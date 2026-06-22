"""
Hybrid Match Fusion Engine.

Combines deterministic scores (ECTS, title, metadata, level, semester)
with LLM semantic scores (domain, content, outcomes) using category-based
weight profiles (technical, social, studio_based).

Use case: Student goes to partner university, takes a partner course.
Question: Which HOME (IKU) course does this partner course correspond to?

Pipeline:
1. Take partner course, find top-10 similar HOME courses via embedding
2. Deterministic scoring (fast, all 10)
3. Pre-filter to top-3 by combined score
4. LLM semantic scoring (slow, only top-3)
5. Hybrid fusion with category weights
6. Final ranked list with score breakdown + evidence + warnings
"""

import json
from pathlib import Path
from typing import Optional
from dataclasses import dataclass, field, asdict

from sqlalchemy.orm import Session

from db.models import Course
from retrieval.search import find_similar_courses
from matching.deterministic_scoring import compute_deterministic_scores
from matching.semantic_scoring import semantic_match_single_call, semantic_match_single_pair


PROFILES_PATH = Path(__file__).parent / "category_profiles.json"


_profiles_cache = None

def _load_profiles() -> dict:
    """Load category weight profiles (cached)."""
    global _profiles_cache
    if _profiles_cache is None:
        with open(PROFILES_PATH, "r", encoding="utf-8") as f:
            _profiles_cache = json.load(f)
    return _profiles_cache


@dataclass
class MatchResult:
    """Complete match result with all scoring components.

    Represents a home course candidate that matches a given partner course.
    """
    home_course_id: int
    home_course_name: str
    home_university_id: int
    overall_score: float = 0.0
    embedding_similarity: float = 0.0
    deterministic_scores: dict = field(default_factory=dict)
    semantic_scores: dict = field(default_factory=dict)
    score_breakdown: dict = field(default_factory=dict)
    matched_topics: list = field(default_factory=list)
    missing_topics: list = field(default_factory=list)
    extra_partner_topics: list = field(default_factory=list)
    core_home_topics: list = field(default_factory=list)
    structural_notes: list = field(default_factory=list)
    warnings: list = field(default_factory=list)
    category: str = "technical"

    def to_dict(self) -> dict:
        return asdict(self)


def _compute_fusion_score(
    det_scores: dict,
    sem_scores: dict,
    profile: dict,
) -> tuple[float, dict]:
    """
    Combine deterministic and semantic scores using category weights.

    Returns (overall_score, score_breakdown dict).
    """
    # Normalize semantic scores from 0-100 to 0-1
    content_score = sem_scores.get("content_score", 50) / 100
    outcomes_score = sem_scores.get("outcomes_score", 50) / 100
    domain_score = sem_scores.get("domain_score", 50) / 100

    # Get deterministic component scores
    ects_score = det_scores["ects"]["score"]
    title_score = det_scores["title"]["score"]
    metadata_score = det_scores["metadata"]["score"]

    # Get weights from profile
    content_w = profile.get("content_weight", 0.35)
    outcomes_w = profile.get("outcomes_weight", 0.25)
    domain_w = profile.get("domain_weight", 0.15)
    ects_w = profile.get("ects_weight", 0.10)
    metadata_w = profile.get("metadata_weight", 0.10)
    title_w = profile.get("title_weight", 0.05)

    # Weighted sum
    overall = (
        content_score * content_w
        + outcomes_score * outcomes_w
        + domain_score * domain_w
        + ects_score * ects_w
        + metadata_score * metadata_w
        + title_score * title_w
    )

    # Build breakdown
    breakdown = {
        "content": {
            "score": round(content_score, 4),
            "weight": content_w,
            "weighted": round(content_score * content_w, 4),
            "evidence": sem_scores.get("content_evidence", ""),
        },
        "outcomes": {
            "score": round(outcomes_score, 4),
            "weight": outcomes_w,
            "weighted": round(outcomes_score * outcomes_w, 4),
            "evidence": sem_scores.get("outcomes_evidence", ""),
        },
        "domain": {
            "score": round(domain_score, 4),
            "weight": domain_w,
            "weighted": round(domain_score * domain_w, 4),
            "evidence": sem_scores.get("domain_evidence", ""),
        },
        "ects": {
            "score": round(ects_score, 4),
            "weight": ects_w,
            "weighted": round(ects_score * ects_w, 4),
            "evidence": det_scores["ects"]["evidence"],
        },
        "metadata": {
            "score": round(metadata_score, 4),
            "weight": metadata_w,
            "weighted": round(metadata_score * metadata_w, 4),
            "evidence": det_scores["metadata"]["evidence"],
        },
        "title": {
            "score": round(title_score, 4),
            "weight": title_w,
            "weighted": round(title_score * title_w, 4),
            "evidence": det_scores["title"]["evidence"],
        },
    }

    return round(overall, 4), breakdown


def compute_match(
    partner_course: Course,
    home_course: Course,
    category: str = None,
) -> MatchResult:
    """
    Compute full match score between a partner course and a home course.

    Use case: partner_course is what the student takes abroad,
    home_course is the IKU equivalent candidate.

    Combines deterministic + semantic scoring with category weights.
    Category is auto-detected by LLM if not provided.
    """
    profiles = _load_profiles()

    # Deterministic scoring (fast)
    det_scores = compute_deterministic_scores(home_course, partner_course)

    # Semantic scoring (LLM call, slow) — also detects academic_category
    sem_scores = semantic_match_single_pair(partner_course, home_course)

    # Use LLM-detected category, or fallback to provided/default
    detected_category = sem_scores.get("academic_category", "technical")
    effective_category = category or detected_category
    profile = profiles.get(effective_category, profiles["technical"])

    # Fusion
    overall, breakdown = _compute_fusion_score(det_scores, sem_scores, profile)

    # Combine all warnings
    all_warnings = det_scores["all_warnings"] + sem_scores.get("warnings", [])

    return MatchResult(
        home_course_id=home_course.id,
        home_course_name=home_course.course_name,
        home_university_id=home_course.university_id,
        overall_score=overall,
        deterministic_scores={
            k: v for k, v in det_scores.items() if k != "all_warnings"
        },
        semantic_scores={
            k: v for k, v in sem_scores.items()
            if k not in ("warnings",)
        },
        score_breakdown=breakdown,
        matched_topics=sem_scores.get("matched_topics", []),
        missing_topics=sem_scores.get("missing_topics", []),
        warnings=all_warnings,
        category=effective_category,
    )





def find_best_matches_v2(
    partner_course: Course,
    home_university_id: int,
    category: str = None,
    top_k: int = 3,
    db: Session = None,
) -> list[MatchResult]:
    """
    Batch-LLM variant of find_best_matches.

    Same pipeline as find_best_matches() but uses a SINGLE LLM call for all
    top-k candidates instead of one call per candidate.

    Pipeline:
    1. Embedding retrieval: top-10 similar HOME courses
    2. Deterministic scoring (all 10, fast)
    3. Pre-filter to top-k by combined score
    4. ONE LLM call for all top-k candidates (batch prompt)
    5. Hybrid fusion with category weights
    6. Final ranked list
    """
    if not db:
        raise ValueError("Database session required")

    if partner_course.embedding is None:
        print(f"[FusionEngine-V2] Warning: partner course {partner_course.id} has no embedding", flush=True)
        return []

    profiles = _load_profiles()

    # Step 1: Embedding retrieval
    retrieval_top_k = max(top_k * 3, 10)
    candidates = find_similar_courses(
        course_id=partner_course.id,
        db=db,
        top_k=retrieval_top_k,
        partner_university_id=home_university_id,
    )

    if not candidates:
        return []

    # Step 2: Deterministic scoring for all candidates
    scored_candidates = []
    for cand in candidates:
        home_course = db.query(Course).filter(Course.id == cand["id"]).first()
        if not home_course:
            continue

        det_scores = compute_deterministic_scores(home_course, partner_course)

        det_avg = (
            det_scores["ects"]["score"]
            + det_scores["title"]["score"]
            + det_scores["metadata"]["score"]
            + det_scores["level"]["score"]
            + det_scores["semester"]["score"]
        ) / 5

        scored_candidates.append({
            "course": home_course,
            "det_scores": det_scores,
            "det_avg": det_avg,
            "embedding_similarity": cand["similarity"],
        })

    # Step 3: Pre-filter to top-k
    scored_candidates.sort(
        key=lambda x: x["embedding_similarity"] * 0.6 + x["det_avg"] * 0.4,
        reverse=True,
    )
    top_candidates = scored_candidates[:top_k]

    # Step 4: ONE batch LLM call for all top-k candidates
    home_courses = [c["course"] for c in top_candidates]
    batch_result = semantic_match_single_call(partner_course, home_courses)

    detected_category = batch_result.get("academic_category", "technical")
    effective_category = category or detected_category
    profile = profiles.get(effective_category, profiles["technical"])

    # Step 5: Fusion for each candidate
    results = []
    candidate_scores = batch_result.get("candidates", [])

    for i, cand in enumerate(top_candidates):
        home_course = cand["course"]
        det_scores = cand["det_scores"]

        # Get this candidate's semantic scores from batch result
        if i < len(candidate_scores):
            sem_scores = candidate_scores[i]
        else:
            sem_scores = {
                "domain_score": 50, "content_score": 50, "outcomes_score": 50,
                "domain_evidence": "", "content_evidence": "", "outcomes_evidence": "",
                "matched_topics": [], "missing_topics": [], "warnings": [],
            }

        overall, breakdown = _compute_fusion_score(det_scores, sem_scores, profile)

        all_warnings = det_scores["all_warnings"] + sem_scores.get("warnings", [])

        result = MatchResult(
            home_course_id=home_course.id,
            home_course_name=home_course.course_name,
            home_university_id=home_course.university_id,
            overall_score=overall,
            embedding_similarity=cand["embedding_similarity"],
            deterministic_scores={
                k: v for k, v in det_scores.items() if k != "all_warnings"
            },
            semantic_scores={
                k: v for k, v in sem_scores.items()
                if k not in ("warnings", "candidate_index")
            },
            score_breakdown=breakdown,
            matched_topics=sem_scores.get("matched_topics", []),
            missing_topics=sem_scores.get("missing_topics", []),
            extra_partner_topics=sem_scores.get("extra_partner_topics", []),
            core_home_topics=sem_scores.get("core_home_topics", []),
            structural_notes=sem_scores.get("structural_notes", []),
            warnings=all_warnings,
            category=effective_category,
        )
        results.append(result)

    # Step 6: Final sort
    results.sort(key=lambda r: r.overall_score, reverse=True)

    return results
