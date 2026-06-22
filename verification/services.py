import time
from sqlalchemy.orm import Session
from db.models import MatchJob, CourseMatch, Course
from verification.verifier import verifier as verifier

def verify_match_job(job_id: int, db: Session):
    """
    Verify all results for a completed MatchJob. Updates job progress
    so the frontend can show a verification progress bar.
    """
    job = db.query(MatchJob).filter(MatchJob.id == job_id).first()
    if not job:
        print(f"[VerificationService] Error: Job {job_id} not found")
        return

    # Get all matches for this job, grouped by partner_course_id
    all_matches = db.query(CourseMatch).filter(CourseMatch.match_job_id == job_id).order_by(CourseMatch.partner_course_id, CourseMatch.overall_score.desc()).all()

    matches_by_partner = {}
    for m in all_matches:
        pid = m.partner_course_id
        if pid not in matches_by_partner:
            matches_by_partner[pid] = []
        matches_by_partner[pid].append(m)

    total_partners = len(matches_by_partner)
    print(f"[VerificationService] Found {total_partners} partner courses to verify for Job {job_id}")

    # Track verify progress on the job object
    job.processed_courses = 0
    job.total_courses = total_partners  # Reuse field as total verifications needed
    db.commit()

    verified_count = 0
    for pid, group in matches_by_partner.items():
        partner_course = db.query(Course).filter(Course.id == pid).first()
        if not partner_course:
            continue

        # Check if already verified
        if all(m.verification_status is not None for m in group[:3]):
            print(f"[VerificationService] Skipping already verified course: {partner_course.course_name}")
            verified_count += 1
            _update_verify_progress(db, job, verified_count, total_partners)
            continue

        print(f"[VerificationService] Verifying matches for course: {partner_course.course_name}...")

        # Prepare candidates for verifier
        candidates_data = []
        for m in group[:3]:  # Top 3
            hc = db.query(Course).filter(Course.id == m.home_course_id).first()
            candidates_data.append({
                "home_course": hc,
                "overall_score": m.overall_score,
                "score_breakdown": m.score_breakdown,
                "matched_topics": m.matched_topics,
                "missing_topics": m.missing_topics,
                "core_home_topics": m.core_home_topics,
                "extra_partner_topics": m.extra_partner_topics,
                "structural_notes": m.structural_notes,
                "warnings": m.warnings,
                "category": m.category,
                "db_match_id": m.id
            })

        # Run verification
        try:
            results = verifier.verify_matches(partner_course, candidates_data)

            verif_list = results.get("verifications", [])
            for verif in verif_list:
                idx = verif.get("candidate_index", 0) - 1
                if 0 <= idx < len(candidates_data):
                    match_id = candidates_data[idx]["db_match_id"]
                    db.query(CourseMatch).filter(CourseMatch.id == match_id).update({
                        "verification_status": verif.get("decision", "risk_flagged"),
                        "verification_confidence": verif.get("confidence", 0.0),
                        "verification_reason": verif.get("reason", ""),
                        "verification_risk_flags": verif.get("risk_flags", []),
                        "is_recommended": verif.get("is_recommended", False),
                        "content_overlap_assessment": verif.get("content_overlap_assessment"),
                        "core_topic_coverage": verif.get("core_topic_coverage")
                    })
            db.commit()

            verified_count += 1
            _update_verify_progress(db, job, verified_count, total_partners)

            # Delay to avoid rate limits if many calls
            time.sleep(1.0)

        except Exception as e:
            print(f"[VerificationService] Error verifying partner course {pid}: {e}")
            db.rollback()
            verified_count += 1
            _update_verify_progress(db, job, verified_count, total_partners)

    print(f"[VerificationService] Verification completed for Job {job_id} ({verified_count}/{total_partners})")


def _update_verify_progress(db: Session, job, verified: int, total: int):
    """Update the MatchJob with current verification progress."""
    pct = int((verified / total) * 100) if total > 0 else 0
    # Reset the job fields that the frontend uses for progress
    job.processed_courses = verified
    job.total_courses = total
    db.commit()
