"""
Course Retrieval Pipeline using pgvector cosine similarity.

Finds similar courses based on embedding distance.
"""

from typing import Optional
from sqlalchemy.orm import Session
from sqlalchemy import text

from db.models import Course
from retrieval.embedder import generate_embedding, get_embedding_text


def find_similar_courses(
    course_id: int,
    db: Session,
    top_k: int = 3,
    exclude_university_id: Optional[int] = None,
    partner_university_id: Optional[int] = None,
    level_filter: Optional[str] = None,
    ects_min: Optional[float] = None,
    ects_max: Optional[float] = None,
) -> list[dict]:
    """
    Find top-k similar courses using pgvector cosine distance.

    Args:
        course_id: Source course ID
        db: SQLAlchemy session
        top_k: Number of results to return
        exclude_university_id: Exclude courses from this university (self-match filter)
        partner_university_id: Only search within this university
        level_filter: Filter by level (bachelor/master)
        ects_min/ects_max: Filter by ECTS range

    Returns:
        List of dicts with course info and distance score
    """
    source_course = db.query(Course).filter(Course.id == course_id).first()
    if not source_course:
        return []

    if source_course.embedding is None:
        return []

    # Build query with filters
    conditions = ["c.embedding IS NOT NULL", "c.id != :source_id", "c.is_active IS TRUE", "u.is_active IS TRUE"]
    params = {"source_id": course_id, "top_k": top_k}

    if exclude_university_id:
        conditions.append("c.university_id != :exclude_uni_id")
        params["exclude_uni_id"] = exclude_university_id

    if partner_university_id:
        conditions.append("c.university_id = :partner_uni_id")
        params["partner_uni_id"] = partner_university_id

    if level_filter:
        conditions.append("c.academic_context->>'level' = :level_filter")
        params["level_filter"] = level_filter

    if ects_min is not None:
        conditions.append("c.ects >= :ects_min")
        params["ects_min"] = ects_min

    if ects_max is not None:
        conditions.append("c.ects <= :ects_max")
        params["ects_max"] = ects_max

    where_clause = " AND ".join(conditions)

    # pgvector cosine distance query (<=> operator)
    query = text(f"""
        SELECT c.id, c.course_name, c.course_code, 
               COALESCE(c.academic_context->>'department', '') AS department, c.ects,
               COALESCE(c.academic_context->>'level', '') AS level,
               COALESCE(c.academic_context->>'semester', '') AS semester,
               COALESCE(c.academic_context->>'language', '') AS language,
               c.university_id,
               c.content, c.learning_outcomes, c.academic_context,
               c.metadata_quality, c.warnings,
               c.embedding <=> (SELECT embedding FROM courses WHERE id = :source_id) AS distance
        FROM courses c
        JOIN universities u ON c.university_id = u.id
        WHERE {where_clause}
        ORDER BY distance ASC
        LIMIT :top_k
    """)

    results = db.execute(query, params).fetchall()

    return [
        {
            "id": row.id,
            "course_name": row.course_name,
            "course_code": row.course_code,
            "department": row.department,
            "ects": row.ects,
            "level": row.level,
            "semester": row.semester,
            "language": row.language,
            "university_id": row.university_id,
            "content": row.content,
            "learning_outcomes": row.learning_outcomes,
            "academic_context": row.academic_context,
            "metadata_quality": row.metadata_quality,
            "warnings": row.warnings,
            "distance": float(row.distance),
            "similarity": round(1.0 - float(row.distance), 4),
        }
        for row in results
    ]


def search_by_text(
    query_text: str,
    db: Session,
    top_k: int = 3,
    university_id: Optional[int] = None,
    level_filter: Optional[str] = None,
) -> list[dict]:
    """
    Search for courses similar to a free-text query.

    Args:
        query_text: Text to search for
        db: SQLAlchemy session
        top_k: Number of results
        university_id: Filter by university
        level_filter: Filter by level

    Returns:
        List of matching courses with similarity scores
    """
    query_embedding = generate_embedding(query_text)
    if query_embedding is None:
        return []

    conditions = ["c.embedding IS NOT NULL", "c.is_active IS TRUE", "u.is_active IS TRUE"]
    params = {"top_k": top_k, "query_embedding": str(query_embedding)}

    if university_id:
        conditions.append("c.university_id = :uni_id")
        params["uni_id"] = university_id

    if level_filter:
        conditions.append("c.academic_context->>'level' = :level_filter")
        params["level_filter"] = level_filter

    where_clause = " AND ".join(conditions)

    query = text(f"""
        SELECT c.id, c.course_name, c.course_code, 
               COALESCE(c.academic_context->>'department', '') AS department, c.ects,
               COALESCE(c.academic_context->>'level', '') AS level,
               COALESCE(c.academic_context->>'semester', '') AS semester,
               COALESCE(c.academic_context->>'language', '') AS language,
               c.university_id,
               c.embedding <=> :query_embedding::vector AS distance
        FROM courses c
        JOIN universities u ON c.university_id = u.id
        WHERE {where_clause}
        ORDER BY distance ASC
        LIMIT :top_k
    """)

    results = db.execute(query, params).fetchall()

    return [
        {
            "id": row.id,
            "course_name": row.course_name,
            "course_code": row.course_code,
            "department": row.department,
            "ects": row.ects,
            "level": row.level,
            "semester": row.semester,
            "language": row.language,
            "university_id": row.university_id,
            "distance": float(row.distance),
            "similarity": round(1.0 - float(row.distance), 4),
        }
        for row in results
    ]
