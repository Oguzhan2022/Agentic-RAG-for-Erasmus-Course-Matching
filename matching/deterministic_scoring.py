"""
Deterministic Scoring Engine for course matching.

Handles: ECTS, title similarity, metadata alignment, level, semester.
All scores return {score, evidence, warnings} dicts.

Key rules:
- unknown != false: unknown = no penalty + warning, false = actual absence
- Lab/exam/project are secondary factors, never blocking
- Scores degrade gracefully with missing data
"""

from difflib import SequenceMatcher
from typing import Optional


def ects_score(home_ects: Optional[float], partner_ects: Optional[float]) -> dict:
    """
    ECTS difference scoring.

    Scoring:
        0 diff -> 1.0
        1 diff -> 0.9
        2 diff -> 0.7
        3+ diff -> 0.4
        Unknown -> 0.5 + warning
    """
    warnings = []

    if home_ects is None and partner_ects is None:
        return {
            "score": 0.5,
            "evidence": "Both ECTS values are unknown",
            "warnings": ["Both home and partner ECTS unknown"],
        }

    if home_ects is None:
        return {
            "score": 0.5,
            "evidence": f"Home ECTS unknown, partner ECTS is {partner_ects}",
            "warnings": ["Home course ECTS unknown"],
        }

    if partner_ects is None:
        return {
            "score": 0.5,
            "evidence": f"Home ECTS is {home_ects}, partner ECTS unknown",
            "warnings": ["Partner course ECTS unknown"],
        }

    diff = abs(home_ects - partner_ects)

    if diff == 0:
        score = 1.0
        evidence = f"ECTS match exactly ({home_ects})"
    elif diff <= 1:
        score = 0.9
        evidence = f"ECTS difference is {diff} (home: {home_ects}, partner: {partner_ects})"
        warnings.append("Minor ECTS difference")
    elif diff <= 2:
        score = 0.7
        evidence = f"ECTS difference is {diff} (home: {home_ects}, partner: {partner_ects})"
        warnings.append("Moderate ECTS difference")
    else:
        score = 0.4
        evidence = f"Large ECTS difference of {diff} (home: {home_ects}, partner: {partner_ects})"
        warnings.append(f"Significant ECTS difference ({diff})")

    return {"score": score, "evidence": evidence, "warnings": warnings}


def title_similarity_score(home_name: str, partner_name: str) -> dict:
    """
    Course name similarity using SequenceMatcher.
    This is a LOW-WEIGHT factor — matching should be content-based, not name-based.
    """
    warnings = []

    if not home_name or not partner_name:
        return {
            "score": 0.0,
            "evidence": "One or both course names are empty",
            "warnings": ["Course name missing for comparison"],
        }

    # Normalize: lowercase, strip
    home_norm = home_name.lower().strip()
    partner_norm = partner_name.lower().strip()

    ratio = SequenceMatcher(None, home_norm, partner_norm).ratio()

    if ratio > 0.8:
        evidence = f"Course names are very similar: '{home_name}' vs '{partner_name}'"
    elif ratio > 0.5:
        evidence = f"Course names share some similarity: '{home_name}' vs '{partner_name}'"
    else:
        evidence = f"Course names differ significantly: '{home_name}' vs '{partner_name}'"

    return {"score": round(ratio, 4), "evidence": evidence, "warnings": warnings}


def metadata_alignment_score(home_ctx: Optional[dict], partner_ctx: Optional[dict]) -> dict:
    """
    Academic context alignment scoring.

    Compares: primary_format, assessment_mode, lab/project/seminar status.

    Rules:
    - unknown vs anything = no penalty + warning
    - true vs false = minor penalty (secondary factor)
    - matching values = bonus
    """
    warnings = []

    if not home_ctx and not partner_ctx:
        return {
            "score": 0.5,
            "evidence": "No academic context available for either course",
            "warnings": ["Academic context unavailable for both courses"],
        }

    home_ctx = home_ctx or {}
    partner_ctx = partner_ctx or {}

    sub_scores = []

    # Format alignment
    home_formats = set(home_ctx.get("primary_format", []))
    partner_formats = set(partner_ctx.get("primary_format", []))
    home_formats.discard("unknown")
    partner_formats.discard("unknown")

    if not home_formats and not partner_formats:
        sub_scores.append(0.5)
        warnings.append("Teaching format unknown for both courses")
    elif not home_formats or not partner_formats:
        sub_scores.append(0.5)
        warnings.append("Teaching format unknown for one course")
    else:
        overlap = len(home_formats & partner_formats)
        total = len(home_formats | partner_formats)
        sub_scores.append(overlap / total if total > 0 else 0.5)

    # Assessment mode alignment
    home_assess = set(home_ctx.get("assessment_mode", []))
    partner_assess = set(partner_ctx.get("assessment_mode", []))
    home_assess.discard("unknown")
    partner_assess.discard("unknown")

    if not home_assess and not partner_assess:
        sub_scores.append(0.5)
        warnings.append("Assessment mode unknown for both courses")
    elif not home_assess or not partner_assess:
        sub_scores.append(0.5)
        warnings.append("Assessment mode unknown for one course")
    else:
        overlap = len(home_assess & partner_assess)
        total = len(home_assess | partner_assess)
        sub_scores.append(overlap / total if total > 0 else 0.5)

    # Lab/Project/Seminar status
    for field in ["lab_status", "project_status", "seminar_status"]:
        home_val = home_ctx.get(field, "unknown")
        partner_val = partner_ctx.get(field, "unknown")
        field_name = field.replace("_status", "").capitalize()

        if home_val == "unknown" or partner_val == "unknown":
            sub_scores.append(0.5)
            if home_val == "unknown" and partner_val == "unknown":
                warnings.append(f"{field_name} status unknown for both courses")
            elif home_val == "unknown":
                warnings.append(f"{field_name} status unknown for home course")
            else:
                warnings.append(f"{field_name} status unknown for partner course")
        elif home_val == partner_val:
            sub_scores.append(1.0)
        else:
            # Mismatch is a minor penalty (secondary factor, NOT blocking)
            sub_scores.append(0.6)
            warnings.append(f"{field_name} mismatch: home={home_val}, partner={partner_val}")

    score = sum(sub_scores) / len(sub_scores) if sub_scores else 0.5

    evidence_parts = []
    if home_formats and partner_formats:
        common = home_formats & partner_formats
        if common:
            evidence_parts.append(f"Shared formats: {', '.join(common)}")
    if home_assess and partner_assess:
        common = home_assess & partner_assess
        if common:
            evidence_parts.append(f"Shared assessment: {', '.join(common)}")

    evidence = ". ".join(evidence_parts) if evidence_parts else "Limited metadata available for comparison"

    return {"score": round(score, 4), "evidence": evidence, "warnings": warnings}


def level_match_score(home_level: Optional[str], partner_level: Optional[str]) -> dict:
    """
    Academic level matching.

    Same level -> 1.0
    Different level -> 0.6
    Unknown -> 0.8 + warning
    """
    warnings = []

    home_level = (home_level or "unknown").lower()
    partner_level = (partner_level or "unknown").lower()

    if home_level == "unknown" or partner_level == "unknown":
        if home_level == "unknown" and partner_level == "unknown":
            warnings.append("Academic level unknown for both courses")
        elif home_level == "unknown":
            warnings.append("Home course level unknown")
        else:
            warnings.append("Partner course level unknown")
        return {
            "score": 0.8,
            "evidence": f"Level comparison uncertain (home: {home_level}, partner: {partner_level})",
            "warnings": warnings,
        }

    if home_level == partner_level:
        return {
            "score": 1.0,
            "evidence": f"Both courses are {home_level} level",
            "warnings": [],
        }

    return {
        "score": 0.6,
        "evidence": f"Level mismatch: home is {home_level}, partner is {partner_level}",
        "warnings": [f"Level mismatch ({home_level} vs {partner_level})"],
    }


def semester_compatibility(home_sem: Optional[str], partner_sem: Optional[str]) -> dict:
    """
    Semester compatibility scoring.

    Both 'both' or same -> 1.0
    Different -> 0.7
    Unknown -> 0.8 + warning
    """
    warnings = []

    home_sem = (home_sem or "unknown").lower()
    partner_sem = (partner_sem or "unknown").lower()

    if home_sem == "unknown" or partner_sem == "unknown":
        return {
            "score": 0.8,
            "evidence": f"Semester comparison uncertain (home: {home_sem}, partner: {partner_sem})",
            "warnings": ["Semester information unavailable for one or both courses"],
        }

    if home_sem == "both" or partner_sem == "both":
        return {
            "score": 1.0,
            "evidence": "Course available in both semesters",
            "warnings": [],
        }

    if home_sem == partner_sem:
        return {
            "score": 1.0,
            "evidence": f"Both courses offered in {home_sem} semester",
            "warnings": [],
        }

    return {
        "score": 0.7,
        "evidence": f"Different semesters: home={home_sem}, partner={partner_sem}",
        "warnings": [f"Semester mismatch ({home_sem} vs {partner_sem})"],
    }


def compute_deterministic_scores(home_course, partner_course) -> dict:
    """
    Compute all deterministic scores for a course pair.

    Returns dict with individual component scores and combined deterministic score.
    """
    ects = ects_score(home_course.ects, partner_course.ects)
    title = title_similarity_score(home_course.course_name, partner_course.course_name)
    metadata = metadata_alignment_score(
        home_course.academic_context, partner_course.academic_context
    )
    level = level_match_score(
        (home_course.academic_context or {}).get("level"),
        (partner_course.academic_context or {}).get("level"),
    )
    semester = semester_compatibility(
        (home_course.academic_context or {}).get("semester"),
        (partner_course.academic_context or {}).get("semester"),
    )

    # Combine all warnings
    all_warnings = (
        ects["warnings"]
        + title["warnings"]
        + metadata["warnings"]
        + level["warnings"]
        + semester["warnings"]
    )

    return {
        "ects": ects,
        "title": title,
        "metadata": metadata,
        "level": level,
        "semester": semester,
        "all_warnings": all_warnings,
    }
