"""
Workflow State Machine Service
Manages state transitions for StudentApplication and StudentCourseSelection.
"""

from datetime import datetime
from typing import Optional

from sqlalchemy.orm import Session
from sqlalchemy import or_, and_, cast, String

from db.models import (
    StudentApplication,
    StudentCourseSelection,
    WorkflowStateLog,
    AuditLog,
    Course,
)

# Valid state transitions for applications (simplified to 5 statuses)
VALID_APP_TRANSITIONS = {
    "not_selected": ["draft", "submitted"],  # legacy default
    "draft": ["submitted"],
    "submitted": ["draft", "rejected", "learning_agreement_ready", "revision_requested"],
    "rejected": ["draft"],
    "learning_agreement_ready": ["submitted", "revision_requested"],
    "revision_requested": ["submitted", "draft", "rejected"],
}

# Valid state transitions for individual course selections (unchanged)
VALID_SELECTION_TRANSITIONS = {
    "not_selected": ["draft_selected", "submitted_for_review", "approved", "rejected"],
    "draft_selected": ["not_selected", "submitted_for_review"],
    "submitted_for_review": ["approved", "rejected", "manual_review_required", "draft_selected", "not_selected"],
    "approved": ["rejected", "manual_review_required", "approved", "not_selected", "submitted_for_review"],
    "rejected": ["draft_selected", "approved", "manual_review_required", "not_selected", "rejected", "submitted_for_review"],
    "manual_review_required": ["approved", "rejected", "draft_selected", "manual_review_required", "not_selected", "submitted_for_review"],
}


class WorkflowService:
    @staticmethod
    def transition_application(
        db: Session,
        app_id: int,
        new_state: str,
        actor_id: Optional[int] = None,
        actor_role: Optional[str] = None,
        reason: Optional[str] = None,
    ) -> StudentApplication:
        app = db.query(StudentApplication).filter(StudentApplication.id == app_id).first()
        if not app:
            raise ValueError(f"Application {app_id} not found")

        current = app.status
        if new_state not in VALID_APP_TRANSITIONS.get(current, []):
            raise ValueError(
                f"Invalid transition: {current} -> {new_state}. "
                f"Valid: {VALID_APP_TRANSITIONS.get(current, [])}"
            )

        old_state = app.status
        app.status = new_state

        if new_state == "submitted" and old_state != "submitted":
            app.submitted_at = datetime.utcnow()
        if new_state in ("submitted", "learning_agreement_ready"):
            if actor_id:
                app.reviewer_id = actor_id

        WorkflowService._log_transition(
            db, "student_application", app_id, old_state, new_state,
            actor_id, actor_role, reason,
        )

        db.commit()
        return app

    @staticmethod
    def transition_selection(
        db: Session,
        selection_id: int,
        new_state: str,
        actor_id: Optional[int] = None,
        actor_role: Optional[str] = None,
        reason: Optional[str] = None,
    ) -> StudentCourseSelection:
        sel = db.query(StudentCourseSelection).filter(
            StudentCourseSelection.id == selection_id
        ).first()
        if not sel:
            raise ValueError(f"Selection {selection_id} not found")

        current = sel.status
        if new_state != current and new_state not in VALID_SELECTION_TRANSITIONS.get(current, []):
            raise ValueError(
                f"Invalid selection transition: {current} -> {new_state}. "
                f"Valid: {VALID_SELECTION_TRANSITIONS.get(current, [])}"
            )

        old_state = sel.status
        sel.status = new_state

        WorkflowService._log_transition(
            db, "student_course_selection", selection_id, old_state, new_state,
            actor_id, actor_role, reason,
        )

        db.commit()
        return sel

    @staticmethod
    def recompute_application_state(db: Session, app_id: int) -> str:
        """Derive application state from children selection states."""
        app = db.query(StudentApplication).filter(StudentApplication.id == app_id).first()
        if not app:
            raise ValueError(f"Application {app_id} not found")

        selections = db.query(StudentCourseSelection).filter(
            StudentCourseSelection.application_id == app_id
        ).all()

        if not selections:
            new_state = "draft"
        else:
            statuses = {s.status for s in selections}
            
            # Application stays in the status set by the coordinator/workflow explicitly.
            # We only auto-transition to 'draft' if it was draft before or has draft items.
            # But we NEVER auto-transition OUT of 'submitted' to 'rejected'.
            
            if app.status == "submitted":
                new_state = "submitted"
            elif any(s == "draft_selected" for s in statuses) or app.status == "draft":
                new_state = "draft"
            else:
                new_state = app.status
        
        if new_state != app.status:
            old = app.status
            app.status = new_state
            WorkflowService._log_transition(
                db, "student_application", app_id, old, new_state,
                None, "system", "Auto-recomputed from selections",
            )
            db.commit()

        return new_state

    @staticmethod
    def check_learning_agreement(db: Session, app_id: int) -> bool:
        """If approved ECTS >= 28, transition to learning_agreement_ready."""
        app = db.query(StudentApplication).filter(StudentApplication.id == app_id).first()
        if not app:
            raise ValueError(f"Application {app_id} not found")

        approved_ects = db.query(
            Course.ects
        ).join(
            StudentCourseSelection,
            StudentCourseSelection.partner_course_id == Course.id,
        ).filter(
            StudentCourseSelection.application_id == app_id,
            StudentCourseSelection.status != "not_selected"
        ).filter(
            or_(
                StudentCourseSelection.status == "approved",
                and_(
                    StudentCourseSelection.coordinator_override_course_ids.isnot(None),
                    cast(StudentCourseSelection.coordinator_override_course_ids, String) != '[]'
                )
            )
        ).all()

        total = sum(row[0] or 0 for row in approved_ects)
        app.approved_partner_ects = total

        # Home ECTS snapshot — Skip home ECTS gate if there are review-request rows
        from backend.services.ects import compute_home_ects, has_review_requests
        selections = db.query(StudentCourseSelection).filter(
            StudentCourseSelection.application_id == app_id
        ).all()
        home_total, home_approved = compute_home_ects(db, selections)
        db.commit()

        # Pending = courses without approved status AND without overrides
        pending_items = db.query(StudentCourseSelection).filter(
            StudentCourseSelection.application_id == app_id,
            StudentCourseSelection.status.in_([
                "manual_review_required", "submitted_for_review"
            ]),
            or_(
                StudentCourseSelection.coordinator_override_course_ids.is_(None),
                cast(StudentCourseSelection.coordinator_override_course_ids, String) == '[]'
            )
        ).count()

        home_ok = home_approved >= 30 or has_review_requests(selections)
        return total >= 28 and home_ok and pending_items == 0 and app.status == "submitted"

    @staticmethod
    def bulk_transition_selections(
        db: Session,
        app_id: int,
        from_state: str,
        to_state: str,
        actor_id: Optional[int] = None,
        actor_role: Optional[str] = None,
    ) -> int:
        """Bulk transition all selections matching from_state."""
        selections = db.query(StudentCourseSelection).filter(
            StudentCourseSelection.application_id == app_id,
            StudentCourseSelection.status == from_state,
        ).all()

        count = 0
        for sel in selections:
            if to_state in VALID_SELECTION_TRANSITIONS.get(sel.status, []):
                old = sel.status
                sel.status = to_state
                WorkflowService._log_transition(
                    db, "student_course_selection", sel.id, old, to_state,
                    actor_id, actor_role, "Bulk transition",
                )
                count += 1

        db.commit()
        return count

    @staticmethod
    def _log_transition(
        db: Session,
        entity_type: str,
        entity_id: int,
        from_state: Optional[str],
        to_state: str,
        actor_id: Optional[int],
        actor_role: Optional[str],
        reason: Optional[str],
    ):
        # DETECT SILENT TRANSITIONS
        effective_reason = reason if reason else "SILENT_TRANSITION_DETECTED"
        
        db.add(WorkflowStateLog(
            entity_type=entity_type,
            entity_id=entity_id,
            from_state=from_state,
            to_state=to_state,
            actor_id=actor_id,
            actor_role=actor_role,
            reason=effective_reason,
        ))

        actor_name = None
        if actor_id:
            from db.models import User
            user = db.query(User).filter(User.id == actor_id).first()
            if user:
                actor_name = user.name

        db.add(AuditLog(
            actor_id=actor_id,
            action="WORKFLOW_TRANSITION",
            details={
                "entity_type": entity_type,
                "entity_id": entity_id,
                "from_state": from_state,
                "to_state": to_state,
                "actor_name": actor_name,
                "actor_role": actor_role,
                "reason": reason,
            },
        ))
