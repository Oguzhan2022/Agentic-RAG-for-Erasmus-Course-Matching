from fastapi import APIRouter, Depends, HTTPException, Query, BackgroundTasks
from sqlalchemy.orm import Session
from sqlalchemy import cast, String, func, distinct
from pydantic import BaseModel
from typing import Optional

from backend.dependencies import get_db
from db.models import Course, University, Department, User, StudentCourseSelection, StudentApplication, CourseMatch
from authorization.middleware import require_role

router = APIRouter(prefix="/api", tags=["courses"])


class CourseUpdate(BaseModel):
    course_code: Optional[str] = None
    course_name: Optional[str] = None
    department: Optional[str] = None
    ects: Optional[float] = None
    level: Optional[str] = None
    content: Optional[str] = None
    learning_outcomes: Optional[str] = None
    semester: Optional[str] = None
    language: Optional[str] = None
    is_active: Optional[bool] = None
    academic_context: Optional[dict] = None
    metadata_quality: Optional[dict] = None
    source_metadata: Optional[dict] = None
    warnings: Optional[list] = None


def _course_to_dict(c: Course) -> dict:
    ac = c.academic_context or {}
    return {
        "id": c.id,
        "university_id": c.university_id,
        "university_name": c.university.name if c.university else None,
        "ingestion_batch_id": c.ingestion_batch_id,
        "course_code": c.course_code,
        "course_name": c.course_name,
        "department": ac.get("department") or "",
        "semester": ac.get("semester") or "",
        "ects": c.ects,
        "level": ac.get("level") or "",
        "language": ac.get("language") or "",
        "content": c.content,
        "learning_outcomes": c.learning_outcomes,
        "is_active": c.is_active,
        "academic_context": c.academic_context,
        "metadata_quality": c.metadata_quality,
        "source_metadata": c.source_metadata,
        "warnings": c.warnings,
        "created_at": c.created_at.isoformat() if c.created_at else None,
    }


@router.get("/universities/{university_id}/courses")
def list_university_courses(
    university_id: int,
    semester: Optional[str] = None,
    level: Optional[str] = None,
    search: Optional[str] = None,
    department: Optional[str] = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=2000),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(["student", "coordinator", "dept_admin", "super_admin", "registrar", "faculty_affairs_admin"]))
):
    """List courses for a specific university with optional filters."""
    # Force department filter for students
    user_role_names = [ra.role.name for ra in current_user.role_assignments if ra.is_active]
    is_admin_type = any(r in ["super_admin", "dept_admin", "coordinator"] for r in user_role_names)
    
    if "student" in user_role_names and not is_admin_type:
        for ra in current_user.role_assignments:
            if ra.role.name == "student" and ra.department:
                department = ra.department.code
                break
    uni = db.query(University).filter(University.id == university_id).first()
    if not uni:
        raise HTTPException(status_code=404, detail="University not found")

    # If student, block access to inactive universities
    if any(r in ["student"] for r in user_role_names) and not is_admin_type:
        if not uni.is_active:
            raise HTTPException(status_code=400, detail="This university is currently inactive.")

    query = db.query(Course).filter(Course.university_id == university_id)
    
    if any(r in ["student"] for r in user_role_names) and not is_admin_type:
        query = query.filter(Course.is_active == True)

    if semester:
        query = query.filter(Course.academic_context["semester"].astext == semester)
    if level:
        query = query.filter(Course.academic_context["level"].astext == level)
    if department:
        dept = db.query(Department).filter(func.upper(Department.code) == department.upper()).first()
        if dept:
            # Re-verify that the university matches the requested department code (in list_university_courses this is mostly redundant but safe)
            if uni.department_id != dept.id:
                return {"total": 0, "skip": skip, "limit": limit, "courses": []}
    if search:
        query = query.filter(Course.course_name.ilike(f"%{search}%"))

    total = query.count()
    courses = query.order_by(Course.course_name).offset(skip).limit(limit).all()

    return {
        "total": total,
        "skip": skip,
        "limit": limit,
        "courses": [_course_to_dict(c) for c in courses],
    }


@router.get("/courses/{course_id}")
def get_course(course_id: int, db: Session = Depends(get_db)):
    """Get single course detail including raw text."""
    course = db.query(Course).filter(Course.id == course_id).first()
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")

    result = _course_to_dict(course)
    result["raw_text"] = course.raw_text
    return result


@router.patch("/courses/{course_id}")
def update_course(
    course_id: int,
    body: CourseUpdate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    _user: User = Depends(require_role(["super_admin", "dept_admin", "coordinator"])),
):
    """Edit parsed course data."""
    course = db.query(Course).filter(Course.id == course_id).first()
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")

    updated_fields = body.model_dump(exclude_unset=True)
    embedding_fields = {"course_name", "department", "content", "learning_outcomes"}
    needs_reembed = False

    ac = dict(course.academic_context or {})
    for field, value in updated_fields.items():
        if field in ("department", "semester", "level", "language"):
            current_val = ac.get(field)
            if field in embedding_fields:
                if current_val != value:
                    needs_reembed = True
            ac[field] = value
        else:
            if field in embedding_fields:
                current_val = getattr(course, field)
                # Only re-embed if the value actually changed
                if current_val != value:
                    needs_reembed = True
            setattr(course, field, value)
    course.academic_context = ac

    db.commit()
    db.refresh(course)

    # Sync affected applications when is_active changes
    if "is_active" in updated_fields:
        if not course.is_active:
            _cleanup_inactive_course_from_applications(db, course_id)
        # Sync all non-LA-ready apps for this university (both activate and deactivate)
        apps = db.query(StudentApplication).filter(
            StudentApplication.partner_university_id == course.university_id,
            StudentApplication.status != "learning_agreement_ready",
        ).all()
        for app in apps:
            sync_application_selections(db, app)
        db.commit()

    # Re-generate embedding if content-affecting fields changed (non-blocking)
    if needs_reembed:
        # Instead of calling it directly and blocking the user
        from retrieval.embedder import embed_single_course
        # We need a new session for background tasks to avoid thread-safety issues with the current request's session
        from backend.dependencies import SessionLocal
        
        def bg_embed(cid: int):
            with SessionLocal() as bg_db:
                c = bg_db.query(Course).filter(Course.id == cid).first()
                if c:
                    embed_single_course(c, bg_db)
        
        background_tasks.add_task(bg_embed, course_id)

    return _course_to_dict(course)


@router.delete("/courses/{course_id}")
def delete_course(
    course_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(require_role(["super_admin", "dept_admin", "coordinator"])),
):
    """Delete a course."""
    course = db.query(Course).filter(Course.id == course_id).first()
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")
    name = course.course_name
    db.delete(course)
    db.commit()
    return {"id": course_id, "name": name, "deleted": True}


@router.get("/courses")
def list_all_courses(
    search: Optional[str] = None,
    university_id: Optional[int] = None,
    semester: Optional[str] = None,
    level: Optional[str] = None,
    quality: Optional[str] = None,
    department: Optional[str] = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=2000),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(["student", "coordinator", "dept_admin", "super_admin"]))
):
    """List all courses across universities with filters."""
    # Force department filter for students
    user_role_names = [ra.role.name for ra in current_user.role_assignments if ra.is_active]
    is_admin_type = any(r in ["super_admin", "dept_admin", "coordinator"] for r in user_role_names)
    
    if "student" in user_role_names and not is_admin_type:
        for ra in current_user.role_assignments:
            if ra.role.name == "student" and ra.department:
                department = ra.department.code
                break
    
    query = db.query(Course).join(University)
    
    # Students only see courses from active universities and active courses
    if any(r in ["student"] for r in user_role_names) and not is_admin_type:
        query = query.filter(University.is_active == True)
        query = query.filter(Course.is_active == True)

    if university_id:
        query = query.filter(Course.university_id == university_id)
    if semester:
        query = query.filter(Course.academic_context["semester"].astext == semester)
    if level:
        query = query.filter(Course.academic_context["level"].astext == level)
    if department:
        dept = db.query(Department).filter(func.upper(Department.code) == department.upper()).first()
        if dept:
            query = query.filter(University.department_id == dept.id)
        else:
            query = query.filter(Course.id == -1)
    if search:
        query = query.filter(Course.course_name.ilike(f"%{search}%"))
    if quality:
        # PostgreSQL JSON operator: metadata_quality->>'format_confidence'
        query = query.filter(
            Course.metadata_quality["format_confidence"].astext == quality
        )

    total = query.count()
    courses = query.order_by(Course.course_name).offset(skip).limit(limit).all()

    # Stats over ALL courses (filtered by department if provided)
    stats_query = db.query(Course).join(University)
    if department:
        dept = db.query(Department).filter(func.upper(Department.code) == department.upper()).first()
        if dept:
            stats_query = stats_query.filter(University.department_id == dept.id)
        else:
            stats_query = stats_query.filter(Course.id == -1)

    total_all = stats_query.with_entities(func.count(Course.id)).scalar()
    universities_count = stats_query.with_entities(func.count(distinct(Course.university_id))).scalar()
    high_quality = stats_query.filter(
        Course.metadata_quality["format_confidence"].astext == "high"
    ).with_entities(func.count(Course.id)).scalar()
    with_warnings = stats_query.filter(
        func.jsonb_array_length(Course.warnings) > 0
    ).with_entities(func.count(Course.id)).scalar()

    return {
        "total": total,
        "skip": skip,
        "limit": limit,
        "courses": [_course_to_dict(c) for c in courses],
        "stats": {
            "total_courses": total_all,
            "universities": universities_count,
            "high_quality": high_quality,
            "with_warnings": with_warnings,
        },
    }


# ── Helper: clean up inactive course from non-LA-ready applications ──

def _cleanup_inactive_course_from_applications(db: Session, course_id: int):
    """
    When a course is deactivated, remove it from all student course selections
    that belong to applications NOT in learning_agreement_ready state.
    Recalculate ECTS totals after removal.
    """
    from backend.services.workflow import WorkflowService

    affected_sels = db.query(StudentCourseSelection).join(
        StudentApplication, StudentCourseSelection.application_id == StudentApplication.id
    ).filter(
        StudentCourseSelection.partner_course_id == course_id,
        StudentApplication.status != "learning_agreement_ready",
    ).all()

    if not affected_sels:
        return

    affected_app_ids = set()
    for sel in affected_sels:
        affected_app_ids.add(sel.application_id)
        # Clear the inactive course from home selections
        if sel.selected_home_course_id == course_id:
            sel.selected_home_course_id = None
        if course_id in (sel.selected_home_course_ids or []):
            sel.selected_home_course_ids = [h for h in sel.selected_home_course_ids if h != course_id]
        if course_id in (sel.coordinator_override_course_ids or []):
            sel.coordinator_override_course_ids = [h for h in sel.coordinator_override_course_ids if h != course_id]
        db.add(sel)

    db.flush()

    # Recalculate ECTS for each affected application
    for app_id in affected_app_ids:
        app = db.query(StudentApplication).filter(StudentApplication.id == app_id).first()
        if not app:
            continue
        _recalc_application_ects(db, app)
        WorkflowService.recompute_application_state(db, app_id)

    db.commit()


def _recalc_application_ects(db: Session, app: StudentApplication):
    """Recalculate partner ECTS totals from current selections."""
    sels = db.query(StudentCourseSelection).filter(
        StudentCourseSelection.application_id == app.id,
    ).all()

    from backend.services.ects import compute_home_ects as _compute_home

    total_partner = 0.0
    approved_partner = 0.0
    for s in sels:
        pc = db.query(Course).filter(Course.id == s.partner_course_id).first()
        if not pc:
            continue
        ects = pc.ects or 0
        if s.status not in ("not_selected", "rejected") or (s.coordinator_override_course_ids and len(s.coordinator_override_course_ids) > 0):
            total_partner += ects
        if s.status == "approved" or (s.coordinator_override_course_ids and len(s.coordinator_override_course_ids) > 0):
            approved_partner += ects

    app.total_partner_ects = total_partner
    app.approved_partner_ects = approved_partner
    db.add(app)


def sync_application_selections(db: Session, app: StudentApplication) -> bool:
    """
    Sync the application's course selections with the current course catalog.
    - Adds new courses that appeared after the application was created
    - Updates match data for existing not_selected selections
    - Removes inactive courses from the application
    - Skips applications in learning_agreement_ready state
    Returns True if any changes were made.
    """
    if app.status == "learning_agreement_ready":
        return False

    from sqlalchemy import or_

    # Get all active partner courses for this uni+semester
    semester_filter = [app.semester, "both", "unknown", "full_year", None]
    partner_courses = db.query(Course).filter(
        Course.university_id == app.partner_university_id,
        Course.is_active == True,
        or_(Course.academic_context["semester"].astext.in_(semester_filter), Course.academic_context["semester"].is_(None)),
    ).all()

    existing = db.query(StudentCourseSelection).filter(
        StudentCourseSelection.application_id == app.id,
    ).all()
    existing_map = {s.partner_course_id: s for s in existing}

    changed = False

    # Remove selections for inactive courses
    for s in existing:
        pc = db.query(Course).filter(Course.id == s.partner_course_id).first()
        if not pc or not pc.is_active:
            db.delete(s)
            changed = True

    # Add missing courses / update existing — only courses that have at least one match
    for pc in partner_courses:
        # Check if this course has any match results
        if pc.id not in existing_map:
            has_match = db.query(CourseMatch).filter(
                CourseMatch.partner_course_id == pc.id,
            ).first()
            if not has_match:
                continue  # Skip courses without matching — same as create_application behavior

        if pc.id in existing_map:
            sel = existing_map[pc.id]
            # Update best match reference for untouched selections (but DON'T mark as selected)
            if sel.status == "not_selected" and not sel.selected_home_course_ids and not sel.course_match_id:
                matches = db.query(CourseMatch).filter(
                    CourseMatch.partner_course_id == pc.id,
                ).order_by(CourseMatch.overall_score.desc()).all()
                if matches:
                    best = None
                    for m in matches:
                        if m.verification_status == "approved":
                            best = m
                            break
                    if not best:
                        for m in matches:
                            if m.verification_status == "risk_flagged":
                                best = m
                                break
                    if best and sel.course_match_id != best.id:
                        sel.course_match_id = best.id
                        changed = True
        else:
            # New course — auto-add selection with best match
            matches = db.query(CourseMatch).filter(
                CourseMatch.partner_course_id == pc.id,
            ).order_by(CourseMatch.overall_score.desc()).all()

            best = None
            for m in matches:
                if m.verification_status == "approved":
                    best = m
                    break
            if not best:
                for m in matches:
                    if m.verification_status == "risk_flagged":
                        best = m
                        break

            sel = StudentCourseSelection(
                application_id=app.id,
                partner_course_id=pc.id,
                status="not_selected",
            )
            if best:
                sel.course_match_id = best.id
            db.add(sel)
            changed = True

    if changed:
        _recalc_application_ects(db, app)
        from backend.services.workflow import WorkflowService
        WorkflowService.recompute_application_state(db, app.id)
        db.commit()

    return changed
