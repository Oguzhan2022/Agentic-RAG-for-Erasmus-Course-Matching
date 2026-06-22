"""
Course Embedding Pipeline using all-MiniLM-L6-v2 (local, 384 dim).

Generates embeddings for courses and stores them in pgvector.
"""

import numpy as np
from typing import Optional
from sqlalchemy.orm import Session

from db.models import Course


_model = None


def get_model():
    """Lazy-load the sentence-transformers model (cached after first call)."""
    global _model
    if _model is None:
        from sentence_transformers import SentenceTransformer
        _model = SentenceTransformer("all-MiniLM-L6-v2")
    return _model


def get_embedding_text(course: Course) -> str:
    """
    Build the text to embed for a course.
    Combines course_name, department, content, and learning_outcomes.
    """
    parts = []

    if course.course_name:
        parts.append(course.course_name)

    dept = (course.academic_context or {}).get("department")
    if dept and dept != "unknown":
        parts.append(dept)

    if course.content and course.content != "unknown":
        parts.append(course.content)

    if course.learning_outcomes and course.learning_outcomes != "unknown":
        parts.append(course.learning_outcomes)

    return "\n".join(parts) if parts else ""


def generate_embedding(text: str) -> Optional[list]:
    """
    Generate a 384-dim embedding for the given text using all-MiniLM-L6-v2.
    Returns None if text is empty.
    """
    if not text or not text.strip():
        return None

    model = get_model()
    embedding = model.encode(text, normalize_embeddings=True)
    return embedding.tolist()


def embed_course(course: Course, db: Session) -> bool:
    """
    Generate and store embedding for a single course.
    Returns True if embedding was generated, False if skipped.
    """
    text = get_embedding_text(course)
    if not text:
        return False

    embedding = generate_embedding(text)
    if embedding is None:
        return False

    course.embedding = embedding
    db.commit()
    return True


def embed_all_courses(db: Session, force: bool = False) -> dict:
    """
    Generate embeddings for all courses (or only those without one).

    Args:
        db: SQLAlchemy session
        force: If True, regenerate embeddings even if they exist

    Returns:
        dict with counts: total, embedded, skipped, failed
    """
    if force:
        courses = db.query(Course).all()
    else:
        courses = db.query(Course).filter(Course.embedding.is_(None)).all()

    total = len(courses)
    if total == 0:
        return {"total": 0, "embedded": 0, "skipped": 0, "failed": 0}

    # Batch encode for efficiency
    model = get_model()
    texts = []
    valid_courses = []

    for course in courses:
        text = get_embedding_text(course)
        if text:
            texts.append(text)
            valid_courses.append(course)

    skipped = total - len(valid_courses)

    if not texts:
        return {"total": total, "embedded": 0, "skipped": skipped, "failed": 0}

    # Batch encode all at once (much faster than one-by-one)
    embeddings = model.encode(texts, normalize_embeddings=True, show_progress_bar=True)

    embedded = 0
    failed = 0
    for course, embedding in zip(valid_courses, embeddings):
        try:
            course.embedding = embedding.tolist()
            embedded += 1
        except Exception:
            failed += 1

    db.commit()

    return {
        "total": total,
        "embedded": embedded,
        "skipped": skipped,
        "failed": failed,
    }


def embed_university_courses(university_id: int, db: Session, force: bool = False) -> dict:
    """
    Generate embeddings for all courses of a specific university (only those without one).

    Args:
        university_id: University to embed courses for
        db: SQLAlchemy session
        force: If True, regenerate even existing embeddings

    Returns:
        dict with counts: total, embedded, skipped, failed
    """
    if force:
        courses = db.query(Course).filter(Course.university_id == university_id).all()
    else:
        courses = db.query(Course).filter(
            Course.university_id == university_id,
            Course.embedding.is_(None),
        ).all()

    total = len(courses)
    if total == 0:
        return {"total": 0, "embedded": 0, "skipped": 0, "failed": 0}

    model = get_model()
    texts = []
    valid_courses = []

    for course in courses:
        text = get_embedding_text(course)
        if text:
            texts.append(text)
            valid_courses.append(course)

    skipped = total - len(valid_courses)
    if not texts:
        return {"total": total, "embedded": 0, "skipped": skipped, "failed": 0}

    embeddings = model.encode(texts, normalize_embeddings=True)

    embedded = 0
    failed = 0
    for course, embedding in zip(valid_courses, embeddings):
        try:
            course.embedding = embedding.tolist()
            embedded += 1
        except Exception:
            failed += 1

    db.commit()
    return {"total": total, "embedded": embedded, "skipped": skipped, "failed": failed}


def embed_single_course(course: Course, db: Session) -> bool:
    """
    (Re)generate embedding for a single course and commit.
    Returns True if embedding was generated.
    """
    text = get_embedding_text(course)
    if not text:
        return False
    model = get_model()
    embedding = model.encode(text, normalize_embeddings=True)
    course.embedding = embedding.tolist()
    db.commit()
    return True


def get_embedding_stats(db: Session) -> dict:
    """Get embedding statistics."""
    total = db.query(Course).count()
    with_embedding = db.query(Course).filter(Course.embedding.isnot(None)).count()
    without_embedding = total - with_embedding

    return {
        "total_courses": total,
        "with_embedding": with_embedding,
        "without_embedding": without_embedding,
        "coverage_percent": round((with_embedding / total * 100), 1) if total > 0 else 0,
    }
