"""
University Onboarding Pipeline - End-to-end ingestion of partner university courses.

Flow: register university -> upload PDFs -> parse -> validate -> save to DB -> update status
"""

import os
from collections import defaultdict
from datetime import datetime
from pathlib import Path
from sqlalchemy.orm import Session

from db.models import University, IngestionBatch, Course, UploadJob
from parsing.parser import CourseParser, UNIVERSITY_CONFIG
from parsing.validator import CourseValidator


class UniversityOnboardingPipeline:
    """Orchestrates the full university onboarding process."""

    def __init__(self, db: Session, parser: CourseParser = None, validator: CourseValidator = None):
        self.db = db
        self.parser = parser or CourseParser()
        self.validator = validator or CourseValidator()

    def register_university(
        self, name: str, country: str = None, city: str = None,
        pdf_structure: str = "individual", is_home: bool = False
    ) -> University:
        """Step 1: Create university record in database."""
        university = University(
            name=name,
            country=country,
            city=city,
            pdf_structure=pdf_structure,
            is_home=is_home,
            is_active=True,
            ingestion_status="pending",
        )
        self.db.add(university)
        self.db.commit()
        self.db.refresh(university)
        return university

    def create_batch(self, university_id: int, semester: str = "unknown") -> IngestionBatch:
        """Step 2: Create an ingestion batch tracking record."""
        batch = IngestionBatch(
            university_id=university_id,
            semester=semester,
            status="pending",
        )
        self.db.add(batch)
        self.db.commit()
        self.db.refresh(batch)
        return batch

    def ingest_pdfs(
        self, university_id: int, batch_id: int,
        pdf_paths: list, semester: str = "unknown",
        university_name: str = None,
        cancel_event=None, pause_event=None, upload_job=None,
    ):
        """
        Step 3: Parse PDFs and save structured course data to database.
        This is the main parsing step - meant to run as a background task.
        """
        batch = self.db.query(IngestionBatch).get(batch_id)
        university = self.db.query(University).get(university_id)

        if not batch or not university:
            return

        university_name = university_name or university.name

        # Determine parse mode: upload job override > university DB field > UNIVERSITY_CONFIG > "individual"
        override = getattr(upload_job, 'pdf_structure_override', None) if upload_job else None
        if override and override in ("individual", "consolidated", "category_based"):
            mode = override
        elif university.pdf_structure and university.pdf_structure in ("individual", "consolidated", "category_based"):
            mode = university.pdf_structure
        else:
            config = UNIVERSITY_CONFIG.get(university_name, {"mode": "individual"})
            mode = config.get("mode", "individual")
        config = UNIVERSITY_CONFIG.get(university_name, {})

        # Update status
        batch.status = "parsing"
        batch.total_courses = upload_job.total_files if upload_job else len(pdf_paths)
        university.ingestion_status = "parsing"
        self.db.commit()

        parsed_count = upload_job.processed_files if upload_job else 0
        failed_count = upload_job.failed_files if upload_job else 0
        errors = []

        def _check_cancel_pause():
            """Returns True if should stop, sets job/batch status appropriately."""
            # Expire + refresh from DB to break SQLAlchemy's session cache
            # and pick up status changes committed by the API in a different session
            if upload_job:
                self.db.expire(upload_job)
                self.db.refresh(upload_job)
                if upload_job.status == "queued":
                    upload_job.status = "parsing"
                    self.db.commit()
            if cancel_event and cancel_event.is_set():
                batch.status = "cancelled"
                batch.completed_at = datetime.utcnow()
                university.ingestion_status = "failed"
                if upload_job:
                    upload_job.status = "cancelled"
                    upload_job.completed_at = datetime.utcnow()
                self.db.commit()
                return "cancel"
            # Check both the threading event AND the DB status
            is_paused = (pause_event and pause_event.is_set()) or (upload_job and upload_job.status == "paused")
            if is_paused:
                if pause_event:
                    pause_event.set()  # sync the flag
                batch.status = "paused"
                if upload_job:
                    upload_job.status = "paused"
                self.db.commit()
                return "paused"
            return None

        try:
            if mode == "consolidated":
                # For consolidated PDFs, each file may contain many courses
                ocr_semesters = config.get("ocr_semesters", [])
                do_ocr = semester in ocr_semesters
                file_index = 0

                for pdf_path in pdf_paths:
                    signal = _check_cancel_pause()
                    if signal in ("cancel", "paused"):
                        return

                    if upload_job:
                        upload_job.current_file = os.path.basename(pdf_path)
                        self.db.commit()

                    try:
                        courses = self.parser.parse_consolidated_pdf(
                            pdf_path, semester=semester, do_ocr=do_ocr
                        )
                        validated = self.validator.validate_batch(courses)
                        batch.total_courses = len(validated)

                        for course_data in validated:
                            signal = _check_cancel_pause()
                            if signal in ("cancel", "paused"):
                                return
                            self._save_course(university_id, batch_id, course_data, pdf_path)
                            parsed_count += 1
                            batch.parsed_courses = parsed_count
                            self.db.commit()

                        # Track FILE-level progress on upload_job (not course-level)
                        file_index += 1
                        if upload_job:
                            self.db.query(UploadJob).filter(UploadJob.id == upload_job.id).update({"processed_files": file_index})
                            self.db.commit()

                    except Exception as e:
                        failed_count += 1
                        file_index += 1
                        if upload_job:
                            self.db.query(UploadJob).filter(UploadJob.id == upload_job.id).update({"processed_files": file_index, "failed_files": failed_count})
                            self.db.commit()
                        errors.append(f"{os.path.basename(pdf_path)}: {str(e)}")

            else:
                # Individual or category_based mode
                for pdf_path in pdf_paths:
                    signal = _check_cancel_pause()
                    if signal in ("cancel", "paused"):
                        return

                    if upload_job:
                        self.db.query(UploadJob).filter(UploadJob.id == upload_job.id).update({"current_file": os.path.basename(pdf_path)})
                        self.db.commit()

                    try:
                        course = self.parser.parse_individual_pdf(pdf_path, semester=semester)

                        # Check pause/cancel immediately after LLM call returns
                        signal = _check_cancel_pause()
                        if signal in ("cancel", "paused"):
                            return

                        if course:
                            # Add source metadata
                            if "source" not in course:
                                course["source"] = {}
                            course["source"]["source_type"] = "home" if university.is_home else "partner"
                            course["source"]["pdf_filename"] = os.path.basename(pdf_path)

                            # Detect category from path for IKU
                            if mode == "category_based":
                                categories = config.get("categories", {})
                                parent_folder = Path(pdf_path).parent.name
                                course["source"]["category"] = categories.get(parent_folder)
                                course["source"]["source_type"] = "home"

                            validated = self.validator.validate(course)
                            self._save_course(university_id, batch_id, validated, pdf_path)
                            parsed_count += 1
                        else:
                            failed_count += 1
                            errors.append(f"{os.path.basename(pdf_path)}: No content extracted")

                        batch.parsed_courses = parsed_count
                        batch.failed_courses = failed_count
                        self.db.commit()
                        if upload_job:
                            self.db.query(UploadJob).filter(UploadJob.id == upload_job.id).update({"processed_files": parsed_count, "failed_files": failed_count})
                            self.db.commit()

                    except Exception as e:
                        failed_count += 1
                        errors.append(f"{os.path.basename(pdf_path)}: {str(e)}")
                        batch.failed_courses = failed_count
                        if upload_job:
                            self.db.refresh(upload_job)
                            upload_job.processed_files = parsed_count
                            upload_job.failed_files = failed_count
                        self.db.commit()

            # Finalize batch
            batch.status = "parsed"
            batch.parsed_courses = parsed_count
            batch.failed_courses = failed_count
            batch.error_log = "\n".join(errors) if errors else None
            batch.completed_at = datetime.utcnow()

            # CRITICAL: Commit status change to 'embedding' BEFORE deduplication
            university.ingestion_status = "embedding"
            if upload_job:
                upload_job.status = "embedding"
            self.db.commit()

            # Deduplicate: if same course exists in both fall and spring, merge to "both"
            # This can be slow, which is why we committed the status above.
            self.deduplicate_semesters(university_id)

        except Exception as e:
            batch.status = "failed"
            batch.error_log = str(e)
            batch.completed_at = datetime.utcnow()
            university.ingestion_status = "failed"
            self.db.commit()

    def deduplicate_semesters(self, university_id: int):
        """
        If the same course (by course_name) exists in both fall and spring
        for the same university, keep one record and set semester to 'both'.
        Called automatically after each ingestion completes.
        """
        courses = self.db.query(Course).filter(Course.university_id == university_id).all()

        groups = defaultdict(list)
        for c in courses:
            key = (c.course_name or "").strip().lower()
            groups[key].append(c)

        merged_count = 0
        for key, group in groups.items():
            if len(group) < 2:
                continue
            semesters = set((c.academic_context or {}).get("semester", "") for c in group)
            if "fall" in semesters and "spring" in semesters:
                # Keep the first one (best data), set to "both", delete duplicates
                keeper = sorted(group, key=lambda c: c.id)[0]
                ac = dict(keeper.academic_context or {})
                ac["semester"] = "both"
                keeper.academic_context = ac
                for duplicate in group:
                    if duplicate.id != keeper.id:
                        self.db.delete(duplicate)
                merged_count += 1

        if merged_count > 0:
            self.db.commit()

        return merged_count

    @staticmethod
    def _strip_nul(val):
        """Recursively strip NUL bytes from strings/dicts/lists. PostgreSQL rejects \\x00 in text."""
        if isinstance(val, str):
            return val.replace('\x00', '')
        if isinstance(val, dict):
            return {k: UniversityOnboardingPipeline._strip_nul(v) for k, v in val.items()}
        if isinstance(val, list):
            return [UniversityOnboardingPipeline._strip_nul(i) for i in val]
        return val

    def _save_course(self, university_id: int, batch_id: int, course_data: dict, pdf_path: str):
        """Save a single parsed course to the database."""
        # Sanitize all string data — PostgreSQL rejects NUL bytes in text fields
        course_data = self._strip_nul(course_data)
        source = course_data.get("source", {})

        raw_level = course_data.get("level", "unknown")
        valid_level = raw_level if raw_level in ["bachelor", "master"] else "unknown"

        ac = dict(course_data.get("academic_context", {}))
        ac.setdefault("department", course_data.get("department") if course_data.get("department") != "unknown" else None)
        ac.setdefault("semester", course_data.get("semester", "unknown"))
        ac.setdefault("level", valid_level)
        ac.setdefault("language", course_data.get("language") if course_data.get("language") != "unknown" else None)

        course = Course(
            university_id=university_id,
            ingestion_batch_id=batch_id,
            course_code=course_data.get("course_code") if course_data.get("course_code") != "unknown" else None,
            course_name=course_data.get("course_name", "Unknown Course"),
            ects=course_data.get("ects"),
            content=course_data.get("content") if course_data.get("content") != "unknown" else None,
            learning_outcomes=course_data.get("learning_outcomes") if course_data.get("learning_outcomes") != "unknown" else None,
            academic_context=ac,
            metadata_quality=course_data.get("metadata_quality", {}),
            source_metadata={
                "source_type": source.get("source_type", "partner"),
                "category": source.get("category"),
                "pdf_filename": source.get("pdf_filename", os.path.basename(pdf_path)),
                "ingestion_batch_id": str(batch_id),
            },
            raw_text=course_data.get("raw_text"),
            warnings=course_data.get("warnings", []),
        )
        self.db.add(course)
