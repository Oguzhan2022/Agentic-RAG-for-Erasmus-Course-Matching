import os
import uuid
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, Body
from sqlalchemy.orm import Session, joinedload
from pydantic import BaseModel
from typing import Optional
from sqlalchemy.sql import func

from backend.dependencies import get_db
from backend.config import settings
from db.models import (
    University, GradingScheme, StudentTranscript, TranscriptGradeEntry,
    StudentApplication, Course, User, Department,
    GradingSchemeSnapshot, EctsIkuSnapshot, GradeConversionAudit,
)
from backend.services.grade_audit import log_conversion
from backend.services.versioning import (
    get_latest_scheme_snapshot_id, get_latest_ects_iku_snapshot_id,
)
from authorization.middleware import require_role, _resolve_accessible_dept_ids, _get_user_role_names

router = APIRouter(prefix="/api/transcripts", tags=["transcripts"])

TRANSCRIPTS_DIR = os.path.join(settings.upload_dir, "transcripts")


def _pin_transcript_versions(db: Session, transcript: StudentTranscript) -> None:
    """Pin the current latest grading scheme and ECTS-IKU snapshots on a transcript."""
    if transcript.partner_university_id and not transcript.grading_scheme_version_id:
        scheme = db.query(GradingScheme).filter(
            GradingScheme.university_id == transcript.partner_university_id,
            GradingScheme.is_active == True,
        ).first()
        if scheme:
            transcript.grading_scheme_version_id = get_latest_scheme_snapshot_id(db, scheme.id)
    if not transcript.ects_iku_version_id:
        transcript.ects_iku_version_id = get_latest_ects_iku_snapshot_id(db)


def _resolve_snapshot_data(db: Session, transcript: StudentTranscript) -> tuple[int | None, list[dict] | None, list[dict] | None, int | None]:
    """Resolve pinned version snapshot data for a transcript.

    Returns (grading_scheme_version_id, rules_snapshot, ects_iku_mappings, ects_iku_version_id).
    If no pinned versions, returns (None, None, None, None).
    """
    gs_vid = transcript.grading_scheme_version_id
    eiku_vid = transcript.ects_iku_version_id
    rules_snapshot = None
    mappings = None
    if gs_vid:
        gs_snap = db.query(GradingSchemeSnapshot).filter(GradingSchemeSnapshot.id == gs_vid).first()
        if gs_snap:
            rules_snapshot = gs_snap.rules_snapshot
    if eiku_vid:
        eiku_snap = db.query(EctsIkuSnapshot).filter(EctsIkuSnapshot.id == eiku_vid).first()
        if eiku_snap:
            mappings = eiku_snap.mappings_snapshot
    return gs_vid, rules_snapshot, mappings, eiku_vid


# ── Pydantic models ──

class GradeEntryInput(BaseModel):
    partner_course_id: Optional[int] = None
    partner_course_name: str
    partner_course_code: Optional[str] = None
    partner_ects: Optional[float] = None
    local_grade: Optional[str] = None
    ects_grade: Optional[str] = None
    iku_grade: Optional[str] = None
    has_ects: bool = False
    conversion_mode: Optional[str] = None  # "manual" to skip auto-conversion
    mapped_home_course_ids: Optional[list[int]] = None


class GradeEntryUpdate(BaseModel):
    partner_course_id: Optional[int] = None
    partner_course_name: Optional[str] = None
    partner_course_code: Optional[str] = None
    partner_ects: Optional[float] = None
    local_grade: Optional[str] = None
    ects_grade: Optional[str] = None
    iku_grade: Optional[str] = None
    conversion_method: Optional[str] = None
    notes: Optional[str] = None
    has_ects: Optional[bool] = None
    mapped_home_course_ids: Optional[list[int]] = None


class TranscriptUpdate(BaseModel):
    student_name: Optional[str] = None
    student_eid: Optional[str] = None
    partner_university_id: Optional[int] = None
    department_id: Optional[int] = None
    status: Optional[str] = None
    notes: Optional[str] = None


class BatchGradeEntryRequest(BaseModel):
    entries: list[GradeEntryInput]


# ── Helpers ──

def _is_coordinator_or_admin(user: User) -> bool:
    """Check if user has coordinator/admin/registrar privileges."""
    user_roles = [ra.role.name for ra in user.role_assignments if ra.is_active]
    return any(r in ["super_admin", "dept_admin", "coordinator", "registrar"] for r in user_roles)


def _check_student_transcript_access(t: StudentTranscript, user: User, allowed_statuses: list[str] | None = None):
    """For student users: verify ownership and status. Coordinators/admins bypass."""
    if _is_coordinator_or_admin(user):
        return
    # Student must own the transcript
    if t.student_id != user.id:
        raise HTTPException(status_code=403, detail="Not authorized to access this transcript")
    # Student must have valid status
    if allowed_statuses and t.status not in allowed_statuses:
        raise HTTPException(status_code=400, detail=f"Cannot modify transcript in '{t.status}' status")


def _transcript_to_dict(t: StudentTranscript, include_entries: bool = False, db: Session = None):
    s_name = None
    s_eid = None
    if t.student:
        s_name = t.student.name
        s_eid = t.student.eid
    elif t.notes and ("Manually created historical record:" in t.notes or "Manuel olarak oluşturulmuş geçmiş kayıt:" in t.notes):
        raw = t.notes.replace("Manually created historical record: ", "").replace("Manuel olarak oluşturulmuş geçmiş kayıt: ", "").strip()
        parts = raw.split(" | ID: ")
        s_name = parts[0].strip() if len(parts) > 0 and parts[0].strip() else "Anonymous Student"
        s_eid = parts[1].strip() if len(parts) > 1 and parts[1].strip() else ""

    d = {
        "id": t.id,
        "student_id": t.student_id,
        "student_name": s_name,
        "student_eid": s_eid,
        "application_id": t.application_id,
        "partner_university_id": t.partner_university_id,
        "partner_university_name": (t.partner_university.name if t.partner_university else None) or t.partner_university_name,
        "original_filename": t.original_filename,
        "file_path": t.file_path,
        "status": t.status,
        "department_id": t.department_id,
        "department_code": t.department.code if t.department else None,
        "grading_scheme_version_id": t.grading_scheme_version_id,
        "grading_scheme_version_number": t.pinned_grading_scheme_version.version_number if t.pinned_grading_scheme_version else None,
        "ects_iku_version_id": t.ects_iku_version_id,
        "ects_iku_version_number": t.pinned_ects_iku_version.version_number if t.pinned_ects_iku_version else None,
        "graded_by": t.graded_by,
        "graded_at": t.graded_at.isoformat() if t.graded_at else None,
        "notes": t.notes,
        "semester": t.application.semester if t.application else None,
        "created_at": t.created_at.isoformat() if t.created_at else None,
        "updated_at": t.updated_at.isoformat() if t.updated_at else None,
    }
    if include_entries:
        d["grade_entries"] = [_entry_to_dict(e, db) for e in t.grade_entries]
    return d


def _entry_to_dict(e: TranscriptGradeEntry, db: Session = None):
    # Resolve snapshot from parent transcript's pinned version IDs
    transcript = e.transcript
    snapshot = None
    ects_snap = None
    if db and transcript:
        gs_vid = transcript.grading_scheme_version_id
        eiku_vid = transcript.ects_iku_version_id
        if gs_vid:
            snapshot = db.query(GradingSchemeSnapshot).filter(
                GradingSchemeSnapshot.id == gs_vid
            ).first()
        if eiku_vid:
            ects_snap = db.query(EctsIkuSnapshot).filter(
                EctsIkuSnapshot.id == eiku_vid
            ).first()
    scheme_name = None
    scheme_type = None
    grading_scheme_id = None
    if snapshot and snapshot.scheme_snapshot:
        scheme_name = snapshot.scheme_snapshot.get("name")
        scheme_type = snapshot.scheme_snapshot.get("scheme_type")
        grading_scheme_id = snapshot.grading_scheme_id

    return {
        "id": e.id,
        "transcript_id": e.transcript_id,
        "partner_course_id": e.partner_course_id,
        "partner_course_name": e.partner_course_name,
        "partner_course_code": e.partner_course_code,
        "partner_ects": e.partner_ects,
        "local_grade": e.local_grade,
        "ects_grade": e.ects_grade,
        "iku_grade": e.iku_grade,
        "grading_scheme_id": grading_scheme_id,
        "conversion_method": e.conversion_method,
        "grading_scheme_name": scheme_name,
        "grading_scheme_type": scheme_type,
        "grading_scheme_version_id": transcript.grading_scheme_version_id if transcript else None,
        "grading_scheme_version_number": snapshot.version_number if snapshot else None,
        "ects_iku_version_id": transcript.ects_iku_version_id if transcript else None,
        "ects_iku_version_number": ects_snap.version_number if ects_snap else None,
        "is_db_course": e.partner_course_id is not None,
        "mapped_home_course_ids": e.mapped_home_course_ids,
        "entered_by": e.entered_by,
        "notes": e.notes,
        "created_at": e.created_at.isoformat() if e.created_at else None,
        "audit_log": _get_entry_audit(e.id, db) if db else [],
    }


def _get_entry_audit(entry_id: int, db: Session) -> list:
    audits = db.query(GradeConversionAudit).filter(
        GradeConversionAudit.grade_entry_id == entry_id
    ).order_by(GradeConversionAudit.created_at.desc()).all()
    return [
        {
            "id": a.id,
            "source_grade": a.source_grade,
            "target_iku_grade": a.target_iku_grade,
            "conversion_method": a.conversion_method,
            "is_manual_override": a.is_manual_override,
            "previous_iku_grade": a.previous_iku_grade,
            "notes": a.notes,
            "created_at": a.created_at.isoformat() if a.created_at else None,
        }
        for a in audits
    ]


# ── Upload ──

@router.post("/upload")
async def upload_transcript(
    partner_university_id: int = Form(...),
    application_id: Optional[int] = Form(None),
    notes: Optional[str] = Form(None),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    _user: User = Depends(require_role(["super_admin", "dept_admin", "coordinator", "registrar", "faculty_affairs_admin", "student"])),
):
    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are accepted")

    uni = db.query(University).filter(University.id == partner_university_id).first()
    if not uni:
        raise HTTPException(status_code=404, detail="University not found")

    if application_id:
        app = db.query(StudentApplication).filter(StudentApplication.id == application_id).first()
        if not app:
            raise HTTPException(status_code=404, detail="Application not found")

    # Student: one transcript per application (or fallback to university)
    user_role_names = [ra.role.name for ra in _user.role_assignments if ra.is_active]
    if "student" in user_role_names and not any(r in ["super_admin", "dept_admin", "coordinator", "registrar"] for r in user_role_names):
        if application_id:
            existing = db.query(StudentTranscript).filter(
                StudentTranscript.student_id == _user.id,
                StudentTranscript.application_id == application_id,
            ).first()
            if existing:
                raise HTTPException(status_code=400, detail="You already have a transcript for this application")
        else:
            existing = db.query(StudentTranscript).filter(
                StudentTranscript.student_id == _user.id,
                StudentTranscript.partner_university_id == partner_university_id,
            ).first()
            if existing:
                raise HTTPException(status_code=400, detail="You already have a transcript for this university")

    # Save file
    os.makedirs(TRANSCRIPTS_DIR, exist_ok=True)
    ext = os.path.splitext(file.filename)[1]
    saved_name = f"{uuid.uuid4().hex}{ext}"
    saved_path = os.path.join(TRANSCRIPTS_DIR, saved_name)

    content = await file.read()
    with open(saved_path, "wb") as f:
        f.write(content)

    # Resolve department_id
    dept_id = None
    if application_id and app:
        dept_id = app.department_id
    else:
        # Try to find student's department_id from roles
        target_student_id = app.student_id if application_id and app else _user.id
        target_user = db.query(User).filter(User.id == target_student_id).first()
        if target_user:
            for ra in target_user.role_assignments:
                if ra.role.name == "student" and ra.department_id:
                    dept_id = ra.department_id
                    break

    transcript = StudentTranscript(
        student_id=app.student_id if application_id and app else _user.id,
        application_id=application_id,
        partner_university_id=partner_university_id,
        partner_university_name=uni.name,
        file_path=f"/uploads/transcripts/{saved_name}",
        original_filename=file.filename,
        status="uploaded",
        notes=notes,
        department_id=dept_id,
    )
    db.add(transcript)
    db.flush()
    _pin_transcript_versions(db, transcript)
    db.commit()
    db.refresh(transcript)
    return _transcript_to_dict(transcript)


@router.post("/manual")
async def create_manual_transcript(
    university_id: Optional[int] = Form(None),
    university_name: Optional[str] = Form(None),
    student_label: str = Form("Anonymous"),
    student_id: Optional[int] = Form(None),
    department_id: Optional[int] = Form(None),
    file: Optional[UploadFile] = File(None),
    db: Session = Depends(get_db),
    _user: User = Depends(require_role(["super_admin", "dept_admin", "coordinator"])),
):
    saved_path = None
    saved_name = None
    if file and file.filename:
        os.makedirs(TRANSCRIPTS_DIR, exist_ok=True)
        ext = os.path.splitext(file.filename)[1]
        saved_name = f"{uuid.uuid4().hex}{ext}"
        saved_path = os.path.join(TRANSCRIPTS_DIR, saved_name)
        content = await file.read()
        with open(saved_path, "wb") as f:
            f.write(content)

    t = StudentTranscript(
        student_id=student_id,
        partner_university_id=university_id,
        partner_university_name=university_name,
        original_filename=file.filename if file and file.filename else f"Historical Import - {university_name or 'Unknown'} - {student_label}",
        file_path=f"/uploads/transcripts/{saved_name}" if saved_name else None,
        status="grading_in_progress",
        notes=f"Manually created historical record: {student_label}",
        department_id=department_id
    )
    db.add(t)
    db.flush()
    _pin_transcript_versions(db, t)
    db.commit()
    db.refresh(t)
    return _transcript_to_dict(t)


# ── Student: list own transcripts ──

@router.get("/my")
def list_my_transcripts(
    db: Session = Depends(get_db),
    _user: User = Depends(require_role(["super_admin", "dept_admin", "coordinator", "registrar", "faculty_affairs_admin", "student"])),
):
    transcripts = db.query(StudentTranscript).filter(
        StudentTranscript.student_id == _user.id,
    ).order_by(StudentTranscript.created_at.desc()).all()
    return [_transcript_to_dict(t) for t in transcripts]


# ── Coordinator: list all transcripts ──

@router.get("/all")
def list_all_transcripts(
    department_id: Optional[int] = None,
    db: Session = Depends(get_db),
    _user: User = Depends(require_role(["super_admin", "dept_admin", "coordinator", "registrar", "faculty_affairs_admin"])),
):
    user_role_names = _get_user_role_names(_user)
    is_registrar_type = any(r in ["registrar", "faculty_affairs_admin"] for r in user_role_names) and not any(
        r in ["super_admin", "dept_admin", "coordinator"] for r in user_role_names
    )

    query = db.query(StudentTranscript)

    allowed_depts = _resolve_accessible_dept_ids(_user, db)
    if allowed_depts is not None:  # not super_admin
        if department_id and department_id in allowed_depts:
            # Specific department filter (from frontend selector)
            query = query.filter(StudentTranscript.department_id == department_id)
        else:
            # Default: all accessible departments
            query = query.filter(StudentTranscript.department_id.in_(allowed_depts))
    elif department_id:
        query = query.filter(StudentTranscript.department_id == department_id)

    transcripts = query.order_by(StudentTranscript.created_at.desc()).all()
    return [_transcript_to_dict(t) for t in transcripts]


# ── Get transcript detail ──

@router.get("/{transcript_id}")
def get_transcript(
    transcript_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(require_role(["super_admin", "dept_admin", "coordinator", "registrar", "faculty_affairs_admin", "student"])),
):
    t = db.query(StudentTranscript).options(
        joinedload(StudentTranscript.grade_entries),
        joinedload(StudentTranscript.pinned_grading_scheme_version),
        joinedload(StudentTranscript.pinned_ects_iku_version),
    ).filter(StudentTranscript.id == transcript_id).first()
    if not t:
        raise HTTPException(status_code=404, detail="Transcript not found")
    user_role_names = _get_user_role_names(_user)
    if "student" in user_role_names and not any(r in ["super_admin", "dept_admin", "coordinator", "registrar"] for r in user_role_names):
        if t.student_id != _user.id:
            raise HTTPException(status_code=403, detail="Not authorized to view this transcript")
    # Registrar/registrar: scope to faculty departments
    is_registrar_type = any(r in ["registrar", "faculty_affairs_admin"] for r in user_role_names) and not any(
        r in ["super_admin", "dept_admin", "coordinator"] for r in user_role_names
    )
    if is_registrar_type:
        allowed_ids = _resolve_accessible_dept_ids(_user, db)
        if allowed_ids is not None and t.department_id not in allowed_ids:
            raise HTTPException(status_code=403, detail="Not authorized to view this transcript")
    return _transcript_to_dict(t, include_entries=True, db=db)


# ── Course search for autocomplete ──

@router.get("/{transcript_id}/search-courses")
def search_courses(
    transcript_id: int,
    q: str = "",
    db: Session = Depends(get_db),
    _user: User = Depends(require_role(["super_admin", "dept_admin", "coordinator", "registrar", "faculty_affairs_admin", "student"])),
):
    t = db.query(StudentTranscript).filter(StudentTranscript.id == transcript_id).first()
    if not t:
        raise HTTPException(status_code=404, detail="Transcript not found")
    _check_student_transcript_access(t, _user)

    if not q or len(q) < 2:
        return []

    results = []
    seen_keys = set() # (name, code)

    def add_result(name, code, ects, course_id=None, source="historical"):
        key = (name.strip().lower(), (code or "").strip().lower())
        if key not in seen_keys:
            results.append({
                "id": course_id,
                "course_name": name,
                "course_code": code,
                "ects": ects,
                "source": source
            })
            seen_keys.add(key)

    # 1. Search official Partner Courses
    if t.partner_university_id:
        official_courses = db.query(Course).filter(
            Course.university_id == t.partner_university_id,
            Course.is_active == True,
            (Course.course_name.ilike(f"%{q}%") | Course.course_code.ilike(f"%{q}%")),
        ).limit(10).all()
        for c in official_courses:
            add_result(c.course_name, c.course_code, c.ects, c.id, "official")

    # 2. Search TranscriptGradeEntry (from existing manual/historical entries in StudentTranscript)
    entry_query = db.query(TranscriptGradeEntry).join(StudentTranscript)
    if t.partner_university_id:
        entry_query = entry_query.filter(StudentTranscript.partner_university_id == t.partner_university_id)
    else:
        entry_query = entry_query.filter(StudentTranscript.partner_university_name.ilike(t.partner_university_name))

    other_entries = entry_query.filter(
        (TranscriptGradeEntry.partner_course_name.ilike(f"%{q}%") | TranscriptGradeEntry.partner_course_code.ilike(f"%{q}%"))
    ).limit(10).all()

    for ec in other_entries:
        add_result(ec.partner_course_name, ec.partner_course_code, ec.partner_ects, source="historical_manual")

    return results[:20]


# ── Preview conversion for a grade ──

@router.post("/{transcript_id}/preview-conversion")
def preview_conversion(
    transcript_id: int,
    body: GradeEntryInput,
    db: Session = Depends(get_db),
    _user: User = Depends(require_role(["super_admin", "dept_admin", "coordinator", "registrar", "faculty_affairs_admin", "student"])),
):
    t = db.query(StudentTranscript).options(
        joinedload(StudentTranscript.grade_entries)
    ).filter(StudentTranscript.id == transcript_id).first()
    if not t:
        raise HTTPException(status_code=404, detail="Transcript not found")
    _check_student_transcript_access(t, _user)

    from matching.grade_transfer import (
        convert_single_grade_from_snapshot, ects_to_iku_vs_mappings,
        convert_single_grade, ects_to_iku,
    )

    _pin_transcript_versions(db, t)
    _, rules_snapshot, ects_iku_mappings, _ = _resolve_snapshot_data(db, t)

    try:
        if body.has_ects:
            # Accept ECTS grade from either field (frontend may send in local_grade)
            ects_input = body.ects_grade or body.local_grade
            if not ects_input:
                return {"ects_grade": None, "iku_grade": None, "conversion_method": None}
            if ects_iku_mappings:
                iku = ects_to_iku_vs_mappings(ects_input.strip().upper(), ects_iku_mappings)
            else:
                iku = ects_to_iku(db, ects_input.strip().upper())
            return {
                "input_grade": ects_input,
                "ects_grade": ects_input.strip().upper(),
                "iku_grade": iku or "?",
                "conversion_method": "auto_ects"
            }

        if not body.local_grade:
            return {"ects_grade": None, "iku_grade": None, "conversion_method": None}

        if rules_snapshot and ects_iku_mappings:
            result = convert_single_grade_from_snapshot(
                body.local_grade, rules_snapshot, ects_iku_mappings, body.has_ects
            )
        else:
            result = convert_single_grade(db, body.local_grade, t.partner_university_id, body.has_ects)
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


# ── Batch grade entry ──

@router.post("/{transcript_id}/grades")
def save_grades(
    transcript_id: int,
    body: BatchGradeEntryRequest,
    db: Session = Depends(get_db),
    _user: User = Depends(require_role(["super_admin", "dept_admin", "coordinator", "student"])),
):
    t = db.query(StudentTranscript).options(
        joinedload(StudentTranscript.grade_entries)
    ).filter(StudentTranscript.id == transcript_id).first()
    if not t:
        raise HTTPException(status_code=404, detail="Transcript not found")
    if t.status == "finalized":
        raise HTTPException(status_code=400, detail="Transcript is already finalized")
    # Student: can only save grades on own transcript in uploaded/student_grading status
    _check_student_transcript_access(t, _user, ["uploaded", "student_grading"])

    scheme = db.query(GradingScheme).filter(
        GradingScheme.university_id == t.partner_university_id,
        GradingScheme.is_active == True,
    ).first()

    # Pin transcript versions if not already set (backfill safety)
    _pin_transcript_versions(db, t)

    # Resolve snapshot data for conversion
    gs_vid, rules_snapshot, ects_iku_mappings, eiku_vid = _resolve_snapshot_data(db, t)

    from matching.grade_transfer import convert_batch_grades_from_snapshot

    # Separate manual entries from auto-conversion entries
    entries = [e.model_dump() for e in body.entries]
    auto_entries = [e for e, be in zip(entries, body.entries) if be.conversion_mode != "manual"]
    auto_body_entries = [be for be in body.entries if be.conversion_mode != "manual"]

    if auto_entries:
        if rules_snapshot and ects_iku_mappings:
            results = convert_batch_grades_from_snapshot(auto_entries, rules_snapshot, ects_iku_mappings)
        else:
            from matching.grade_transfer import convert_batch_grades
            results = convert_batch_grades(db, auto_entries, t.partner_university_id)
    else:
        results = []

    # Build result lookup keyed by position
    result_map = {}
    result_idx = 0
    for i, be in enumerate(body.entries):
        if be.conversion_mode != "manual":
            result_map[i] = results[result_idx] if result_idx < len(results) else {}
            result_idx += 1

    saved = []
    for i, entry_data in enumerate(body.entries):
        is_manual = entry_data.conversion_mode == "manual"
        result = result_map.get(i, {})

        # Students may not use manual override
        if is_manual and not _is_coordinator_or_admin(_user):
            raise HTTPException(status_code=403, detail="Students are not allowed to use manual grade override")

        # Resolve partner course info
        partner_course_id = entry_data.partner_course_id
        course_name = entry_data.partner_course_name
        course_code = entry_data.partner_course_code
        partner_ects = entry_data.partner_ects
        is_db_course = False

        if partner_course_id:
            course = db.query(Course).filter(Course.id == partner_course_id).first()
            if course:
                course_name = course.course_name
                course_code = course.course_code or course_code
                partner_ects = partner_ects or course.ects
                is_db_course = True

        # Prevent duplicate entries for the same course in the same transcript
        if is_db_course:
            existing_entry = db.query(TranscriptGradeEntry).filter(
                TranscriptGradeEntry.transcript_id == transcript_id,
                TranscriptGradeEntry.partner_course_id == partner_course_id
            ).first()
        else:
            existing_entry = db.query(TranscriptGradeEntry).filter(
                TranscriptGradeEntry.transcript_id == transcript_id,
                TranscriptGradeEntry.partner_course_name == course_name
            ).first()

        if existing_entry:
            # Skip duplicates
            continue

        grade_entry = TranscriptGradeEntry(
            transcript_id=transcript_id,
            partner_course_id=partner_course_id if is_db_course else None,
            partner_course_name=course_name,
            partner_course_code=course_code,
            partner_ects=partner_ects,
            local_grade=entry_data.local_grade or None,
            ects_grade=entry_data.ects_grade if is_manual else result.get("ects_grade"),
            iku_grade=entry_data.iku_grade if is_manual else result.get("iku_grade"),
            conversion_method="manual_override" if is_manual else result.get("conversion_method"),
            is_db_course=partner_course_id is not None,
            home_courses=db.query(Course).filter(Course.id.in_(entry_data.mapped_home_course_ids)).all() if entry_data.mapped_home_course_ids else [],
            entered_by=_user.id,
        )
        db.add(grade_entry)
        saved.append(grade_entry)

    # Set status based on who is saving
    if _is_coordinator_or_admin(_user):
        t.status = "grading_in_progress"
    else:
        # Student saving — only upgrade from 'uploaded' to 'student_grading'
        if t.status == "uploaded":
            t.status = "student_grading"

    db.flush()  # assign IDs to all new grade entries

    for grade_entry in saved:
        log_conversion(db, grade_entry)

    db.commit()

    for e in saved:
        db.refresh(e)
    return [_entry_to_dict(e, db) for e in saved]


# ── Update single grade entry ──

@router.put("/{transcript_id}/grades/{entry_id}")
def update_grade_entry(
    transcript_id: int,
    entry_id: int,
    body: GradeEntryUpdate,
    db: Session = Depends(get_db),
    _user: User = Depends(require_role(["super_admin", "dept_admin", "coordinator", "student"])),
):
    t = db.query(StudentTranscript).options(
        joinedload(StudentTranscript.grade_entries)
    ).filter(StudentTranscript.id == transcript_id).first()
    if not t:
        raise HTTPException(status_code=404, detail="Transcript not found")
    if t.status == "finalized":
        raise HTTPException(status_code=400, detail="Transcript is already finalized")
    # Student: can only edit grades on own transcript in student_grading status
    _check_student_transcript_access(t, _user, ["student_grading"])

    entry = db.query(TranscriptGradeEntry).filter(
        TranscriptGradeEntry.id == entry_id,
        TranscriptGradeEntry.transcript_id == transcript_id,
    ).first()
    if not entry:
        raise HTTPException(status_code=404, detail="Grade entry not found")

    update_data = body.model_dump(exclude_unset=True)

    old_iku = entry.iku_grade  # Snapshot for audit

    # Determine if manual override: either explicit flag or only iku_grade sent
    is_manual = (
        update_data.get("conversion_method") == "manual_override"
        or (
            "iku_grade" in update_data
            and "local_grade" not in update_data
            and "ects_grade" not in update_data
            and "has_ects" not in update_data
        )
    )

    if is_manual:
        entry.conversion_method = "manual_override"

    for field, value in update_data.items():
        if field == "mapped_home_course_ids":
            entry.home_courses = db.query(Course).filter(Course.id.in_(value)).all() if value else []
        else:
            setattr(entry, field, value)

    needs_conversion = not is_manual and ("local_grade" in update_data or "has_ects" in update_data or "ects_grade" in update_data)
    if needs_conversion:
        from matching.grade_transfer import (
            convert_single_grade_from_snapshot, ects_to_iku_vs_mappings,
            convert_single_grade, ects_to_iku,
        )

        _pin_transcript_versions(db, t)
        _, rules_snapshot, ects_iku_mappings, _ = _resolve_snapshot_data(db, t)
        use_snapshot = rules_snapshot is not None and ects_iku_mappings is not None

        # Only switch to ECTS mode if explicitly requested (has_ects=True).
        # If has_ects is explicitly False, stay in local mode regardless of ects_grade presence.
        explicit_ects = update_data.get("has_ects") is True
        explicit_local = update_data.get("has_ects") is False
        implicit_ects = (
            not explicit_local
            and (
                ("ects_grade" in update_data and update_data["ects_grade"])
                or (not entry.local_grade and entry.ects_grade and "has_ects" not in update_data
                    and entry.conversion_method != "auto_local")
            )
        )
        if explicit_ects or implicit_ects:
            ects_val = (update_data.get("ects_grade") or entry.ects_grade).strip().upper()
            if use_snapshot:
                iku = ects_to_iku_vs_mappings(ects_val, ects_iku_mappings)
            else:
                iku = ects_to_iku(db, ects_val)
            entry.ects_grade = ects_val
            entry.iku_grade = iku or "?"
            entry.conversion_method = "auto_ects"
        else:
            # Fallback to standard conversion logic
            has_ects = update_data.get("has_ects", entry.conversion_method == "auto_ects")
            # Auto-detect ECTS
            if not update_data.get("local_grade", entry.local_grade) and (update_data.get("ects_grade") or entry.ects_grade):
                has_ects = True

            input_grade = (update_data.get("ects_grade") or entry.ects_grade) if has_ects else (update_data.get("local_grade") or entry.local_grade)

            if input_grade:
                try:
                    if use_snapshot:
                        converted = convert_single_grade_from_snapshot(
                            input_grade, rules_snapshot, ects_iku_mappings, has_ects
                        )
                    else:
                        converted = convert_single_grade(db, input_grade, t.partner_university_id, has_ects)
                    entry.ects_grade = converted.get("ects_grade")
                    entry.iku_grade = converted.get("iku_grade")
                    entry.conversion_method = converted.get("conversion_method")
                except ValueError:
                    if "iku_grade" not in update_data and not is_manual:
                        entry.iku_grade = "?"

    log_conversion(db, entry, is_override=is_manual, overridden_by=_user.id, previous_iku=old_iku)
    db.commit()
    db.refresh(entry)
    return _entry_to_dict(entry, db)


# ── Delete single grade entry ──

@router.delete("/{transcript_id}/grades/{entry_id}")
def delete_grade_entry(
    transcript_id: int,
    entry_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(require_role(["super_admin", "dept_admin", "coordinator", "student"])),
):
    t = db.query(StudentTranscript).options(
        joinedload(StudentTranscript.grade_entries)
    ).filter(StudentTranscript.id == transcript_id).first()
    if not t:
        raise HTTPException(status_code=404, detail="Transcript not found")
    if t.status == "finalized":
        raise HTTPException(status_code=400, detail="Transcript is already finalized")
    # Student: can only delete grades on own transcript in student_grading status
    _check_student_transcript_access(t, _user, ["student_grading"])

    entry = db.query(TranscriptGradeEntry).filter(
        TranscriptGradeEntry.id == entry_id,
        TranscriptGradeEntry.transcript_id == transcript_id,
    ).first()
    if not entry:
        raise HTTPException(status_code=404, detail="Grade entry not found")

    db.delete(entry)
    db.commit()
    return {"id": entry_id, "deleted": True}


# ── Finalize transcript ──

@router.post("/{transcript_id}/finalize")
def finalize_transcript(
    transcript_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(require_role(["super_admin", "dept_admin", "coordinator"])),
):
    t = db.query(StudentTranscript).options(
        joinedload(StudentTranscript.grade_entries)
    ).filter(StudentTranscript.id == transcript_id).first()
    if not t:
        raise HTTPException(status_code=404, detail="Transcript not found")
    if t.status == "finalized":
        raise HTTPException(status_code=400, detail="Transcript is already finalized")

    entry_count = db.query(TranscriptGradeEntry).filter(
        TranscriptGradeEntry.transcript_id == transcript_id,
    ).count()
    if entry_count == 0:
        raise HTTPException(status_code=400, detail="Cannot finalize transcript with no grade entries")

    t.status = "finalized"
    t.graded_by = _user.id
    t.graded_at = func.now()
    db.commit()
    db.refresh(t)
    return _transcript_to_dict(t, include_entries=True, db=db)


# ── Revert transcript ──

@router.post("/{transcript_id}/revert")
def revert_transcript(
    transcript_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(require_role(["super_admin", "dept_admin", "coordinator"])),
):
    t = db.query(StudentTranscript).options(
        joinedload(StudentTranscript.grade_entries)
    ).filter(StudentTranscript.id == transcript_id).first()
    if not t:
        raise HTTPException(status_code=404, detail="Transcript not found")
    if t.status != "finalized":
        raise HTTPException(status_code=400, detail="Transcript is not finalized")

    t.status = "grading_in_progress"
    t.graded_by = None
    t.graded_at = None
    db.commit()
    db.refresh(t)
    return _transcript_to_dict(t, include_entries=True, db=db)


# ── Update transcript ──

@router.patch("/{transcript_id}")
def update_transcript(
    transcript_id: int,
    student_name: Optional[str] = Form(None),
    student_eid: Optional[str] = Form(None),
    file: Optional[UploadFile] = File(None),
    remove_file: Optional[bool] = Form(False),
    db: Session = Depends(get_db),
    _user: User = Depends(require_role(["super_admin", "dept_admin", "coordinator"])),
):
    t = db.query(StudentTranscript).filter(StudentTranscript.id == transcript_id).first()
    if not t:
        raise HTTPException(status_code=404, detail="Transcript not found")

    if student_name == "__EMPTY__":
        student_name = "Anonymous Student"
    if student_eid == "__EMPTY__":
        student_eid = ""

    if t.student_id is not None and t.student:
        if student_name is not None:
            val_name = student_name.strip() if student_name.strip() else "Anonymous Student"
            t.student.name = val_name
        if student_eid is not None:
            t.student.eid = student_eid.strip()
        db.add(t.student)
    elif t.student_id is None and (student_name is not None or student_eid is not None):
        curr_name = "Anonymous Student"
        curr_eid = ""
        if t.notes and ("Manually created historical record:" in t.notes or "Manuel olarak oluşturulmuş geçmiş kayıt:" in t.notes):
            raw = t.notes.replace("Manually created historical record: ", "").replace("Manuel olarak oluşturulmuş geçmiş kayıt: ", "").strip()
            parts = raw.split(" | ID: ")
            if len(parts) > 0 and parts[0].strip():
                curr_name = parts[0].strip()
            if len(parts) > 1 and parts[1].strip():
                curr_eid = parts[1].strip()

        new_name = student_name.strip() if student_name is not None and student_name.strip() else curr_name
        new_eid = student_eid.strip() if student_eid is not None else curr_eid

        t.notes = f"Manually created historical record: {new_name} | ID: {new_eid}"

    if remove_file:
        if t.file_path:
            try:
                rel_path = t.file_path.lstrip("/")
                abs_path = os.path.join(os.getcwd(), rel_path)
                if os.path.exists(abs_path):
                    os.remove(abs_path)
            except Exception as e:
                print(f"Failed to delete old file: {e}")
        t.file_path = None
        t.original_filename = None

    if file and file.filename:
        if t.file_path:
            try:
                rel_path = t.file_path.lstrip("/")
                abs_path = os.path.join(os.getcwd(), rel_path)
                if os.path.exists(abs_path):
                    os.remove(abs_path)
            except Exception as e:
                print(f"Failed to delete old file: {e}")

        os.makedirs(TRANSCRIPTS_DIR, exist_ok=True)
        ext = os.path.splitext(file.filename)[1]
        unique_name = f"{uuid.uuid4()}{ext}"
        save_path = os.path.join(TRANSCRIPTS_DIR, unique_name)
        with open(save_path, "wb") as buffer:
            buffer.write(file.file.read())
        
        t.file_path = f"/uploads/transcripts/{unique_name}"
        t.original_filename = file.filename

    db.commit()
    db.refresh(t)
    return _transcript_to_dict(t, include_entries=True, db=db)


# ── Delete transcript ──

@router.delete("/{transcript_id}")
def delete_transcript(
    transcript_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(require_role(["super_admin", "dept_admin", "coordinator", "student"])),
):
    t = db.query(StudentTranscript).options(
        joinedload(StudentTranscript.grade_entries)
    ).filter(StudentTranscript.id == transcript_id).first()
    if not t:
        raise HTTPException(status_code=404, detail="Transcript not found")
    
    # Permission checks
    user_role_names = [ra.role.name for ra in _user.role_assignments if ra.is_active]
    is_coordinator_or_admin = any(r in ["super_admin", "dept_admin", "coordinator"] for r in user_role_names)

    if not is_coordinator_or_admin:
        # User is likely a student
        if t.student_id != _user.id:
            raise HTTPException(status_code=403, detail="Not authorized to delete this transcript")
        if t.status not in ("uploaded", "student_grading"):
            raise HTTPException(status_code=400, detail="Students can only delete transcripts in 'uploaded' or 'student_grading' status")
    else:
        # Coordinator/Admin
        if t.status == "finalized":
             raise HTTPException(status_code=400, detail="Cannot delete finalized transcripts. Revert them first.")

    # Delete the file if it exists
    if t.file_path:
        try:
            # t.file_path is like "/uploads/transcripts/filename.pdf"
            relative_path = t.file_path.lstrip("/") 
            abs_path = os.path.join(os.getcwd(), relative_path)
            if os.path.exists(abs_path):
                os.remove(abs_path)
        except Exception as e:
            print(f"Failed to delete file: {e}")

    db.delete(t)
    db.commit()
    return {"message": "Transcript deleted"}


# ── Student: submit for coordinator review ──

@router.post("/{transcript_id}/submit-for-review")
def submit_for_review(
    transcript_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(require_role(["student"])),
):
    t = db.query(StudentTranscript).options(
        joinedload(StudentTranscript.grade_entries)
    ).filter(StudentTranscript.id == transcript_id).first()
    if not t:
        raise HTTPException(status_code=404, detail="Transcript not found")
    if t.student_id != _user.id:
        raise HTTPException(status_code=403, detail="Not authorized")
    if t.status not in ("uploaded", "student_grading"):
        raise HTTPException(status_code=400, detail="Transcript cannot be submitted in its current status")

    entry_count = db.query(TranscriptGradeEntry).filter(
        TranscriptGradeEntry.transcript_id == transcript_id,
    ).count()
    if entry_count == 0:
        raise HTTPException(status_code=400, detail="Cannot submit transcript with no grade entries")

    t.status = "pending_review"
    db.commit()
    db.refresh(t)
    return _transcript_to_dict(t, include_entries=True, db=db)


# ── Grade Conversion Audit ──

@router.get("/{transcript_id}/audit")
def get_transcript_audit(
    transcript_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(require_role(["super_admin", "dept_admin", "coordinator", "registrar", "faculty_affairs_admin"])),
):
    """Return all grade conversion audit records for a transcript."""
    t = db.query(StudentTranscript).filter(StudentTranscript.id == transcript_id).first()
    if not t:
        raise HTTPException(status_code=404, detail="Transcript not found")

    user_role_names = _get_user_role_names(_user)
    is_registrar_type = any(r in ["registrar"] for r in user_role_names)
    if is_registrar_type and not any(r in ["super_admin", "dept_admin", "coordinator"] for r in user_role_names):
        allowed_depts = _resolve_accessible_dept_ids(_user, db)
        if allowed_depts is not None and t.department_id not in allowed_depts:
            raise HTTPException(status_code=403, detail="Not authorized")

    audits = db.query(GradeConversionAudit).filter(
        GradeConversionAudit.transcript_id == transcript_id
    ).order_by(GradeConversionAudit.created_at.desc()).all()

    return {
        "transcript_id": transcript_id,
        "total": len(audits),
        "items": [
            {
                "id": a.id,
                "grade_entry_id": a.grade_entry_id,
                "source_grade": a.source_grade,
                "target_iku_grade": a.target_iku_grade,
                "conversion_method": a.conversion_method,
                "is_manual_override": a.is_manual_override,
                "overridden_by": a.overridden_by,
                "previous_iku_grade": a.previous_iku_grade,
                "notes": a.notes,
                "created_at": a.created_at.isoformat() if a.created_at else None,
            }
            for a in audits
        ],
    }