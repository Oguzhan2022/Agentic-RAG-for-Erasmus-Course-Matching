"""
Matching API endpoints.

Provides course matching, retrieval, embedding management,
and match request CRUD.
"""

from typing import Optional
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from sqlalchemy.orm import Session, joinedload

from backend.dependencies import get_db
from db.models import Course, University, MatchJob, CourseMatch, User
from authorization.middleware import require_role
from matching.match_queue_manager_v2 import match_queue_manager_v2 as match_queue_manager

router = APIRouter(prefix="/api", tags=["matching"])


# ── Embedding Management ─────────────────────────────────────────────────────

@router.post("/embeddings/generate-all")
def generate_all_embeddings(
    force: bool = False,
    background_tasks: BackgroundTasks = BackgroundTasks(),
    db: Session = Depends(get_db),
    _user: User = Depends(require_role(["super_admin", "dept_admin", "coordinator"])),
):
    """Generate embeddings for all courses (background task)."""
    from retrieval.embedder import embed_all_courses, get_embedding_stats

    # Get current stats first
    stats_before = get_embedding_stats(db)

    # Run embedding in foreground (it's fast with local model)
    result = embed_all_courses(db, force=force)

    stats_after = get_embedding_stats(db)

    return {
        "action": "embeddings_generated",
        "before": stats_before,
        "after": stats_after,
        "result": result,
    }


@router.get("/embeddings/status")
def get_embedding_status(
    db: Session = Depends(get_db),
    _user: User = Depends(require_role(["super_admin", "dept_admin", "coordinator", "student"])),
):
    """Get embedding coverage statistics."""
    from retrieval.embedder import get_embedding_stats
    return get_embedding_stats(db)


# ── Course Matching ───────────────────────────────────────────────────────────

@router.post("/courses/{course_id}/find-matches")
def find_matches(
    course_id: int,
    home_university_id: int,
    category: Optional[str] = None,
    top_k: int = 3,
    db: Session = Depends(get_db),
    _user: User = Depends(require_role(["super_admin", "dept_admin", "coordinator"])),
):
    """
    Find best HOME course equivalents for a PARTNER course.

    Use case: Student takes partner_course abroad.
    Question: Which home (IKU) course does this correspond to?

    Pipeline: embedding retrieval -> deterministic scoring -> LLM semantic -> fusion.
    Category is auto-detected by LLM if not provided.

    Args:
        course_id: Partner course ID (the course student takes abroad)
        home_university_id: Home university to search for equivalents (e.g., IKU)
        category: Optional override (technical/social/studio_based). Auto-detected if omitted.
        top_k: Number of results (default 3)
    """
    from matching.fusion_engine import find_best_matches_v2 as find_best_matches

    partner_course = db.query(Course).filter(Course.id == course_id).first()
    if not partner_course:
        raise HTTPException(status_code=404, detail="Partner course not found")

    home_uni = db.query(University).filter(University.id == home_university_id).first()
    if not home_uni:
        raise HTTPException(status_code=404, detail="Home university not found")

    if partner_course.embedding is None:
        raise HTTPException(
            status_code=400,
            detail="Partner course has no embedding. Generate embeddings first via POST /api/embeddings/generate-all"
        )

    # Check home uni has embeddings
    home_count = db.query(Course).filter(
        Course.university_id == home_university_id,
        Course.embedding.isnot(None),
    ).count()
    if home_count == 0:
        raise HTTPException(
            status_code=400,
            detail=f"Home university '{home_uni.name}' has no embedded courses"
        )

    results = find_best_matches(
        partner_course=partner_course,
        home_university_id=home_university_id,
        category=category,
        top_k=top_k,
        db=db,
    )

    # Each match may have its own detected category
    detected_categories = list(set(r.category for r in results)) if results else []

    return {
        "partner_course": {
            "id": partner_course.id,
            "name": partner_course.course_name,
            "university_id": partner_course.university_id,
        },
        "home_university": {
            "id": home_uni.id,
            "name": home_uni.name,
        },
        "detected_categories": detected_categories,
        "matches": [r.to_dict() for r in results],
    }


@router.post("/courses/{course_id}/find-similar")
def find_similar(
    course_id: int,
    top_k: int = 3,
    partner_university_id: Optional[int] = None,
    level_filter: Optional[str] = None,
    db: Session = Depends(get_db),
    _user: User = Depends(require_role(["super_admin", "dept_admin", "coordinator"])),
):
    """
    Find similar courses using embedding similarity (fast, no LLM).
    """
    from retrieval.search import find_similar_courses

    course = db.query(Course).filter(Course.id == course_id).first()
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")

    if course.embedding is None:
        raise HTTPException(status_code=400, detail="Course has no embedding")

    results = find_similar_courses(
        course_id=course_id,
        db=db,
        top_k=top_k,
        exclude_university_id=course.university_id if not partner_university_id else None,
        partner_university_id=partner_university_id,
        level_filter=level_filter,
    )

    # Add university names
    uni_names = {}
    for r in results:
        uid = r["university_id"]
        if uid not in uni_names:
            uni = db.query(University).filter(University.id == uid).first()
            uni_names[uid] = uni.name if uni else None
        r["university_name"] = uni_names[uid]

    return {
        "source_course": {
            "id": course.id,
            "name": course.course_name,
            "university_id": course.university_id,
        },
        "results": results,
    }


# ── Batch Match Jobs (Queue-based) ──────────────────────────────────────────

def _match_job_to_dict(job: MatchJob, db: Session) -> dict:
    partner_uni = db.query(University).filter(University.id == job.partner_university_id).first()
    home_uni = db.query(University).filter(University.id == job.home_university_id).first()
    progress = 0
    if job.total_courses and job.total_courses > 0:
        progress = round((job.processed_courses / job.total_courses) * 100, 1)
    return {
        "id": job.id,
        "partner_university_id": job.partner_university_id,
        "partner_university_name": partner_uni.name if partner_uni else None,
        "home_university_id": job.home_university_id,
        "home_university_name": home_uni.name if home_uni else None,
        "status": job.status,
        "llm_mode": job.llm_mode or "sequential",
        "total_courses": job.total_courses,
        "processed_courses": job.processed_courses,
        "failed_courses": job.failed_courses,
        "progress_percent": progress,
        "current_course": job.current_course,
        "error_log": job.error_log,
        "created_at": job.created_at.isoformat() if job.created_at else None,
        "updated_at": job.updated_at.isoformat() if job.updated_at else None,
        "completed_at": job.completed_at.isoformat() if job.completed_at else None,
    }




def _build_job_results(job_id: int, job, db: Session):
    """Build deduplicated match results for a job (handles duplicates from resume)."""
    matches = db.query(CourseMatch).options(
        joinedload(CourseMatch.partner_course),
        joinedload(CourseMatch.home_course)
    ).filter(
        CourseMatch.match_job_id == job_id,
    ).order_by(CourseMatch.partner_course_id, CourseMatch.overall_score.desc()).all()

    results = {}
    for m in matches:
        partner = m.partner_course
        home = m.home_course
        pid = m.partner_course_id
        if pid not in results:
            results[pid] = {
                "partner_course": {
                    "id": partner.id if partner else pid,
                    "name": partner.course_name if partner else "Unknown",
                    "ects": partner.ects if partner else None,
                },
                "_seen": {},  # home_course_id → best match dict
            }
        hid = m.home_course_id
        seen = results[pid]["_seen"]
        if hid not in seen or m.overall_score > seen[hid]["overall_score"]:
            seen[hid] = {
                "home_course_id": hid,
                "home_course_name": home.course_name if home else "Unknown",
                "overall_score": m.overall_score,
                "score_breakdown": m.score_breakdown,
                "matched_topics": m.matched_topics,
                "missing_topics": m.missing_topics,
                "warnings": m.warnings,
                "category": m.category,
                "verification_status": m.verification_status,
                "verification_confidence": m.verification_confidence,
                "verification_reason": m.verification_reason,
                "verification_risk_flags": m.verification_risk_flags,
                "is_recommended": m.is_recommended,
                "content_overlap_assessment": m.content_overlap_assessment,
                "core_topic_coverage": m.core_topic_coverage,
                "core_home_topics": m.core_home_topics,
                "extra_partner_topics": m.extra_partner_topics,
                "structural_notes": m.structural_notes,
                "is_not_recommended": m.verification_status == "rejected",
            }

    course_results = []
    for data in results.values():
        deduped = sorted(data["_seen"].values(), key=lambda x: x["overall_score"], reverse=True)
        ranked = [{**item, "rank": i + 1} for i, item in enumerate(deduped)]
        course_results.append({
            "partner_course": data["partner_course"],
            "matches": ranked,
        })

    return {
        "job": _match_job_to_dict(job, db),
        "course_results": course_results,
    }


@router.get("/course-matches")
def list_course_matches(
    partner_university_id: Optional[int] = None,
    home_university_id: Optional[int] = None,
    db: Session = Depends(get_db),
    _user: User = Depends(require_role(["super_admin", "dept_admin", "coordinator", "student"])),
):
    """List course match results with optional filters."""
    query = db.query(CourseMatch).join(
        Course, CourseMatch.partner_course_id == Course.id
    ).filter(CourseMatch.source == "batch")
    if partner_university_id:
        query = query.filter(Course.university_id == partner_university_id)

    matches = query.order_by(CourseMatch.created_at.desc()).limit(200).all()

    return [{
        "id": m.id,
        "match_job_id": m.match_job_id,
        "partner_course_id": m.partner_course_id,
        "home_course_id": m.home_course_id,
        "overall_score": m.overall_score,
        "category": m.category,
        "rank": m.rank,
    } for m in matches]


# ── Batch Match Jobs(single LLM call per course) ────────────────────────

@router.post("/match-jobs")
def create_match_job(
    partner_university_id: int,
    home_university_id: int,
    department: Optional[str] = None,
    db: Session = Depends(get_db),
    _user: User = Depends(require_role(["super_admin", "dept_admin", "coordinator"])),
):
    """Create a batch match job (V2): single LLM call per partner course."""
    from db.models import MatchJob

    partner_uni = db.query(University).filter(University.id == partner_university_id).first()
    if not partner_uni:
        raise HTTPException(status_code=404, detail="Partner university not found")
    
    if not partner_uni.is_active:
        raise HTTPException(status_code=400, detail="Partner university is inactive. Match jobs are disabled.")

    home_uni = db.query(University).filter(University.id == home_university_id).first()
    if not home_uni:
        raise HTTPException(status_code=404, detail="Home university not found")

    p_query = db.query(Course).filter(
        Course.university_id == partner_university_id,
        Course.embedding.isnot(None),
    )
    if department:
        from db.models import Department
        from sqlalchemy import func as sa_func
        dept_obj = db.query(Department).filter(sa_func.upper(Department.code) == department.upper()).first()
        if dept_obj:
            p_query = p_query.join(University, Course.university_id == University.id).filter(
                University.department_id == dept_obj.id
            )
        else:
            p_query = p_query.filter(Course.academic_context["department"].astext.ilike(f"%{department}%"))
    
    partner_count = p_query.count()
    if partner_count == 0:
        raise HTTPException(status_code=400, detail="Partner university has no embedded courses in this department")

    # Count already matched in batch mode
    am_query = db.query(CourseMatch.partner_course_id).join(
        MatchJob, CourseMatch.match_job_id == MatchJob.id
    ).join(
        Course, CourseMatch.partner_course_id == Course.id
    ).filter(
        Course.university_id == partner_university_id,
        MatchJob.llm_mode == "batch",
    )
    if department:
        from db.models import Department
        from sqlalchemy import func as sa_func
        dept_obj = db.query(Department).filter(sa_func.upper(Department.code) == department.upper()).first()
        if dept_obj:
            am_query = am_query.join(University, Course.university_id == University.id).filter(
                University.department_id == dept_obj.id
            )
        else:
            am_query = am_query.filter(Course.academic_context["department"].astext.ilike(f"%{department}%"))
    
    already_matched = am_query.distinct().count()

    unmatched = partner_count - already_matched

    job = MatchJob(
        partner_university_id=partner_university_id,
        home_university_id=home_university_id,
        status="queued",
        llm_mode="batch",
        total_courses=unmatched,
    )
    db.add(job)
    db.commit()
    db.refresh(job)

    match_queue_manager.enqueue(job.id)

    return _match_job_to_dict(job, db)


@router.get("/match-jobs")
def list_match_jobs(
    partner_university_id: Optional[int] = None,
    department: Optional[str] = None,
    db: Session = Depends(get_db),
    _user: User = Depends(require_role(["super_admin", "dept_admin", "coordinator", "student"])),
):
    """List all(batch) match jobs."""
    from db.models import MatchJob, University, Department
    from sqlalchemy import func as sa_func

    query = db.query(MatchJob).filter(MatchJob.llm_mode == "batch")
    
    if partner_university_id:
        query = query.filter(MatchJob.partner_university_id == partner_university_id)
        
    if department:
        # 1. Resolve department code to ID case-insensitively
        dept = db.query(Department).filter(sa_func.upper(Department.code) == department.upper()).first()
        if dept:
            # 2. Join with University to filter jobs by department
            # We filter by both partner and home university's department just in case,
            # though usually they are the same in our current flow.
            query = query.join(University, MatchJob.partner_university_id == University.id) \
                         .filter(University.department_id == dept.id)
        else:
            # If department code is invalid, return nothing
            query = query.filter(MatchJob.id == -1)

    jobs = query.order_by(MatchJob.created_at.desc()).limit(50).all()
    return [_match_job_to_dict(j, db) for j in jobs]


@router.post("/match-jobs/resume-all")
def resume_all_match_jobs(
    db: Session = Depends(get_db),
    _user: User = Depends(require_role(["super_admin", "dept_admin", "coordinator"])),
):
    """Resume all pausedmatch jobs AND re-enqueue any stuck QUEUED jobs."""
    from db.models import MatchJob
    # Pick up both paused and queued-but-stuck jobs
    jobs = db.query(MatchJob).filter(
        MatchJob.status.in_(["paused", "queued"]),
        MatchJob.llm_mode == "batch",
    ).order_by(MatchJob.id).all()
    resumed_ids = []
    for job in jobs:
        if job.status == "paused":
            job.status = "queued"
        resumed_ids.append(job.id)
    db.commit()  # commit first so worker sees correct status
    for job_id in resumed_ids:
        match_queue_manager.resume(job_id)
    return {"action": "resumed_all", "resumed_job_ids": resumed_ids}


@router.post("/match-jobs/pause-all")
def pause_all_match_jobs(
    db: Session = Depends(get_db),
    _user: User = Depends(require_role(["super_admin", "dept_admin", "coordinator"])),
):
    """Pause all activematch jobs."""
    from db.models import MatchJob
    active = db.query(MatchJob).filter(
        MatchJob.status.in_(["queued", "matching"]),
        MatchJob.llm_mode == "batch",
    ).all()
    paused_ids = []
    for job in active:
        match_queue_manager.pause(job.id)
        job.status = "paused"
        paused_ids.append(job.id)
    db.commit()
    return {"action": "paused_all", "paused_job_ids": paused_ids}


@router.get("/match-jobs/{job_id}")
def get_match_job(
    job_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(require_role(["super_admin", "dept_admin", "coordinator", "student"])),
):
    """Getmatch job status."""
    from db.models import MatchJob
    job = db.query(MatchJob).filter(MatchJob.id == job_id, MatchJob.llm_mode == "batch").first()
    if not job:
        raise HTTPException(status_code=404, detail="V2 match job not found")
    return _match_job_to_dict(job, db)


@router.post("/match-jobs/{job_id}/pause")
def pause_match_job(
    job_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(require_role(["super_admin", "dept_admin", "coordinator"])),
):
    from db.models import MatchJob
    job = db.query(MatchJob).filter(MatchJob.id == job_id, MatchJob.llm_mode == "batch").first()
    if not job:
        raise HTTPException(status_code=404, detail="V2 match job not found")
    if job.status not in ("queued", "matching"):
        raise HTTPException(status_code=400, detail=f"Cannot pause job with status '{job.status}'")
    match_queue_manager.pause(job_id)
    job.status = "paused"
    db.commit()
    return {"job_id": job_id, "action": "paused"}


@router.post("/match-jobs/{job_id}/resume")
def resume_match_job(
    job_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(require_role(["super_admin", "dept_admin", "coordinator"])),
):
    from db.models import MatchJob
    job = db.query(MatchJob).filter(MatchJob.id == job_id, MatchJob.llm_mode == "batch").first()
    if not job:
        raise HTTPException(status_code=404, detail="V2 match job not found")
    if job.status != "paused":
        raise HTTPException(status_code=400, detail=f"Cannot resume job with status '{job.status}'")
    job.status = "queued"
    db.commit()  # commit first so worker sees correct status
    match_queue_manager.resume(job_id)
    return {"job_id": job_id, "action": "resumed"}


@router.post("/match-jobs/{job_id}/cancel")
def cancel_match_job(
    job_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(require_role(["super_admin", "dept_admin", "coordinator"])),
):
    from db.models import MatchJob
    job = db.query(MatchJob).filter(MatchJob.id == job_id, MatchJob.llm_mode == "batch").first()
    if not job:
        raise HTTPException(status_code=404, detail="V2 match job not found")
    if job.status in ("completed", "failed"):
        raise HTTPException(status_code=400, detail=f"Cannot cancel job with status '{job.status}'")
    match_queue_manager.cancel(job_id)
    job.status = "cancelled"
    job.completed_at = datetime.utcnow()
    db.commit()
    return {"job_id": job_id, "action": "cancelled"}


@router.get("/match-jobs/{job_id}/results")
def get_match_job_results(
    job_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(require_role(["super_admin", "dept_admin", "coordinator", "student"])),
):
    """Get all match results for ajob."""
    from db.models import MatchJob
    job = db.query(MatchJob).filter(MatchJob.id == job_id, MatchJob.llm_mode == "batch").first()
    if not job:
        raise HTTPException(status_code=404, detail="V2 match job not found")
    return _build_job_results(job_id, job, db)


@router.delete("/jobs/{job_id}")
def delete_match_job(
    job_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(require_role(["super_admin", "dept_admin", "coordinator"])),
):
    """Delete a match job and its results."""
    from db.models import MatchJob
    job = db.query(MatchJob).filter(MatchJob.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Match job not found")
    
    # Check if job is active in queue
    if job.status in ["matching", "queued", "paused", "verifying"]:
        match_queue_manager.cancel(job_id)

    db.delete(job)
    db.commit()
    return {"message": "Job and matches deleted", "id": job_id}


@router.delete("/university/{university_id}/clear")
def clear_university_matches(
    university_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(require_role(["super_admin", "dept_admin", "coordinator"])),
):
    """Delete all match jobs and results for a specific partner university."""
    from db.models import MatchJob
    jobs = db.query(MatchJob).filter(MatchJob.partner_university_id == university_id).all()
    
    for job in jobs:
        if job.status in ["matching", "queued", "paused", "verifying"]:
            match_queue_manager.cancel(job.id)
        db.delete(job)
    
    db.commit()
    return {"message": f"Cleared {len(jobs)} jobs and all associated matches for university {university_id}"}


@router.get("/course-matches/by-partner-course/{partner_course_id}")
def get_matches_by_partner_course(
    partner_course_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(require_role(["super_admin", "dept_admin", "coordinator", "student"])),
):
    """Get all matches for a specific partner course, sorted by relevance."""
    matches = (
        db.query(CourseMatch)
        .filter(
            CourseMatch.partner_course_id == partner_course_id,
            CourseMatch.source == "batch"
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
            "home_course_ects": home.ects if home else None,
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
            "is_not_recommended": m.verification_status == "rejected",
            "content_overlap_assessment": m.content_overlap_assessment,
            "core_topic_coverage": m.core_topic_coverage,
            "category": m.category,
            "rank": m.rank,
        })

    return {"partner_course_id": partner_course_id, "candidates": result, "count": len(result)}
