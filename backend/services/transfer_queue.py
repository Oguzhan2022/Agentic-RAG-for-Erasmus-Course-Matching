"""
FIFO queue manager for transfer document processing.

Same pattern as MatchQueueManagerV2 — singleton daemon thread that
processes transfer_documents one at a time in order.
"""

import threading
import time
import logging

logger = logging.getLogger(__name__)


class TransferDocumentQueue:
    """Singleton FIFO queue for parsing + verifying transfer documents."""

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
        self._queue: list[int] = []
        self._queue_lock = threading.Lock()
        self._completion_events: dict[int, threading.Event] = {}
        self._worker_event = threading.Event()
        
        import os
        from dotenv import load_dotenv
        load_dotenv()
        use_celery = os.getenv("USE_CELERY", "false").lower() == "true"
        if not use_celery:
            self._worker = threading.Thread(target=self._run, daemon=True, name="TransferDocWorker")
            self._worker.start()
            # Recover orphans on startup
            threading.Thread(target=self._recover_orphans, daemon=True).start()

    def _recover_orphans(self):
        time.sleep(3)
        try:
            from db.database import SessionLocal
            from db.models import TransferDocument
            db = SessionLocal()
            orphans = db.query(TransferDocument).filter(
                TransferDocument.parsing_method == None
            ).order_by(TransferDocument.id).all()
            for doc in orphans:
                if doc.file_path and doc.partner_university_id:
                    self.enqueue(doc.id)
                    logger.info("Recovered orphan transfer doc %d", doc.id)
            db.close()
        except Exception as e:
            logger.exception("Orphan recovery failed: %s", e)

    def enqueue(self, doc_id: int):
        import os
        if os.getenv("USE_CELERY", "false").lower() == "true":
            try:
                from backend.celery_app import process_transfer_doc_task
                process_transfer_doc_task.delay(doc_id)
                logger.info("[TransferQueue] Enqueued TransferDocument %d to Celery successfully!", doc_id)
                return
            except Exception as e:
                logger.error("[TransferQueue] Celery task enqueue failed, falling back to local thread: %s", e)

        with self._queue_lock:
            if doc_id not in self._queue:
                self._queue.append(doc_id)
        self._worker_event.set()

    def _run(self):
        while True:
            self._worker_event.wait()
            doc_id = None
            with self._queue_lock:
                if self._queue:
                    doc_id = self._queue.pop(0)
                else:
                    self._worker_event.clear()
            if doc_id is None:
                continue
            try:
                self._process(doc_id)
            except Exception as e:
                logger.exception("Unexpected error processing transfer doc %d: %s", doc_id, e)

    def _process(self, doc_id: int):
        from db.database import SessionLocal
        from db.models import (
            TransferDocument, GradingScheme, GradingSchemeSnapshot,
            EctsIkuSnapshot, University,
        )
        from backend.services.versioning import get_latest_scheme_snapshot_id, get_latest_ects_iku_snapshot_id
        from parsing.transfer_document_parser import (
            parse_transfer_document, verify_document_grades,
            generate_error_explanations,
        )

        self._completion_events[doc_id] = threading.Event()

        db = SessionLocal()
        try:
            doc = db.query(TransferDocument).filter(TransferDocument.id == doc_id).first()
            if not doc or doc.parsing_method is not None:
                return  # already processed

            file_path = doc.file_path
            if file_path:
                # Convert virtual path to absolute
                abs_path = file_path.lstrip("/")
                import os
                if not os.path.isabs(abs_path):
                    abs_path = os.path.join(os.getcwd(), abs_path)

                if not os.path.exists(abs_path):
                    logger.error("Transfer doc %d file not found: %s", doc_id, abs_path)
                    doc.parsing_method = "error"
                    doc.review_notes = (doc.review_notes or "") + "\nFile not found on disk"
                    db.commit()
                    return

                # Parse
                parsed = parse_transfer_document(db, abs_path, doc.partner_university_id)
            else:
                # No file — should not happen
                parsed = {
                    "studentName": "", "studentNumber": "",
                    "partnerUniversity": "", "homeUniversity": "İstanbul Kültür Üniversitesi",
                    "rows": [], "warnings": ["No file path"],
                    "parsing_method": "error", "grading_scheme_id": None,
                    "_gs_vid": None, "_eiku_vid": None,
                    "rules_snapshot": None, "mappings": None,
                }

            rows_raw = parsed.get("rows", [])
            warnings = parsed.get("warnings", [])
            parsing_method = parsed.get("parsing_method", "rule_based")

            doc.student_name = parsed.get("studentName", "")[:300]
            doc.student_number = parsed.get("studentNumber", "")[:50]
            doc.parsing_method = parsing_method
            doc.parsed_rows = rows_raw
            doc.grading_scheme_version_id = parsed.get("_gs_vid")
            doc.ects_iku_version_id = parsed.get("_eiku_vid")

            if not doc.grading_scheme_version_id:
                scheme = db.query(GradingScheme).filter(
                    GradingScheme.university_id == doc.partner_university_id,
                    GradingScheme.is_active == True,
                ).first()
                if scheme:
                    doc.grading_scheme_version_id = get_latest_scheme_snapshot_id(db, scheme.id)
                    doc.ects_iku_version_id = get_latest_ects_iku_snapshot_id(db)

            # Verification — always run if we have grading data
            uni = db.query(University).filter(University.id == doc.partner_university_id).first()
            rules_snap = parsed.get("rules_snapshot")
            mappings = parsed.get("mappings")
            if rules_snap and mappings:
                # Determine next version number
                from sqlalchemy import func as sa_func
                from db.models import TransferVerificationResult
                max_version = db.query(sa_func.max(TransferVerificationResult.version_number)).filter(
                    TransferVerificationResult.transfer_document_id == doc.id
                ).scalar() or 0
                next_version = max_version + 1

                # Deactivate old active results
                db.query(TransferVerificationResult).filter(
                    TransferVerificationResult.transfer_document_id == doc.id,
                    TransferVerificationResult.is_active == True,
                ).update({"is_active": False})
                db.flush()

                try:
                    verify_document_grades(db, doc.id, rows_raw, rules_snap, mappings, uni.name if uni else "", version_number=next_version)
                except Exception as e:
                    logger.exception("Verification failed for doc %d", doc_id)
                    warnings.append(f"Grade verification failed: {str(e)}")

                try:
                    generate_error_explanations(db, doc.id, uni.name if uni else "")
                except Exception as e:
                    logger.exception("Explanation generation failed for doc %d", doc_id)
                    warnings.append(f"Explanation generation failed: {str(e)}")

                # Save file info for this version
                vf_dict = dict(doc.version_files or {})
                vf_dict[str(next_version)] = {
                    "filename": doc.original_filename,
                    "file_path": doc.file_path,
                }
                doc.version_files = vf_dict

                # Preserve old version's review status before resetting
                if next_version > 1:
                    old_version_key = str(next_version - 1)
                    vrev_dict = dict(doc.version_reviews or {})
                    if old_version_key not in vrev_dict and doc.review_status and doc.review_status != "pending":
                        vrev_dict[old_version_key] = {
                            "status": doc.review_status,
                            "by": doc.reviewed_by,
                            "at": doc.reviewed_at.isoformat() if doc.reviewed_at else None,
                            "notes": doc.review_notes or "",
                        }
                        doc.version_reviews = vrev_dict

                    # New version starts as pending
                    doc.review_status = "pending"
                    doc.reviewed_by = None
                    doc.reviewed_at = None
                    doc.review_notes = None
            # Save the parsed rows for this specific version so they can be fully restored
            vpr_dict = dict(doc.version_parsed_rows or {})
            vpr_dict[str(next_version)] = rows_raw
            doc.version_parsed_rows = vpr_dict

            doc.parsed_rows = rows_raw
            if warnings:
                old = doc.review_notes or ""
                doc.review_notes = old + ("\n" if old else "") + "Warnings: " + "; ".join(warnings)

            db.commit()

        except Exception as e:
            logger.exception("Background processing failed for doc %d", doc_id)
            try:
                doc = db.query(TransferDocument).filter(TransferDocument.id == doc_id).first()
                if doc:
                    doc.review_notes = (doc.review_notes or "") + f"\nProcessing error: {str(e)}"
                    db.commit()
            except Exception:
                pass
        finally:
            db.close()
            self._completion_events.pop(doc_id, None)


transfer_queue = TransferDocumentQueue()
