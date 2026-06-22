from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, joinedload, selectinload
from pydantic import BaseModel
from typing import Optional, List
import json, hashlib

from backend.dependencies import get_db
from db.models import (
    University, GradingScheme, GradeConversionRule, EctsIkuConversion, User, Department,
    GradingSchemeSnapshot, EctsIkuSnapshot, GradeConversionAudit, StudentTranscript, SenateDecision,
    TranscriptGradeEntry,
)
from authorization.middleware import require_role, _resolve_accessible_dept_ids, _get_user_role_names
from backend.services.versioning import (
    snapshot_grading_scheme, snapshot_ects_iku,
)

router = APIRouter(prefix="/api/grading-schemes", tags=["grading-schemes"])


# ── Pydantic models ──

class RuleCreate(BaseModel):
    local_grade_min: Optional[str] = None
    local_grade_max: Optional[str] = None
    local_grade_exact: Optional[str] = None
    local_definition: Optional[str] = None
    ects_grade: str
    description: Optional[str] = None
    sort_order: int = 0

class EctsIkuUpdate(BaseModel):
    iku_grade: str

class EctsIkuCreate(BaseModel):
    ects_grade: str
    iku_grade: str


class RuleUpdate(BaseModel):
    local_grade_min: Optional[str] = None
    local_grade_max: Optional[str] = None
    local_grade_exact: Optional[str] = None
    local_definition: Optional[str] = None
    ects_grade: Optional[str] = None
    description: Optional[str] = None
    sort_order: Optional[int] = None


class RuleBatchItem(BaseModel):
    id: Optional[int] = None  # None for new rules, existing id for updates
    local_grade_min: Optional[str] = None
    local_grade_max: Optional[str] = None
    local_grade_exact: Optional[str] = None
    local_definition: Optional[str] = None
    ects_grade: str
    description: Optional[str] = None
    sort_order: int = 0


class RulesBatchRequest(BaseModel):
    rules: List[RuleBatchItem]


class EctsIkuBatchItem(BaseModel):
    ects_grade: str
    iku_grade: str


class EctsIkuBatchRequest(BaseModel):
    mappings: List[EctsIkuBatchItem]


class SchemeCreate(BaseModel):
    university_id: int
    name: str
    scheme_type: str
    grade_direction: Optional[str] = None
    source: Optional[str] = None
    source_document: Optional[str] = None
    notes: Optional[str] = None
    rules: list[RuleCreate] = []


class SchemeUpdate(BaseModel):
    name: Optional[str] = None
    scheme_type: Optional[str] = None
    grade_direction: Optional[str] = None
    is_active: Optional[bool] = None
    source: Optional[str] = None
    source_document: Optional[str] = None
    notes: Optional[str] = None
    senate_decision_id: Optional[int] = None


class GradeConvertRequest(BaseModel):
    local_grade: str
    university_id: int
    has_ects: bool = False


class BatchGradeEntry(BaseModel):
    local_grade: str
    has_ects: bool = False


class BatchConvertRequest(BaseModel):
    university_id: int
    entries: list[BatchGradeEntry]


# ── Helpers ──

def _scheme_to_dict(scheme: GradingScheme, include_rules: bool = False):
    d = {
        "id": scheme.id,
        "university_id": scheme.university_id,
        "university_name": scheme.university.name if scheme.university else None,
        "name": scheme.name,
        "scheme_type": scheme.scheme_type,
        "country": scheme.university.country if scheme.university else None,
        "grade_direction": scheme.grade_direction,
        "is_active": scheme.is_active,
        "source": None,
        "source_document": None,
        "notes": scheme.notes,
        "senate_decision_id": None,
        "senate_decision_ref": None,
        "created_at": scheme.created_at.isoformat() if scheme.created_at else None,
        "updated_at": scheme.updated_at.isoformat() if scheme.updated_at else None,
    }
    if include_rules:
        d["rules"] = [_rule_to_dict(r) for r in sorted(scheme.rules, key=lambda r: r.sort_order)]
    return d


def _rule_to_dict(rule: GradeConversionRule):
    return {
        "id": rule.id,
        "grading_scheme_id": rule.grading_scheme_id,
        "local_grade_min": rule.local_grade_min,
        "local_grade_max": rule.local_grade_max,
        "local_grade_exact": rule.local_grade_exact,
        "local_definition": rule.local_definition,
        "ects_grade": rule.ects_grade,
        "description": rule.description,
        "sort_order": rule.sort_order,
    }


# ── ECTS → IKU (fixed, read-only) ──

@router.get("/ects-iku")
def get_ects_iku_conversion(db: Session = Depends(get_db)):
    rows = db.query(EctsIkuConversion).filter(EctsIkuConversion.is_active == True).order_by(EctsIkuConversion.ects_grade).all()
    return [
        {
            "id": r.id,
            "ects_grade": r.ects_grade,
            "iku_grade": r.iku_grade,
        }
        for r in rows
    ]


@router.put("/ects-iku/batch")
def batch_ects_iku(
    body: EctsIkuBatchRequest,
    db: Session = Depends(get_db),
    _user: User = Depends(require_role(["super_admin"])),
):
    old = db.query(EctsIkuConversion).filter(
        EctsIkuConversion.is_active == True
    ).order_by(EctsIkuConversion.id).all()
    old_hash = _hash_ects_iku([{
        "ects_grade": m.ects_grade,
        "iku_grade": m.iku_grade,
    } for m in old])

    for m in old:
        db.delete(m)

    db.flush()

    for item in body.mappings:
        m = EctsIkuConversion(
            ects_grade=item.ects_grade.upper(),
            iku_grade=item.iku_grade.upper(),
        )
        db.add(m)

    db.commit()

    new = db.query(EctsIkuConversion).filter(
        EctsIkuConversion.is_active == True
    ).order_by(EctsIkuConversion.id).all()
    new_hash = _hash_ects_iku([{
        "ects_grade": m.ects_grade,
        "iku_grade": m.iku_grade,
    } for m in new])

    if old_hash != new_hash:
        snapshot_ects_iku(db, _user.id)
        db.commit()

    return [{
        "id": m.id,
        "ects_grade": m.ects_grade,
        "iku_grade": m.iku_grade,
    } for m in new]


@router.put("/ects-iku/{mapping_id}")
def update_ects_iku(
    mapping_id: int,
    body: EctsIkuUpdate,
    db: Session = Depends(get_db),
    _user: User = Depends(require_role(["super_admin", "dept_admin"])),
):
    mapping = db.query(EctsIkuConversion).filter(EctsIkuConversion.id == mapping_id).first()
    if not mapping:
        raise HTTPException(status_code=404, detail="Mapping not found")

    mapping.iku_grade = body.iku_grade
    db.commit()
    db.refresh(mapping)
    snapshot_ects_iku(db, _user.id)
    db.commit()
    return {
        "id": mapping.id,
        "ects_grade": mapping.ects_grade,
        "iku_grade": mapping.iku_grade,
    }

@router.post("/ects-iku")
def create_ects_iku(
    body: EctsIkuCreate,
    db: Session = Depends(get_db),
    _user: User = Depends(require_role(["super_admin", "dept_admin"])),
):
    existing = db.query(EctsIkuConversion).filter(
        EctsIkuConversion.ects_grade == str(body.ects_grade).upper()
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail="ECTS grade already exists")

    mapping = EctsIkuConversion(ects_grade=str(body.ects_grade).upper(), iku_grade=str(body.iku_grade).upper())
    db.add(mapping)
    db.commit()
    db.refresh(mapping)
    snapshot_ects_iku(db, _user.id)
    db.commit()
    return {"id": mapping.id, "ects_grade": mapping.ects_grade, "iku_grade": mapping.iku_grade}

@router.delete("/ects-iku/{mapping_id}")
def delete_ects_iku(
    mapping_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(require_role(["super_admin", "dept_admin"])),
):
    mapping = db.query(EctsIkuConversion).filter(EctsIkuConversion.id == mapping_id).first()
    if not mapping:
        raise HTTPException(status_code=404, detail="Mapping not found")
    db.delete(mapping)
    db.commit()
    snapshot_ects_iku(db, _user.id)
    db.commit()
    return {"success": True, "id": mapping_id}


# ── Version History ──
# These fixed-path routes MUST be defined BEFORE the parametrized /{scheme_id} routes

@router.get("/ects-iku/versions")
def get_ects_iku_versions(
    db: Session = Depends(get_db),
    _user: User = Depends(require_role(["super_admin", "dept_admin", "coordinator", "registrar", "faculty_affairs_admin", "student"])),
):
    versions = (
        db.query(EctsIkuSnapshot)
        .order_by(EctsIkuSnapshot.id.desc())
        .all()
    )
    return [
        {
            "id": v.id,
            "version_number": v.version_number,
            "changed_by": v.changed_by,
            "changed_by_name": v.changed_by_user.name if v.changed_by_user else None,
            "created_at": v.created_at.isoformat() if v.created_at else None,
        }
        for v in versions
    ]


@router.get("/ects-iku/versions/{version_id}")
def get_ects_iku_version(
    version_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(require_role(["super_admin", "dept_admin", "coordinator", "registrar", "faculty_affairs_admin", "student"])),
):
    v = db.query(EctsIkuSnapshot).filter(EctsIkuSnapshot.id == version_id).first()
    if not v:
        raise HTTPException(status_code=404, detail="Version not found")

    return {
        "id": v.id,
        "version_number": v.version_number,
        "mappings_snapshot": v.mappings_snapshot,
        "changed_by": v.changed_by,
        "created_at": v.created_at.isoformat() if v.created_at else None,
    }


@router.get("/schemes/{scheme_id}/versions")
def get_scheme_versions(
    scheme_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(require_role(["super_admin", "dept_admin", "coordinator", "registrar", "faculty_affairs_admin", "student"])),
):
    scheme = db.query(GradingScheme).filter(GradingScheme.id == scheme_id).first()
    if not scheme:
        raise HTTPException(status_code=404, detail="Grading scheme not found")

    versions = (
        db.query(GradingSchemeSnapshot)
        .filter(GradingSchemeSnapshot.grading_scheme_id == scheme_id)
        .order_by(GradingSchemeSnapshot.id.desc())
        .all()
    )
    return [
        {
            "id": v.id,
            "version_number": v.version_number,
            "changed_by": v.changed_by,
            "changed_by_name": v.changed_by_user.name if v.changed_by_user else None,
            "senate_decision_id": v.senate_decision_id,
            "senate_decision_ref": f"{v.senate_decision.reference_no} — {v.senate_decision.title}" if v.senate_decision else None,
            "created_at": v.created_at.isoformat() if v.created_at else None,
        }
        for v in versions
    ]


class VersionLinkRequest(BaseModel):
    senate_decision_id: Optional[int] = None


@router.patch("/schemes/{scheme_id}/versions/{version_id}")
def link_decision_to_version(
    scheme_id: int,
    version_id: int,
    body: VersionLinkRequest,
    db: Session = Depends(get_db),
    _user: User = Depends(require_role(["super_admin", "dept_admin"])),
):
    snap = db.query(GradingSchemeSnapshot).filter(
        GradingSchemeSnapshot.id == version_id,
        GradingSchemeSnapshot.grading_scheme_id == scheme_id,
    ).first()
    if not snap:
        raise HTTPException(status_code=404, detail="Version not found")

    if body.senate_decision_id is not None:
        decision = db.query(SenateDecision).filter(SenateDecision.id == body.senate_decision_id).first()
        if not decision:
            raise HTTPException(status_code=404, detail="Senate decision not found")

    snap.senate_decision_id = body.senate_decision_id
    db.commit()
    db.refresh(snap)

    return {
        "id": snap.id,
        "version_number": snap.version_number,
        "senate_decision_id": snap.senate_decision_id,
        "senate_decision_ref": f"{snap.senate_decision.reference_no} — {snap.senate_decision.title}" if snap.senate_decision else None,
    }


@router.get("/schemes/{scheme_id}/versions/{version_id}")
def get_scheme_version(
    scheme_id: int,
    version_id: int,
    ects_iku_version_id: Optional[int] = None,
    db: Session = Depends(get_db),
    _user: User = Depends(require_role(["super_admin", "dept_admin", "coordinator", "registrar", "faculty_affairs_admin", "student"])),
):
    v = (
        db.query(GradingSchemeSnapshot)
        .filter(GradingSchemeSnapshot.id == version_id, GradingSchemeSnapshot.grading_scheme_id == scheme_id)
        .first()
    )
    if not v:
        raise HTTPException(status_code=404, detail="Version not found")

    # Find the precise ECTS-IKU version pinned on the entry, or fallback to the timestamp
    ects_iku_snap = None
    if ects_iku_version_id:
        ects_iku_snap = db.query(EctsIkuSnapshot).filter(EctsIkuSnapshot.id == ects_iku_version_id).first()
    elif v.created_at:
        ects_iku_snap = (
            db.query(EctsIkuSnapshot)
            .filter(EctsIkuSnapshot.created_at <= v.created_at)
            .order_by(EctsIkuSnapshot.id.desc())
            .first()
        )

    return {
        "id": v.id,
        "grading_scheme_id": v.grading_scheme_id,
        "version_number": v.version_number,
        "scheme_snapshot": v.scheme_snapshot,
        "rules_snapshot": v.rules_snapshot,
        "changed_by": v.changed_by,
        "senate_decision_id": v.senate_decision_id,
        "senate_decision_ref": f"{v.senate_decision.reference_no} — {v.senate_decision.title}" if v.senate_decision else None,
        "senate_decision_file": v.senate_decision.original_filename if v.senate_decision and v.senate_decision.original_filename else None,
        "created_at": v.created_at.isoformat() if v.created_at else None,
        "ects_iku_version_number": ects_iku_snap.version_number if ects_iku_snap else None,
        "ects_iku_mappings": ects_iku_snap.mappings_snapshot if ects_iku_snap else None,
    }


# ── Scheme CRUD ──

# /audit-log MUST come before /{scheme_id}
@router.get("/audit-log")
def get_grade_audit_log(
    department_id: Optional[int] = None,
    university_id: Optional[int] = None,
    conversion_method: Optional[str] = None,
    is_manual_override: Optional[bool] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=500),
    db: Session = Depends(get_db),
    _user: User = Depends(require_role(["super_admin", "dept_admin", "coordinator", "registrar", "faculty_affairs_admin"])),
):
    """List all grade conversion audit records with filters and summary."""
    from sqlalchemy import func as sa_func

    user_role_names = _get_user_role_names(_user)
    is_registrar_type = "registrar" in user_role_names
    is_fac_admin = "faculty_affairs_admin" in user_role_names
    allowed_dept_ids = None
    if is_registrar_type or is_fac_admin or "super_admin" not in user_role_names:
        allowed_dept_ids = _resolve_accessible_dept_ids(_user, db)

    query = db.query(GradeConversionAudit, TranscriptGradeEntry, StudentTranscript, User, University).join(
        TranscriptGradeEntry, GradeConversionAudit.grade_entry_id == TranscriptGradeEntry.id, isouter=True
    ).join(
        StudentTranscript, GradeConversionAudit.transcript_id == StudentTranscript.id
    ).outerjoin(
        User, StudentTranscript.student_id == User.id
    ).outerjoin(
        University, StudentTranscript.partner_university_id == University.id
    )

    if allowed_dept_ids is not None:
        query = query.filter(StudentTranscript.department_id.in_(allowed_dept_ids))
    if department_id:
        query = query.filter(StudentTranscript.department_id == department_id)
    if university_id:
        query = query.filter(StudentTranscript.partner_university_id == university_id)
    if conversion_method:
        query = query.filter(GradeConversionAudit.conversion_method == conversion_method)
    if is_manual_override is not None:
        query = query.filter(GradeConversionAudit.is_manual_override == is_manual_override)
    if date_from:
        query = query.filter(GradeConversionAudit.created_at >= date_from)
    if date_to:
        query = query.filter(GradeConversionAudit.created_at <= date_to)

    total = query.count()

    items_tuple = query.order_by(GradeConversionAudit.created_at.desc()).offset(skip).limit(limit).all()

    summary_query = db.query(GradeConversionAudit).join(
        StudentTranscript, GradeConversionAudit.transcript_id == StudentTranscript.id
    )
    if allowed_dept_ids is not None:
        summary_query = summary_query.filter(StudentTranscript.department_id.in_(allowed_dept_ids))

    total_auto = summary_query.filter(GradeConversionAudit.conversion_method.in_(['auto_local', 'auto_ects'])).count()
    total_manual = summary_query.filter(GradeConversionAudit.is_manual_override == True).count()

    return {
        "total": total,
        "skip": skip,
        "limit": limit,
        "summary": {"total_auto": total_auto, "total_manual": total_manual},
        "items": [
            {
                "id": a.id,
                "transcript_id": a.transcript_id,
                "student_name": u.name if u else (t.student_id if t else None),
                "student_eid": u.eid if u else None,
                "university": uni.name if uni else (t.partner_university_name if t else None),
                "course": e.partner_course_name if e else None,
                "source_grade": a.source_grade,
                "target_iku_grade": a.target_iku_grade,
                "conversion_method": a.conversion_method,
                "is_manual_override": a.is_manual_override,
                "previous_iku_grade": a.previous_iku_grade,
                "created_at": a.created_at.isoformat() if a.created_at else None,
            }
            for a, e, t, u, uni in items_tuple
        ],
    }


@router.get("")
def list_schemes(
    university_id: Optional[int] = None,
    active_only: bool = False,
    department_code: Optional[str] = None,
    db: Session = Depends(get_db),
    _user: User = Depends(require_role(["super_admin", "dept_admin", "coordinator", "registrar", "student", "faculty_affairs_admin"])),
):
    user_role_names = _get_user_role_names(_user)
    is_registrar_type = any(r in ["registrar", "faculty_affairs_admin"] for r in user_role_names) and not any(
        r in ["super_admin", "dept_admin", "coordinator"] for r in user_role_names
    )
    # Force-filter registrar to their own faculty's departments
    if is_registrar_type:
        allowed_dept_codes = [
            d.code for d in db.query(Department).filter(
                Department.id.in_(_resolve_accessible_dept_ids(_user, db) or [])
            ).all()
        ]
        if allowed_dept_codes:
            if department_code and department_code in allowed_dept_codes:
                pass
            else:
                department_code = allowed_dept_codes[0]

    query = db.query(GradingScheme).join(University, GradingScheme.university_id == University.id).options(
        joinedload(GradingScheme.university),
        selectinload(GradingScheme.rules)
    )
    if university_id:
        query = query.filter(GradingScheme.university_id == university_id)
    if active_only:
        query = query.filter(GradingScheme.is_active == True)
    if department_code:
        query = query.filter(University.department_id != None) \
                     .join(Department, Department.id == University.department_id) \
                     .filter(Department.code == department_code)

    schemes = query.order_by(University.country, GradingScheme.name).all()
    return [_scheme_to_dict(s, include_rules=True) for s in schemes]


@router.get("/{scheme_id}")
def get_scheme(
    scheme_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(require_role(["super_admin", "dept_admin", "coordinator", "registrar", "faculty_affairs_admin", "student"])),
):
    scheme = db.query(GradingScheme).options(
        joinedload(GradingScheme.university),
        selectinload(GradingScheme.rules)
    ).filter(GradingScheme.id == scheme_id).first()
    if not scheme:
        raise HTTPException(status_code=404, detail="Grading scheme not found")
    return _scheme_to_dict(scheme, include_rules=True)


@router.post("")
def create_scheme(
    body: SchemeCreate,
    db: Session = Depends(get_db),
    _user: User = Depends(require_role(["super_admin", "dept_admin"])),
):
    uni = db.query(University).filter(University.id == body.university_id).first()
    if not uni:
        raise HTTPException(status_code=404, detail="University not found")
    if uni.is_home:
        raise HTTPException(status_code=400, detail="Home üniversiteler için grading scheme oluşturulamaz.")

    # Check if a scheme already exists for this university
    existing = db.query(GradingScheme).filter(GradingScheme.university_id == body.university_id).first()
    if existing:
        raise HTTPException(
            status_code=400,
            detail=f"Bu üniversite için zaten bir grading scheme mevcut ('{existing.name}'). Yeni bir tane oluşturmadan önce mevcut olanı silmeniz gerekmektedir."
        )

    scheme = GradingScheme(
        university_id=body.university_id,
        name=body.name,
        scheme_type=body.scheme_type,
        grade_direction=body.grade_direction,
        notes=body.notes,
    )
    db.add(scheme)
    db.flush()

    for rule_data in body.rules:
        rule = GradeConversionRule(
            grading_scheme_id=scheme.id,
            local_grade_min=rule_data.local_grade_min,
            local_grade_max=rule_data.local_grade_max,
            local_grade_exact=rule_data.local_grade_exact,
            local_definition=rule_data.local_definition,
            ects_grade=rule_data.ects_grade,
            description=rule_data.description,
            sort_order=rule_data.sort_order,
        )
        db.add(rule)

    db.commit()
    db.refresh(scheme)
    # Take initial v1 snapshot so grade entries can link to it
    snapshot_grading_scheme(db, scheme.id, _user.id)
    db.commit()
    return _scheme_to_dict(scheme, include_rules=True)


@router.put("/{scheme_id}")
def update_scheme(
    scheme_id: int,
    body: SchemeUpdate,
    db: Session = Depends(get_db),
    _user: User = Depends(require_role(["super_admin", "dept_admin"])),
):
    scheme = db.query(GradingScheme).filter(GradingScheme.id == scheme_id).first()
    if not scheme:
        raise HTTPException(status_code=404, detail="Grading scheme not found")

    update_data = body.model_dump(exclude_unset=True)

    if "university_id" in update_data and update_data["university_id"] != scheme.university_id:
        target_uni = db.query(University).filter(University.id == update_data["university_id"]).first()
        if target_uni and target_uni.is_home:
            raise HTTPException(status_code=400, detail="Home üniversiteler için grading scheme oluşturulamaz.")

        existing = db.query(GradingScheme).filter(
            GradingScheme.university_id == update_data["university_id"],
            GradingScheme.id != scheme_id
        ).first()
        if existing:
            raise HTTPException(
                status_code=400,
                detail=f"Hedef üniversite için zaten bir grading scheme mevcut ('{existing.name}')."
            )

    for field, value in update_data.items():
        setattr(scheme, field, value)

    db.commit()
    db.refresh(scheme)
    snapshot_grading_scheme(db, scheme_id, _user.id)
    db.commit()
    return _scheme_to_dict(scheme, include_rules=True)


@router.delete("/{scheme_id}")
def delete_scheme(
    scheme_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(require_role(["super_admin", "dept_admin"])),
):
    scheme = db.query(GradingScheme).filter(GradingScheme.id == scheme_id).first()
    if not scheme:
        raise HTTPException(status_code=404, detail="Grading scheme not found")

    db.delete(scheme)
    db.commit()
    return {"id": scheme_id, "deleted": True}

@router.post("/{scheme_id}/rules")
def add_rule(
    scheme_id: int,
    body: RuleCreate,
    db: Session = Depends(get_db),
    _user: User = Depends(require_role(["super_admin", "dept_admin"])),
):
    scheme = db.query(GradingScheme).filter(GradingScheme.id == scheme_id).first()
    if not scheme:
        raise HTTPException(status_code=404, detail="Grading scheme not found")

    rule = GradeConversionRule(
        grading_scheme_id=scheme_id,
        local_grade_min=body.local_grade_min,
        local_grade_max=body.local_grade_max,
        local_grade_exact=body.local_grade_exact,
        local_definition=body.local_definition,
        ects_grade=body.ects_grade,
        description=body.description,
        sort_order=body.sort_order,
    )
    db.add(rule)
    db.commit()
    db.refresh(rule)
    snapshot_grading_scheme(db, scheme_id, _user.id)
    db.commit()
    return _rule_to_dict(rule)


@router.put("/rules/{rule_id}")
def update_rule(
    rule_id: int,
    body: RuleUpdate,
    db: Session = Depends(get_db),
    _user: User = Depends(require_role(["super_admin", "dept_admin"])),
):
    rule = db.query(GradeConversionRule).filter(GradeConversionRule.id == rule_id).first()
    if not rule:
        raise HTTPException(status_code=404, detail="Rule not found")

    update_data = body.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(rule, field, value)

    db.commit()
    db.refresh(rule)
    snapshot_grading_scheme(db, rule.grading_scheme_id, _user.id)
    db.commit()
    return _rule_to_dict(rule)


@router.delete("/rules/{rule_id}")
def delete_rule(
    rule_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(require_role(["super_admin", "dept_admin"])),
):
    rule = db.query(GradeConversionRule).filter(GradeConversionRule.id == rule_id).first()
    if not rule:
        raise HTTPException(status_code=404, detail="Rule not found")

    db.delete(rule)
    db.commit()
    snapshot_grading_scheme(db, rule.grading_scheme_id, _user.id)
    db.commit()
    return {"id": rule_id, "deleted": True}


# ── Batch endpoints ──

def _hash_rules(rules: list[dict]) -> str:
    """Deterministic hash of rule set for change detection."""
    data = json.dumps(
        sorted(rules, key=lambda r: (r.get('id') or 0, r.get('ects_grade', ''), r.get('local_grade_exact', ''), r.get('local_grade_min', ''), r.get('local_grade_max', ''))),
        sort_keys=True,
        default=str,
    )
    return hashlib.sha256(data.encode()).hexdigest()


@router.put("/{scheme_id}/rules/batch")
def batch_rules(
    scheme_id: int,
    body: RulesBatchRequest,
    db: Session = Depends(get_db),
    _user: User = Depends(require_role(["super_admin", "dept_admin"])),
):
    scheme = db.query(GradingScheme).filter(GradingScheme.id == scheme_id).first()
    if not scheme:
        raise HTTPException(status_code=404, detail="Grading scheme not found")

    old_rules = db.query(GradeConversionRule).filter(
        GradeConversionRule.grading_scheme_id == scheme_id
    ).all()

    old_hash = _hash_rules([
        _rule_to_dict(r) for r in old_rules
    ])

    incoming_ids = {item.id for item in body.rules if item.id is not None}

    # Delete rules not in the batch
    for old in old_rules:
        if old.id not in incoming_ids:
            db.delete(old)

    # Add / update
    for item in body.rules:
        if item.id is not None:
            existing = db.query(GradeConversionRule).filter(
                GradeConversionRule.id == item.id,
                GradeConversionRule.grading_scheme_id == scheme_id,
            ).first()
            if existing:
                existing.local_grade_min = item.local_grade_min
                existing.local_grade_max = item.local_grade_max
                existing.local_grade_exact = item.local_grade_exact
                existing.local_definition = item.local_definition
                existing.ects_grade = item.ects_grade
                existing.description = item.description
                existing.sort_order = item.sort_order
        else:
            new_rule = GradeConversionRule(
                grading_scheme_id=scheme_id,
                local_grade_min=item.local_grade_min,
                local_grade_max=item.local_grade_max,
                local_grade_exact=item.local_grade_exact,
                local_definition=item.local_definition,
                ects_grade=item.ects_grade,
                description=item.description,
                sort_order=item.sort_order,
            )
            db.add(new_rule)

    db.commit()

    # Only snapshot if something changed
    new_rules = db.query(GradeConversionRule).filter(
        GradeConversionRule.grading_scheme_id == scheme_id
    ).all()
    new_hash = _hash_rules([_rule_to_dict(r) for r in new_rules])

    if old_hash != new_hash:
        snapshot_grading_scheme(db, scheme_id, _user.id)
        db.commit()

    return [_rule_to_dict(r) for r in new_rules]


def _hash_ects_iku(mappings: list[dict]) -> str:
    data = json.dumps(
        sorted(mappings, key=lambda r: r.get('ects_grade', '')),
        sort_keys=True,
        default=str,
    )
    return hashlib.sha256(data.encode()).hexdigest()


# ── Grade conversion test endpoint ──

@router.post("/convert")
def convert_grade(
    body: GradeConvertRequest,
    db: Session = Depends(get_db),
    _user: User = Depends(require_role(["super_admin", "dept_admin", "coordinator", "registrar", "faculty_affairs_admin", "student"])),
):
    local_grade = body.local_grade.strip()

    if body.has_ects:
        ects_row = db.query(EctsIkuConversion).filter(
            EctsIkuConversion.ects_grade == local_grade,
            EctsIkuConversion.is_active == True,
        ).first()
        if not ects_row:
            raise HTTPException(status_code=400, detail=f"No ECTS→IKU mapping for '{local_grade}'")
        return {
            "input_grade": local_grade,
            "input_type": "ects",
            "ects_grade": local_grade,
            "iku_grade": ects_row.iku_grade,
            "conversion_path": "ects→iku",
        }

    scheme = db.query(GradingScheme).filter(
        GradingScheme.university_id == body.university_id,
        GradingScheme.is_active == True,
    ).first()
    if not scheme:
        raise HTTPException(status_code=404, detail="No active grading scheme for this university")

    ects_grade = None
    try:
        numeric_input = float(local_grade)
        for rule in scheme.rules:
            if rule.local_grade_exact:
                continue
            if rule.local_grade_min is not None and rule.local_grade_max is not None:
                r_min = float(rule.local_grade_min)
                r_max = float(rule.local_grade_max)
                if r_min <= numeric_input <= r_max:
                    ects_grade = rule.ects_grade
                    break
    except ValueError:
        pass

    if not ects_grade:
        for rule in scheme.rules:
            if rule.local_grade_exact and rule.local_grade_exact.strip().lower() == local_grade.lower():
                ects_grade = rule.ects_grade
                break

    if not ects_grade:
        raise HTTPException(
            status_code=400,
            detail=f"No conversion rule matches '{local_grade}' in scheme '{scheme.name}'",
        )

    ects_row = db.query(EctsIkuConversion).filter(
        EctsIkuConversion.ects_grade == ects_grade,
        EctsIkuConversion.is_active == True,
    ).first()
    iku_grade = ects_row.iku_grade if ects_row else "?"

    return {
        "input_grade": local_grade,
        "input_type": "local",
        "ects_grade": ects_grade,
        "iku_grade": iku_grade,
        "scheme_id": scheme.id,
        "scheme_name": scheme.name,
        "conversion_path": "local→ects→iku",
    }


@router.post("/convert-batch")
def convert_batch(
    body: BatchConvertRequest,
    db: Session = Depends(get_db),
    _user: User = Depends(require_role(["super_admin", "dept_admin", "coordinator", "registrar", "faculty_affairs_admin", "student"])),
):
    from matching.grade_transfer import convert_batch_grades

    entries = [e.model_dump() for e in body.entries]
    results = convert_batch_grades(db, entries, body.university_id)
    return {"results": results}
