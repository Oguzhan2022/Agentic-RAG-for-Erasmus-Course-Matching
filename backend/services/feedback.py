"""
Coordinator Feedback Learning Service
Logs coordinator decisions for ML/prompt tuning and analytics.
"""

from datetime import datetime
from typing import Optional, Dict, Any, List

from sqlalchemy.orm import Session
from sqlalchemy import func

from db.models import CoordinatorReview, AuditLog, User


VALID_DECISIONS = {"approve", "reject", "override", "manual_review"}
VALID_REASON_CATEGORIES = {
    "insufficient_core_coverage",
    "ects_insufficient",
    "structural_mismatch",
    "no_suitable_equivalent",
    "manual_review_needed",
    "other",
}


class FeedbackService:
    @staticmethod
    def log_decision(
        db: Session,
        coordinator_id: int,
        partner_course_id: int,
        decision: str,
        selection_id: Optional[int] = None,
        application_id: Optional[int] = None,
        home_course_id: Optional[int] = None,
        course_match_id: Optional[int] = None,
        override_reason_category: Optional[str] = None,
        override_details: Optional[str] = None,
        original_score: Optional[float] = None,
        original_verification_status: Optional[str] = None,
        override_home_course_id: Optional[int] = None,
        metadata: Optional[Dict[str, Any]] = None,
        notes: Optional[str] = None,
    ) -> CoordinatorReview:
        if override_reason_category and override_reason_category not in VALID_REASON_CATEGORIES:
            raise ValueError(f"Invalid reason category: {override_reason_category}")

        coord_review = CoordinatorReview(
            coordinator_id=coordinator_id,
            application_id=application_id,
            selection_id=selection_id,
            partner_course_id=partner_course_id,
            home_course_id=home_course_id,
            course_match_id=course_match_id,
            action=decision,
            override_details=override_details,
            override_home_course_id=override_home_course_id,
            notes=notes or override_details,
        )
        db.add(coord_review)

        # Audit log
        coord_name = None
        if coordinator_id:
            coord = db.query(User).filter(User.id == coordinator_id).first()
            if coord:
                coord_name = coord.name

        db.add(AuditLog(
            actor_id=coordinator_id,
            action="COORDINATOR_DECISION",
            details={
                "coordinator_name": coord_name,
                "decision": decision,
                "reason_category": override_reason_category,
                "partner_course_id": partner_course_id,
                "home_course_id": home_course_id,
                "override_details": override_details or notes,
                "original_score": original_score,
                "original_verification_status": original_verification_status,
            },
        ))

        return coord_review

    @staticmethod
    def get_feedback_dataset(
        db: Session,
        filters: Optional[Dict[str, Any]] = None,
    ) -> List[CoordinatorReview]:
        query = db.query(CoordinatorReview)
        if filters:
            if filters.get("decision"):
                query = query.filter(CoordinatorReview.action == filters["decision"])
            if filters.get("coordinator_id"):
                query = query.filter(CoordinatorReview.coordinator_id == filters["coordinator_id"])
            if filters.get("date_from"):
                query = query.filter(CoordinatorReview.created_at >= filters["date_from"])
            if filters.get("date_to"):
                query = query.filter(CoordinatorReview.created_at <= filters["date_to"])
            if filters.get("application_id"):
                query = query.filter(CoordinatorReview.application_id == filters["application_id"])
        return query.order_by(CoordinatorReview.created_at.desc()).all()

    @staticmethod
    def get_stats(
        db: Session,
        coordinator_id: Optional[int] = None,
        department_id: Optional[int] = None,
    ) -> Dict[str, Any]:
        query = db.query(CoordinatorReview)
        if coordinator_id:
            query = query.filter(CoordinatorReview.coordinator_id == coordinator_id)

        # By decision type
        by_decision = (
            db.query(CoordinatorReview.action, func.count(CoordinatorReview.id))
            .group_by(CoordinatorReview.action)
            .all()
        )

        total = (
            db.query(func.count(CoordinatorReview.id)).scalar() or 0
        )

        return {
            "total_decisions": total,
            "by_decision": {d: c for d, c in by_decision},
            "by_reason_category": {},
        }
