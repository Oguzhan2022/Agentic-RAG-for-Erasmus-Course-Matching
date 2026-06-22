"""
Upload Queue Manager - FIFO queue for upload/parse jobs.

Ensures uploads are processed one at a time (first-come-first-serve).
Supports pause, resume, and cancel operations per job.
Recovers orphaned jobs on startup (e.g. after server reload).
"""

import os
import time
import socket
import logging
import threading
import uuid
from datetime import datetime, timezone, timedelta
from typing import Dict


class UploadQueueManager:
    """
    Singleton FIFO queue manager for upload jobs.
    Worker thread processes one job at a time.
    """

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
            self._worker_thread = threading.Thread(target=self._worker, daemon=True, name="UploadQueueWorker")
            self._worker_thread.start()
            # Recover orphaned jobs on startup (clean up any jobs stuck in 'parsing' from a crash)
            threading.Thread(target=self._recover_orphaned_jobs, daemon=True).start()
        else:
            import sys
            is_celery = any("celery" in arg for arg in sys.argv)
            is_pytest = any("pytest" in arg or "test" in arg for arg in sys.argv)
            if not is_celery and not is_pytest:
                print("[UploadQueueManager] Running Celery startup orphan recovery in web server process...", flush=True)
                threading.Thread(target=self._recover_orphaned_jobs, daemon=True).start()

    def _recover_orphaned_jobs(self):
        """Re-enqueue jobs stuck in 'parsing' or 'queued' after a restart.
        Paused jobs are kept as-is but their flags are re-created so resume works."""
        time.sleep(2)
        try:
            from db.database import SessionLocal
            from db.models import UploadJob
            db = SessionLocal()
            # If a job was marked as 'parsing' or 'embedding' but the worker is gone, reset to 'queued'
            orphaned = db.query(UploadJob).filter(
                UploadJob.status.in_(["parsing", "embedding", "queued", "paused"])
            ).order_by(UploadJob.id).all()
            for job in orphaned:
                if job.status == "paused":
                    with self._queue_lock:
                        if job.id not in self._cancel_flags:
                            self._cancel_flags[job.id] = threading.Event()
                        if job.id not in self._pause_flags:
                            self._pause_flags[job.id] = threading.Event()
                            self._pause_flags[job.id].set()
                else:
                    job.status = "queued"
                    db.commit()
                    if job.ingestion_batch_id:
                        from db.models import IngestionBatch
                        batch = db.query(IngestionBatch).get(job.ingestion_batch_id)
                        if batch and batch.status in ("parsing", "embedding"):
                            batch.status = "pending"
                            db.commit()
                    self.enqueue(job.id)

            # Also recover any independent IngestionBatch stuck in 'parsing' or 'embedding'
            from db.models import IngestionBatch
            stuck_batches = db.query(IngestionBatch).filter(
                IngestionBatch.status.in_(["parsing", "embedding"]),
                IngestionBatch.completed_at == None
            ).all()
            for batch in stuck_batches:
                # If no active upload job is working on this batch, set it to failed
                active_job = db.query(UploadJob).filter(
                    UploadJob.ingestion_batch_id == batch.id,
                    UploadJob.status.in_(["queued", "parsing", "embedding", "paused"])
                ).first()
                if not active_job:
                    batch.status = "failed"
                    batch.error_log = "System restarted during execution. Job orphaned."
                    batch.completed_at = datetime.utcnow()
                    db.commit()

            db.close()
        except Exception as e:
            print(f"[QueueManager] Recovery failed: {e}", flush=True)

    def enqueue(self, job_id: int):
        """Add a job to the queue and wake up the worker."""
        if os.getenv("USE_CELERY", "false").lower() == "true":
            try:
                from backend.celery_app import process_upload_job_task
                process_upload_job_task.delay(job_id)
                print(f"[QueueManager] Enqueued UploadJob {job_id} to Celery successfully!", flush=True)
                return
            except Exception as e:
                print(f"[QueueManager] Celery task enqueue failed, falling back to local thread: {e}", flush=True)

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
        """Wait for a job to finish processing. Returns True if stopped within timeout."""
        event = self._completion_events.get(job_id)
        if event:
            return event.wait(timeout=timeout)
        return True

    def _worker(self):
        """
        Worker loop with Global Sequentiality.
        Uses PostgreSQL Advisory Locks to ensure only one worker processes ANY job at a time 
        globally (across all 3 run_server.py instances).
        """
        from db.database import SessionLocal
        from db.models import UploadJob
        from sqlalchemy import text

        GLOABL_INGESTION_LOCK_ID = 42 # Unique ID for ingestion lock

        while True:
            db = SessionLocal()
            job_id = None
            lock_acquired = False
            try:
                # 1. Attempt to acquire the global application-level lock
                # Use pg_try_advisory_lock so we don't block the thread indefinitely; 
                # instead, we'll try again next iteration if busy.
                res = db.execute(text(f"SELECT pg_try_advisory_lock({GLOABL_INGESTION_LOCK_ID})"))
                lock_acquired = res.scalar()

                if not lock_acquired:
                    # Another worker is already processing something globally.
                    # Wait in 'queued' state logic: just sleep and don't pick any job.
                    db.close()
                    time.sleep(5)
                    continue

                # 2. We hold the global lock! Now pick the next job in FIFO order.
                job = db.query(UploadJob).filter(
                    UploadJob.status == "queued"
                ).order_by(UploadJob.created_at.asc()).first()

                if job:
                    job_id = job.id
                    job.status = "parsing"
                    db.commit()
                else:
                    self._worker_event.clear()
            except Exception as e:
                print(f"[QueueManager] Worker lock/poll error: {e}", flush=True)
                db.rollback()
            finally:
                if not job_id:
                    # If we grabbed the lock but found no job, release it immediately
                    if lock_acquired:
                        db.execute(text(f"SELECT pg_advisory_unlock({GLOABL_INGESTION_LOCK_ID})"))
                        db.commit()
                    db.close()
            
            if job_id is None:
                self._worker_event.wait(timeout=10)
                continue
                
            # 3. Process the job while holding the advisory lock
            try:
                self._process_job(job_id)
            except Exception as e:
                print(f"[QueueManager] Fatal error in _process_job({job_id}): {e}", flush=True)
            finally:
                # 4. Mandatory release of the global lock after job finishes (success or failure)
                try:
                    db = SessionLocal()
                    db.execute(text(f"SELECT pg_advisory_unlock({GLOABL_INGESTION_LOCK_ID})"))
                    db.commit()
                    db.close()
                except Exception:
                    pass

    def _process_job(self, job_id: int):
        """Main processing logic: parse PDFs then embed courses."""
        from db.database import SessionLocal
        from db.models import UploadJob, IngestionBatch, University, Course
        from ingestion.university_onboarding import UniversityOnboardingPipeline
        from backend.config import settings
        from retrieval.embedder import embed_university_courses

        self._completion_events[job_id] = threading.Event()

        with self._queue_lock:
            if job_id not in self._cancel_flags:
                self._cancel_flags[job_id] = threading.Event()
            if job_id not in self._pause_flags:
                self._pause_flags[job_id] = threading.Event()
            cancel_event = self._cancel_flags[job_id]
            pause_event = self._pause_flags[job_id]

        db = SessionLocal()
        should_cleanup = True
        try:
            # Re-fetch job object in THIS session
            job = db.query(UploadJob).get(job_id)
            if not job or job.status not in ("parsing", "queued"):
                return

            batch = db.query(IngestionBatch).get(job.ingestion_batch_id)
            university = db.query(University).get(job.university_id)
            if not batch or not university:
                job.status = "failed"
                job.error_log = "Batch or university not found"
                job.completed_at = datetime.now(timezone.utc)
                db.commit()
                return

            if job.category:
                upload_dir = os.path.join(settings.upload_dir, str(job.university_id), job.semester, job.category)
            else:
                upload_dir = os.path.join(settings.upload_dir, str(job.university_id), job.semester)

            if job.file_manifest:
                all_filenames = job.file_manifest
                all_files = [os.path.join(upload_dir, f) for f in all_filenames]
                already_done = job.processed_files or 0
                if 0 < already_done < len(all_files):
                    all_files = all_files[already_done:]
                elif already_done >= len(all_files):
                    job.status = "completed"
                    job.completed_at = datetime.now(timezone.utc)
                    db.commit()
                    return
            else:
                all_filenames = []
                if os.path.exists(upload_dir):
                    all_filenames = sorted([f for f in os.listdir(upload_dir) if f.lower().endswith((".pdf", ".txt")) and os.path.isfile(os.path.join(upload_dir, f))])

                if not all_filenames:
                    job.status = "failed"
                    job.error_log = "No files found"
                    job.completed_at = datetime.now(timezone.utc)
                    db.commit()
                    return

                job.file_manifest = all_filenames
                job.total_files = len(all_filenames)
                all_files = [os.path.join(upload_dir, f) for f in all_filenames]

            job.status = "parsing"
            db.commit()

            pipeline = UniversityOnboardingPipeline(db)
            pipeline.ingest_pdfs(
                university_id=job.university_id,
                batch_id=batch.id,
                pdf_paths=all_files,
                semester=job.semester,
                university_name=university.name,
                cancel_event=cancel_event,
                pause_event=pause_event,
                upload_job=job,
            )

            db.refresh(job)
            if job.status == "paused":
                should_cleanup = False
            elif job.status not in ("cancelled", "failed"):
                # Mandatory embedding step
                print(f"[QueueManager] Starting embedding for university {job.university_id}...", flush=True)
                job.status = "embedding"
                university.ingestion_status = "embedding"
                db.commit()
                
                try:
                    embed_result = embed_university_courses(job.university_id, db)
                    print(f"[QueueManager] Embedding completed: {embed_result}", flush=True)
                    
                    university.ingestion_status = "ready"
                    job.status = "completed"
                    job.completed_at = datetime.now(timezone.utc)
                    db.commit()
                except Exception as emb_err:
                    print(f"[QueueManager] Embedding failed: {emb_err}", flush=True)
                    job.status = "failed"
                    job.error_log = f"Parsing ok, but embedding failed: {str(emb_err)}"
                    db.commit()

            if job.status == "cancelled":
                active_jobs = db.query(UploadJob).filter(
                    UploadJob.university_id == job.university_id,
                    UploadJob.id != job.id,
                    UploadJob.status.in_(["queued", "parsing", "paused"]),
                ).count()
                if active_jobs == 0:
                    has_courses = db.query(Course).filter(Course.university_id == job.university_id, Course.embedding.isnot(None)).count() > 0
                    university.ingestion_status = "ready" if has_courses else "pending"
                    db.commit()

        except Exception as e:
            print(f"[QueueManager] Error processing job {job_id}: {e}", flush=True)
            try:
                db.rollback()
                job = db.query(UploadJob).get(job_id)
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


# Global singleton instance
queue_manager = UploadQueueManager()
