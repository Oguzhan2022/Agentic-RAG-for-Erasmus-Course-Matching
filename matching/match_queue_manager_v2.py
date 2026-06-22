"""
Match Queue Manager V2 - Same FIFO queue pattern as match_queue_manager.py
but uses a single batch LLM call per partner course (find_best_matches_v2)
instead of one LLM call per candidate.

Jobs created via this manager are stored in the same match_jobs table
with llm_mode='batch'.
"""

import threading
import time
from datetime import datetime, timezone
from typing import Dict


class MatchQueueManagerV2:
    _instance = None
    _lock = threading.Lock()

    def __new__(cls):
        with cls._lock:
            if cls._instance is None:
                cls._instance = super().__new__(cls)
                cls._instance._initialized = False
            return cls._instance

    def __init__(self):
        if self._initialized:
            return
        self._initialized = True
        self._queue: list = []
        self._queue_lock = threading.Lock()
        self._cancel_flags: Dict[int, threading.Event] = {}
        self._pause_flags: Dict[int, threading.Event] = {}
        self._completion_events: Dict[int, threading.Event] = {}
        self._worker_event = threading.Event()
        
        import os
        from dotenv import load_dotenv
        load_dotenv()
        use_celery = os.getenv("USE_CELERY", "false").lower() == "true"
        if not use_celery:
            self._worker_thread = threading.Thread(target=self._worker, daemon=True, name="MatchQueueWorkerV2")
            self._worker_thread.start()
            threading.Thread(target=self._recover_orphaned_jobs, daemon=True).start()
        else:
            import sys
            is_celery = any("celery" in arg for arg in sys.argv)
            is_pytest = any("pytest" in arg or "test" in arg for arg in sys.argv)
            if not is_celery and not is_pytest:
                print("[MatchQueueV2] Running Celery startup orphan recovery in web server process...", flush=True)
                threading.Thread(target=self._recover_orphaned_jobs, daemon=True).start()

    def _recover_orphaned_jobs(self):
        time.sleep(4)  # Slightly offset from V1 to avoid DB conflicts
        try:
            from db.database import SessionLocal
            from db.models import MatchJob
            db = SessionLocal()
            orphaned = db.query(MatchJob).filter(
                MatchJob.status.in_(["matching", "queued", "paused", "verifying"]),
                MatchJob.llm_mode == "batch",
            ).order_by(MatchJob.id).all()
            for job in orphaned:
                if job.status == "paused":
                    with self._queue_lock:
                        if job.id not in self._cancel_flags:
                            self._cancel_flags[job.id] = threading.Event()
                        if job.id not in self._pause_flags:
                            self._pause_flags[job.id] = threading.Event()
                            self._pause_flags[job.id].set()
                    print(f"[MatchQueueV2] Recovered paused job {job.id}", flush=True)
                else:
                    job.status = "queued"
                    db.commit()
                    self.enqueue(job.id)
                    print(f"[MatchQueueV2] Recovered orphaned job {job.id}", flush=True)
            db.close()
        except Exception as e:
            print(f"[MatchQueueV2] Recovery failed: {e}", flush=True)

    def enqueue(self, job_id: int):
        import os
        if os.getenv("USE_CELERY", "false").lower() == "true":
            try:
                from backend.celery_app import process_match_job_task
                process_match_job_task.delay(job_id)
                print(f"[MatchQueueV2] Enqueued MatchJob {job_id} to Celery successfully!", flush=True)
                return
            except Exception as e:
                print(f"[MatchQueueV2] Celery task enqueue failed, falling back to local thread: {e}", flush=True)

        with self._queue_lock:
            if job_id not in self._cancel_flags:
                self._cancel_flags[job_id] = threading.Event()
                self._pause_flags[job_id] = threading.Event()
            if job_id not in self._queue:
                self._queue.append(job_id)
        self._worker_event.set()

    def cancel(self, job_id: int):
        with self._queue_lock:
            if job_id in self._cancel_flags:
                self._cancel_flags[job_id].set()
            if job_id in self._queue:
                self._queue.remove(job_id)

    def pause(self, job_id: int):
        with self._queue_lock:
            if job_id in self._pause_flags:
                self._pause_flags[job_id].set()

    def resume(self, job_id: int):
        import os
        from dotenv import load_dotenv
        load_dotenv()
        if os.getenv("USE_CELERY", "false").lower() == "true":
            with self._queue_lock:
                if job_id in self._pause_flags:
                    self._pause_flags[job_id].clear()
            self.enqueue(job_id)
            return

        with self._queue_lock:
            if job_id not in self._cancel_flags:
                self._cancel_flags[job_id] = threading.Event()
            if job_id not in self._pause_flags:
                self._pause_flags[job_id] = threading.Event()
            else:
                self._pause_flags[job_id].clear()
            if job_id not in self._queue:
                self._queue.append(job_id)
        self._worker_event.set()

    def cleanup(self, job_id: int):
        with self._queue_lock:
            self._cancel_flags.pop(job_id, None)
            self._pause_flags.pop(job_id, None)
            self._completion_events.pop(job_id, None)
            if job_id in self._queue:
                self._queue.remove(job_id)

    def wait_for_stop(self, job_id: int, timeout: float = 15.0) -> bool:
        event = self._completion_events.get(job_id)
        if event:
            return event.wait(timeout=timeout)
        return True

    def _worker(self):
        while True:
            self._worker_event.wait()
            job_id = None
            with self._queue_lock:
                if self._queue:
                    job_id = self._queue.pop(0)
                else:
                    self._worker_event.clear()
            if job_id is None:
                continue
            try:
                self._process_job(job_id)
            except Exception as e:
                print(f"[MatchQueueV2] Unexpected error processing job {job_id}: {e}", flush=True)
                import traceback
                traceback.print_exc()

    def _process_job(self, job_id: int):
        from db.database import SessionLocal
        from db.models import MatchJob, CourseMatch, Course
        from matching.fusion_engine import find_best_matches_v2
        from verification.verifier import verifier

        self._completion_events[job_id] = threading.Event()

        with self._queue_lock:
            if job_id not in self._cancel_flags:
                self._cancel_flags[job_id] = threading.Event()
            if job_id not in self._pause_flags:
                self._pause_flags[job_id] = threading.Event()
            cancel_event = self._cancel_flags[job_id]
            pause_event = self._pause_flags[job_id]

        should_cleanup = True
        db = SessionLocal()
        try:
            job = db.query(MatchJob).filter(MatchJob.id == job_id).first()
            if not job or job.status in ("cancelled", "completed", "failed"):
                return

            if cancel_event.is_set():
                job.status = "cancelled"
                job.completed_at = datetime.now(timezone.utc)
                db.commit()
                return

            already_done = job.processed_courses or 0

            if job.course_manifest:
                course_ids = job.course_manifest
            else:
                partner_courses = db.query(Course).filter(
                    Course.university_id == job.partner_university_id,
                    Course.embedding.isnot(None),
                ).all()

                # Exclude already matched (only from v2 jobs — same llm_mode)
                already_matched_ids = set()
                if partner_courses:
                    existing = db.query(CourseMatch.partner_course_id).join(
                        MatchJob, CourseMatch.match_job_id == MatchJob.id
                    ).filter(
                        CourseMatch.partner_course_id.in_([c.id for c in partner_courses]),
                        MatchJob.llm_mode == "batch",
                    ).distinct().all()
                    already_matched_ids = {m[0] for m in existing}

                course_ids = [c.id for c in partner_courses if c.id not in already_matched_ids]
                job.course_manifest = course_ids
                job.total_courses = len(course_ids)
                db.commit()

            if not course_ids:
                job.status = "completed"
                job.completed_at = datetime.now(timezone.utc)
                db.commit()
                return

            remaining_ids = course_ids[already_done:]

            job.status = "matching"
            db.commit()

            for i, course_id in enumerate(remaining_ids):
                db.expire(job)
                db.refresh(job)
                if job.status == "queued":
                    job.status = "matching"
                    db.commit()

                if cancel_event.is_set():
                    db.query(MatchJob).filter(MatchJob.id == job_id).update({
                        "status": "cancelled",
                        "completed_at": datetime.now(timezone.utc),
                    })
                    db.commit()
                    return

                if pause_event.is_set():
                    db.query(MatchJob).filter(MatchJob.id == job_id).update({
                        "status": "paused",
                    })
                    db.commit()
                    should_cleanup = False
                    return

                partner_course = db.query(Course).filter(Course.id == course_id).first()
                if not partner_course:
                    db.query(MatchJob).filter(MatchJob.id == job_id).update({
                        "failed_courses": MatchJob.failed_courses + 1,
                    }, synchronize_session="fetch")
                    db.commit()
                    continue

                db.query(MatchJob).filter(MatchJob.id == job_id).update({
                    "current_course": partner_course.course_name,
                })
                db.commit()

                print(f"[MatchQueueV2] Job {job_id}: batch-matching '{partner_course.course_name}' "
                      f"({already_done + i + 1}/{job.total_courses})", flush=True)

                try:
                    results = find_best_matches_v2(
                        partner_course=partner_course,
                        home_university_id=job.home_university_id,
                        top_k=3,
                        db=db,
                    )

                    # Delete any previous matches for this course in this job (from prior resume)
                    db.query(CourseMatch).filter(
                        CourseMatch.match_job_id == job_id,
                        CourseMatch.partner_course_id == course_id,
                    ).delete()

                    for rank, result in enumerate(results, 1):
                        cm = CourseMatch(
                            match_job_id=job_id,
                            partner_course_id=course_id,
                            home_course_id=result.home_course_id,
                            overall_score=result.overall_score,
                            score_breakdown=result.score_breakdown,
                            matched_topics=result.matched_topics,
                            missing_topics=result.missing_topics,
                            warnings=result.warnings,
                            category=result.category,
                            extra_partner_topics=result.extra_partner_topics,
                            core_home_topics=result.core_home_topics,
                            structural_notes=result.structural_notes,
                            rank=rank,
                        )
                        db.add(cm)

                    db.flush()  # Persist CourseMatch rows so verification UPDATE can find them

                except Exception as e:
                    print(f"[MatchQueueV2] Error matching course {course_id}: {e}", flush=True)
                    db.query(MatchJob).filter(MatchJob.id == job_id).update({
                        "failed_courses": MatchJob.failed_courses + 1,
                    }, synchronize_session="fetch")
                    db.query(MatchJob).filter(MatchJob.id == job_id).update({
                        "processed_courses": already_done + i + 1,
                    })
                    db.commit()
                    continue

                # ── Inline verification (per-course) ──
                try:
                    candidates_data = []
                    for result in results:
                        hc = db.query(Course).filter(Course.id == result.home_course_id).first()
                        candidates_data.append({
                            "home_course": hc,
                            "overall_score": result.overall_score,
                            "score_breakdown": result.score_breakdown,
                            "matched_topics": result.matched_topics,
                            "missing_topics": result.missing_topics,
                            "core_home_topics": result.core_home_topics,
                            "extra_partner_topics": result.extra_partner_topics,
                            "structural_notes": result.structural_notes,
                            "warnings": result.warnings,
                            "category": result.category,
                        })

                    verif_result = verifier.verify_matches(partner_course, candidates_data)
                    verif_list = verif_result.get("verifications", [])
                    for v in verif_list:
                        idx = v.get("candidate_index", 0) - 1
                        if 0 <= idx < len(candidates_data):
                            home_id = results[idx].home_course_id
                            db.query(CourseMatch).filter(
                                CourseMatch.match_job_id == job_id,
                                CourseMatch.partner_course_id == course_id,
                                CourseMatch.home_course_id == home_id,
                            ).update({
                                "verification_status": v.get("decision", "risk_flagged"),
                                "verification_confidence": v.get("confidence", 0.0),
                                "verification_reason": v.get("reason", ""),
                                "verification_risk_flags": v.get("risk_flags", []),
                                "is_recommended": v.get("is_recommended", False),
                                "content_overlap_assessment": v.get("content_overlap_assessment"),
                                "core_topic_coverage": v.get("core_topic_coverage"),
                            })
                    db.commit()
                    print(f"[MatchQueueV2] Job {job_id}: verified '{partner_course.course_name}' "
                          f"({already_done + i + 1}/{job.total_courses})", flush=True)

                except Exception as ve:
                    print(f"[MatchQueueV2] Verification error for course {course_id}: {ve}", flush=True)
                    for result in results:
                        db.query(CourseMatch).filter(
                            CourseMatch.match_job_id == job_id,
                            CourseMatch.partner_course_id == course_id,
                            CourseMatch.home_course_id == result.home_course_id,
                        ).update({
                            "verification_status": "risk_flagged",
                            "verification_confidence": 0.0,
                            "verification_reason": "LLM verification call failed",
                            "verification_risk_flags": ["llm_failure"],
                            "is_recommended": False,
                        })
                    db.commit()

                db.query(MatchJob).filter(MatchJob.id == job_id).update({
                    "processed_courses": already_done + i + 1,
                })
                db.commit()

            # All courses done
            db.expire_all()
            job = db.query(MatchJob).filter(MatchJob.id == job_id).first()
            if job and job.status == "paused":
                should_cleanup = False
            elif job and job.status not in ("cancelled", "failed"):
                job.status = "completed"
                job.current_course = None
                job.completed_at = datetime.now(timezone.utc)
                db.commit()
                print(f"[MatchQueueV2] Job {job_id}: Completed.", flush=True)

        except Exception as e:
            try:
                job = db.query(MatchJob).filter(MatchJob.id == job_id).first()
                if job:
                    job.status = "failed"
                    job.error_log = str(e)[:500]
                    job.completed_at = datetime.now(timezone.utc)
                    db.commit()
            except Exception:
                pass
        finally:
            db.close()
            if job_id in self._completion_events:
                self._completion_events[job_id].set()
            if should_cleanup:
                self.cleanup(job_id)


match_queue_manager_v2 = MatchQueueManagerV2()
