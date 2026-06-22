import os
import uuid
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from sqlalchemy import func
from typing import Optional

from backend.dependencies import get_db
from backend.config import settings
from db.models import SenateDecision, User, Department, University
from authorization.middleware import require_role, _resolve_accessible_dept_ids, _get_user_role_names

router = APIRouter(prefix="/api/senate-decisions", tags=["senate-decisions"])

DECISIONS_DIR = os.path.join(settings.upload_dir, "senate_decisions")


def _decision_to_dict(d: SenateDecision) -> dict:
    return {
        "id": d.id,
        "title": d.title,
        "decision_date": d.decision_date.isoformat() if d.decision_date else None,
        "reference_no": d.reference_no,
        "decision_type": d.decision_type,
        "faculty_id": d.faculty_id,
        "faculty_name": d.faculty.name if d.faculty else None,
        "department_id": d.department_id,
        "department_name": d.department.name if d.department else None,
        "university_id": d.university_id,
        "university_name": d.university.name if hasattr(d, 'university') and d.university else None,
        "summary": d.summary,
        "is_active": d.is_active,
        "original_filename": d.original_filename,
        "file_size": d.file_size,
        "uploaded_by": d.uploaded_by,
        "created_at": d.created_at.isoformat() if d.created_at else None,
        "updated_at": d.updated_at.isoformat() if d.updated_at else None,
    }


@router.get("")
def list_decisions(
    decision_type: Optional[str] = None,
    department_id: Optional[int] = None,
    department_code: Optional[str] = None,
    faculty_id: Optional[int] = None,
    university_id: Optional[int] = None,
    is_active: Optional[bool] = None,
    db: Session = Depends(get_db),
    _user: User = Depends(require_role(["super_admin", "dept_admin", "coordinator", "registrar", "faculty_affairs_admin"])),
):
    user_role_names = _get_user_role_names(_user)
    if "super_admin" not in user_role_names:
        allowed_depts = _resolve_accessible_dept_ids(_user, db) or []
        is_faculty_admin = any(r in ["registrar", "registrar_staff", "faculty_affairs_admin"] for r in user_role_names)

        dept_faculties = db.query(Department.faculty_id).filter(
            Department.id.in_(allowed_depts)
        ).distinct().all() if allowed_depts else []
        fac_ids = [f for (f,) in dept_faculties if f]

        if is_faculty_admin:
            query = db.query(SenateDecision).filter(
                (SenateDecision.faculty_id.in_(fac_ids)) |
                (SenateDecision.department_id.in_(allowed_depts)) |
                ((SenateDecision.faculty_id.is_(None)) & (SenateDecision.department_id.is_(None)))
            )
        else:
            query = db.query(SenateDecision).filter(
                (SenateDecision.department_id.in_(allowed_depts)) |
                ((SenateDecision.faculty_id.in_(fac_ids)) & (SenateDecision.department_id.is_(None))) |
                ((SenateDecision.faculty_id.is_(None)) & (SenateDecision.department_id.is_(None)))
            )

        if decision_type:
            query = query.filter(SenateDecision.decision_type == decision_type)
        if department_id is not None:
            query = query.filter(SenateDecision.department_id == department_id)
        if faculty_id is not None:
            query = query.filter(SenateDecision.faculty_id == faculty_id)
        if university_id is not None:
            query = query.filter(SenateDecision.university_id == university_id)
        if is_active is not None:
            query = query.filter(SenateDecision.is_active == is_active)

        if department_code:
            dept = db.query(Department).filter(func.upper(Department.code) == department_code.upper()).first()
            if dept:
                query = query.filter(SenateDecision.department_id == dept.id)

        decisions = query.order_by(SenateDecision.decision_date.desc()).all()
        return [_decision_to_dict(d) for d in decisions]

    query = db.query(SenateDecision)
    if decision_type:
        query = query.filter(SenateDecision.decision_type == decision_type)
    if department_id is not None:
        query = query.filter(SenateDecision.department_id == department_id)
    if faculty_id is not None:
        query = query.filter(SenateDecision.faculty_id == faculty_id)
    if university_id is not None:
        query = query.filter(SenateDecision.university_id == university_id)
    if is_active is not None:
        query = query.filter(SenateDecision.is_active == is_active)

    # Resolve department_code to department_id
    resolved_dept_id = None
    if department_code:
        dept = db.query(Department).filter(func.upper(Department.code) == department_code.upper()).first()
        if dept:
            resolved_dept_id = dept.id
            query = query.filter(SenateDecision.department_id == resolved_dept_id)

    decisions = query.order_by(SenateDecision.decision_date.desc()).all()
    return [_decision_to_dict(d) for d in decisions]


@router.get("/{decision_id}")
def get_decision(
    decision_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(require_role(["super_admin", "dept_admin", "coordinator", "registrar", "faculty_affairs_admin"])),
):
    d = db.query(SenateDecision).filter(SenateDecision.id == decision_id).first()
    if not d:
        raise HTTPException(status_code=404, detail="Senate decision not found")
    return _decision_to_dict(d)


import json
@router.post("")
async def upload_decision(
    title: str = Form(...),
    decision_date: str = Form(...),
    reference_no: str = Form(...),
    decision_type: str = Form(...),
    department_id: Optional[int] = Form(None),
    faculty_id: Optional[int] = Form(None),
    department_ids: Optional[str] = Form(None),
    university_ids: Optional[str] = Form(None),
    scopes: Optional[str] = Form(None),
    summary: Optional[str] = Form(None),
    file: Optional[UploadFile] = File(None),
    db: Session = Depends(get_db),
    _user: User = Depends(require_role(["super_admin", "dept_admin", "registrar", "faculty_affairs_admin"])),
):
    user_role_names = _get_user_role_names(_user)
    if "super_admin" not in user_role_names and any(r in ["registrar", "faculty_affairs_admin"] for r in user_role_names):
        if not faculty_id:
            for ra in _user.role_assignments:
                if ra.is_active and ra.faculty_id:
                    faculty_id = ra.faculty_id
                    break

    combos = []
    if scopes:
        try:
            scope_list = json.loads(scopes)
            for sc in scope_list:
                d_ids = sc.get("department_ids", [])
                u_ids = sc.get("university_ids", [])
                if not d_ids:
                    d_ids = [None]
                if not u_ids:
                    u_ids = [None]
                for did in d_ids:
                    for uid in u_ids:
                        combos.append((did, uid))
        except Exception:
            pass

    if not combos:
        dept_list = []
        if department_ids:
            try:
                dept_list = [int(x.strip()) for x in department_ids.split(",") if x.strip()]
            except ValueError:
                pass
        if not dept_list and department_id is not None:
            dept_list = [department_id]
        if not dept_list:
            dept_list = [None]  # Global / All departments

        uni_list = []
        if university_ids:
            try:
                uni_list = [int(x.strip()) for x in university_ids.split(",") if x.strip()]
            except ValueError:
                pass
        if not uni_list:
            uni_list = [None]

        for did in dept_list:
            for uid in uni_list:
                combos.append((did, uid))

    unique_combos = list(set(combos))

    # Check existence for each combination
    for did, uid in unique_combos:
        existing = db.query(SenateDecision).filter(
            SenateDecision.reference_no == reference_no,
            SenateDecision.department_id == did,
            SenateDecision.university_id == uid
        ).first()
        if existing:
            dept_name = f"Dept ID {did}" if did else "All Departments"
            uni_name = f"Uni ID {uid}" if uid else "All Universities"
            raise HTTPException(
                status_code=400, 
                detail=f"Reference number {reference_no} already exists for {dept_name} and {uni_name}."
            )

    file_path = None
    original_filename = None
    file_size = None

    if file and file.filename:
        os.makedirs(DECISIONS_DIR, exist_ok=True)
        ext = os.path.splitext(file.filename)[1]
        saved_name = f"{uuid.uuid4().hex}{ext}"
        saved_path = os.path.join(DECISIONS_DIR, saved_name)
        content = await file.read()
        with open(saved_path, "wb") as f:
            f.write(content)
        file_path = f"/uploads/senate_decisions/{saved_name}"
        original_filename = file.filename
        file_size = len(content)

    created_decisions = []
    for did, uid in unique_combos:
        # Derive faculty_id from department when department is set (avoids cross-faculty mismatch)
        row_faculty_id = faculty_id
        if did is not None:
            dept = db.query(Department).filter(Department.id == did).first()
            row_faculty_id = dept.faculty_id if dept else faculty_id

        d = SenateDecision(
            title=title,
            decision_date=datetime.fromisoformat(decision_date),
            reference_no=reference_no,
            decision_type=decision_type,
            department_id=did,
            faculty_id=row_faculty_id,
            university_id=uid,
            summary=summary,
            file_path=file_path,
            original_filename=original_filename,
            file_size=file_size,
            uploaded_by=_user.id,
        )
        db.add(d)
        created_decisions.append(d)

    db.commit()
    for d in created_decisions:
        db.refresh(d)

    return _decision_to_dict(created_decisions[0]) if created_decisions else {}


@router.get("/{decision_id}/file")
def download_file(
    decision_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(require_role(["super_admin", "dept_admin", "coordinator", "registrar", "faculty_affairs_admin"])),
):
    d = db.query(SenateDecision).filter(SenateDecision.id == decision_id).first()
    if not d or not d.file_path:
        raise HTTPException(status_code=404, detail="File not found")

    filename = os.path.basename(d.file_path)
    absolute = os.path.join(settings.upload_dir, "senate_decisions", filename)
    if not os.path.exists(absolute):
        raise HTTPException(status_code=404, detail="File not found on disk")

    return FileResponse(
        absolute,
        media_type="application/octet-stream",
        filename=d.original_filename,
    )


@router.delete("/{decision_id}")
def delete_decision(
    decision_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(require_role(["super_admin", "dept_admin", "registrar", "faculty_affairs_admin"])),
):
    d = db.query(SenateDecision).filter(SenateDecision.id == decision_id).first()
    if not d:
        raise HTTPException(status_code=404, detail="Senate decision not found")

    # Only remove physical file if no other SenateDecision row is sharing this exact file_path
    if d.file_path:
        other_uses = db.query(SenateDecision).filter(
            SenateDecision.file_path == d.file_path,
            SenateDecision.id != decision_id
        ).count()
        if other_uses == 0:
            filename = os.path.basename(d.file_path)
            absolute = os.path.join(settings.upload_dir, "senate_decisions", filename)
            if os.path.exists(absolute):
                os.remove(absolute)

    db.delete(d)
    db.commit()
    return {"success": True, "id": decision_id}
