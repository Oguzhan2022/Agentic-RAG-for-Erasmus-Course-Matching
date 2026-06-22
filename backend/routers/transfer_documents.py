import os
import uuid
import logging
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from typing import Optional

from backend.dependencies import get_db
from backend.config import settings
from db.models import (
    User, TransferDocument, TransferVerificationResult,
    University, Department, AuditLog,
)
from authorization.middleware import require_role, _resolve_accessible_dept_ids, _get_user_role_names
from backend.services.transfer_queue import transfer_queue
from parsing.transfer_document_parser import (
    verify_document_grades, generate_error_explanations,
)
from backend.services.versioning import get_latest_scheme_snapshot_id, get_latest_ects_iku_snapshot_id
from db.models import GradingScheme, GradingSchemeSnapshot, EctsIkuSnapshot

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/registrar", tags=["transfer-documents"])

TRANSFER_DOCS_DIR = os.path.join(settings.upload_dir, "transfer_documents")
ALLOWED_EXTENSIONS = {".pdf", ".doc", ".docx"}
MAX_FILE_SIZE = 15 * 1024 * 1024  # 15 MB


def _doc_to_dict(d: TransferDocument, include_verification: bool = False) -> dict:
    """Serialize a TransferDocument to a dict."""
    result = {
        "id": d.id,
        "partnerUniversityId": d.partner_university_id,
        "partnerUniversityName": d.partner_university.name if d.partner_university else None,
        "departmentId": d.department_id,
        "departmentName": d.department.name if d.department else None,
        "originalFilename": d.original_filename,
        "filePath": d.file_path,
        "fileSize": d.file_size,
        "studentName": d.student_name,
        "studentNumber": d.student_number,
        "parsingMethod": d.parsing_method,
        "parsedRows": d.parsed_rows or [],
        "gradingSchemeId": None,
        "gradingSchemeVersionId": d.grading_scheme_version_id,
        "ectsIkuVersionId": d.ects_iku_version_id,
        "verificationStatus": d.verification_status,
        "totalRows": d.total_rows,
        "validRows": d.valid_rows,
        "partialRows": d.partial_rows,
        "invalidRows": d.invalid_rows,
        "manualCheckRows": d.manual_check_rows,
        "reviewStatus": d.review_status,
        "reviewedBy": d.reviewed_by,
        "reviewedAt": d.reviewed_at.isoformat() if d.reviewed_at else None,
        "reviewNotes": d.review_notes,
        "uploadedBy": d.uploaded_by,
        "createdAt": d.created_at.isoformat() if d.created_at else None,
        "updatedAt": d.updated_at.isoformat() if d.updated_at else None,
    }

    if include_verification and d.verification_results:
        active_vrs = [vr for vr in d.verification_results if vr.is_active]
        result["verificationResults"] = [
            {
                "id": vr.id,
                "rowIndex": vr.row_index,
                "partnerCourseName": vr.partner_course_name,
                "partnerCourseCode": vr.partner_course_code,
                "partnerGrade": vr.partner_grade,
                "partnerEcts": vr.partner_ects,
                "expectedEctsGrade": vr.expected_ects_grade,
                "expectedIkuGrade": vr.expected_iku_grade,
                "providedEctsGrade": vr.provided_ects_grade,
                "providedIkuGrade": vr.provided_iku_grade,
                "validationResult": vr.validation_result,
                "gradeRuleUsed": vr.grade_rule_used,
                "explanation": vr.explanation,
                "explanationVersion": vr.explanation_version,
                "explanationGeneratedAt": None,
            }
            for vr in active_vrs
        ]

    return result


# ── List ──────────────────────────────────────────────────────────────────────

@router.get("/transfer-documents")
def list_documents(
    department_id: Optional[int] = None,
    partner_university_id: Optional[int] = None,
    review_status: Optional[str] = None,
    db: Session = Depends(get_db),
    _user: User = Depends(require_role(["super_admin", "dept_admin", "registrar", "faculty_affairs_admin"])),
):
    user_role_names = _get_user_role_names(_user)
    query = db.query(TransferDocument)

    if "super_admin" not in user_role_names:
        allowed_depts = _resolve_accessible_dept_ids(_user, db) or []
        if allowed_depts:
            query = query.filter(TransferDocument.department_id.in_(allowed_depts))

    if department_id is not None:
        query = query.filter(TransferDocument.department_id == department_id)
    if partner_university_id is not None:
        query = query.filter(TransferDocument.partner_university_id == partner_university_id)
    if review_status is not None:
        query = query.filter(TransferDocument.review_status == review_status)

    docs = query.order_by(TransferDocument.created_at.desc()).all()
    return {"total": len(docs), "items": [_doc_to_dict(d) for d in docs]}


# ── Detail ────────────────────────────────────────────────────────────────────

@router.get("/transfer-documents/{doc_id}")
def get_document(
    doc_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(require_role(["super_admin", "dept_admin", "registrar", "faculty_affairs_admin"])),
):
    d = db.query(TransferDocument).filter(TransferDocument.id == doc_id).first()
    if not d:
        raise HTTPException(status_code=404, detail="Transfer document not found")
    return _doc_to_dict(d, include_verification=True)


# ── Upload + Parse ────────────────────────────────────────────────────────────

@router.post("/upload-transfer-document")
async def upload_transfer_document(
    file: UploadFile = File(...),
    partner_university_id: int = Form(...),
    department_id: int = Form(...),
    db: Session = Depends(get_db),
    _user: User = Depends(require_role(["super_admin", "dept_admin", "registrar", "faculty_affairs_admin"])),
):
    # Validate file extension
    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=400, detail=f"Unsupported file type: {ext}. Accepted: {', '.join(ALLOWED_EXTENSIONS)}")

    # Read and validate size
    content = await file.read()
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(status_code=413, detail=f"File exceeds 15 MB limit")

    # Validate partner_university_id exists
    uni = db.query(University).filter(University.id == partner_university_id).first()
    if not uni:
        raise HTTPException(status_code=404, detail="Partner university not found")

    # Validate department_id exists
    dept = db.query(Department).filter(Department.id == department_id).first()
    if not dept:
        raise HTTPException(status_code=404, detail="Department not found")

    # Check department scope
    user_role_names = _get_user_role_names(_user)
    if "super_admin" not in user_role_names:
        allowed_depts = _resolve_accessible_dept_ids(_user, db) or []
        if allowed_depts and department_id not in allowed_depts:
            raise HTTPException(status_code=403, detail="Not authorized for this department")

    # Save file immediately
    os.makedirs(TRANSFER_DOCS_DIR, exist_ok=True)
    saved_name = f"{uuid.uuid4().hex}{ext}"
    saved_path = os.path.join(TRANSFER_DOCS_DIR, saved_name)
    with open(saved_path, "wb") as f:
        f.write(content)

    # Create DB record with status "processing"
    doc = TransferDocument(
        partner_university_id=partner_university_id,
        department_id=department_id,
        original_filename=file.filename,
        file_path=f"/uploads/transfer_documents/{saved_name}",
        file_size=len(content),
        parsing_method=None,  # null = processing, set by background thread
        parsed_rows=[],
        verification_status="not_verified",
        review_status="pending",
        uploaded_by=_user.id,
    )
    db.add(doc)
    db.flush()

    # Audit log
    al = AuditLog(
        action="upload_transfer_document",
        actor_id=_user.id,
        details={
            "doc_id": doc.id,
            "filename": file.filename,
            "partner_university_id": partner_university_id,
            "department_id": department_id,
        },
    )
    db.add(al)

    db.commit()
    db.refresh(doc)

    # Enqueue for background FIFO processing
    transfer_queue.enqueue(doc.id)

    return {
        "id": doc.id,
        "status": "queued",
        "message": "Document uploaded and queued for processing.",
        "partnerUniversity": uni.name,
        "homeUniversity": "İstanbul Kültür Üniversitesi",
        "rows": [],
        "warnings": [],
        "parsingMethod": None,
        "verificationStatus": "not_verified",
        "totalRows": 0,
        "validRows": 0,
        "partialRows": 0,
        "invalidRows": 0,
        "manualCheckRows": 0,
        "verificationResults": [],
    }


# ── Download file ─────────────────────────────────────────────────────────────

@router.get("/transfer-documents/{doc_id}/file")
def download_file(
    doc_id: int,
    version: int = None,
    db: Session = Depends(get_db),
    _user: User = Depends(require_role(["super_admin", "dept_admin", "registrar", "faculty_affairs_admin"])),
):
    d = db.query(TransferDocument).filter(TransferDocument.id == doc_id).first()
    if not d or not d.file_path:
        raise HTTPException(status_code=404, detail="File not found")

    # If a specific version is requested, look up its file from version_files
    file_path = d.file_path
    original_name = d.original_filename
    if version is not None:
        vf_dict = d.version_files or {}
        ver_key = str(version)
        if ver_key in vf_dict:
            ver_file = vf_dict[ver_key]
            file_path = ver_file.get("file_path", file_path)
            original_name = ver_file.get("filename", original_name)

    filename = os.path.basename(file_path)
    absolute = os.path.join(settings.upload_dir, "transfer_documents", filename)
    if not os.path.exists(absolute):
        raise HTTPException(status_code=404, detail="File not found on disk")

    return FileResponse(
        absolute,
        media_type="application/octet-stream",
        filename=original_name,
    )


# ── Review ────────────────────────────────────────────────────────────────────

from pydantic import BaseModel

class ReviewBody(BaseModel):
    status: str  # 'approved' | 'flagged'
    notes: Optional[str] = None

@router.post("/transfer-documents/{doc_id}/review")
def review_document(
    doc_id: int,
    body: ReviewBody,
    db: Session = Depends(get_db),
    _user: User = Depends(require_role(["super_admin", "dept_admin", "registrar", "faculty_affairs_admin"])),
):
    if body.status not in ("approved", "flagged"):
        raise HTTPException(status_code=400, detail="Status must be 'approved' or 'flagged'")

    d = db.query(TransferDocument).filter(TransferDocument.id == doc_id).first()
    if not d:
        raise HTTPException(status_code=404, detail="Transfer document not found")

    now = datetime.now(timezone.utc)

    d.review_status = body.status
    d.reviewed_by = _user.id
    d.reviewed_at = now
    d.review_notes = body.notes

    # Also save per-version review data
    from sqlalchemy import func as sa_func
    active_version = db.query(TransferVerificationResult.version_number).filter(
        TransferVerificationResult.transfer_document_id == doc_id,
        TransferVerificationResult.is_active == True,
    ).first()
    if active_version:
        vn = str(active_version[0])
        vr_dict = dict(d.version_reviews or {})
        vr_dict[vn] = {
            "status": body.status,
            "by": _user.id,
            "at": now.isoformat(),
            "notes": body.notes or "",
        }
        d.version_reviews = vr_dict

    db.flush()

    al = AuditLog(
        action="review_transfer_document",
        actor_id=_user.id,
        details={
            "doc_id": doc_id,
            "status": body.status,
            "notes": body.notes or "",
        },
    )
    db.add(al)

    db.commit()
    db.refresh(d)

    return _doc_to_dict(d, include_verification=True)


# ── Delete ────────────────────────────────────────────────────────────────────

@router.delete("/transfer-documents/{doc_id}")
def delete_document(
    doc_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(require_role(["super_admin", "dept_admin", "registrar", "faculty_affairs_admin"])),
):
    d = db.query(TransferDocument).filter(TransferDocument.id == doc_id).first()
    if not d:
        raise HTTPException(status_code=404, detail="Transfer document not found")

    # Remove physical file
    if d.file_path:
        try:
            rel = d.file_path.lstrip("/")
            abs_path = os.path.join(os.getcwd(), rel)
            if os.path.exists(abs_path):
                os.remove(abs_path)
        except Exception as e:
            logger.warning("Failed to delete file for doc %d: %s", doc_id, e)

    db.delete(d)
    db.flush()

    al = AuditLog(
        action="delete_transfer_document",
        actor_id=_user.id,
        details={
            "doc_id": doc_id,
            "filename": d.original_filename,
        },
    )
    db.add(al)

    db.commit()
    return {"success": True, "id": doc_id}


@router.get("/transfer-documents/{doc_id}/versions")
def list_versions(
    doc_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(require_role(["super_admin", "dept_admin", "registrar", "faculty_affairs_admin"])),
):
    """List all verification versions for a transfer document."""
    d = db.query(TransferDocument).filter(TransferDocument.id == doc_id).first()
    if not d:
        raise HTTPException(status_code=404, detail="Transfer document not found")

    # Group verification results by version_number, sorted by version desc
    vrs = db.query(TransferVerificationResult).filter(
        TransferVerificationResult.transfer_document_id == doc_id
    ).order_by(
        TransferVerificationResult.version_number.desc(),
        TransferVerificationResult.row_index.asc(),
    ).all()

    versions: dict[int, dict] = {}
    for vr in vrs:
        vn = vr.version_number or 1
        if vn not in versions:
            versions[vn] = {
                "versionNumber": vn,
                "isActive": vr.is_active if vr.is_active else False,
                "createdAt": vr.created_at.isoformat() if vr.created_at else None,
                "rows": [],
            }
        versions[vn]["rows"].append({
            "id": vr.id,
            "rowIndex": vr.row_index,
            "partnerCourseName": vr.partner_course_name,
            "partnerCourseCode": vr.partner_course_code,
            "partnerGrade": vr.partner_grade,
            "partnerEcts": vr.partner_ects,
            "expectedEctsGrade": vr.expected_ects_grade,
            "expectedIkuGrade": vr.expected_iku_grade,
            "providedEctsGrade": vr.provided_ects_grade,
            "providedIkuGrade": vr.provided_iku_grade,
            "validationResult": vr.validation_result,
            "gradeRuleUsed": vr.grade_rule_used,
            "explanation": vr.explanation,
        })

    return {
        "docId": doc_id,
        "totalVersions": len(versions),
        "versions": sorted(versions.values(), key=lambda v: v["versionNumber"], reverse=True),
    }


@router.post("/transfer-documents/{doc_id}/versions/{version_number}/activate")
def activate_version(
    doc_id: int,
    version_number: int,
    db: Session = Depends(get_db),
    _user: User = Depends(require_role(["super_admin", "dept_admin", "registrar", "faculty_affairs_admin"])),
):
    """Set a specific version as active (deactivates others)."""
    d = db.query(TransferDocument).filter(TransferDocument.id == doc_id).first()
    if not d:
        raise HTTPException(status_code=404, detail="Transfer document not found")

    db.query(TransferVerificationResult).filter(
        TransferVerificationResult.transfer_document_id == doc_id
    ).update({"is_active": False})

    db.query(TransferVerificationResult).filter(
        TransferVerificationResult.transfer_document_id == doc_id,
        TransferVerificationResult.version_number == version_number,
    ).update({"is_active": True})

    # Recalculate document stats from the now-active version
    active_vrs = db.query(TransferVerificationResult).filter(
        TransferVerificationResult.transfer_document_id == doc_id,
        TransferVerificationResult.is_active == True,
    ).order_by(TransferVerificationResult.row_index.asc()).all()

    valid = sum(1 for vr in active_vrs if vr.validation_result == "valid")
    invalid = sum(1 for vr in active_vrs if vr.validation_result == "invalid")
    partial = sum(1 for vr in active_vrs if vr.validation_result == "partial")
    manual = sum(1 for vr in active_vrs if vr.validation_result in ("manual_check_required", "no_rule_found"))

    d.total_rows = len(active_vrs)
    d.valid_rows = valid
    d.invalid_rows = invalid
    d.partial_rows = partial
    d.manual_check_rows = manual
    d.verification_status = "has_issues" if invalid > 0 or manual > 0 or partial > 0 else "verified"

    # Restore parsed_rows from the specific version so the frontend table has full data
    vpr_dict = d.version_parsed_rows or {}
    vn_key = str(version_number)
    if vn_key in vpr_dict:
        d.parsed_rows = vpr_dict[vn_key]
    else:
        # Fallback for old versions before version_parsed_rows was added
        d.parsed_rows = [
            {
                "partnerCode": vr.partner_course_code or "",
                "partnerName": vr.partner_course_name or "",
                "localGrade": vr.partner_grade or "",
                "ectsGrade": vr.provided_ects_grade or "",
                "partnerEcts": vr.partner_ects or "",
                "homeCode": "",
                "homeName": "",
                "ikuGrade": vr.provided_iku_grade or "",
                "homeEcts": "",
            }
            for vr in active_vrs
        ]

    # Restore per-version review status
    vr_dict = d.version_reviews or {}
    vn_key = str(version_number)
    if vn_key in vr_dict:
        ver_review = vr_dict[vn_key]
        d.review_status = ver_review.get("status", "pending")
        d.reviewed_by = ver_review.get("by")
        d.reviewed_at = datetime.fromisoformat(ver_review["at"]) if ver_review.get("at") else None
        d.review_notes = ver_review.get("notes", "")
    else:
        # No review for this version yet — reset to pending
        d.review_status = "pending"
        d.reviewed_by = None
        d.reviewed_at = None
        d.review_notes = ""

    # Restore per-version file info
    vf_dict = d.version_files or {}
    if vn_key in vf_dict:
        ver_file = vf_dict[vn_key]
        d.original_filename = ver_file.get("filename", d.original_filename)
        d.file_path = ver_file.get("file_path", d.file_path)

    db.commit()
    db.refresh(d)
    return _doc_to_dict(d, include_verification=True)


# ── Reverify ──────────────────────────────────────────────────────────────────

@router.post("/transfer-documents/{doc_id}/reverify")
def reverify_document(
    doc_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(require_role(["super_admin", "dept_admin", "registrar", "faculty_affairs_admin"])),
):
    """Queue re-verification: reset parsing_method so queue picks it up."""
    d = db.query(TransferDocument).filter(TransferDocument.id == doc_id).first()
    if not d:
        raise HTTPException(status_code=404, detail="Transfer document not found")
    if not d.parsed_rows or not d.parsing_method:
        raise HTTPException(status_code=400, detail="Document not yet processed; cannot reverify")

    # Reset parsing so queue re-processes (queue will handle version increment & deactivation)
    d.parsing_method = None
    d.verification_status = "not_verified"
    d.valid_rows = 0
    d.invalid_rows = 0
    d.partial_rows = 0
    d.manual_check_rows = 0

    al = AuditLog(
        action="reverify_transfer_document",
        actor_id=_user.id,
        details={
            "doc_id": doc_id,
            "note": "Verification results reset, queued for re-processing",
        },
    )
    db.add(al)
    db.commit()

    transfer_queue.enqueue(doc_id)
    return {"status": "queued", "message": "Document queued for re-verification"}


# ── Reupload (replace file + reverify) ────────────────────────────────────────

@router.post("/transfer-documents/{doc_id}/reupload")
async def reupload_document(
    doc_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    _user: User = Depends(require_role(["super_admin", "dept_admin", "registrar", "faculty_affairs_admin"])),
):
    """Replace the file for an existing document and re-queue for processing."""
    d = db.query(TransferDocument).filter(TransferDocument.id == doc_id).first()
    if not d:
        raise HTTPException(status_code=404, detail="Transfer document not found")

    # Validate file extension
    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=400, detail=f"Unsupported file type: {ext}")

    # Read and validate size
    content = await file.read()
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(status_code=413, detail="File exceeds 15 MB limit")

    # NOTE: Do NOT remove old file from disk — it is referenced by
    # previous versions in version_files and must remain downloadable.

    # Save new file
    os.makedirs(TRANSFER_DOCS_DIR, exist_ok=True)
    saved_name = f"{uuid.uuid4().hex}{ext}"
    saved_path = os.path.join(TRANSFER_DOCS_DIR, saved_name)
    with open(saved_path, "wb") as f:
        f.write(content)

    # Update document record
    d.original_filename = file.filename
    d.file_path = f"/uploads/transfer_documents/{saved_name}"
    d.file_size = len(content)
    d.parsing_method = None  # reset so queue picks it up
    d.verification_status = "not_verified"
    d.valid_rows = 0
    d.invalid_rows = 0
    d.partial_rows = 0
    d.manual_check_rows = 0

    al = AuditLog(
        action="reupload_transfer_document",
        actor_id=_user.id,
        details={
            "doc_id": doc_id,
            "new_filename": file.filename,
            "note": "File replaced, queued for re-processing",
        },
    )
    db.add(al)
    db.commit()

    transfer_queue.enqueue(doc_id)
    return {"status": "queued", "message": "File replaced and document queued for re-processing"}


# ── Regenerate Explanations ──────────────────────────────────────────────────

@router.post("/transfer-documents/{doc_id}/regenerate-explanations")
def regenerate_explanations(
    doc_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(require_role(["super_admin", "dept_admin", "registrar", "faculty_affairs_admin"])),
):
    """Queue explanation regeneration: reset explanations, queue for re-processing."""
    d = db.query(TransferDocument).filter(TransferDocument.id == doc_id).first()
    if not d:
        raise HTTPException(status_code=404, detail="Transfer document not found")
    if not d.parsed_rows or not d.parsing_method:
        raise HTTPException(status_code=400, detail="Document not yet processed; cannot regenerate")

    # Clear old explanations + reset parsing so queue re-processes
    vrs = db.query(TransferVerificationResult).filter(
        TransferVerificationResult.transfer_document_id == doc_id
    ).all()
    for vr in vrs:
        vr.explanation = ""
    d.parsing_method = None

    al = AuditLog(
        action="regenerate_explanations_transfer_document",
        actor_id=_user.id,
        details={
            "doc_id": doc_id,
            "note": "Explanations reset, queued for re-processing",
        },
    )
    db.add(al)
    db.commit()

    transfer_queue.enqueue(doc_id)
    return {"status": "queued", "message": "Document queued for explanation regeneration"}
