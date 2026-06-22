import logging
"""
Student Course Selection Router
Endpoints for students to manage applications and course selections.
"""

from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import or_, and_, func, cast, String

from db.database import get_db
from db.models import (
    StudentApplication, StudentCourseSelection, CourseMatch, Course,
    University, User, WorkflowStateLog, CoordinatorReview,
)
from authorization.middleware import require_role
from backend.services.workflow import WorkflowService
from backend.services.ects import compute_home_ects, has_review_requests

router = APIRouter(prefix="/api/student", tags=["student"])
logger = logging.getLogger("student")


_PARTNER_WARNING_KEYWORDS = ("partner", "both courses", "one or both")

def _get_partner_course_warnings(db: Session, partner_course_id: int) -> list:
    """Extract warnings/structural_notes from the best match that describe the partner course itself."""
    best = (
        db.query(CourseMatch)
        .filter(CourseMatch.partner_course_id == partner_course_id, CourseMatch.source == "batch")
        .order_by(CourseMatch.overall_score.desc())
        .first()
    )
    if not best:
        return []
    combined = list(best.structural_notes or []) + list(best.warnings or [])
    return [w for w in combined if any(kw in w.lower() for kw in _PARTNER_WARNING_KEYWORDS)]


def _ensure_editable(app: StudentApplication):
    """Ensure the application is in a state where the student can make edits."""
    if app.status not in ("draft", "rejected", "revision_requested"):
        raise HTTPException(
            status_code=403, 
            detail=f"Application is currently '{app.status}' and cannot be edited. Withdraw it first if allowed."
        )


def _get_my_app(db: Session, current_user: User, app_id: int) -> StudentApplication:
    app = db.query(StudentApplication).filter(
        StudentApplication.id == app_id,
        StudentApplication.student_id == current_user.id,
    ).first()
    if not app:
        raise HTTPException(status_code=404, detail="Application not found")
    return app


def _check_home_course_collision(db: Session, app_id: int, home_ids: List[int], exclude_partner_id: int):
    """Raise error if any of the provided home_ids are already used elsewhere in the same app."""
    # Collision check disabled: allow using the same home course multiple times
    return
    
    # Original logic (for reference)
    # for s in other_sels:


@router.post("/applications")
async def create_application(
    body: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(["student"])),
):
    partner_university_id = body.get("partner_university_id")
    semester = body.get("semester")
    if not partner_university_id:
        raise HTTPException(status_code=400, detail="partner_university_id is required")
    if not semester or semester not in ("fall", "spring"):
        raise HTTPException(status_code=400, detail="semester is required (fall or spring)")

    # Retrieve all existing applications for this student
    existing_apps = db.query(StudentApplication).filter(
        StudentApplication.student_id == current_user.id,
    ).all()

    if len(existing_apps) >= 2:
        raise HTTPException(
            status_code=409,
            detail="You already have two active applications. You can only have up to two applications at a time."
        )
    elif len(existing_apps) == 1:
        first_app = existing_apps[0]
        # Condition 1: Must be the same partner university
        if first_app.partner_university_id != partner_university_id:
            raise HTTPException(
                status_code=403,
                detail="You cannot apply to a different university without deleting your first application."
            )
        # Condition 2: Must be the opposite semester (fall <-> spring)
        expected_other = "spring" if first_app.semester == "fall" else "fall" if first_app.semester == "spring" else None
        if not expected_other or semester != expected_other:
            raise HTTPException(
                status_code=400,
                detail=f"Since your first application is for the '{first_app.semester}' semester, your second application must be for the '{expected_other}' semester."
            )

    # Find student's department_id from roles
    dept_id = None
    for ra in current_user.role_assignments:
        if ra.role.name == "student" and ra.department_id:
            dept_id = ra.department_id
            break

    # Check if department is active
    if dept_id:
        from db.models import Department
        dept = db.query(Department).filter(Department.id == dept_id).first()
        if dept and not dept.is_active:
            raise HTTPException(
                status_code=403, 
                detail=f"Department '{dept.name}' is currently closed for new applications."
            )

    # -- BUG FIX: Ensure university belongs to student's department --
    uni = db.query(University).filter(University.id == partner_university_id).first()
    if not uni:
        raise HTTPException(status_code=404, detail="University not found")
    
    # If the university is restricted to a department, ensure it matches the student's
    if uni.department_id and uni.department_id != dept_id:
        raise HTTPException(
            status_code=403, 
            detail="You can only apply to universities within your own department."
        )
    # -------------------------------------------------------------

    app = StudentApplication(
        student_id=current_user.id,
        partner_university_id=partner_university_id,
        department_id=dept_id,
        semester=semester,
        status="draft",
        student_editing=True,
    )
    db.add(app)
    db.flush()

    # Auto-populate selections — filter by semester
    course_semester_filter = [semester, "both", "unknown", "full_year", None]
    partner_courses = db.query(Course).filter(
        Course.university_id == partner_university_id,
        or_(
            Course.academic_context["semester"].astext.in_(course_semester_filter),
            Course.academic_context["semester"] == None,
        ),
    ).all()

    for pc in partner_courses:
        all_matches = db.query(CourseMatch).filter(
            CourseMatch.partner_course_id == pc.id,
            CourseMatch.source == "batch",
        ).order_by(CourseMatch.overall_score.desc()).all()

        # Auto-select: approved first, then risk_flagged as fallback
        best_match = None
        for m in all_matches:
            if m.verification_status == "approved":
                best_match = m
                break
        if not best_match:
            for m in all_matches:
                if m.verification_status == "risk_flagged":
                    best_match = m
                    break

        if best_match:
            sel = StudentCourseSelection(
                application_id=app.id,
                partner_course_id=pc.id,
                course_match_id=best_match.id,
                selected_home_course_id=best_match.home_course_id,
                status="not_selected",
            )
            db.add(sel)
        elif all_matches:
            # Only rejected matches — create selection without auto-fill
            sel = StudentCourseSelection(
                application_id=app.id,
                partner_course_id=pc.id,
                status="not_selected",
            )
            db.add(sel)

    db.commit()
    db.refresh(app)
    logger.info(f"Student {current_user.id} created a new application {app.id} for university {partner_university_id}")
    return {"id": app.id, "status": app.status, "partner_university_id": partner_university_id, "semester": semester}


@router.get("/applications")
async def list_applications(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(["student"])),
):
    apps = (
        db.query(StudentApplication)
        .filter(StudentApplication.student_id == current_user.id)
        .order_by(StudentApplication.created_at.desc())
        .all()
    )
    result = []
    for app in apps:
        uni = db.query(University).filter(University.id == app.partner_university_id).first()
        all_sels = db.query(StudentCourseSelection).filter(
            StudentCourseSelection.application_id == app.id,
        ).all()
        active_sels = [s for s in all_sels if s.status != "not_selected" and s.status != "rejected" and (
            s.status in ["submitted_for_review", "approved", "manual_review_required", "draft_selected"] or
            s.no_match_requested or
            (s.alternative_home_course_ids and len(s.alternative_home_course_ids) > 0) or
            (s.coordinator_override_course_ids and len(s.coordinator_override_course_ids) > 0)
        )]
        
        selection_count = len(active_sels)
        # For legacy UI support, we can keep draft_count and review_count if needed, but they should sum to selection_count
        draft_count = sum(1 for s in active_sels if s.status in ["approved", "draft_selected", "submitted_for_review", "manual_review_required"])
        review_count = selection_count - draft_count
        # Auto-fix stale status: if selections exist but app says draft, recompute
        if selection_count > 0 and app.status == "draft":
            try:
                WorkflowService.recompute_application_state(db, app.id)
                app = db.query(StudentApplication).filter(StudentApplication.id == app.id).first()
            except Exception:
                pass
        result.append({
            "id": app.id,
            "partner_university": {"id": uni.id, "name": uni.name, "country": uni.country, "city": uni.city} if uni else None,
            "semester": app.semester,
            "status": app.status,
            "total_partner_ects": app.total_partner_ects,
            "approved_partner_ects": app.approved_partner_ects,
            "selection_count": selection_count,
            "draft_count": draft_count,
            "review_count": review_count,
            "created_at": app.created_at.isoformat() if app.created_at else None,
            "updated_at": app.updated_at.isoformat() if app.updated_at else None,
        })
    return result


@router.get("/applications/{app_id}")
async def get_application(
    app_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(["student"])),
):
    app = _get_my_app(db, current_user, app_id)

    # Sync selections with current course catalog (new courses, updated matches, inactive removals)
    from backend.routers.courses import sync_application_selections
    sync_application_selections(db, app)

    # Mark as viewed by student when app is in a revised/draft state (locks coordinator from editing)
    if app.student_draft_viewed_at is None and app.status in ("draft", "revision_requested"):
        from datetime import datetime
        app.student_draft_viewed_at = datetime.utcnow()
        db.commit()

    is_finalized = app.status == "learning_agreement_ready"
    
    query = db.query(StudentCourseSelection).filter(StudentCourseSelection.application_id == app_id)
    if not is_finalized:
        query = query.join(Course, StudentCourseSelection.partner_course_id == Course.id).filter(Course.is_active == True)
        
    selections = query.order_by(StudentCourseSelection.id).all()

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

    # Bulk fetch all matches for these partner courses
    all_matches = db.query(CourseMatch).filter(
        CourseMatch.partner_course_id.in_(partner_ids),
        CourseMatch.source == "batch",
    ).order_by(CourseMatch.overall_score.desc()).all() if partner_ids else []
    matches_by_partner: dict = {}
    ver_by_pair: dict = {}
    for m in all_matches:
        matches_by_partner.setdefault(m.partner_course_id, []).append(m)
        key = (m.partner_course_id, m.home_course_id)
        if key not in ver_by_pair:
            ver_by_pair[key] = m
        home_ids.add(m.home_course_id)
    # Refetch any new home IDs from matches
    missing_ids = home_ids - set(courses_by_id.keys())
    if missing_ids:
        courses_by_id.update({c.id: c for c in db.query(Course).filter(Course.id.in_(missing_ids)).all()})

    # Bulk fetch coordinator reviews for all selections
    sel_ids = [sel.id for sel in selections]
    all_reviews = db.query(CoordinatorReview).filter(
        CoordinatorReview.selection_id.in_(sel_ids)
    ).order_by(CoordinatorReview.id.desc()).all() if sel_ids else []
    review_by_sel: dict = {}
    reject_count_by_sel: dict = {}
    for r in all_reviews:
        if r.selection_id not in review_by_sel:
            review_by_sel[r.selection_id] = r
        if r.action == "reject":
            reject_count_by_sel[r.selection_id] = reject_count_by_sel.get(r.selection_id, 0) + 1

    # Bulk fetch max scores per partner course
    from sqlalchemy import func
    max_scores = {}
    if partner_ids:
        rows = db.query(CourseMatch.partner_course_id, func.max(CourseMatch.overall_score)).filter(
            CourseMatch.partner_course_id.in_(partner_ids),
            CourseMatch.source == "batch",
        ).group_by(CourseMatch.partner_course_id).all()
        max_scores = {row[0]: row[1] or 0 for row in rows}

    result = []
    for sel in selections:
        partner = courses_by_id.get(sel.partner_course_id)
        home = courses_by_id.get(sel.selected_home_course_id) if sel.selected_home_course_id else None

        # Build name map and verification map from selected_home_course_ids
        selected_ids = sel.selected_home_course_ids or []
        home_course_names: dict = {}
        selected_home_course_verifications: dict = {}
        selected_home_courses = []
        for hc_id in selected_ids:
            hc = courses_by_id.get(hc_id)
            match = ver_by_pair.get((sel.partner_course_id, hc_id))
            ver = match.verification_status if match else None
            selected_home_course_verifications[hc_id] = ver
            if hc:
                label = f"{hc.course_code} — {hc.course_name}" if hc.course_code else hc.course_name
                if hc.ects:
                    ects_str = str(int(hc.ects)) if hc.ects == int(hc.ects) else str(hc.ects)
                    label += f" — {ects_str} ECTS"
                home_course_names[hc_id] = label
                selected_home_courses.append({
                    "id": hc.id,
                    "course_code": hc.course_code,
                    "course_name": hc.course_name,
                    "ects": hc.ects,
                    "department": (hc.academic_context or {}).get("department", ""),
                    "category": (hc.source_metadata or {}).get("category") if hc.source_metadata else None,
                    "verification_status": ver,
                })

        # Verification for primary hint
        if sel.selected_home_course_id and sel.selected_home_course_id not in selected_home_course_verifications:
            primary_match = ver_by_pair.get((sel.partner_course_id, sel.selected_home_course_id))
            selected_home_course_verifications[sel.selected_home_course_id] = primary_match.verification_status if primary_match else None

        # Coordinator override courses
        override_ids = sel.coordinator_override_course_ids or []
        coordinator_override_courses = []
        for oc_id in override_ids:
            oc = courses_by_id.get(oc_id)
            if oc:
                coordinator_override_courses.append({
                    "id": oc.id, "course_code": oc.course_code,
                    "course_name": oc.course_name, "ects": oc.ects,
                    "category": (oc.source_metadata or {}).get("category") if oc.source_metadata else None,
                    "department": (oc.academic_context or {}).get("department", ""),
                })

        # Last coordinator note
        last_review = review_by_sel.get(sel.id)
        coordinator_note = last_review.notes if last_review else None

        # Resolve alternative IDs
        alt_ids = sel.alternative_home_course_ids or []
        for hc_id in alt_ids:
            if hc_id not in home_course_names:
                hc = courses_by_id.get(hc_id)
                if hc:
                    label = f"{hc.course_code} — {hc.course_name}" if hc.course_code else hc.course_name
                    if hc.ects:
                        ects_str = str(int(hc.ects)) if hc.ects == int(hc.ects) else str(hc.ects)
                        label += f" — {ects_str} ECTS"
                    home_course_names[hc_id] = label

        # Max score
        max_match_score = max_scores.get(sel.partner_course_id, 0)

        # Top candidate — prefer approved/risk_flagged over rejected
        top_candidate = None
        top_matches = matches_by_partner.get(sel.partner_course_id, [])
        if top_matches:
            # Pick the best verified match first (approved > risk_flagged), then fallback to highest score
            top_match = None
            for _m in top_matches:
                if _m.verification_status == "approved":
                    top_match = _m
                    break
            if not top_match:
                for _m in top_matches:
                    if _m.verification_status == "risk_flagged":
                        top_match = _m
                        break
            if not top_match:
                top_match = top_matches[0]
            tc = courses_by_id.get(top_match.home_course_id)
            if tc:
                top_candidate = {
                    "id": tc.id, "course_code": tc.course_code,
                    "course_name": tc.course_name, "ects": tc.ects,
                    "department": (tc.academic_context or {}).get("department", ""),
                }
                if tc.id not in selected_home_course_verifications:
                    selected_home_course_verifications[tc.id] = top_match.verification_status

        result.append({
            "id": sel.id,
            "partner_course_id": sel.partner_course_id,
            "partner_course": {
                "id": partner.id,
                "course_code": partner.course_code,
                "course_name": partner.course_name,
                "ects": partner.ects,
                "level": (partner.academic_context or {}).get("level", ""),
                "semester": (partner.academic_context or {}).get("semester", ""),
                "language": (partner.academic_context or {}).get("language", ""),
                "department": (partner.academic_context or {}).get("department", ""),
                "content": partner.content,
                "learning_outcomes": partner.learning_outcomes,
                "academic_context": partner.academic_context,
                "metadata_quality": partner.metadata_quality,
                "warnings": partner.warnings or [],
            } if partner else None,
            "selected_home_course_id": sel.selected_home_course_id,
            "selected_home_course_ids": sel.selected_home_course_ids or [],
            "selected_course_match_ids": sel.selected_course_match_ids or [],
            "home_course_names": home_course_names,
            "selected_home_course_verifications": selected_home_course_verifications,
            "selected_home_course": {
                "id": home.id,
                "course_code": home.course_code,
                "course_name": home.course_name,
                "ects": home.ects,
                "department": (home.academic_context or {}).get("department", ""),
            } if home else None,
            "selected_home_courses": selected_home_courses,
            "top_candidate": top_candidate,
            "status": sel.status,
            "was_approved": sel.was_approved or False,
            "no_match_requested": sel.no_match_requested,
            "student_notes": sel.student_notes,
            "alternative_home_course_ids": sel.alternative_home_course_ids or [],
            "rejected_home_course_ids": sel.rejected_home_course_ids or [],
            "alternative_reason": sel.alternative_reason,
            "coordinator_override_courses": coordinator_override_courses,

            "coordinator_note": coordinator_note,
            "rejection_count": reject_count_by_sel.get(sel.id, 0),
            "has_recommended_candidates": any(
                m.verification_status in ("approved", "risk_flagged")
                for m in matches_by_partner.get(sel.partner_course_id, [])
            ),
            "partner_course_warnings": _get_partner_course_warnings(db, sel.partner_course_id),
            "student_explanation_snapshot": None,
            "max_score": max_match_score,
        })

    uni = db.query(University).filter(University.id == app.partner_university_id).first()
    all_sels_for_home = db.query(StudentCourseSelection).filter(
        StudentCourseSelection.application_id == app_id,
    ).all()
    app_total_home, app_approved_home = compute_home_ects(db, all_sels_for_home, ignore_active=is_finalized)
    app_has_review = has_review_requests(all_sels_for_home)
    return {
        "id": app.id,
        "partner_university": {"id": uni.id, "name": uni.name, "country": uni.country, "city": uni.city} if uni else None,
        "semester": app.semester,
        "status": app.status,
        "total_partner_ects": app.total_partner_ects,
        "approved_partner_ects": app.approved_partner_ects,
        "total_home_ects": app_total_home,
        "approved_home_ects": app_approved_home,
        "has_review_requests": app_has_review,
        "student_notes": app.student_notes,
        "coordinator_notes": app.coordinator_notes,
        "coordinator_viewed_at": app.coordinator_viewed_at.isoformat() if app.coordinator_viewed_at else None,
        "student_draft_viewed_at": app.student_draft_viewed_at.isoformat() if app.student_draft_viewed_at else None,
        "submitted_at": app.submitted_at.isoformat() if app.submitted_at else None,
        "student_editing": app.student_editing or False,
        "student": {
            "id": app.student_id,
            "name": app.student.name if app.student else "Unknown",
            "eid": app.student.eid if app.student else "Unknown"
        },
        "selections": result,
    }


@router.post("/applications/{app_id}/select-course")
async def select_course(
    app_id: int,
    body: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(["student"])),
):
    print(f"\n[TRACE] select_course triggered for App {app_id} by User {current_user.id}")
    app = _get_my_app(db, current_user, app_id)
    _ensure_editable(app)

    partner_course_id = body.get("partner_course_id")
    home_course_id = body.get("home_course_id")
    course_match_id = body.get("course_match_id")

    if not partner_course_id or not home_course_id:
        raise HTTPException(status_code=400, detail="partner_course_id and home_course_id are required")

    # Find or create selection
    sel = db.query(StudentCourseSelection).filter(
        StudentCourseSelection.application_id == app_id,
        StudentCourseSelection.partner_course_id == partner_course_id,
    ).first()

    if not sel:
        # Check if the university and course are active before allowing new selection
        partner_course = db.query(Course).filter(Course.id == partner_course_id).first()
        if partner_course:
            if not partner_course.is_active:
                raise HTTPException(status_code=400, detail=f"Course '{partner_course.course_name}' is currently inactive.")
                
            uni = db.query(University).filter(University.id == partner_course.university_id).first()
            if uni and not uni.is_active:
                raise HTTPException(status_code=400, detail=f"University '{uni.name}' is currently inactive and cannot be selected.")
        
        sel = StudentCourseSelection(
            application_id=app_id,
            partner_course_id=partner_course_id,
        )
        db.add(sel)
        db.flush()

    old_selected_id = sel.selected_home_course_id

    # Toggle: if already in the list → deselect; otherwise → add
    ids: list = list(sel.selected_home_course_ids or [])
    match_ids: list = list(sel.selected_course_match_ids or [])
    # Capture state before modification
    orig_status = str(sel.status)
    old_hint_id = sel.selected_home_course_id

    if home_course_id in ids:
        # Remove (deselect this specific candidate)
        ids = [x for x in ids if x != home_course_id]
        if course_match_id and course_match_id in match_ids:
            match_ids = [x for x in match_ids if x != course_match_id]
        
        if not ids:
            # Toggle off last item: if it was approved, remember it
            if orig_status == "approved":
                sel.was_approved = True
            WorkflowService.transition_selection(db, sel.id, "not_selected", current_user.id, "student", "Student deselected course")
        
        if ids:
            sel.selected_home_course_id = ids[0]
        sel.course_match_id = match_ids[0] if match_ids else None
    else:
        # Check rejection BEFORE adding
        # Check if explicitly rejected by coordinator for this selection
        if home_course_id in (sel.rejected_home_course_ids or []):
            raise HTTPException(status_code=400, detail="This course has been previously rejected by the coordinator for this application.")

        # Check collision BEFORE adding
        _check_home_course_collision(db, app_id, [home_course_id], partner_course_id)
        # Add
        ids.append(home_course_id)
        if course_match_id:
            match_ids.append(course_match_id)
        # Mutual Exclusion: Clear alternate paths when selecting a standard candidate
        sel.no_match_requested = False
        sel.alternative_home_course_ids = []
        sel.alternative_reason = None
        
        sel.selected_home_course_id = ids[0]  # primary = first selected
        sel.course_match_id = match_ids[0] if match_ids else None

        pass

    sel.selected_home_course_ids = ids
    sel.selected_course_match_ids = match_ids
    sel.student_notes = body.get("student_notes") or sel.student_notes

    # Status transition (only if we just added something)
    if ids and (orig_status == "not_selected" or orig_status == "rejected"):
        # Nuclear ID comparison (stringified and stripped)
        hc_id_str = str(home_course_id).strip()
        hint_id_str = str(old_hint_id).strip() if old_hint_id is not None else ""
        override_ids_str = [str(x).strip() for x in (sel.coordinator_override_course_ids or [])]

        # 1. Check direct override list (the easiest case)
        if override_ids_str and hc_id_str in override_ids_str:
            sel.was_approved = False
            WorkflowService.transition_selection(db, sel.id, "approved", current_user.id, "student", "Student accepted coordinator override")
            return

        # 2. Archival deep-dive: Find if this SELECTION was ever formally approved
        from db.models import CoordinatorReview, WorkflowStateLog
        
        # Check for any 'approve' or 'override' action for this selection in history
        # We also include manual_review counterparts which were previously missing
        ever_coordinator_approved = db.query(CoordinatorReview).filter(
            CoordinatorReview.selection_id == sel.id,
            CoordinatorReview.action.in_([
                'approve', 'override', 
                'manual_review_approve', 'manual_review_override'
            ])
        ).first() is not None

        if not ever_coordinator_approved:
            ever_coordinator_approved = db.query(WorkflowStateLog).filter(
                WorkflowStateLog.entity_type == 'student_course_selection',
                WorkflowStateLog.entity_id == sel.id,
                WorkflowStateLog.to_state == 'approved',
                WorkflowStateLog.actor_role == 'coordinator'
            ).first() is not None

        # NUCLEAR RESTORE: If this selection pair ever saw a coordinator's approval,
        # we trust the restoration regardless of ID desyncs.
        if (getattr(sel, 'was_approved', False) or ever_coordinator_approved):
            sel.was_approved = False
            WorkflowService.transition_selection(db, sel.id, "approved", current_user.id, "student", "VERIFIED_RESTORE_V4")
        else:
            sel.was_approved = False
            dbg_info = f"Target={hc_id_str}, Hint={hint_id_str}"
            WorkflowService.transition_selection(db, sel.id, "draft_selected", current_user.id, "student", f"FORCE_DRAFT_RESTORE_{dbg_info}")
    elif not ids and sel.status != "not_selected":
        WorkflowService.transition_selection(db, sel.id, "not_selected", current_user.id, "student")

    # Recompute
    WorkflowService.recompute_application_state(db, app_id)
    db.commit()
    logger.info(f"Student {current_user.id} updated selection for partner course {partner_course_id} in application {app_id}")
    db.refresh(sel)
    db.refresh(sel)

    return {"selection_id": sel.id, "status": sel.status, "application_status": app.status}


@router.post("/applications/{app_id}/deselect-course")
async def deselect_course(
    app_id: int,
    body: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(["student"])),
):
    app = _get_my_app(db, current_user, app_id)
    _ensure_editable(app)

    partner_course_id = body.get("partner_course_id")
    sel = db.query(StudentCourseSelection).filter(
        StudentCourseSelection.application_id == app_id,
        StudentCourseSelection.partner_course_id == partner_course_id,
    ).first()
    if not sel:
        raise HTTPException(status_code=404, detail="Selection not found")

    home_course_id = body.get("home_course_id")
    if home_course_id:
        # Save current state for restoration logic
        is_formally_approved = sel.status == "approved"
        if is_formally_approved:
            sel.was_approved = True
        
        # Remove specific candidate from arrays
        ids = [x for x in (sel.selected_home_course_ids or []) if x != home_course_id]
        sel.selected_home_course_ids = ids
        sel.selected_course_match_ids = list(sel.selected_course_match_ids or [])
        
        # KEY FIX: Always preserve the removed ID as the 'selected_home_course_id' hint
        sel.selected_home_course_id = home_course_id
        
        if not ids:
             WorkflowService.transition_selection(db, sel.id, "not_selected", current_user.id, "student", "Student removed selection (hint preserved)")
        else:
             if is_formally_approved:
                 WorkflowService.transition_selection(db, sel.id, "draft_selected", current_user.id, "student", "Selection changed after approval")
    else:
        is_formally_approved = sel.status == "approved"
        if is_formally_approved:
            sel.was_approved = True
            
        if sel.selected_home_course_ids:
            sel.selected_home_course_id = sel.selected_home_course_ids[0]
            
        sel.selected_home_course_ids = []
        sel.selected_course_match_ids = []
        sel.course_match_id = None
        WorkflowService.transition_selection(db, sel.id, "not_selected", current_user.id, "student", "Student cleared selections (hint preserved)")

    WorkflowService.recompute_application_state(db, app_id)
    db.commit()

    return {"selection_id": sel.id, "status": sel.status}





@router.post("/applications/{app_id}/request-review")
async def request_review(
    app_id: int,
    body: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(["student"])),
):
    app = _get_my_app(db, current_user, app_id)
    _ensure_editable(app)

    partner_course_id = body.get("partner_course_id")
    sel = db.query(StudentCourseSelection).filter(
        StudentCourseSelection.application_id == app_id,
        StudentCourseSelection.partner_course_id == partner_course_id,
    ).first()
    if not sel:
        raise HTTPException(status_code=404, detail="Selection not found")

    sel.no_match_requested = True
    
    # Mutual Exclusion: Clear other paths
    sel.selected_home_course_ids = []
    sel.selected_home_course_id = None
    sel.selected_course_match_ids = []
    sel.alternative_home_course_ids = []
    sel.alternative_reason = None
    
    sel.student_notes = body.get("student_notes") or sel.student_notes
    db.commit()
    return {"selection_id": sel.id, "no_match_requested": True}


@router.post("/applications/{app_id}/submit")
async def submit_application(
    app_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(["student"])),
):
    app = _get_my_app(db, current_user, app_id)
    if app.status not in ("draft", "rejected", "revision_requested"):
        raise HTTPException(status_code=400, detail="Application must be in draft, rejected, or revision state to submit")

    # Check minimum 28 ECTS from active selections (includes courses with student-suggested alternatives)
    active_sels = db.query(StudentCourseSelection).filter(
        StudentCourseSelection.application_id == app_id,
    ).all()
    # Check all active selections, reviews, and suggestions
    total_active_ects = 0
    calculated_partner_ids = set()

    for s in active_sels:
        # EXCLUDE strictly Rejected items
        if s.status == "rejected":
            continue

        # If has selection, review request, or suggestion, count it
        has_sel = bool(s.selected_home_course_ids)
        has_req = bool(s.no_match_requested)
        has_sug = bool(s.alternative_home_course_ids) and len(s.alternative_home_course_ids) > 0
        is_active_status = s.status in ["draft_selected", "submitted_for_review", "approved", "manual_review_required", "reviewed"]

        if is_active_status or has_req or has_sug or has_sel:
            calculated_partner_ids.add(s.partner_course_id)

    if calculated_partner_ids:
        ects_rows = db.query(Course.ects).filter(Course.id.in_(list(calculated_partner_ids))).all()
        total_active_ects = sum(row[0] or 0 for row in ects_rows)

    if total_active_ects < 28:
        raise HTTPException(
            status_code=400,
            detail=f"You need at least 28 ECTS to submit. Currently {total_active_ects} ECTS selected (including reviews and suggestions)."
        )

    # Home ECTS validation: only enforced when there are no review-request rows,
    # since review-request selections have no mapped home course yet.
    has_review = has_review_requests(active_sels)
    total_home_active, approved_home_active = compute_home_ects(db, active_sels)
    if not has_review and total_home_active < 30:
        raise HTTPException(
            status_code=400,
            detail=f"You need at least 30 home ECTS to submit. Currently {total_home_active} home ECTS mapped."
        )

    # Bulk transition
    WorkflowService.bulk_transition_selections(db, app_id, "draft_selected", "submitted_for_review", current_user.id, "student")
    WorkflowService.transition_application(db, app_id, "submitted", current_user.id, "student")
    # Reset coordinator view flag so student can retract until coordinator opens
    app.coordinator_viewed_at = None

    partner_ects = db.query(Course.ects).join(
        StudentCourseSelection,
        StudentCourseSelection.partner_course_id == Course.id,
    ).filter(
        StudentCourseSelection.application_id == app_id,
        StudentCourseSelection.status != "rejected",
        or_(
            StudentCourseSelection.status.in_(["submitted_for_review", "draft_selected", "approved", "manual_review_required", "reviewed"]),
            StudentCourseSelection.no_match_requested == True,
            and_(
                StudentCourseSelection.alternative_home_course_ids.isnot(None),
                cast(StudentCourseSelection.alternative_home_course_ids, String) != '[]'
            )
        )
    ).all()
    app.total_partner_ects = sum(row[0] or 0 for row in partner_ects)

    db.commit()
    logger.info(f"Student {current_user.id} submitted application {app_id}")
    db.refresh(app)

    return {
        "id": app.id,
        "status": app.status,
        "total_partner_ects": app.total_partner_ects,
        "total_home_ects": total_home_active,
        "approved_home_ects": approved_home_active,
    }






@router.post("/applications/{app_id}/withdraw")
async def withdraw_application(
    app_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(["student"])),
):
    """Withdraw a submitted application back to draft so the student can edit it."""
    app = _get_my_app(db, current_user, app_id)
    if app.status != "submitted":
        raise HTTPException(status_code=400, detail="Only submitted applications can be withdrawn")

    # Transition all submitted selections back to draft
    WorkflowService.bulk_transition_selections(
        db, app_id, "submitted_for_review", "draft_selected", current_user.id, "student"
    )
    WorkflowService.transition_application(
        db, app_id, "draft", current_user.id, "student",
        reason="Withdrawn by student for editing"
    )
    # Reset coordinator view flag so coordinator can still edit until student opens it
    app.coordinator_viewed_at = None
    app.student_draft_viewed_at = None

    db.commit()
    logger.info(f"Student {current_user.id} withdrew application {app_id}")
    db.refresh(app)
    return {"id": app.id, "status": app.status}


@router.post("/applications/{app_id}/reset")
async def reset_application(
    app_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(["student"])),
):
    """Reset all selections to auto-populated defaults (approved first, risk_flagged fallback)."""
    app = _get_my_app(db, current_user, app_id)
    if app.status == "learning_agreement_ready":
        raise HTTPException(status_code=400, detail="Cannot reset a finalized application")

    selections = db.query(StudentCourseSelection).filter(
        StudentCourseSelection.application_id == app_id
    ).all()

    for sel in selections:
        # Save was_approved if modifying an approved selection
        was_approved_before = (sel.status == "approved" or getattr(sel, "was_approved", False))

        # Find best auto-select candidate for this partner course
        all_matches = db.query(CourseMatch).filter(
            CourseMatch.partner_course_id == sel.partner_course_id,
            CourseMatch.source == "batch",
        ).order_by(CourseMatch.overall_score.desc()).all()

        # Auto-select: approved first, then risk_flagged as fallback
        best_match = None
        for m in all_matches:
            if m.verification_status == "approved":
                best_match = m
                break
        if not best_match:
            for m in all_matches:
                if m.verification_status == "risk_flagged":
                    best_match = m
                    break
        
        if not was_approved_before:
            if best_match:
                # Same as initial creation: show hint but keep not_selected
                sel.selected_home_course_id = best_match.home_course_id
                sel.course_match_id = best_match.id
            else:
                # If no good match, clear the hint/ghost selection
                sel.selected_home_course_id = None
                sel.course_match_id = None
        # else: Keep existing selected_home_course_id as the approved hint

        sel.selected_home_course_ids = []
        sel.selected_course_match_ids = []
        sel.no_match_requested = False
        sel.alternative_home_course_ids = []
        sel.alternative_reason = None
        sel.coordinator_override_course_ids = []
        sel.student_notes = None

        if was_approved_before:
            sel.was_approved = True
        
        if sel.status != "not_selected":
             WorkflowService.transition_selection(db, sel.id, "not_selected", current_user.id, "student", "Reset application")
        
        sel.status = "not_selected"
        # Always commit each selection to ensure flags are flushed
        db.flush()

    app.status = "draft"
    app.total_partner_ects = 0
    app.student_notes = None

    db.commit()
    return {"id": app_id, "status": app.status, "reset_count": len(selections)}


@router.patch("/applications/{app_id}/editing-state")
async def set_student_editing_state(
    app_id: int,
    body: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(["student"])),
):
    app = _get_my_app(db, current_user, app_id)
    app.student_editing = bool(body.get("editing", False))
    db.commit()
    return {"application_id": app_id, "student_editing": app.student_editing}


@router.patch("/applications/{app_id}")
async def update_application(
    app_id: int,
    body: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(["student"])),
):
    app = _get_my_app(db, current_user, app_id)
    if "student_notes" in body:
        app.student_notes = body["student_notes"]
    db.commit()
    db.refresh(app)
    return {"id": app.id}


@router.delete("/applications/{app_id}")
async def delete_application(
    app_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(["student"])),
):
    app = _get_my_app(db, current_user, app_id)
    if app.status not in ("draft",):
        raise HTTPException(status_code=400, detail="Cannot delete a submitted application. Contact your coordinator.")
    
    # Explicitly delete all coordinator reviews/decisions for this application to prevent orphan records
    db.query(CoordinatorReview).filter(CoordinatorReview.application_id == app_id).delete(synchronize_session=False)
    
    db.delete(app)
    db.commit()
    return {"deleted": True}


@router.get("/applications/{app_id}/ects-summary")
async def ects_summary(
    app_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(["student"])),
):
    app = _get_my_app(db, current_user, app_id)

    is_finalized = app.status == "learning_agreement_ready"

    s_query = db.query(Course.ects).join(
        StudentCourseSelection,
        StudentCourseSelection.partner_course_id == Course.id,
    ).filter(
        StudentCourseSelection.application_id == app_id,
        StudentCourseSelection.status != "rejected",
        or_(
            StudentCourseSelection.status.in_([
                "draft_selected", "submitted_for_review", "approved", 
                "manual_review_required", "reviewed"
            ]),
            StudentCourseSelection.no_match_requested == True,
            and_(
                StudentCourseSelection.alternative_home_course_ids.isnot(None),
                cast(StudentCourseSelection.alternative_home_course_ids, String) != '[]'
            )
        )
    )
    if not is_finalized:
        s_query = s_query.filter(Course.is_active == True)
    
    selected_ects = s_query.all()
    total_selected = sum(row[0] or 0 for row in selected_ects)

    a_query = db.query(Course.ects).join(
        StudentCourseSelection,
        StudentCourseSelection.partner_course_id == Course.id,
    ).filter(
        StudentCourseSelection.application_id == app_id,
        StudentCourseSelection.status != "not_selected",
        or_(
            StudentCourseSelection.status == "approved",
            and_(
                StudentCourseSelection.coordinator_override_course_ids.isnot(None),
                cast(StudentCourseSelection.coordinator_override_course_ids, String) != '[]'
            )
        )
    )
    if not is_finalized:
        a_query = a_query.filter(Course.is_active == True)

    approved_ects = a_query.all()
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
    has_review = has_review_requests(all_sels)
    
    is_finalized = app.status == "learning_agreement_ready"
    total_home, approved_home = compute_home_ects(db, all_sels, ignore_active=is_finalized)
    home_threshold = 30
    home_ok = has_review or approved_home >= home_threshold

    is_la_ready = (total_approved >= 28) and (pending_or_rejected == 0) and home_ok

    return {
        "total_partner_ects": total_selected,
        "approved_partner_ects": total_approved,
        "total_home_ects": total_home,
        "approved_home_ects": approved_home,
        "home_target": home_threshold,
        "home_threshold": home_threshold,
        "has_review_requests": has_review,
        "learning_agreement_ready": is_la_ready,
        "missing_ects": max(28 - total_approved, 0),
        "missing_home_ects": 0 if has_review else max(home_threshold - approved_home, 0),
    }


@router.get("/applications/{app_id}/home-courses/{partner_course_id}")
async def get_home_courses_for_suggestion(
    app_id: int,
    partner_course_id: int,
    search: str = "",
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(["student", "coordinator", "admin"])),
):
    """Return home university courses excluding existing top candidates, for student alternative suggestions."""
    if "student" in [ra.role.name for ra in current_user.role_assignments]:
        app = _get_my_app(db, current_user, app_id)
    else:
        # Coordinator/Admin can view any app's home course list
        app = db.query(StudentApplication).filter(StudentApplication.id == app_id).first()
        if not app:
            raise HTTPException(status_code=404, detail="Application not found")

    # Get existing candidate home course IDs to exclude
    existing_candidate_ids = {
        m.home_course_id for m in db.query(CourseMatch).filter(
            CourseMatch.partner_course_id == partner_course_id,
            CourseMatch.source == "batch",
        ).all()
    }

    # Get home university courses
    from db.models import University
    home_unis = db.query(University).filter(University.is_home == True).all()
    home_uni_ids = [u.id for u in home_unis]

    query = db.query(Course).filter(
        Course.university_id.in_(home_uni_ids),
        ~Course.id.in_(existing_candidate_ids),
        Course.is_active == True,
    )

    if app.department:
        query = query.filter(Course.academic_context["department"].astext == app.department.name)
    if search.strip():
        like = f"%{search.strip()}%"
        query = query.filter(
            Course.course_name.ilike(like) | Course.course_code.ilike(like)
        )

    courses = query.order_by(Course.course_name).all()

    return {"courses": [
        {
            "id": c.id,
            "course_code": c.course_code,
            "course_name": c.course_name,
            "ects": c.ects,
            "department": (c.academic_context or {}).get("department", ""),
            "level": (c.academic_context or {}).get("level", ""),
        }
        for c in courses
    ]}


@router.post("/applications/{app_id}/clear-review-request")
async def clear_review_request(
    app_id: int,
    body: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(["student"])),
):
    _get_my_app(db, current_user, app_id)
    partner_course_id = body.get("partner_course_id")
    sel = db.query(StudentCourseSelection).filter(
        StudentCourseSelection.application_id == app_id,
        StudentCourseSelection.partner_course_id == partner_course_id,
    ).first()
    if not sel:
        raise HTTPException(status_code=404, detail="Selection not found")
    sel.no_match_requested = False
    sel.student_notes = None
    db.commit()
    return {"cleared": True}


@router.post("/applications/{app_id}/clear-alternative-suggestion")
async def clear_alternative_suggestion(
    app_id: int,
    body: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(["student"])),
):
    _get_my_app(db, current_user, app_id)
    partner_course_id = body.get("partner_course_id")
    sel = db.query(StudentCourseSelection).filter(
        StudentCourseSelection.application_id == app_id,
        StudentCourseSelection.partner_course_id == partner_course_id,
    ).first()
    if not sel:
        raise HTTPException(status_code=404, detail="Selection not found")
    sel.alternative_home_course_ids = []
    sel.alternative_reason = None
    db.commit()
    return {"cleared": True}


@router.post("/applications/{app_id}/suggest-alternatives")
async def suggest_alternatives(
    app_id: int,
    body: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(["student"])),
):
    """Save student's alternative course suggestions + reason for a partner course."""
    _get_my_app(db, current_user, app_id)

    partner_course_id = body.get("partner_course_id")
    home_course_ids = body.get("home_course_ids", [])
    reason = body.get("reason", "")

    if not partner_course_id:
        raise HTTPException(status_code=400, detail="partner_course_id is required")

    sel = db.query(StudentCourseSelection).filter(
        StudentCourseSelection.application_id == app_id,
        StudentCourseSelection.partner_course_id == partner_course_id,
    ).first()

    if not sel:
        # Create new selection row
        sel = StudentCourseSelection(
            application_id=app_id,
            partner_course_id=partner_course_id,
            status="not_selected"
        )
        db.add(sel)
        db.flush()
    
    sel.alternative_home_course_ids = home_course_ids
    sel.alternative_reason = reason
    
    # Mutual Exclusion: Clear other paths
    sel.no_match_requested = False
    sel.selected_home_course_ids = []
    sel.selected_home_course_id = None
    sel.selected_course_match_ids = []

    db.commit()
    return {"selection_id": sel.id, "alternative_count": len(home_course_ids)}


@router.get("/applications/{app_id}/candidates/{partner_course_id}")
async def get_candidates(
    app_id: int,
    partner_course_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(["student"])),
):
    _get_my_app(db, current_user, app_id)

    matches = (
        db.query(CourseMatch)
        .join(Course, CourseMatch.home_course_id == Course.id)
        .filter(
            CourseMatch.partner_course_id == partner_course_id,
            CourseMatch.source == "batch",
            Course.is_active == True
        )
        .order_by(
            CourseMatch.overall_score.desc()
        )
        .all()
    )

    result = []
    for m in matches:
        home = db.query(Course).filter(Course.id == m.home_course_id).first()
        result.append({
            "id": m.id,
            "home_course_id": m.home_course_id,
            "home_course_name": home.course_name if home else "Unknown",
            "home_course_code": home.course_code if home else None,
            "home_course_ects": home.ects if home else 0,
            "home_course_category": (home.source_metadata or {}).get("category") if home and home.source_metadata else None,
            "overall_score": m.overall_score,
            "score_breakdown": m.score_breakdown,
            "matched_topics": m.matched_topics,
            "missing_topics": m.missing_topics,
            "extra_partner_topics": m.extra_partner_topics,
            "core_home_topics": m.core_home_topics,
            "structural_notes": m.structural_notes,
            "warnings": m.warnings,
            "verification_status": m.verification_status,
            "verification_confidence": m.verification_confidence,
            "verification_reason": m.verification_reason,
            "is_recommended": m.is_recommended,
            "content_overlap_assessment": m.content_overlap_assessment,
            "core_topic_coverage": m.core_topic_coverage,
            "is_not_recommended": m.verification_status == "rejected",
            "category": m.category,
            "rank": m.rank,
        })

    return {"candidates": result, "count": len(result)}



