import logging
"""
Coordinator Review Panel Router
Endpoints for coordinators to review and approve/reject student applications.
"""

from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from db.database import get_db
from db.models import (
    StudentApplication, StudentCourseSelection, CourseMatch, Course,
    University, User, CoordinatorReview,
)
from sqlalchemy import or_, and_, func as sqlfunc, cast, String
from authorization.middleware import require_role
from backend.services.workflow import WorkflowService
from backend.services.feedback import FeedbackService
from backend.services.ects import compute_home_ects, has_review_requests

router = APIRouter(prefix="/api/coordinator", tags=["coordinator"])
logger = logging.getLogger("coordinator")


def _check_home_course_collision(db: Session, app_id: int, home_ids: List[int], exclude_selection_id: int):
    """Raise error if any of the provided home_ids are already used elsewhere in the same app."""
    # Collision check disabled: allow using the same home course multiple times
    return

    # Original logic (for reference)
    # for s in other_sels:


@router.get("/applications")
async def list_applications(
    status: Optional[str] = None,
    university_id: Optional[int] = None,
    department_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(["coordinator", "dept_admin", "super_admin"])),
):
    query = db.query(StudentApplication)
    if status:
        query = query.filter(StudentApplication.status == status)
    if university_id:
        query = query.filter(StudentApplication.partner_university_id == university_id)
    if department_id:
        query = query.filter(StudentApplication.department_id == department_id)
    query = query.order_by(StudentApplication.updated_at.desc())
    apps = query.all()

    result = []
    for app in apps:
        student = db.query(User).filter(User.id == app.student_id).first()
        uni = db.query(University).filter(University.id == app.partner_university_id).first()
        from sqlalchemy import or_, func as sqlfunc
        all_sels_for_count = db.query(StudentCourseSelection).filter(
            StudentCourseSelection.application_id == app.id
        ).all()
        # Define active (student-intent) selections: everything not removed or rejected
        active_sels = [s for s in all_sels_for_count if s.status != "not_selected" and s.status != "rejected" and (
            s.status in ["submitted_for_review", "approved", "manual_review_required", "draft_selected"] or
            s.no_match_requested or
            (s.alternative_home_course_ids and len(s.alternative_home_course_ids) > 0)
        )]
        
        selection_count = len(active_sels)
        
        # Approved count: derived from active selections
        approved_count = sum(1 for s in active_sels if (
            s.status == "approved" or 
            (s.coordinator_override_course_ids and len(s.coordinator_override_course_ids) > 0)
        ))
        
        pending_count = sum(1 for s in active_sels if (
            s.status in ["submitted_for_review", "draft_selected", "manual_review_required"] and
            not (s.coordinator_override_course_ids and len(s.coordinator_override_course_ids) > 0)
        ))
        # Approved ECTS: approved + override_pending where override IS student's own suggestion (*APPROVED case)
        all_sels_ects = db.query(StudentCourseSelection, Course.ects).join(
            Course, StudentCourseSelection.partner_course_id == Course.id,
        ).filter(
            StudentCourseSelection.application_id == app.id,
            StudentCourseSelection.status != "not_selected",
            or_(
                StudentCourseSelection.status == "approved",
                and_(
                    StudentCourseSelection.coordinator_override_course_ids.isnot(None),
                    cast(StudentCourseSelection.coordinator_override_course_ids, String) != '[]'
                )
            )
        ).all()
        live_approved_ects = 0
        for sel, ects in all_sels_ects:
            live_approved_ects += ects or 0
        selected_ects_rows = db.query(Course.ects).join(
            StudentCourseSelection,
            StudentCourseSelection.partner_course_id == Course.id,
        ).filter(
            StudentCourseSelection.application_id == app.id,
            StudentCourseSelection.status != "not_selected",
            StudentCourseSelection.status != "rejected",
            or_(
                StudentCourseSelection.status.in_(["submitted_for_review", "draft_selected", "approved", "manual_review_required"]),
                StudentCourseSelection.no_match_requested == True,
                and_(
                    StudentCourseSelection.alternative_home_course_ids.isnot(None),
                    cast(StudentCourseSelection.alternative_home_course_ids, String) != '[]'
                )
            )
        ).all()
        live_total_ects = sum(r[0] or 0 for r in selected_ects_rows)

        result.append({
            "id": app.id,
            "student": {"id": student.id, "name": student.name, "eid": student.eid} if student else None,
            "partner_university": {"id": uni.id, "name": uni.name} if uni else None,
            "department": None,
            "semester": app.semester,
            "status": app.status,
            "total_partner_ects": live_total_ects,
            "approved_partner_ects": live_approved_ects,
            "total_selections": selection_count,
            "reviewed_selections": approved_count,
            "pending_selections": pending_count,
            "submitted_at": app.submitted_at.isoformat() if app.submitted_at else None,
        })
    return result


@router.delete("/applications/{app_id}")
async def delete_application(
    app_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(["coordinator", "dept_admin", "super_admin"])),
):
    app = db.query(StudentApplication).filter(StudentApplication.id == app_id).first()
    if not app:
        raise HTTPException(status_code=404, detail="Application not found")
    
    # Explicitly delete all coordinator reviews/decisions for this application to prevent orphan records
    db.query(CoordinatorReview).filter(CoordinatorReview.application_id == app_id).delete(synchronize_session=False)
    
    db.delete(app)
    db.commit()
    logger.info(f"Coordinator {current_user.id} deleted application {app_id}")
    return {"deleted": True}


@router.get("/applications/{app_id}")
async def get_application_detail(
    app_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(["coordinator", "dept_admin", "super_admin", "registrar"])),
):
    app = db.query(StudentApplication).filter(StudentApplication.id == app_id).first()
    if not app:
        raise HTTPException(status_code=404, detail="Application not found")

    # Sync selections with current course catalog (new courses, updated matches, inactive removals)
    from backend.routers.courses import sync_application_selections
    sync_application_selections(db, app)

    # Mark as viewed by coordinator (locks student from editing)
    if app.coordinator_viewed_at is None and app.status == "submitted":
        from datetime import datetime
        app.coordinator_viewed_at = datetime.utcnow()
        db.commit()

    selections = db.query(StudentCourseSelection).filter(
        StudentCourseSelection.application_id == app_id
    ).all()

    # --- Bulk pre-fetch to eliminate N+1 queries ---
    partner_ids = [sel.partner_course_id for sel in selections]
    home_ids = set()
    for sel in selections:
        if sel.selected_home_course_id:
            home_ids.add(sel.selected_home_course_id)
        for hid in (sel.selected_home_course_ids or []):
            home_ids.add(hid)
        for hid in (sel.alternative_home_course_ids or []):
            home_ids.add(hid)
        for hid in (sel.coordinator_override_course_ids or []):
            home_ids.add(hid)
    all_course_ids = list(set(partner_ids) | home_ids)
    courses_by_id = {c.id: c for c in db.query(Course).filter(Course.id.in_(all_course_ids)).all()} if all_course_ids else {}

    # Bulk fetch match candidates
    all_matches = db.query(CourseMatch).filter(
        CourseMatch.partner_course_id.in_(partner_ids),
        CourseMatch.source == "batch",
    ).order_by(CourseMatch.overall_score.desc()).all() if partner_ids else []
    matches_by_partner: dict = {}
    for m in all_matches:
        matches_by_partner.setdefault(m.partner_course_id, []).append(m)
        home_ids.add(m.home_course_id)
    # Refetch if new home IDs discovered from matches
    missing_ids = home_ids - set(courses_by_id.keys())
    if missing_ids:
        courses_by_id.update({c.id: c for c in db.query(Course).filter(Course.id.in_(missing_ids)).all()})

    # Bulk fetch coordinator reviews
    sel_ids = [sel.id for sel in selections]
    all_reviews = db.query(CoordinatorReview).filter(
        CoordinatorReview.selection_id.in_(sel_ids),
        CoordinatorReview.notes.isnot(None),
    ).order_by(CoordinatorReview.id.desc()).all() if sel_ids else []
    review_by_sel: dict = {}
    for r in all_reviews:
        if r.selection_id not in review_by_sel:
            review_by_sel[r.selection_id] = r

    # Bulk fetch match verifications for selected home courses
    ver_pairs = []
    for sel in selections:
        for hid in (sel.selected_home_course_ids or []):
            ver_pairs.append((sel.partner_course_id, hid))
    if ver_pairs:
        from sqlalchemy import and_, or_
        ver_filters = or_(*[and_(CourseMatch.partner_course_id == pid, CourseMatch.home_course_id == hid) for pid, hid in ver_pairs])
        ver_matches = db.query(CourseMatch).filter(ver_filters).order_by(CourseMatch.overall_score.desc()).all()
        ver_by_pair: dict = {}
        for vm in ver_matches:
            key = (vm.partner_course_id, vm.home_course_id)
            if key not in ver_by_pair:
                ver_by_pair[key] = vm
    else:
        ver_by_pair = {}

    result = []
    for sel in selections:
        partner = courses_by_id.get(sel.partner_course_id)
        home = courses_by_id.get(sel.selected_home_course_id) if sel.selected_home_course_id else None
        # Get match candidates (already bulk-fetched, take top 5)
        candidates = matches_by_partner.get(sel.partner_course_id, [])[:5]

        candidate_list = []
        for c in candidates:
            c_home = courses_by_id.get(c.home_course_id)
            candidate_list.append({
                "id": c.id,
                "home_course_id": c.home_course_id,
                "home_course_name": c_home.course_name if c_home else "Unknown",
                "home_course_code": c_home.course_code if c_home else None,
                "home_course_ects": c_home.ects if c_home else None,
                "home_course_department": (c_home.academic_context or {}).get("department") if c_home else None,
                "home_course_category": (c_home.source_metadata or {}).get("category") if c_home and c_home.source_metadata else None,
                "overall_score": c.overall_score,
                "rank": c.rank,
                "category": c.category,
                "verification_status": c.verification_status,
                "verification_confidence": c.verification_confidence,
                "verification_reason": c.verification_reason,
                "verification_risk_flags": c.verification_risk_flags,
                "is_recommended": c.is_recommended,
                "score_breakdown": c.score_breakdown,
                "matched_topics": c.matched_topics,
                "missing_topics": c.missing_topics,
                "extra_partner_topics": c.extra_partner_topics,
                "core_home_topics": c.core_home_topics,
                "structural_notes": c.structural_notes,
                "warnings": c.warnings,
                "content_overlap_assessment": c.content_overlap_assessment,
                "core_topic_coverage": c.core_topic_coverage,
                "is_not_recommended": c.verification_status == "rejected",
            })

        # Resolve alternative course names
        alt_ids = sel.alternative_home_course_ids or []
        alternative_home_course_names: dict = {}
        alternative_home_courses_detail = []
        for hc_id in alt_ids:
            hc = courses_by_id.get(hc_id)
            if hc:
                alternative_home_course_names[hc_id] = f"{hc.course_code} — {hc.course_name}" if hc.course_code else hc.course_name
                alternative_home_courses_detail.append({
                    "id": hc.id,
                    "course_code": hc.course_code,
                    "course_name": hc.course_name,
                    "ects": hc.ects,
                    "category": (hc.source_metadata or {}).get("category") if hc.source_metadata else None,
                    "department": (hc.academic_context or {}).get("department", ""),
                })

        # All selected home course IDs + resolved names + verification statuses
        sel_home_ids = sel.selected_home_course_ids or []
        selected_home_courses_detail = []
        selected_home_course_verifications: dict = {}
        for hc_id in sel_home_ids:
            hc_obj = courses_by_id.get(hc_id)
            hc_match = ver_by_pair.get((sel.partner_course_id, hc_id))
            ver = hc_match.verification_status if hc_match else None
            selected_home_course_verifications[hc_id] = ver
            if hc_obj:
                selected_home_courses_detail.append({
                    "id": hc_obj.id,
                    "course_code": hc_obj.course_code,
                    "course_name": hc_obj.course_name,
                    "ects": hc_obj.ects,
                    "department": (hc_obj.academic_context or {}).get("department", ""),
                    "category": (hc_obj.source_metadata or {}).get("category") if hc_obj.source_metadata else None,
                    "verification_status": ver,
                })

        # Primary verification (for backward compat)
        selected_home_course_verification = selected_home_course_verifications.get(sel.selected_home_course_id) if sel.selected_home_course_id else None

        has_recommended_candidates = any(
            c["verification_status"] in ("approved", "risk_flagged") for c in candidate_list
        )

        # Last coordinator note for this selection
        last_review = review_by_sel.get(sel.id)
        coordinator_note = last_review.notes if last_review else None

        # Resolve coordinator override courses
        override_ids = sel.coordinator_override_course_ids or []
        coordinator_override_courses = []
        for oc_id in override_ids:
            oc = courses_by_id.get(oc_id)
            if oc:
                coordinator_override_courses.append({
                    "id": oc.id,
                    "course_code": oc.course_code,
                    "course_name": oc.course_name,
                    "ects": oc.ects,
                    "department": (oc.academic_context or {}).get("department", ""),
                    "category": (oc.source_metadata or {}).get("category") if oc.source_metadata else None,
                })

        result.append({
            "id": sel.id,
            "status": sel.status,
            "was_approved": sel.was_approved or False,
            "coordinator_note": coordinator_note,
            "coordinator_override_courses": coordinator_override_courses,
            "partner_course": {
                "id": partner.id, "course_code": partner.course_code,
                "course_name": partner.course_name, "ects": partner.ects,
                "content": partner.content, "learning_outcomes": partner.learning_outcomes,
                "level": (partner.academic_context or {}).get("level", ""), "semester": (partner.academic_context or {}).get("semester", ""),
            } if partner else None,
            "selected_home_course": {
                "id": home.id, "course_code": home.course_code,
                "course_name": home.course_name, "ects": home.ects,
                "department": (home.academic_context or {}).get("department", ""),
            } if home else None,
            "selected_home_course_ids": sel_home_ids,
            "selected_home_courses": selected_home_courses_detail,
            "selected_home_course_verifications": selected_home_course_verifications,
            "selected_home_course_verification": selected_home_course_verification,
            "student_note": sel.student_notes,
            "no_match_requested": sel.no_match_requested,
            "alternative_home_course_ids": alt_ids,
            "alternative_reason": sel.alternative_reason,
            "alternative_home_course_names": alternative_home_course_names,
            "alternative_home_courses_detail": alternative_home_courses_detail,
            "has_recommended_candidates": has_recommended_candidates,
            "candidates": candidate_list,
            "coordinator_override_course_ids": sel.coordinator_override_course_ids or [],
            "rejection_count": 0, # Strike system removed
        })

    student = db.query(User).filter(User.id == app.student_id).first()
    uni = db.query(University).filter(University.id == app.partner_university_id).first()
    _home_total, _home_approved = compute_home_ects(db, selections)
    _has_review = has_review_requests(selections)
    def _counts_as_approved(s: dict) -> bool:
        has_override = len(s.get("coordinator_override_course_ids") or []) > 0
        return s["status"] == "approved" or has_override
    live_approved_ects = sum(
        (s["partner_course"]["ects"] or 0)
        for s in result
        if _counts_as_approved(s) and s["partner_course"]
    )
    live_total_ects = 0
    for s in result:
        status = s.get("status")
        no_match = s.get("no_match_requested")
        has_alt = len(s.get("alternative_home_course_ids") or []) > 0
        
        if (status not in ("not_selected", "rejected") or no_match or has_alt) and s.get("partner_course"):
            live_total_ects += (s["partner_course"]["ects"] or 0)
    return {
        "application": {
            "id": app.id,
            "status": app.status,
            "semester": app.semester,
            "student_notes": app.student_notes,
            "coordinator_notes": app.coordinator_notes,
            "coordinator_editing": app.coordinator_editing or False,
            "submitted_at": app.submitted_at.isoformat() if app.submitted_at else None,
            "coordinator_viewed_at": app.coordinator_viewed_at.isoformat() if app.coordinator_viewed_at else None,
            "student_draft_viewed_at": app.student_draft_viewed_at.isoformat() if app.student_draft_viewed_at else None,
            "student": {"id": student.id, "name": student.name, "eid": student.eid} if student else None,
            "partner_university": {"id": uni.id, "name": uni.name} if uni else None,
            "total_partner_ects": live_total_ects,
            "approved_partner_ects": live_approved_ects,
            "total_home_ects": _home_total,
            "approved_home_ects": _home_approved,
            "has_review_requests": _has_review,
        },
        "selections": result,
    }


@router.post("/applications/{app_id}/review-selection")
async def review_selection(
    app_id: int,
    body: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(["coordinator", "dept_admin", "super_admin"])),
):
    app = db.query(StudentApplication).filter(StudentApplication.id == app_id).first()
    if not app:
        raise HTTPException(status_code=404, detail="Application not found")

    selection_id = body.get("selection_id")
    action = body.get("action")  # approve, reject, override, manual_review_required
    notes = body.get("notes")

    sel = db.query(StudentCourseSelection).filter(
        StudentCourseSelection.id == selection_id
    ).first()
    if not sel:
        raise HTTPException(status_code=404, detail="Selection not found")

    # Delete all previous decision history for this selection to enforce Single Decision Principle
    db.query(CoordinatorReview).filter(
        CoordinatorReview.selection_id == selection_id,
    ).delete(synchronize_session=False)

    # Strike system removed - auto-clear block removed

    if action == "override":
        override_home_ids = body.get("override_home_course_ids") or []
        if isinstance(override_home_ids, int):
            override_home_ids = [override_home_ids]
        # Backward compat: also accept single id
        single_id = body.get("override_home_course_id")
        if single_id and single_id not in override_home_ids:
            override_home_ids.append(single_id)
        if not override_home_ids:
            raise HTTPException(status_code=400, detail="override_home_course_ids required for override")

        # Collision check BEFORE override
        _check_home_course_collision(db, app_id, override_home_ids, selection_id)

        # Replace (not merge) — coordinator explicitly sets the final list
        sel.coordinator_override_course_ids = override_home_ids

        # Remove override IDs from rejected list if they exist there
        current_rejected = [rid for rid in (sel.rejected_home_course_ids or []) if rid not in override_home_ids]
        sel.rejected_home_course_ids = current_rejected

        # Update match id for the latest override course
        new_match = db.query(CourseMatch).filter(
            CourseMatch.partner_course_id == sel.partner_course_id,
            CourseMatch.home_course_id == override_home_ids[-1],
        ).first()
        if new_match:
            sel.course_match_id = new_match.id

        # True override — transition to approved immediately (Coordinator is final)
        # We NO LONGER overwrite sel.selected_home_course_ids. 
        # We keep the student's choice for audit/UI, but status 'approved' with coordinator_override set
        # means the override IS the approved one.
        WorkflowService.transition_selection(db, sel.id, "approved", current_user.id, "coordinator", f"Coordinator final override. Note: {notes}")

    elif action == "clear_override":
        sel.coordinator_override_course_ids = []
        sel.selected_home_course_id = (sel.selected_home_course_ids or [None])[0]
        # Delete all decision history for this selection to leave no trace of override/clear actions
        db.query(CoordinatorReview).filter(
            CoordinatorReview.selection_id == selection_id,
        ).delete(synchronize_session=False)
    elif action == "reject":
        # Save current selections to rejected list for history
        current_rejected = set(sel.rejected_home_course_ids or [])
        current_rejected.update(sel.selected_home_course_ids or [])
        sel.rejected_home_course_ids = list(current_rejected)

        # Transition status but DO NOT clear the selection IDs yet.
        # This allows the coordinator to 'Undo' or 'Approve' later if they change their mind.
        sel.coordinator_override_course_ids = []  # Clear override if rejecting
        WorkflowService.transition_selection(db, selection_id, "rejected", current_user.id, "coordinator")
    elif action in ("approve", "manual_review_required", "clear_override"):
        # Strike system removed - auto-clear block removed


        if action == "clear_override":
             WorkflowService.transition_selection(db, selection_id, "submitted_for_review", current_user.id, "coordinator")
        else:
            state_map = {"approve": "approved", "manual_review_required": "manual_review_required"}
            if action == 'approve':
                # Collision check BEFORE approving student selection
                ids_to_check = list(sel.selected_home_course_ids or [])
                if sel.selected_home_course_id and sel.selected_home_course_id not in ids_to_check:
                    ids_to_check.append(sel.selected_home_course_id)
                _check_home_course_collision(db, app_id, ids_to_check, selection_id)
                
                sel.coordinator_override_course_ids = [] # Clear override if approving original

                # Remove approved IDs from rejected list if they exist there
                current_rejected = [rid for rid in (sel.rejected_home_course_ids or []) if rid not in ids_to_check]
                sel.rejected_home_course_ids = current_rejected
            
            WorkflowService.transition_selection(db, selection_id, state_map[action], current_user.id, "coordinator")
    else:
        raise HTTPException(status_code=400, detail=f"Invalid action: {action}")


    # Log review action / feedback decision
    if action != "clear_override":
        reason_category = body.get("reason_category")
        match = db.query(CourseMatch).filter(CourseMatch.id == sel.course_match_id).first() if sel.course_match_id else None
        FeedbackService.log_decision(
            db, current_user.id, sel.partner_course_id, action if action != "manual_review_required" else "manual_review",
            selection_id=selection_id,
            application_id=app_id,
            home_course_id=sel.selected_home_course_id,
            course_match_id=sel.course_match_id,
            override_reason_category=reason_category,
            override_details=notes,
            original_score=match.overall_score if match else None,
            original_verification_status=match.verification_status if match else None,
            override_home_course_id=body.get("override_home_course_id"),
            notes=notes,
        )
    else:
        # For clear_override, we do not log any new action; we just clear the history and recompute
        WorkflowService.check_learning_agreement(db, app_id)
        db.commit()
        WorkflowService.recompute_application_state(db, app_id)
        return {"status": "ok"}

    WorkflowService.check_learning_agreement(db, app_id)
    db.commit()
    logger.info(f"Coordinator {current_user.id} performed action '{action}' on selection {selection_id} in application {app_id}")

    return {"selection_id": selection_id, "action": action}

    return {"selection_id": selection_id, "action": action}


@router.post("/applications/{app_id}/send-back")
async def send_back(
    app_id: int,
    body: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(["coordinator", "dept_admin", "super_admin"])),
):
    app = db.query(StudentApplication).filter(StudentApplication.id == app_id).first()
    if not app:
        raise HTTPException(status_code=404, detail="Application not found")

    app.coordinator_notes = body.get("notes") or app.coordinator_notes

    WorkflowService.bulk_transition_selections(db, app_id, "submitted_for_review", "draft_selected", current_user.id, "coordinator")
    WorkflowService.bulk_transition_selections(db, app_id, "reviewed", "draft_selected", current_user.id, "coordinator")
    
    app_obj = db.query(StudentApplication).filter(StudentApplication.id == app_id).first()
    if app_obj and app_obj.status != "revision_requested":
        WorkflowService.transition_application(db, app_id, "revision_requested", current_user.id, "coordinator", body.get("notes"))
    elif app_obj and body.get("notes"):
        app_obj.coordinator_notes = body.get("notes")

    # Reset student view flag
    if app_obj:
        app_obj.student_draft_viewed_at = None
        app_obj.student_editing = True
    db.commit()
    logger.info(f"Coordinator {current_user.id} sent application {app_id} back to student for revision")
    return {"application_id": app_id, "status": "revision_requested"}


@router.post("/applications/{app_id}/bulk-approve-submitted")
async def bulk_approve_submitted(
    app_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(["coordinator", "dept_admin", "super_admin"])),
):
    app = db.query(StudentApplication).filter(StudentApplication.id == app_id).first()
    if not app:
        raise HTTPException(status_code=404, detail="Application not found")

    selections = db.query(StudentCourseSelection).filter(
        StudentCourseSelection.application_id == app_id,
        StudentCourseSelection.status == "submitted_for_review",
    ).all()

    # Filter to only plain submitted: no alternatives, no no_match_requested, no override
    plain = []
    for sel in selections:
        has_alternatives = bool(sel.alternative_home_course_ids)
        has_no_match = bool(sel.no_match_requested)
        has_override = bool(sel.coordinator_override_course_ids)
        if not has_alternatives and not has_no_match and not has_override:
            plain.append(sel)

    if not plain:
        raise HTTPException(status_code=400, detail="No plain submitted selections to approve")

    approved_count = 0
    for sel in plain:
        sel.coordinator_override_course_ids = []
        WorkflowService.transition_selection(db, sel.id, "approved", current_user.id, "coordinator")

        # Log review action / feedback decision
        match = db.query(CourseMatch).filter(CourseMatch.id == sel.course_match_id).first() if sel.course_match_id else None
        FeedbackService.log_decision(
            db, current_user.id, sel.partner_course_id, "approve",
            selection_id=sel.id,
            application_id=app_id,
            home_course_id=sel.selected_home_course_id,
            course_match_id=sel.course_match_id,
            original_score=match.overall_score if match else None,
            original_verification_status=match.verification_status if match else None,
            notes="Bulk approved",
        )
        approved_count += 1

    WorkflowService.check_learning_agreement(db, app_id)
    db.commit()
    logger.info(f"Coordinator {current_user.id} bulk-approved {approved_count} plain submitted selections in app {app_id}")

    return {"approved_count": approved_count, "application_id": app_id}


@router.patch("/applications/{app_id}/editing-state")
async def set_editing_state(
    app_id: int,
    body: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(["coordinator", "dept_admin", "super_admin"])),
):
    app = db.query(StudentApplication).filter(StudentApplication.id == app_id).first()
    if not app:
        raise HTTPException(status_code=404, detail="Application not found")
    app.coordinator_editing = bool(body.get("editing", False))
    db.commit()
    return {"application_id": app_id, "coordinator_editing": app.coordinator_editing}


@router.post("/applications/{app_id}/send-note")
async def send_note(
    app_id: int,
    body: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(["coordinator", "dept_admin", "super_admin"])),
):
    app = db.query(StudentApplication).filter(StudentApplication.id == app_id).first()
    if not app:
        raise HTTPException(status_code=404, detail="Application not found")

    app.coordinator_notes = body.get("notes") or app.coordinator_notes
    db.commit()
    return {"application_id": app_id}


@router.post("/applications/{app_id}/finalize")
async def finalize_application(
    app_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(["coordinator", "dept_admin", "super_admin"])),
):
    app = db.query(StudentApplication).filter(StudentApplication.id == app_id).first()
    if not app:
        raise HTTPException(status_code=404, detail="Application not found")

    selections = db.query(StudentCourseSelection).filter(
        StudentCourseSelection.application_id == app_id,
    ).all()
    
    # Check if any selection is still truly pending coordinator action
    pending_count = 0
    for sel in selections:
        is_truly_pending = (
            sel.status == "manual_review_required" or 
            (sel.status == "submitted_for_review" and not (sel.coordinator_override_course_ids or []))
        )
        if is_truly_pending:
            pending_count += 1

    if pending_count > 0:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot finalize review: {pending_count} selection(s) still require a coordinator decision."
        )

    # Step 1: Sync the approved ECTS count and check readiness
    WorkflowService.check_learning_agreement(db, app_id)
    
    # Reload app to get updated ECTS
    app = db.query(StudentApplication).filter(StudentApplication.id == app_id).first()
    
    if (app.approved_partner_ects or 0) < 28:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot finalize: Approved ECTS ({app.approved_partner_ects or 0}) is below the required 28."
        )

    total_home, approved_home = compute_home_ects(db, selections)
    db.commit()
    if approved_home < 30 and not has_review_requests(selections):
        raise HTTPException(
            status_code=400,
            detail=f"Cannot finalize: Approved home ECTS ({approved_home}) is below the required 30."
        )

    # Transition to LA Ready (Coordinator has explicitly pressed 'Finalize')
    WorkflowService.transition_application(
        db, app_id, "learning_agreement_ready",
        actor_id=current_user.id, actor_role="coordinator",
        reason="Coordinator finalized application: Marking as LA Ready."
    )
    db.commit()
    logger.info(f"Coordinator {current_user.id} finalized application {app_id} as LA Ready")
    return {"application_id": app_id, "status": "learning_agreement_ready"}

    return {"application_id": app_id, "status": "learning_agreement_ready"}


@router.get("/applications/{app_id}/ects-summary")
async def ects_summary(
    app_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(["coordinator", "dept_admin", "super_admin"])),
):
    app = db.query(StudentApplication).filter(StudentApplication.id == app_id).first()
    if not app:
        raise HTTPException(status_code=404, detail="Application not found")

    selected_ects = db.query(Course.ects).join(
        StudentCourseSelection, StudentCourseSelection.partner_course_id == Course.id,
    ).filter(
        StudentCourseSelection.application_id == app_id,
        StudentCourseSelection.status != "rejected",
        or_(
            StudentCourseSelection.status.in_(["submitted_for_review", "draft_selected", "approved", "manual_review_required"]),
            StudentCourseSelection.no_match_requested == True,
            and_(
                StudentCourseSelection.alternative_home_course_ids.isnot(None),
                cast(StudentCourseSelection.alternative_home_course_ids, String) != '[]'
            )
        )
    ).all()

    approved_ects = db.query(Course.ects).join(
        StudentCourseSelection, StudentCourseSelection.partner_course_id == Course.id,
    ).filter(
        StudentCourseSelection.application_id == app_id,
        StudentCourseSelection.status == "approved",
    ).all()

    total_approved = sum(row[0] or 0 for row in approved_ects)

    pending_or_rejected = db.query(StudentCourseSelection).filter(
        StudentCourseSelection.application_id == app_id,
        StudentCourseSelection.status.in_([
            "rejected", "manual_review_required", "submitted_for_review"
        ])
    ).count()

    all_sels = db.query(StudentCourseSelection).filter(
        StudentCourseSelection.application_id == app_id,
    ).all()
    total_home, approved_home = compute_home_ects(db, all_sels)
    home_threshold = 30

    is_la_ready = (total_approved >= 28) and (pending_or_rejected == 0) and approved_home >= home_threshold

    return {
        "total_partner_ects": sum(row[0] or 0 for row in selected_ects),
        "approved_partner_ects": total_approved,
        "total_home_ects": total_home,
        "approved_home_ects": approved_home,
        "home_target": home_threshold,
        "home_threshold": home_threshold,
        "has_review_requests": has_review_requests(all_sels),
        "learning_agreement_ready": is_la_ready,
        "missing_ects": max(28 - total_approved, 0),
        "missing_home_ects": max(home_threshold - approved_home, 0),
    }


@router.get("/dashboard")
async def dashboard(
    department_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(["coordinator", "dept_admin", "super_admin"])),
):
    query = db.query(StudentApplication)
    if department_id:
        query = query.filter(StudentApplication.department_id == department_id)
    apps = query.all()

    status_counts = {
        "pending_count": sum(1 for a in apps if a.status == "submitted"),
        "approved_count": sum(1 for a in apps if a.status == "learning_agreement_ready"),
        "rejected_count": sum(1 for a in apps if a.status == "rejected"),
        "la_ready_count": sum(1 for a in apps if a.status == "learning_agreement_ready"),
    }

    by_uni = {}
    for a in apps:
        uni = db.query(University).filter(University.id == a.partner_university_id).first()
        name = uni.name if uni else "Unknown"
        by_uni[name] = by_uni.get(name, 0) + 1
    status_counts["by_university"] = by_uni

    return status_counts


@router.get("/decisions")
async def get_decisions(
    coordinator_id: Optional[int] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(["coordinator", "dept_admin", "super_admin"])),
):
    filters: dict = {}
    if coordinator_id:
        filters["coordinator_id"] = coordinator_id
    if date_from:
        filters["date_from"] = date_from
    if date_to:
        filters["date_to"] = date_to

    from backend.services.feedback import FeedbackService
    decisions = FeedbackService.get_feedback_dataset(db, filters)
    return {"decisions": [
        {
            "id": d.id,
            "decision": d.action,
            "override_reason_category": None,
            "override_details": d.override_details,
            "original_score": None,
            "created_at": d.created_at.isoformat() if d.created_at else None,
        }
        for d in decisions
    ], "count": len(decisions)}


@router.get("/decisions/stats")
async def decision_stats(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(["coordinator", "dept_admin", "super_admin"])),
):
    from backend.services.feedback import FeedbackService
    return FeedbackService.get_stats(db)


@router.get("/decisions/export")
async def export_decisions(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(["coordinator", "dept_admin", "super_admin"])),
):
    from backend.services.feedback import FeedbackService
    decisions = FeedbackService.get_feedback_dataset(db)
    return [
        {
            "decision": d.action,
            "reason_category": None,
            "details": d.override_details,
            "original_score": None,
            "original_verification_status": None,
            "partner_course_id": d.partner_course_id,
            "home_course_id": d.home_course_id,
            "override_home_course_id": d.override_home_course_id,
            "metadata": {},
            "created_at": d.created_at.isoformat() if d.created_at else None,
        }
        for d in decisions
    ]


# ── Manual Review Workspace ────────────────────────────────────────────────────

@router.get("/applications/{app_id}/manual-review/{selection_id}")
async def get_manual_review_data(
    app_id: int,
    selection_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(["coordinator", "dept_admin", "super_admin"])),
):
    """Return all data needed for the manual review workspace page."""
    app = db.query(StudentApplication).filter(StudentApplication.id == app_id).first()
    if not app:
        raise HTTPException(status_code=404, detail="Application not found")

    sel = db.query(StudentCourseSelection).filter(
        StudentCourseSelection.id == selection_id,
        StudentCourseSelection.application_id == app_id,
    ).first()
    if not sel:
        raise HTTPException(status_code=404, detail="Selection not found")

    partner = db.query(Course).filter(Course.id == sel.partner_course_id).first()

    # Student's suggested home courses
    alt_ids = sel.alternative_home_course_ids or []
    alt_courses = []
    for cid in alt_ids:
        c = db.query(Course).filter(Course.id == cid).first()
        if c:
            alt_courses.append({
                "id": c.id,
                "course_code": c.course_code,
                "course_name": c.course_name,
                "ects": c.ects,
                "department": (c.academic_context or {}).get("department"),
                "category": (c.source_metadata or {}).get("category") if c.source_metadata else None,
                "content": c.content,
                "learning_outcomes": c.learning_outcomes,
                "academic_context": c.academic_context,
                "level": (c.academic_context or {}).get("level"),
                "semester": (c.academic_context or {}).get("semester"),
            })

    # All match analyses are loaded together below (all_matches_raw) and split by source

    def _analysis_dict(a: CourseMatch) -> dict:
        home = db.query(Course).filter(Course.id == a.home_course_id).first()
        sb = a.score_breakdown or {}
        return {
            "id": a.id,
            "home_course_id": a.home_course_id,
            "home_course_code": home.course_code if home else None,
            "home_course_name": home.course_name if home else None,
            "overall_score": a.overall_score,
            "domain_score": sb.get("domain", {}).get("score"),
            "content_score": sb.get("content", {}).get("score"),
            "outcomes_score": sb.get("outcomes", {}).get("score"),
            "ects_score": sb.get("ects", {}).get("score"),
            "title_score": sb.get("title", {}).get("score"),
            "metadata_score": sb.get("metadata", {}).get("score"),
            "matched_topics": a.matched_topics,
            "missing_topics": a.missing_topics,
            "extra_partner_topics": a.extra_partner_topics,
            "core_home_topics": a.core_home_topics,
            "structural_notes": a.structural_notes,
            "domain_evidence": sb.get("domain", {}).get("evidence"),
            "content_evidence": sb.get("content", {}).get("evidence"),
            "outcomes_evidence": sb.get("outcomes", {}).get("evidence"),
            "score_breakdown": a.score_breakdown,
            "verification_status": a.verification_status,
            "verification_confidence": a.verification_confidence,
            "verification_reason": a.verification_reason,
            "verification_risk_flags": a.verification_risk_flags,
            "is_recommended": a.is_recommended,
            "content_overlap_assessment": a.content_overlap_assessment,
            "core_topic_coverage": a.core_topic_coverage,
            "academic_category": a.category,
            "created_at": a.created_at.isoformat() if a.created_at else None,
        }

    # Student info
    student = db.query(User).filter(User.id == app.student_id).first()

    # Last coordinator action on this selection (for pre-filling notes)
    last_review = db.query(CoordinatorReview).filter(
        CoordinatorReview.selection_id == selection_id,
        CoordinatorReview.action.in_(["manual_review_approve", "manual_review_override", "manual_review_reject"]),
    ).order_by(CoordinatorReview.created_at.desc()).first()

    # Override course detail (if approved)
    override_course = None
    override_ids = sel.coordinator_override_course_ids or []
    if override_ids:
        oc = db.query(Course).filter(Course.id == override_ids[0]).first()
        if oc:
            override_course = {
                "id": oc.id,
                "course_code": oc.course_code,
                "course_name": oc.course_name,
                "ects": oc.ects,
            }

    # Home university
    home_uni = db.query(University).filter(University.is_home == True).first()  # noqa: E712

    # All match results for this partner course (batch + manual)
    all_matches_raw = db.query(CourseMatch).filter(
        CourseMatch.partner_course_id == sel.partner_course_id
    ).order_by(CourseMatch.overall_score.desc()).all()

    def _match_dict(m: CourseMatch) -> dict:
        home = db.query(Course).filter(Course.id == m.home_course_id).first()
        return {
            "id": f"{m.source}_{m.id}",
            "home_course_id": m.home_course_id,
            "home_course_code": home.course_code if home else None,
            "home_course_name": home.course_name if home else None,
            "overall_score": m.overall_score,
            "score_breakdown": m.score_breakdown,
            "matched_topics": m.matched_topics or [],
            "missing_topics": m.missing_topics or [],
            "extra_partner_topics": m.extra_partner_topics or [],
            "core_home_topics": m.core_home_topics or [],
            "structural_notes": m.structural_notes,
            "verification_status": m.verification_status,
            "verification_confidence": m.verification_confidence,
            "verification_reason": m.verification_reason,
            "verification_risk_flags": m.verification_risk_flags or [],
            "is_recommended": m.is_recommended,
            "content_overlap_assessment": m.content_overlap_assessment,
            "core_topic_coverage": m.core_topic_coverage,
            "academic_category": m.category,
            "created_at": m.created_at.isoformat() if m.created_at else None,
            "source": m.source or "batch",
        }
    batch_matches = [_match_dict(m) for m in all_matches_raw]

    return {
        "selection_id": selection_id,
        "application_id": app_id,
        "status": sel.status,
        "was_approved": sel.was_approved or False,
        "alternative_reason": sel.alternative_reason,
        "no_match_requested": sel.no_match_requested,
        "student": {
            "id": student.id if student else None,
            "name": student.name if student else None,
            "eid": student.eid if student else None,
        } if student else None,
        "partner_course": {
            "id": partner.id,
            "course_code": partner.course_code,
            "course_name": partner.course_name,
            "ects": partner.ects,
            "department": (partner.academic_context or {}).get("department"),
            "content": partner.content,
            "learning_outcomes": partner.learning_outcomes,
            "academic_context": partner.academic_context,
            "level": (partner.academic_context or {}).get("level"),
            "semester": (partner.academic_context or {}).get("semester"),
        } if partner else None,
        "student_suggestions": alt_courses,
        "existing_analyses": [_analysis_dict(a) for a in all_matches_raw if a.source == "manual"],
        "batch_matches": [_match_dict(m) for m in all_matches_raw if m.source != "manual"],
        "home_university_id": home_uni.id if home_uni else None,
        "home_university_name": home_uni.name if home_uni else None,
        "coordinator_note": last_review.notes if last_review else None,
        "coordinator_action": last_review.action if last_review else None,
        "coordinator_override_course": override_course,
        "force_manual_review": False,
    }


@router.post("/applications/{app_id}/manual-review/{selection_id}/analyze")
def run_manual_analysis(
    app_id: int,
    selection_id: int,
    body: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(["coordinator", "dept_admin", "super_admin"])),
):
    """Run AI analysis on a partner-home pair and persist the result."""
    from backend.services.manual_analysis import ManualAnalysisService

    home_course_id = body.get("home_course_id")
    if not home_course_id:
        raise HTTPException(status_code=400, detail="home_course_id is required")

    sel = db.query(StudentCourseSelection).filter(
        StudentCourseSelection.id == selection_id,
        StudentCourseSelection.application_id == app_id,
    ).first()
    if not sel:
        raise HTTPException(status_code=404, detail="Selection not found")

    try:
        record = ManualAnalysisService.analyze(
            db=db,
            partner_course_id=sel.partner_course_id,
            home_course_id=home_course_id,
            coordinator_id=current_user.id,
            selection_id=selection_id,
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))

    home = db.query(Course).filter(Course.id == home_course_id).first()
    sb = record.score_breakdown or {}
    return {
        "id": record.id,
        "home_course_id": record.home_course_id,
        "home_course_code": home.course_code if home else None,
        "home_course_name": home.course_name if home else None,
        "overall_score": record.overall_score,
        "domain_score": sb.get("domain", {}).get("score"),
        "content_score": sb.get("content", {}).get("score"),
        "outcomes_score": sb.get("outcomes", {}).get("score"),
        "ects_score": sb.get("ects", {}).get("score"),
        "title_score": sb.get("title", {}).get("score"),
        "metadata_score": sb.get("metadata", {}).get("score"),
        "matched_topics": record.matched_topics,
        "missing_topics": record.missing_topics,
        "extra_partner_topics": record.extra_partner_topics,
        "core_home_topics": record.core_home_topics,
        "structural_notes": record.structural_notes,
        "domain_evidence": sb.get("domain", {}).get("evidence"),
        "content_evidence": sb.get("content", {}).get("evidence"),
        "outcomes_evidence": sb.get("outcomes", {}).get("evidence"),
        "score_breakdown": record.score_breakdown,
        "verification_status": record.verification_status,
        "verification_confidence": record.verification_confidence,
        "verification_reason": record.verification_reason,
        "verification_risk_flags": record.verification_risk_flags,
        "is_recommended": record.is_recommended,
        "content_overlap_assessment": record.content_overlap_assessment,
        "core_topic_coverage": record.core_topic_coverage,
        "academic_category": record.category,
        "created_at": record.created_at.isoformat() if record.created_at else None,
    }


@router.post("/applications/{app_id}/manual-review/{selection_id}/approve")
async def approve_manual_review(
    app_id: int,
    selection_id: int,
    body: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(["coordinator", "dept_admin", "super_admin"])),
):
    """Approve a home course from the manual review workspace (sets as override)."""
    home_course_id = body.get("home_course_id")
    notes = body.get("notes", "")

    if not home_course_id:
        raise HTTPException(status_code=400, detail="home_course_id is required")

    app = db.query(StudentApplication).filter(StudentApplication.id == app_id).first()
    if not app:
        raise HTTPException(status_code=404, detail="Application not found")

    sel = db.query(StudentCourseSelection).filter(
        StudentCourseSelection.id == selection_id,
        StudentCourseSelection.application_id == app_id,
    ).first()
    if not sel:
        raise HTTPException(status_code=404, detail="Selection not found")

    # Delete all previous decision history for this selection to enforce Single Decision Principle
    db.query(CoordinatorReview).filter(
        CoordinatorReview.selection_id == selection_id,
    ).delete(synchronize_session=False)

    # Collision check
    _check_home_course_collision(db, app_id, [home_course_id], selection_id)

    # Determine if coordinator is approving the student's own suggestion or overriding with a different course
    alt_ids = sel.alternative_home_course_ids or []
    is_suggestion_approval = home_course_id in alt_ids
    log_action = "manual_review_approve" if is_suggestion_approval else "manual_review_override"

    # Set override and transition status
    sel.coordinator_override_course_ids = [home_course_id]
    # DO NOT overwrite sel.selected_home_course_ids; keep student's original choice
    sel.status = "approved"

    # Log review action / feedback decision
    FeedbackService.log_decision(
        db, current_user.id, sel.partner_course_id, log_action,
        selection_id=selection_id,
        application_id=app_id,
        home_course_id=home_course_id,
        course_match_id=sel.course_match_id,
        override_reason_category="other",
        override_details=notes,
        override_home_course_id=home_course_id,
        notes=notes,
    )

    db.commit()
    WorkflowService.recompute_application_state(db, app_id)

    return {"status": "ok", "selection_id": selection_id, "home_course_id": home_course_id}


@router.post("/applications/{app_id}/manual-review/{selection_id}/reject")
async def reject_manual_review(
    app_id: int,
    selection_id: int,
    body: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(["coordinator", "dept_admin", "super_admin"])),
):
    """Reject a selection from the manual review workspace (bypasses state machine)."""
    notes = body.get("notes", "")

    app = db.query(StudentApplication).filter(StudentApplication.id == app_id).first()
    if not app:
        raise HTTPException(status_code=404, detail="Application not found")

    sel = db.query(StudentCourseSelection).filter(
        StudentCourseSelection.id == selection_id,
        StudentCourseSelection.application_id == app_id,
    ).first()
    if not sel:
        raise HTTPException(status_code=404, detail="Selection not found")

    # Delete all previous decision history for this selection to enforce Single Decision Principle
    db.query(CoordinatorReview).filter(
        CoordinatorReview.selection_id == selection_id,
    ).delete(synchronize_session=False)

    sel.status = "rejected"

    FeedbackService.log_decision(
        db, current_user.id, sel.partner_course_id, "manual_review_reject",
        selection_id=selection_id,
        application_id=app_id,
        notes=notes,
    )

    db.commit()
    WorkflowService.recompute_application_state(db, app_id)

    return {"status": "ok", "selection_id": selection_id}


@router.post("/applications/{app_id}/revert-finalization")
async def revert_application_finalization(
    app_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(["coordinator", "dept_admin", "super_admin"])),
):
    """Revert application from 'learning_agreement_ready' to 'submitted' state."""
    app = db.query(StudentApplication).filter(StudentApplication.id == app_id).first()
    if not app:
        raise HTTPException(status_code=404, detail="Application not found")

    if app.status != "learning_agreement_ready":
        raise HTTPException(status_code=400, detail="Application is not in 'learning_agreement_ready' state")

    WorkflowService.transition_application(
        db, app_id, "submitted",
        actor_id=current_user.id,
        actor_role="coordinator",
        reason="Coordinator reverted finalization"
    )

    # Sync after revert — catch any courses added while LA was ready
    from backend.routers.courses import sync_application_selections
    sync_application_selections(db, app)
    db.commit()

    return {"status": "ok", "new_status": "submitted"}
