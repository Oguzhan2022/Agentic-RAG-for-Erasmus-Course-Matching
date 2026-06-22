"""
IKU ECTS Scraper – fetches the Program Curriculum page from
akademikpaket.iku.edu.tr, categorises courses into Core / Departmental Elective /
Elective, downloads the full text of each course detail page, and creates
upload-jobs per category so they flow through the existing parse → embed pipeline.
"""

import os
import re
import time
import logging
import threading
from typing import List, Dict, Optional, Tuple
from datetime import datetime, timezone
from urllib.parse import urljoin
from urllib.parse import urlparse

import requests
from bs4 import BeautifulSoup
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from sqlalchemy.orm import Session
from pydantic import BaseModel

from backend.dependencies import get_db
from backend.config import settings
from backend.services.lock_manager import DistributedLockManager
from db.models import University, IngestionBatch, UploadJob, User, SystemLock


from authorization.middleware import require_role

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["ects-scraper"])

# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------

class ScrapeRequest(BaseModel):
    ects_url: str  # e.g. https://akademikpaket.iku.edu.tr/EN/ects_bolum.php?m=1&p=13&f=4&r=0&ects=ders


class ScrapeStatus(BaseModel):
    status: str  # "running", "completed", "failed", "idle"
    total_courses: int
    scraped_courses: int
    categories: Dict[str, int]
    jobs_created: List[int]
    error: Optional[str] = None


# ---------------------------------------------------------------------------

# Category mapping
#
# The IKU ECTS page has a "CC/DE/EL" column per course row:
#   CC  = Compulsory Course  → core
#   BSC = Basic Science Course → core  (treated as core)
#   DE  = Departmental Elective → departmental_elective
#   EL  = Elective → elective
# ---------------------------------------------------------------------------

CATEGORY_MAP = {
    "CC":  "core",
    "BSC": "core",
    "DE":  "departmental_elective",
    "EL":  "elective",
}

# ---------------------------------------------------------------------------
# Scraping helpers
# ---------------------------------------------------------------------------

_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
}


def _fetch_page(url: str) -> BeautifulSoup:
    """Fetch a page and return parsed BeautifulSoup."""
    resp = requests.get(url, headers=_HEADERS, timeout=30)
    resp.encoding = "utf-8"
    resp.raise_for_status()
    return BeautifulSoup(resp.text, "html.parser")


def _parse_curriculum_page(soup: BeautifulSoup, base_url: str) -> Dict[str, List[Tuple[str, str, str, str]]]:
    """
    Parse the program curriculum page.

    The HTML table has rows with 5 cells:
        Course Code | Course Name (link to detail) | CC/DE/EL | LE/RC/LA | ECTS

    Returns dict:  category -> list of (course_code, course_name, detail_url, ects)
    """
    courses_by_category: Dict[str, List[Tuple[str, str, str, str]]] = {
        "core": [],
        "departmental_elective": [],
        "elective": [],
    }

    # Find the largest table (the curriculum table)
    tables = soup.find_all("table")
    target_table = max(tables, key=lambda t: len(t.find_all("tr")), default=None)
    if not target_table:
        return courses_by_category

    for row in target_table.find_all("tr"):
        cells = row.find_all("td")
        if len(cells) != 5:
            continue  # skip header rows, semester labels, totals, empty rows

        course_code = cells[0].get_text(strip=True)
        course_name_cell = cells[1]
        category_text = cells[2].get_text(strip=True).upper()
        ects_text = cells[4].get_text(strip=True)

        # Must have a link to the detail page
        a_tag = course_name_cell.find("a")
        if not a_tag or not a_tag.get("href"):
            continue

        href = a_tag["href"]
        if "ders_detay" not in href and "ders_id" not in href:
            continue

        course_name = a_tag.get_text(strip=True)
        detail_url = href if href.startswith("http") else urljoin(base_url, href)

        cat = CATEGORY_MAP.get(category_text)
        if not cat:
            # Unknown category code – default to elective
            cat = "elective"

        courses_by_category[cat].append((course_code, course_name, detail_url, ects_text))

    return courses_by_category


def _extract_course_text(soup: BeautifulSoup) -> str:
    """
    Extract ALL text content from a course detail page.
    Returns the full page text as a clean string.
    """
    # Remove script and style elements
    for tag in soup(["script", "style"]):
        tag.decompose()

    # Get full body text
    body = soup.find("body")
    if not body:
        return ""

    text = body.get_text(separator="\n", strip=False)

    # Clean up excessive whitespace
    text = re.sub(r'\n{3,}', '\n\n', text)
    text = re.sub(r'[ \t]+', ' ', text)

    # Remove duplicate consecutive lines
    lines = text.split('\n')
    cleaned = []
    prev = None
    for line in lines:
        stripped = line.strip()
        if stripped != prev:
            cleaned.append(line)
        prev = stripped

    return '\n'.join(cleaned).strip()


def _sanitize_filename(name: str) -> str:
    """Convert course name to a safe filename."""
    safe = re.sub(r'[<>:"/\\|?*]', '_', name)
    safe = re.sub(r'\s+', '_', safe)
    safe = safe.strip('_.')
    if len(safe) > 100:
        safe = safe[:100]
    return safe


# ---------------------------------------------------------------------------
# Background scraping task
# ---------------------------------------------------------------------------

import json

def _update_db_progress(db: Session, lock_name: str, status_data: dict):
    """Utility to update serialized progress inside SystemLock's worker_id."""
    lock = db.query(SystemLock).filter(SystemLock.name == lock_name).first()
    if lock:
        lock.worker_id = json.dumps(status_data)
        lock.last_heartbeat = datetime.now()
        try:
            db.commit()
        except Exception as e:
            db.rollback()
            logger.error(f"[ECTS Scraper] Failed to save progress to DB: {e}")


def _run_scrape_task(university_id: int, ects_url: str):
    """Background task: scrape all courses and create upload jobs."""
    from db.database import SessionLocal
    from ingestion.queue_manager import queue_manager

    db = SessionLocal()
    lock_name = f"ects_scrape_uni_{university_id}"
    worker_id = f"scrape_worker_{university_id}"

    try:
        university = db.query(University).filter(University.id == university_id).first()
        if not university:
            _update_db_progress(db, lock_name, {
                "status": "failed", "total_courses": 0, "scraped_courses": 0,
                "categories": {}, "jobs_created": [], "error": "University not found"
            })
            DistributedLockManager.release_lock(db, lock_name, worker_id=worker_id)
            return

        # 1. Parse the curriculum page
        logger.info(f"[ECTS Scraper] Fetching curriculum page: {ects_url}")
        soup = _fetch_page(ects_url)
        courses_by_category = _parse_curriculum_page(soup, ects_url)

        total = sum(len(v) for v in courses_by_category.values())
        cat_counts = {k: len(v) for k, v in courses_by_category.items() if v}

        _update_db_progress(db, lock_name, {
            "status": "running", "total_courses": total, "scraped_courses": 0,
            "categories": cat_counts, "jobs_created": []
        })

        if total == 0:
            _update_db_progress(db, lock_name, {
                "status": "failed", "total_courses": 0, "scraped_courses": 0,
                "categories": {}, "jobs_created": [], "error": "No courses found on the page. Check the URL."
            })
            DistributedLockManager.release_lock(db, lock_name, worker_id=worker_id)
            return

        # 2. For each category, download course texts and save as .txt
        semester = "unknown"
        jobs_created = []
        scraped_count = 0

        for category, course_list in courses_by_category.items():
            if not course_list:
                continue

            # Create upload directory
            upload_dir = os.path.join(settings.upload_dir, str(university_id), semester, category)
            os.makedirs(upload_dir, exist_ok=True)

            saved_filenames = []

            for course_code, course_name, detail_url, ects_val in course_list:
                try:
                    # Fetch course detail page
                    detail_soup = _fetch_page(detail_url)
                    course_text = _extract_course_text(detail_soup)

                    if not course_text or len(course_text) < 20:
                        continue

                    # Save as .txt
                    filename = f"{_sanitize_filename(course_name)}.txt"
                    filepath = os.path.join(upload_dir, filename)
                    with open(filepath, "w", encoding="utf-8") as f:
                        f.write(course_text)

                    saved_filenames.append(filename)
                    scraped_count += 1

                    # Update status progress & heartbeat
                    _update_db_progress(db, lock_name, {
                        "status": "running", "total_courses": total, "scraped_courses": scraped_count,
                        "categories": cat_counts, "jobs_created": jobs_created
                    })

                    # Be nice to the server
                    time.sleep(0.3)

                except Exception as e:
                    logger.error(f"[ECTS Scraper] Failed to scrape {course_name}: {e}")
                    continue

            # 3. Create upload job for this category
            if saved_filenames:
                batch = IngestionBatch(
                    university_id=university_id,
                    semester=semester,
                    status="pending",
                    total_courses=len(saved_filenames),
                )
                db.add(batch)
                db.commit()
                db.refresh(batch)

                job = UploadJob(
                    university_id=university_id,
                    ingestion_batch_id=batch.id,
                    semester=semester,
                    category=category,
                    status="queued",
                    total_files=len(saved_filenames),
                    processed_files=0,
                    failed_files=0,
                    file_manifest=saved_filenames,
                )
                db.add(job)
                db.commit()
                db.refresh(job)

                queue_manager.enqueue(job.id)
                jobs_created.append(job.id)

        # 4. Update university ingestion status
        university.ingestion_status = "parsing"
        db.commit()

        # Update to completed in the progress metadata before releasing the lock
        _update_db_progress(db, lock_name, {
            "status": "completed",
            "total_courses": total,
            "scraped_courses": scraped_count,
            "categories": cat_counts,
            "jobs_created": jobs_created
        })

    except Exception as e:
        logger.error(f"[ECTS Scraper] Fatal error: {e}")
        _update_db_progress(db, lock_name, {
            "status": "failed", "total_courses": 0, "scraped_courses": 0,
            "categories": {}, "jobs_created": [], "error": str(e)
        })
    finally:
        # Mark lock inactive to release it but preserve the state in the db row
        lock = db.query(SystemLock).filter(SystemLock.name == lock_name).first()
        if lock and lock.is_active:
            lock.is_active = False
            try:
                db.commit()
            except Exception:
                db.rollback()
        db.close()


# ---------------------------------------------------------------------------
# API Endpoints
# ---------------------------------------------------------------------------

@router.post("/universities/{university_id}/scrape-ects")
def scrape_ects(
    university_id: int,
    body: ScrapeRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    _user: User = Depends(require_role(["super_admin", "dept_admin", "coordinator"])),
):
    """
    Start scraping courses from the IKU ECTS catalog page.
    Runs in background. Poll /scrape-ects/status to track progress.
    """
    uni = db.query(University).filter(University.id == university_id).first()
    if not uni:
        raise HTTPException(status_code=404, detail="University not found")

    if not uni.is_home:
        raise HTTPException(status_code=400, detail="ECTS scraping is only available for the home university")

    # Validate URL
    parsed = urlparse(body.ects_url)
    if parsed.hostname != "akademikpaket.iku.edu.tr":
        raise HTTPException(status_code=400, detail="URL must be from akademikpaket.iku.edu.tr")

    if "ects=ders" not in body.ects_url:
        raise HTTPException(
            status_code=400,
            detail="URL must point to a Program Curriculum page (should contain ects=ders)"
        )

    lock_name = f"ects_scrape_uni_{university_id}"
    worker_id = f"scrape_worker_{university_id}"

    # Try acquiring distributed lock with 10-minute expiration
    acquired = DistributedLockManager.acquire_lock(
        db, lock_name, expire_seconds=600, worker_id=worker_id
    )
    if not acquired:
        raise HTTPException(status_code=409, detail="A scrape is already in progress for this university")

    # Initialize progress JSON in the database lock row
    initial_status = {
        "status": "running",
        "total_courses": 0,
        "scraped_courses": 0,
        "categories": {},
        "jobs_created": []
    }
    _update_db_progress(db, lock_name, initial_status)

    # Start background task
    background_tasks.add_task(_run_scrape_task, university_id, body.ects_url)

    return {
        "message": "ECTS scraping started",
        "university_id": university_id,
        "url": body.ects_url,
    }


@router.get("/universities/{university_id}/scrape-ects/status")
def scrape_ects_status(
    university_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(require_role(["super_admin", "dept_admin", "coordinator"])),
):
    """Get the current status of an ECTS scrape operation."""
    lock_name = f"ects_scrape_uni_{university_id}"
    lock = db.query(SystemLock).filter(SystemLock.name == lock_name).first()

    if not lock:
        return {
            "status": "idle",
            "total_courses": 0,
            "scraped_courses": 0,
            "categories": {},
            "jobs_created": []
        }

    # Lock worker_id contains our serialized JSON progress
    try:
        data = json.loads(lock.worker_id)
        # If lock expired/inactive, reflect the finalized status
        if not lock.is_active and data.get("status") == "running":
            data["status"] = "failed"
            data["error"] = "Process terminated unexpectedly."
        return data
    except Exception:
        # Fallback if parsing fails
        return {
            "status": "running" if lock.is_active else "idle",
            "total_courses": 0,
            "scraped_courses": 0,
            "categories": {},
            "jobs_created": []
        }

