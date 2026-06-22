"""
LLM Semantic Matching using LangChain (ChatGoogleGenerativeAI).

Evaluates content similarity, learning outcomes alignment, and domain compatibility.
Prompt construction + dict normalization kept manually; model calls delegate to llm_client.
"""

import os
import json
from pathlib import Path

from dotenv import load_dotenv

from db.models import Course
from matching.llm_client import llm_client
from matching.prompt_loader import load_prompt

load_dotenv()

PROMPTS_DIR = Path(__file__).parent / "prompts"


# ── Fallback / default results ────────────────────────────────────────────────

def _get_default_result(warnings: list = None) -> dict:
    """Return a neutral fallback result when the LLM call fails."""
    return {
        "domain_score": 50,
        "content_score": 50,
        "outcomes_score": 50,
        "academic_category": "technical",
        "matched_topics": [],
        "missing_topics": [],
        "domain_evidence": "Could not evaluate — LLM call failed",
        "content_evidence": "Could not evaluate — LLM call failed",
        "outcomes_evidence": "Could not evaluate — LLM call failed",
        "warnings": (warnings or []) + ["LLM semantic evaluation failed, using neutral scores"],
    }


def _get_default_batch_result(index: int, warnings: list = None) -> dict:
    """Return a neutral default for one candidate in a batch when LLM fails."""
    return {
        "candidate_index": index,
        "domain_score": 50,
        "content_score": 50,
        "outcomes_score": 50,
        "matched_topics": [],
        "missing_topics": [],
        "extra_partner_topics": [],
        "core_home_topics": [],
        "domain_evidence": "Could not evaluate — LLM call failed",
        "content_evidence": "Could not evaluate — LLM call failed",
        "outcomes_evidence": "Could not evaluate — LLM call failed",
        "structural_notes": [],
        "warnings": (warnings or []) + ["LLM semantic evaluation failed, using neutral scores"],
    }


VALID_CATEGORIES = (
    "technical", "social_science", "arts_design", "health",
    "natural_science", "business", "humanities", "interdisciplinary",
)


# ── Helpers ────────────────────────────────────────────────────────────────────

def _validate_category(cat: str) -> str:
    return cat if cat in VALID_CATEGORIES else "technical"


def _normalize_candidate_scores(cand: dict):
    for key in ["domain_score", "content_score", "outcomes_score"]:
        val = cand.get(key, 50)
        if not isinstance(val, (int, float)):
            val = 50
        cand[key] = max(0, min(100, val))


def _ensure_candidate_defaults(cand: dict):
    cand.setdefault("matched_topics", [])
    cand.setdefault("missing_topics", [])
    cand.setdefault("extra_partner_topics", [])
    cand.setdefault("core_home_topics", [])
    cand.setdefault("domain_evidence", "")
    cand.setdefault("content_evidence", "")
    cand.setdefault("outcomes_evidence", "")
    cand.setdefault("structural_notes", [])


def _check_content_warnings(partner_content, partner_outcomes,
                            home_content, home_outcomes) -> list:
    warnings = []
    if home_content == "unknown":
        warnings.append("Home course content unavailable")
    if home_outcomes == "unknown":
        warnings.append("Home course learning outcomes unavailable")
    if partner_content == "unknown":
        warnings.append("Partner course content unavailable")
    if partner_outcomes == "unknown":
        warnings.append("Partner course learning outcomes unavailable")
    return warnings


# ── Single-pair matching ───────────────────────────────────────────────────────
# (Note: semantic_match is deprecated. Use semantic_match_single_pair below.)


# ── Batch matching (single LLM call for top-3, used by find_best_matches_v2) ────

def semantic_match_single_call(partner_course: Course, home_candidates: list[Course]) -> dict:
    """Evaluate a partner course against up to 3 home candidates in ONE LLM call.

    Returns {"academic_category": str, "candidates": [dict, ...]}.
    """
    n = len(home_candidates)
    if n == 0:
        return {"academic_category": "technical", "candidates": []}

    padded = list(home_candidates) + [None] * (3 - n)

    partner_content = partner_course.content or "unknown"
    partner_outcomes = partner_course.learning_outcomes or "unknown"
    warnings_global = _check_content_warnings(
        partner_content, partner_outcomes, "present", "present"
    )
    # Filter duplicates from _check_content_warnings (only partner warnings apply)
    warnings_global = [w for w in warnings_global if "Home" not in w]

    def _course_field(c: Course | None, field: str) -> str:
        if c is None:
            return "N/A"
        if field in ("department", "level", "semester", "language"):
            val = (c.academic_context or {}).get(field) or "unknown"
        else:
            val = getattr(c, field, None) or "unknown"
        if isinstance(val, dict):
            return json.dumps(val)
        return str(val)

    template = load_prompt("semantic_match_batch_prompt_v2.txt")
    prompt = template

    prompt = prompt.replace("{partner_name}", partner_course.course_name or "Unknown")
    prompt = prompt.replace("{partner_department}", (partner_course.academic_context or {}).get("department") or "Unknown")
    prompt = prompt.replace("{partner_level}", (partner_course.academic_context or {}).get("level") or "unknown")
    prompt = prompt.replace("{partner_ects}", str(partner_course.ects or "unknown"))
    prompt = prompt.replace("{partner_content}", partner_content)
    prompt = prompt.replace("{partner_outcomes}", partner_outcomes)
    prompt = prompt.replace("{partner_academic_context}", json.dumps(partner_course.academic_context or {}))

    for i in range(1, 4):
        h = padded[i - 1]
        prompt = prompt.replace(f"{{home{i}_name}}", _course_field(h, "course_name"))
        prompt = prompt.replace(f"{{home{i}_department}}", _course_field(h, "department"))
        prompt = prompt.replace(f"{{home{i}_level}}", _course_field(h, "level"))
        prompt = prompt.replace(f"{{home{i}_ects}}", _course_field(h, "ects"))
        prompt = prompt.replace(f"{{home{i}_content}}", _course_field(h, "content"))
        prompt = prompt.replace(f"{{home{i}_outcomes}}", _course_field(h, "learning_outcomes"))
        prompt = prompt.replace(f"{{home{i}_academic_context}}", _course_field(h, "academic_context"))

    print(f"[SemanticScoring-Batch] Single call: partner '{partner_course.course_name}' "
          f"vs {n} candidates", flush=True)

    response_text = llm_client.invoke_with_retry(prompt, expected_key="candidates", context="SemanticScoring-Batch")
    if response_text is None:
        return {
            "academic_category": "technical",
            "candidates": [_get_default_batch_result(i + 1, warnings_global) for i in range(n)],
        }

    result = llm_client.extract_json(response_text, required_key="candidates")
    if result is None or "candidates" not in result:
        llm_client._log_failed_response("SemanticScoring-Batch", response_text)
        return {
            "academic_category": "technical",
            "candidates": [_get_default_batch_result(i + 1, warnings_global + ["Failed to parse LLM response"]) for i in range(n)],
        }

    cat = _validate_category(result.get("academic_category", "technical"))
    parsed_candidates = result.get("candidates", [])

    normalized = []
    for i in range(n):
        cand = next((c for c in parsed_candidates if c.get("candidate_index") == i + 1), None)
        if cand is None:
            cand = parsed_candidates[i] if i < len(parsed_candidates) else {}

        _normalize_candidate_scores(cand)
        _ensure_candidate_defaults(cand)

        llm_warnings = cand.get("warnings", [])
        cand["warnings"] = warnings_global + (llm_warnings if isinstance(llm_warnings, list) else [])
        cand["candidate_index"] = i + 1

        normalized.append(cand)

    return {"academic_category": cat, "candidates": normalized}


# ── Single-pair prompt (used by manual_analysis.py) ────────────────────────────

def semantic_match_single_pair(partner_course: Course, home_course: Course) -> dict:
    """Evaluate a single partner-home pair (v3-derived single-pair prompt).

    Returns a flat dict with all semantic scores + academic_category.
    """
    partner_content = partner_course.content or "unknown"
    partner_outcomes = partner_course.learning_outcomes or "unknown"

    warnings_global = []
    if partner_content == "unknown":
        warnings_global.append("Partner course content unavailable")
    if partner_outcomes == "unknown":
        warnings_global.append("Partner course learning outcomes unavailable")

    def _f(c: Course, field: str) -> str:
        if field in ("department", "level", "semester", "language"):
            val = (c.academic_context or {}).get(field) or "unknown"
        else:
            val = getattr(c, field, None) or "unknown"
        if isinstance(val, dict):
            return json.dumps(val)
        return str(val)

    template = load_prompt("semantic_match_single_prompt_v1.txt")
    prompt = template

    prompt = prompt.replace("{partner_name}", partner_course.course_name or "Unknown")
    prompt = prompt.replace("{partner_department}", (partner_course.academic_context or {}).get("department") or "Unknown")
    prompt = prompt.replace("{partner_level}", (partner_course.academic_context or {}).get("level") or "unknown")
    prompt = prompt.replace("{partner_ects}", str(partner_course.ects or "unknown"))
    prompt = prompt.replace("{partner_content}", partner_content)
    prompt = prompt.replace("{partner_outcomes}", partner_outcomes)
    prompt = prompt.replace("{partner_academic_context}", json.dumps(partner_course.academic_context or {}))

    prompt = prompt.replace("{home1_name}", _f(home_course, "course_name"))
    prompt = prompt.replace("{home1_department}", _f(home_course, "department"))
    prompt = prompt.replace("{home1_level}", _f(home_course, "level"))
    prompt = prompt.replace("{home1_ects}", _f(home_course, "ects"))
    prompt = prompt.replace("{home1_content}", _f(home_course, "content"))
    prompt = prompt.replace("{home1_outcomes}", _f(home_course, "learning_outcomes"))
    prompt = prompt.replace("{home1_academic_context}", _f(home_course, "academic_context"))

    print(f"[SemanticScoring-Single] partner='{partner_course.course_name}' "
          f"home='{home_course.course_name}'", flush=True)

    response_text = llm_client.invoke_with_retry(prompt, expected_key="candidates", context="SemanticScoring-Single")
    if response_text is None:
        default = _get_default_batch_result(1, warnings_global)
        default["academic_category"] = "technical"
        return default

    result = llm_client.extract_json(response_text, required_key="candidates")
    if result is None or not result.get("candidates"):
        llm_client._log_failed_response("SemanticScoring-Single", response_text)
        default = _get_default_batch_result(1, warnings_global + ["Failed to parse LLM response"])
        default["academic_category"] = "technical"
        return default

    cat = _validate_category(result.get("academic_category", "technical"))

    cand = result["candidates"][0]
    _normalize_candidate_scores(cand)
    _ensure_candidate_defaults(cand)

    llm_warnings = cand.get("warnings", [])
    cand["warnings"] = warnings_global + (llm_warnings if isinstance(llm_warnings, list) else [])
    cand["academic_category"] = cat

    return cand
