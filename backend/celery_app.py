import os
from dotenv import load_dotenv
load_dotenv()

try:
    from celery import Celery
    CELERY_AVAILABLE = True
except ImportError:
    CELERY_AVAILABLE = False
    class Celery:
        def __init__(self, *args, **kwargs):
            self.conf = MagicCeleryConf()
        def task(self, *args, **kwargs):
            def decorator(func):
                def delay(*args, **kwargs):
                    return func(*args, **kwargs)
                func.delay = delay
                return func
            return decorator
    class MagicCeleryConf:
        def update(self, *args, **kwargs): pass

REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")

celery_app = Celery(
    "erasmus_matching",
    broker=REDIS_URL,
    backend=REDIS_URL,
)

if CELERY_AVAILABLE:
    celery_app.conf.update(
        task_serializer="json",
        accept_content=["json"],
        result_serializer="json",
        timezone="Europe/Istanbul",
        enable_utc=True,
        task_acks_late=True,
        worker_prefetch_multiplier=1,
        worker_concurrency=1,
    )

# Celery Task Definitions
@celery_app.task(name="process_upload_job_task", max_retries=1)
def process_upload_job_task(job_id: int):
    print(f"[Celery] Starting process_upload_job_task for job {job_id}...", flush=True)
    from ingestion.queue_manager import queue_manager
    queue_manager._process_job(job_id)
    print(f"[Celery] Finished process_upload_job_task for job {job_id}!", flush=True)

@celery_app.task(name="process_match_job_task", max_retries=1)
def process_match_job_task(job_id: int):
    print(f"[Celery] Starting process_match_job_task for job {job_id}...", flush=True)
    from matching.match_queue_manager_v2 import match_queue_manager_v2
    match_queue_manager_v2._process_job(job_id)
    print(f"[Celery] Finished process_match_job_task for job {job_id}!", flush=True)

@celery_app.task(name="process_transfer_doc_task", max_retries=1)
def process_transfer_doc_task(doc_id: int):
    print(f"[Celery] Starting process_transfer_doc_task for doc {doc_id}...", flush=True)
    from backend.services.transfer_queue import TransferDocumentQueue
    TransferDocumentQueue()._process(doc_id)
    print(f"[Celery] Finished process_transfer_doc_task for doc {doc_id}!", flush=True)
