import os
import shutil
from typing import List, Optional
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, BackgroundTasks
from sqlalchemy.orm import Session

from backend.dependencies import get_db
from backend.config import settings
from db.models import University, IngestionBatch, UploadJob, User
from authorization.middleware import require_role
from ingestion.queue_manager import queue_manager

router = APIRouter(prefix="/api", tags=["ingestion"])


# ── Legacy endpoints (kept for backwards compatibility) ──────────────────────

def _run_parsing_task(university_id: int, batch_id: int, pdf_paths: list,
                      semester: str, university_name: str, db_url: str):
    """Background task that runs the parsing pipeline (legacy, no queue)."""
    from db.database import SessionLocal
    from ingestion.university_onboarding import UniversityOnboardingPipeline
    db = SessionLocal()
    try:
        pipeline = UniversityOnboardingPipeline(db)
        pipeline.ingest_pdfs(
            university_id=university_id,
            batch_id=batch_id,
            pdf_paths=pdf_paths,
            semester=semester,
            university_name=university_name,
        )
    finally:
        db.close()


@router.post("/universities/{university_id}/upload")
async def upload_pdfs(
    university_id: int,
    semester: str = Form("unknown"),
    files: List[UploadFile] = File(...),
    db: Session = Depends(get_db),
    _user: User = Depends(require_role(["super_admin", "dept_admin", "coordinator"])),
):
    """Upload PDF files for a university (legacy endpoint)."""
    uni = db.query(University).filter(University.id == university_id).first()
    if not uni:
        raise HTTPException(status_code=404, detail="University not found")

    upload_dir = os.path.join(settings.upload_dir, str(university_id), semester)
    os.makedirs(upload_dir, exist_ok=True)

    saved_files = []
    for file in files:
        if not (file.filename.lower().endswith(".pdf") or file.filename.lower().endswith(".txt")):
            continue
        file_path = os.path.join(upload_dir, os.path.basename(file.filename))
        with open(file_path, "wb") as f:
            content = await file.read()
            f.write(content)
        saved_files.append({"filename": os.path.basename(file.filename), "path": file_path, "size": len(content)})

    return {
        "university_id": university_id,
        "semester": semester,
        "uploaded_files": saved_files,
        "count": len(saved_files),
    }


@router.post("/universities/{university_id}/parse")
async def trigger_parsing(
    university_id: int,
    semester: str = Form("unknown"),
    background_tasks: BackgroundTasks = BackgroundTasks(),
    db: Session = Depends(get_db),
    _user: User = Depends(require_role(["super_admin", "dept_admin", "coordinator"])),
):
    """Trigger parsing for uploaded PDFs (legacy endpoint - uses queue now)."""
    uni = db.query(University).filter(University.id == university_id).first()
    if not uni:
        raise HTTPException(status_code=404, detail="University not found")

    upload_dir = os.path.join(settings.upload_dir, str(university_id), semester)
    if not os.path.exists(upload_dir):
        raise HTTPException(status_code=400, detail="No uploaded files found for this semester")

    file_paths = [
        os.path.join(upload_dir, f)
        for f in os.listdir(upload_dir)
        if f.lower().endswith((".pdf", ".txt"))
    ]
    if not file_paths:
        raise HTTPException(status_code=400, detail="No PDF/TXT files found in upload directory")

    batch = IngestionBatch(
        university_id=university_id,
        semester=semester,
        status="pending",
        total_courses=len(file_paths),
    )
    db.add(batch)
    db.commit()
    db.refresh(batch)

    background_tasks.add_task(
        _run_parsing_task,
        university_id=university_id,
        batch_id=batch.id,
        pdf_paths=file_paths,
        semester=semester,
        university_name=uni.name,
        db_url=str(settings.database_url),
    )

    return {
        "batch_id": batch.id,
        "university_id": university_id,
        "semester": semester,
        "total_files": len(file_paths),
        "status": "parsing",
        "message": "Parsing started. Poll /api/ingestion/batches/{batch_id} for progress.",
    }


@router.get("/ingestion/batches/{batch_id}")
def get_batch_status(
    batch_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(require_role(["super_admin", "dept_admin", "coordinator"])),
):
    """Get the status and progress of an ingestion batch."""
    batch = db.query(IngestionBatch).filter(IngestionBatch.id == batch_id).first()
    if not batch:
        raise HTTPException(status_code=404, detail="Batch not found")

    progress = 0
    if batch.total_courses and batch.total_courses > 0:
        progress = round((batch.parsed_courses / batch.total_courses) * 100, 1)

    return {
        "id": batch.id,
        "university_id": batch.university_id,
        "semester": batch.semester,
        "status": batch.status,
        "total_courses": batch.total_courses,
        "parsed_courses": batch.parsed_courses,
        "failed_courses": batch.failed_courses,
        "progress_percent": progress,
        "error_log": batch.error_log,
        "started_at": batch.started_at.isoformat() if batch.started_at else None,
        "completed_at": batch.completed_at.isoformat() if batch.completed_at else None,
    }


@router.get("/ingestion/batches")
def list_batches(
    university_id: Optional[int] = None,
    db: Session = Depends(get_db),
    _user: User = Depends(require_role(["super_admin", "dept_admin", "coordinator"])),
):
    """List all ingestion batches, optionally filtered by university."""
    query = db.query(IngestionBatch)
    if university_id:
        query = query.filter(IngestionBatch.university_id == university_id)
    batches = query.order_by(IngestionBatch.started_at.desc()).all()
    return [
        {
            "id": b.id,
            "university_id": b.university_id,
            "semester": b.semester,
            "status": b.status,
            "total_courses": b.total_courses,
            "parsed_courses": b.parsed_courses,
            "failed_courses": b.failed_courses,
            "started_at": b.started_at.isoformat() if b.started_at else None,
            "completed_at": b.completed_at.isoformat() if b.completed_at else None,
        }
        for b in batches
    ]


# ── Queue-based Upload Job endpoints ─────────────────────────────────────────

def _job_to_dict(job: UploadJob, uni_name: str = None) -> dict:
    """Serialize an UploadJob to a response dict."""
    progress = 0
    if job.total_files and job.total_files > 0:
        progress = round((job.processed_files / job.total_files) * 100, 1)
    return {
        "id": job.id,
        "university_id": job.university_id,
        "university_name": uni_name,
        "ingestion_batch_id": job.ingestion_batch_id,
        "semester": job.semester,
        "category": job.category,
        "status": job.status,
        "total_files": job.total_files,
        "processed_files": job.processed_files,
        "failed_files": job.failed_files,
        "progress_percent": progress,
        "current_file": job.current_file,
        "error_log": job.error_log,
        "created_at": job.created_at.isoformat() if job.created_at else None,
        "updated_at": job.updated_at.isoformat() if job.updated_at else None,
        "completed_at": job.completed_at.isoformat() if job.completed_at else None,
    }


@router.post("/upload-jobs")
async def create_upload_job(
    university_id: int,
    semester: str = Form("unknown"),
    category: Optional[str] = Form(None),
    pdf_structure: Optional[str] = Form(None),
    files: List[UploadFile] = File(...),
    db: Session = Depends(get_db),
    _user: User = Depends(require_role(["super_admin", "dept_admin", "coordinator"])),
):
    """
    Upload PDF files and enqueue a parse job.
    Returns the UploadJob which can be polled for progress.
    pdf_structure: Override the university's default pdf_structure for this upload.
    """
    uni = db.query(University).filter(University.id == university_id).first()
    if not uni:
        raise HTTPException(status_code=404, detail="University not found")

    if not uni.is_active:
        raise HTTPException(status_code=400, detail="University is inactive. Please activate it first.")

    # If pdf_structure override provided, also update the university record
    if pdf_structure and pdf_structure in ("individual", "consolidated", "category_based"):
        uni.pdf_structure = pdf_structure
        db.commit()

    # Save uploaded files — put in category subfolder if provided
    if category:
        upload_dir = os.path.join(settings.upload_dir, str(university_id), semester, category)
    else:
        upload_dir = os.path.join(settings.upload_dir, str(university_id), semester)
    os.makedirs(upload_dir, exist_ok=True)

    saved_filenames = []
    for file in files:
        if not (file.filename.lower().endswith(".pdf") or file.filename.lower().endswith(".txt")):
            continue
        file_path = os.path.join(upload_dir, os.path.basename(file.filename))
        with open(file_path, "wb") as f:
            content = await file.read()
            f.write(content)
        saved_filenames.append(os.path.basename(file.filename))

    if not saved_filenames:
        raise HTTPException(status_code=400, detail="No valid PDF/TXT files provided")

    saved_count = len(saved_filenames)

    # Create IngestionBatch for this upload
    batch = IngestionBatch(
        university_id=university_id,
        semester=semester,
        status="pending",
        total_courses=saved_count,
    )
    db.add(batch)
    db.commit()
    db.refresh(batch)

    # Create UploadJob with file_manifest set at creation time
    # This ensures only the newly uploaded files are parsed, not old files in the same directory
    job = UploadJob(
        university_id=university_id,
        ingestion_batch_id=batch.id,
        semester=semester,
        category=category,
        pdf_structure_override=pdf_structure,
        status="queued",
        total_files=saved_count,
        processed_files=0,
        failed_files=0,
        file_manifest=saved_filenames,
    )
    db.add(job)
    db.commit()
    db.refresh(job)

    # Enqueue in the queue manager (FIFO)
    queue_manager.enqueue(job.id)

    return _job_to_dict(job, uni_name=uni.name)


@router.get("/upload-jobs")
def list_upload_jobs(
    university_id: Optional[int] = None,
    department: Optional[str] = None,
    db: Session = Depends(get_db),
    _user: User = Depends(require_role(["super_admin", "dept_admin", "coordinator"])),
):
    """List all upload jobs (active and recent), ordered by creation time descending."""
    query = db.query(UploadJob)
    if university_id:
        query = query.filter(UploadJob.university_id == university_id)
    if department:
        from db.models import Department
        from sqlalchemy import func as sa_func
        dept = db.query(Department).filter(sa_func.upper(Department.code) == department.upper()).first()
        if dept:
            query = query.join(University).filter(University.department_id == dept.id)
        else:
            query = query.join(University).filter(University.department_id == -1)
    jobs = query.order_by(UploadJob.created_at.desc()).limit(50).all()

    uni_names = {}
    for job in jobs:
        if job.university_id not in uni_names:
            uni = db.query(University).filter(University.id == job.university_id).first()
            uni_names[job.university_id] = uni.name if uni else None

    return [_job_to_dict(job, uni_names.get(job.university_id)) for job in jobs]


@router.post("/upload-jobs/pause-all")
def pause_all_upload_jobs(
    db: Session = Depends(get_db),
    _user: User = Depends(require_role(["super_admin", "dept_admin", "coordinator"])),
):
    """Pause all active upload jobs immediately."""
    active_jobs = db.query(UploadJob).filter(
        UploadJob.status.in_(["queued", "uploading", "parsing"]),
    ).all()
    paused_ids = []
    for job in active_jobs:
        queue_manager.pause(job.id)
        job.status = "paused"
        paused_ids.append(job.id)
    db.commit()
    return {"action": "paused_all", "paused_job_ids": paused_ids}


@router.get("/upload-jobs/{job_id}")
def get_upload_job(
    job_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(require_role(["super_admin", "dept_admin", "coordinator"])),
):
    """Get the current status of an upload job."""
    job = db.query(UploadJob).filter(UploadJob.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Upload job not found")
    uni = db.query(University).filter(University.id == job.university_id).first()
    return _job_to_dict(job, uni_name=uni.name if uni else None)


@router.post("/upload-jobs/{job_id}/pause")
def pause_upload_job(
    job_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(require_role(["super_admin", "dept_admin", "coordinator"])),
):
    """Pause a running upload job immediately."""
    job = db.query(UploadJob).filter(UploadJob.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Upload job not found")
    if job.status not in ("queued", "uploading", "parsing"):
        raise HTTPException(
            status_code=400,
            detail=f"Cannot pause job with status '{job.status}'"
        )
    queue_manager.pause(job_id)
    job.status = "paused"
    db.commit()
    return {"job_id": job_id, "action": "paused", "status": "paused"}


@router.post("/upload-jobs/{job_id}/resume")
def resume_upload_job(
    job_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(require_role(["super_admin", "dept_admin", "coordinator"])),
):
    """Resume a paused upload job from where it left off."""
    job = db.query(UploadJob).filter(UploadJob.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Upload job not found")
    if job.status not in ("paused", "failed", "cancelled"):
        raise HTTPException(
            status_code=400,
            detail=f"Cannot resume job with status '{job.status}'"
        )
    job.status = "queued"
    db.commit()
    queue_manager.resume(job_id)
    return {"job_id": job_id, "action": "resumed", "status": "queued"}


@router.post("/upload-jobs/{job_id}/cancel")
def cancel_upload_job(
    job_id: int,
    delete_university: bool = False,
    db: Session = Depends(get_db),
    _user: User = Depends(require_role(["super_admin", "dept_admin", "coordinator"])),
):
    """
    Cancel an upload job.
    If delete_university=true, also deletes the university and all its data.
    """
    job = db.query(UploadJob).filter(UploadJob.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Upload job not found")

    if job.status in ("completed", "failed"):
        raise HTTPException(
            status_code=400,
            detail=f"Cannot cancel job with status '{job.status}'"
        )

    university_id = job.university_id
    queue_manager.cancel(job_id)

    # Update job status immediately
    job.status = "cancelled"
    job.completed_at = datetime.utcnow()
    db.commit()

    # Update university ingestion_status if no other active jobs remain
    active_jobs = db.query(UploadJob).filter(
        UploadJob.university_id == university_id,
        UploadJob.id != job_id,
        UploadJob.status.in_(["queued", "parsing", "paused"]),
    ).count()
    if active_jobs == 0:
        uni = db.query(University).filter(University.id == university_id).first()
        if uni and uni.ingestion_status == "parsing":
            from db.models import Course
            has_courses = db.query(Course).filter(Course.university_id == university_id).count() > 0
            uni.ingestion_status = "ready" if has_courses else "pending"
            db.commit()

    if delete_university:
        # Wait for the worker thread to finish processing before deleting
        queue_manager.wait_for_stop(job_id, timeout=15.0)

        # Also delete the university and all its data
        uni = db.query(University).filter(University.id == university_id).first()
        if uni:
            # Delete upload jobs first (no ORM cascade from University for these)
            db.query(UploadJob).filter(UploadJob.university_id == university_id).delete(synchronize_session="fetch")
            # Cascade will handle courses and batches via ORM relationship
            db.delete(uni)
            db.commit()

            # Clean up files
            upload_path = os.path.join(settings.upload_dir, str(university_id))
            if os.path.exists(upload_path):
                shutil.rmtree(upload_path, ignore_errors=True)

        return {"job_id": job_id, "action": "cancelled_and_deleted", "university_deleted": True}

    return {"job_id": job_id, "action": "cancelled", "university_deleted": False}
