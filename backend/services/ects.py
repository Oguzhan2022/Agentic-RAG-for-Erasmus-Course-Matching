"""Shared helpers for computing home-side ECTS totals on a student application.

Partner ECTS is derived from the partner course attached to each selection row
and is handled inline in the routers (and in workflow.check_learning_agreement).
Home ECTS, however, lives across three JSON columns on
``StudentCourseSelection`` (student selections, student-suggested alternatives,
and coordinator overrides), so the logic is centralised here.
"""

from typing import Iterable, Sequence, Tuple

from sqlalchemy.orm import Session

from db.models import Course, StudentCourseSelection


# Selection statuses that we treat as "still in the running" for ECTS totals.
_ACTIVE_STATUSES = {
    "draft_selected",
    "submitted_for_review",
    "approved",
    "manual_review_required",
    "reviewed",
}

# Statuses that represent a concretely approved selection (home side).
_APPROVED_STATUSES = {"approved"}


def has_review_requests(selections: Iterable[StudentCourseSelection]) -> bool:
    """True when at least one non-rejected selection has ``no_match_requested``.

    Review-request rows have no home course attached, so the home ECTS target
    cannot be met and must be skipped.
    """
    for sel in selections:
        if sel.status == "rejected":
            continue
        if sel.no_match_requested:
            return True
    return False


def _collect_home_course_ids(
    sel: StudentCourseSelection, include_override: bool = True
) -> set[int]:
    ids: set[int] = set()
    has_override = include_override and bool(sel.coordinator_override_course_ids)
    if has_override:
        # Override replaces student selection — only count override courses
        ids.update(sel.coordinator_override_course_ids)
    else:
        if sel.selected_home_course_ids:
            ids.update(sel.selected_home_course_ids)
    if sel.alternative_home_course_ids:
        ids.update(sel.alternative_home_course_ids)
    return ids


def _sum_ects(db: Session, course_ids: Iterable[int], ignore_active: bool = False) -> float:
    ids = list({i for i in course_ids if i})
    if not ids:
        return 0.0
    
    query = db.query(Course.ects).filter(Course.id.in_(ids))
    if not ignore_active:
        query = query.filter(Course.is_active == True)
        
    rows = query.all()
    return float(sum(r[0] or 0 for r in rows))


def compute_home_ects(
    db: Session, selections: Sequence[StudentCourseSelection], ignore_active: bool = False
) -> Tuple[float, float]:
    """Return ``(total_home_ects, approved_home_ects)`` for a set of selections.

    - ``total``: sum of distinct home course ECTS across all non-rejected,
      active-or-suggesting rows (selections + suggestions + overrides).
    - ``approved``: sum of distinct home course ECTS on rows that are either
      ``approved`` or carry a coordinator override (which is an implicit
      approval path).
    """
    active_ids: set[int] = set()
    approved_ids: set[int] = set()

    for sel in selections:
        if sel.status == "not_selected":
            continue
        if sel.no_match_requested:
            continue  # review-request rows have no home course yet

        home_ids = _collect_home_course_ids(sel, include_override=True)
        has_home = bool(home_ids)
        is_active = (
            sel.status in _ACTIVE_STATUSES
            or sel.status == "rejected"
            or bool(sel.alternative_home_course_ids)
            or bool(sel.coordinator_override_course_ids)
        )
        if has_home and is_active:
            active_ids.update(home_ids)

        is_approved_row = (
            sel.status in _APPROVED_STATUSES
            or bool(sel.coordinator_override_course_ids)
        )
        if has_home and is_approved_row:
            approved_ids.update(home_ids)

    total = _sum_ects(db, active_ids, ignore_active=ignore_active)
    approved = _sum_ects(db, approved_ids, ignore_active=ignore_active)
    return total, approved
