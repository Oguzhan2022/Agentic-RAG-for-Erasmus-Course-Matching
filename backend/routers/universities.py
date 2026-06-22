import os
import shutil
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func
from pydantic import BaseModel
from typing import Optional

from backend.dependencies import get_db
from backend.config import settings
from db.models import University, Course, IngestionBatch, UploadJob, Department, Faculty, User, UniversityProfile, GradingScheme
from authorization.middleware import require_role

router = APIRouter(prefix="/api", tags=["universities"])


class UniversityCreate(BaseModel):
    name: str
    country: Optional[str] = None
    city: Optional[str] = None
    pdf_structure: str = "individual"
    is_home: bool = False
    department: Optional[str] = None  # department_code


class UniversityUpdate(BaseModel):
    name: Optional[str] = None
    country: Optional[str] = None
    city: Optional[str] = None
    pdf_structure: Optional[str] = None
    is_active: Optional[bool] = None
    is_home: Optional[bool] = None


@router.get("/departments")
def list_all_departments(
    faculty_id: Optional[int] = None,
    db: Session = Depends(get_db),
):
    """Public endpoint to list all departments for filtering. Optionally filter by faculty."""
    query = db.query(Department).filter(Department.is_active == True)
    if faculty_id is not None:
        query = query.filter(Department.faculty_id == faculty_id)
    departments = query.all()
    return [
        {"id": d.id, "name": d.name, "code": d.code,
         "faculty_id": d.faculty_id,
         "faculty_name": d.faculty.name if d.faculty else None}
        for d in departments
    ]

@router.get("/faculties")
def list_all_faculties(db: Session = Depends(get_db)):
    """Public endpoint to list all active faculties."""
    faculties = db.query(Faculty).filter(Faculty.is_active == True).order_by(Faculty.name).all()
    return [{"id": f.id, "name": f.name, "code": f.code} for f in faculties]


@router.get("/public/stats")
def public_stats(db: Session = Depends(get_db)):
    """Public endpoint returning basic system stats for the landing page."""
    partner_count = db.query(University).filter(
        University.is_active == True,
        University.is_home == False,
    ).count()
    return {"partner_university_count": partner_count}


@router.get("/universities")
def list_universities(
    department: Optional[str] = None, 
    active_only: bool = False,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(["student", "coordinator", "dept_admin", "super_admin", "registrar", "faculty_affairs_admin"]))
):
    """List all universities with course counts. Optionally filtered by department or active status."""
    # Force department filter for students if they don't have higher roles
    user_role_names = [ra.role.name for ra in current_user.role_assignments if ra.is_active]
    is_admin_type = any(r in ["super_admin", "dept_admin", "coordinator"] for r in user_role_names)
    
    if "student" in user_role_names and not is_admin_type:
        # Resolve student's department code
        for ra in current_user.role_assignments:
            if ra.role.name == "student" and ra.department:
                department = ra.department.code
                break

    query = db.query(University)

    # Filter for active-only if requested or if user is a student
    if (any(r in ["student"] for r in user_role_names) and not is_admin_type):
        query = query.join(Department, University.department_id == Department.id).filter(
            University.is_active == True,
            Department.is_active == True
        )
    elif active_only:
        # For admins/coordinators, active_only should just mean active universities.
        # We don't necessarily want to block inactive departments here if they specifically requested one.
        query = query.filter(University.is_active == True)
    
    if department:
        dept = db.query(Department).filter(func.upper(Department.code) == department.upper()).first()
        if dept:
            query = query.filter(University.department_id == dept.id)
        else:
            query = query.filter(University.department_id == -1)

    # Order by home university first, then alphabetically
    universities = query.order_by(University.is_home.desc(), University.name.asc()).all()

    result = []
    for uni in universities:
        c_query = db.query(func.count(Course.id)).filter(
            Course.university_id == uni.id,
            Course.is_active == True,
        )
        course_count = c_query.scalar()

        active_upload = db.query(UploadJob).filter(
            UploadJob.university_id == uni.id,
            UploadJob.status.in_(["queued", "uploading", "parsing", "paused"]),
        ).first()

        has_profile = db.query(UniversityProfile).filter_by(university_id=uni.id).first() is not None

        result.append({
            "id": uni.id,
            "name": uni.name,
            "country": uni.country,
            "city": uni.city,
            "pdf_structure": uni.pdf_structure,
            "is_home": uni.is_home,
            "is_active": uni.is_active,
            "ingestion_status": uni.ingestion_status,
            "course_count": course_count,
            "has_active_upload": active_upload is not None,
            "has_profile": has_profile,
            "department_id": uni.department_id,
            "created_at": uni.created_at.isoformat() if uni.created_at else None,
        })

    return result


@router.post("/universities")
def create_university(
    body: UniversityCreate,
    db: Session = Depends(get_db),
    _user: User = Depends(require_role(["super_admin", "dept_admin"])),
):
    """Register a new university."""
    dept_id = None
    if body.department:
        dept = db.query(Department).filter(func.upper(Department.code) == body.department.upper()).first()
        if dept:
            dept_id = dept.id

    existing = db.query(University).filter(
        University.name == body.name,
        University.department_id == dept_id,
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail="University with this name already exists in this department")

    if body.is_home:
        # Enforce name
        if body.name != "İstanbul Kültür Üniversitesi":
            raise HTTPException(status_code=400, detail="Home university name must be 'İstanbul Kültür Üniversitesi'")
        
        # Ensure only one home university per department
        existing_home = db.query(University).filter(
            University.department_id == dept_id,
            University.is_home == True
        ).first()
        if existing_home:
            raise HTTPException(status_code=400, detail="A home university already exists for this department")

    university = University(
        department_id=dept_id,
        name=body.name,
        country=body.country,
        city=body.city,
        pdf_structure=body.pdf_structure,
        is_home=body.is_home,
        ingestion_status="pending",
    )
    db.add(university)
    db.commit()
    db.refresh(university)

    return {
        "id": university.id,
        "name": university.name,
        "country": university.country,
        "city": university.city,
        "pdf_structure": university.pdf_structure,
        "is_home": university.is_home,
        "ingestion_status": university.ingestion_status,
    }


@router.get("/universities/{university_id}")
def get_university(university_id: int, db: Session = Depends(get_db)):
    """Get university detail with batches."""
    uni = db.query(University).filter(University.id == university_id).first()
    if not uni:
        raise HTTPException(status_code=404, detail="University not found")

    course_count = db.query(func.count(Course.id)).filter(
        Course.university_id == uni.id,
        Course.is_active == True,
    ).scalar()

    batches = db.query(IngestionBatch).filter(
        IngestionBatch.university_id == uni.id
    ).order_by(IngestionBatch.started_at.desc()).all()

    return {
        "id": uni.id,
        "name": uni.name,
        "country": uni.country,
        "city": uni.city,
        "pdf_structure": uni.pdf_structure,
        "is_home": uni.is_home,
        "is_active": uni.is_active,
        "ingestion_status": uni.ingestion_status,
        "course_count": course_count,
        "created_at": uni.created_at.isoformat() if uni.created_at else None,
        "batches": [
            {
                "id": b.id,
                "semester": b.semester,
                "status": b.status,
                "total_courses": b.total_courses,
                "parsed_courses": b.parsed_courses,
                "failed_courses": b.failed_courses,
                "started_at": b.started_at.isoformat() if b.started_at else None,
                "completed_at": b.completed_at.isoformat() if b.completed_at else None,
            }
            for b in batches
        ],
    }


@router.patch("/universities/{university_id}")
def update_university(
    university_id: int,
    body: UniversityUpdate,
    db: Session = Depends(get_db),
    _user: User = Depends(require_role(["super_admin", "dept_admin"])),
):
    """Update university information."""
    uni = db.query(University).filter(University.id == university_id).first()
    if not uni:
        raise HTTPException(status_code=404, detail="University not found")

    update_data = body.model_dump(exclude_unset=True)
    
    # Validation for home university
    new_is_home = update_data.get("is_home", uni.is_home)
    new_name = update_data.get("name", uni.name)
    
    if new_is_home:
        if new_name != "İstanbul Kültür Üniversitesi":
             raise HTTPException(status_code=400, detail="Home university name must be 'İstanbul Kültür Üniversitesi'")
        
        # Check uniqueness if becoming home or department changed
        existing_home = db.query(University).filter(
            University.department_id == uni.department_id,
            University.is_home == True,
            University.id != university_id
        ).first()
        if existing_home:
            raise HTTPException(status_code=400, detail="A home university already exists for this department")

    for field, value in update_data.items():
        setattr(uni, field, value)

    db.commit()
    db.refresh(uni)

    return {"id": uni.id, "name": uni.name, "updated": True}


@router.delete("/universities/{university_id}")
def delete_university(
    university_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(require_role(["super_admin", "dept_admin"])),
):
    """Hard-delete a university and all its courses/batches (cascade)."""
    uni = db.query(University).filter(University.id == university_id).first()
    if not uni:
        raise HTTPException(status_code=404, detail="University not found")

    # (Home university deletion is now allowed for re-import scenarios)

    # Block deletion if there's an active upload job
    active_job = db.query(UploadJob).filter(
        UploadJob.university_id == university_id,
        UploadJob.status.in_(["queued", "uploading", "parsing", "paused"]),
    ).first()
    if active_job:
        raise HTTPException(
            status_code=409,
            detail=f"Cannot remove university while an upload is in progress (job #{active_job.id}). "
                   f"Please cancel the upload first."
        )

    uni_id = uni.id
    uni_name = uni.name

    # Explicitly delete courses, batches, and upload jobs first (SQLite cascade workaround)
    course_count = db.query(Course).filter(Course.university_id == uni_id).delete(synchronize_session="fetch")
    batch_count = db.query(IngestionBatch).filter(IngestionBatch.university_id == uni_id).delete(synchronize_session="fetch")
    db.query(UploadJob).filter(UploadJob.university_id == uni_id).delete(synchronize_session="fetch")
    
    # Explicitly delete grading schemes to prevent ORM SET NULL issues
    for scheme in db.query(GradingScheme).filter(GradingScheme.university_id == uni_id).all():
        db.delete(scheme)
    db.flush()

    # Explicitly delete university profile to prevent FK not-null violation
    profile = db.query(UniversityProfile).filter(UniversityProfile.university_id == uni_id).first()
    if profile:
        db.delete(profile)
    db.flush()

    db.delete(uni)
    db.commit()

    # Clean up uploaded PDF files on disk
    upload_path = os.path.join(settings.upload_dir, str(uni_id))
    if os.path.exists(upload_path):
        shutil.rmtree(upload_path, ignore_errors=True)

    return {"id": uni_id, "name": uni_name, "deleted": True, "courses_deleted": course_count, "batches_deleted": batch_count}
