"""Grade transfer engine — batch local→ECTS→IKU conversion.

Provides reusable functions for converting single or batch grades
using the grading_schemes + grade_conversion_rules + ects_iku_conversion chain.

When a transcript has pinned version IDs (grading_scheme_version_id, ects_iku_version_id),
conversions use the frozen snapshot data. Otherwise, they fall back to live tables.
"""
from sqlalchemy.orm import Session
from db.models import (
    GradingScheme, GradeConversionRule, EctsIkuConversion,
    GradingSchemeSnapshot, EctsIkuSnapshot,
)


def _match_numeric(local_grade: str, rules: list[GradeConversionRule]) -> str | None:
    """Try to match a numeric grade against range rules."""
    try:
        val = float(local_grade)
    except ValueError:
        return None

    for rule in rules:
        if rule.local_grade_exact:
            continue
        if rule.local_grade_min is not None and rule.local_grade_max is not None:
            try:
                lo = float(rule.local_grade_min)
                hi = float(rule.local_grade_max)
                if lo <= val <= hi:
                    return rule.ects_grade
            except ValueError:
                continue
    return None


def _match_exact(local_grade: str, rules: list[GradeConversionRule]) -> str | None:
    """Try to match a grade against exact-value rules (case-insensitive or numeric equivalence)."""
    normalized = local_grade.strip().lower()
    
    # Try numeric conversion for the input once
    input_val_float = None
    try:
        input_val_float = float(normalized.replace(',', '.'))
    except ValueError:
        pass

    for rule in rules:
        if not rule.local_grade_exact:
            continue
            
        rule_exact = rule.local_grade_exact.strip().lower()
        
        # 1. Direct string match
        if rule_exact == normalized:
            return rule.ects_grade
            
        # 2. Numeric equivalence match (e.g. "2" == "2.0")
        if input_val_float is not None:
            try:
                rule_val_float = float(rule_exact.replace(',', '.'))
                if input_val_float == rule_val_float:
                    return rule.ects_grade
            except ValueError:
                continue
                
    return None


def get_scheme_for_university(db: Session, university_id: int) -> GradingScheme | None:
    """Return the default active grading scheme for a university."""
    return db.query(GradingScheme).filter(
        GradingScheme.university_id == university_id,
        GradingScheme.is_active == True,
    ).first()


def ects_to_iku(db: Session, ects_grade: str) -> str | None:
    """Convert an ECTS grade to IKU using the fixed senate table."""
    row = db.query(EctsIkuConversion).filter(
        EctsIkuConversion.ects_grade == ects_grade,
        EctsIkuConversion.is_active == True,
    ).first()
    return row.iku_grade if row else None


def convert_single_grade(
    db: Session,
    local_grade: str,
    university_id: int | None,
    has_ects: bool = False,
) -> dict:
    """Convert a single grade.
    
    If has_ects is True, local_grade is treated as the ECTS grade string.
    Returns dict with conversion details or raises ValueError.
    """

    if has_ects:
        ects_val = local_grade.strip().upper() if local_grade else ""
        iku = ects_to_iku(db, ects_val)
        if iku is None:
            raise ValueError(f"No ECTS→IKU mapping for '{ects_val}'")
        return {
            "input_grade": ects_val,
            "ects_grade": ects_val,
            "iku_grade": iku,
            "conversion_method": "auto_ects",
        }

    # For local grade conversion, we MUST have a registered university and a scheme
    if university_id is None:
        raise ValueError("Cannot convert local grade: University is not registered in the system (Unknown). Please use ECTS mode or register the university first.")

    scheme = get_scheme_for_university(db, university_id)
    if not scheme:
        raise ValueError(f"No active grading scheme for university #{university_id}. Please use ECTS mode or define a scheme.")

    rules = scheme.rules
    ects = _match_numeric(local_grade, rules)
    if not ects:
        ects = _match_exact(local_grade, rules)
    if not ects:
        raise ValueError(
            f"No conversion rule matches '{local_grade}' in scheme '{scheme.name}'"
        )

    iku = ects_to_iku(db, ects)
    return {
        "input_grade": local_grade,
        "ects_grade": ects,
        "iku_grade": iku or "?",
        "conversion_method": "auto_local",
    }


def convert_batch_grades(
    db: Session,
    entries: list[dict],
    university_id: int | None,
) -> list[dict]:
    """Convert a batch of grade entries.

    Each entry dict should have:
      - local_grade: str (required)
      - ects_grade: str (optional, used if has_ects is True)
      - has_ects: bool (default False)
      - any additional fields are passed through

    Returns list of dicts with conversion results merged in.
    """
    scheme = get_scheme_for_university(db, university_id) if university_id else None

    results = []
    for entry in entries:
        has_ects = entry.get("has_ects", False)
        # Auto-detect ECTS mode if local_grade is missing but ects_grade is present
        if not entry.get("local_grade") and entry.get("ects_grade"):
            has_ects = True

        # If has_ects is true, we prefer the explicit ects_grade field,
        # falling back to local_grade if ects_grade is missing.
        if has_ects:
            input_val = entry.get("ects_grade") or entry.get("local_grade", "")
        else:
            input_val = entry.get("local_grade", "")

        input_val = str(input_val).strip()

        result = {**entry, "iku_grade": None, "ects_grade": None, "conversion_method": None, "error": None}

        if not input_val:
            result["error"] = "Empty grade"
            results.append(result)
            continue

        try:
            converted = convert_single_grade(db, input_val, university_id, has_ects)
            result["ects_grade"] = converted["ects_grade"]
            result["iku_grade"] = converted["iku_grade"]
            result["conversion_method"] = converted["conversion_method"]
        except ValueError as e:
            result["error"] = str(e)

        results.append(result)

    return results


# ── Snapshot-based conversion (pinned transcript versions) ──

def _match_numeric_vs_rules(local_grade: str, rules: list[dict]) -> str | None:
    """Try to match a numeric grade against frozen rules list."""
    try:
        val = float(local_grade)
    except ValueError:
        return None

    for rule in rules:
        if rule.get("local_grade_exact"):
            continue
        lo_str = rule.get("local_grade_min")
        hi_str = rule.get("local_grade_max")
        if lo_str is not None and hi_str is not None:
            try:
                lo = float(lo_str)
                hi = float(hi_str)
                if lo <= val <= hi:
                    return rule["ects_grade"]
            except (ValueError, TypeError):
                continue
    return None


def _match_exact_vs_rules(local_grade: str, rules: list[dict]) -> str | None:
    """Try to match a grade against frozen exact-value rules."""
    normalized = local_grade.strip().lower()

    input_val_float = None
    try:
        input_val_float = float(normalized.replace(',', '.'))
    except ValueError:
        pass

    for rule in rules:
        rule_exact = rule.get("local_grade_exact")
        if not rule_exact:
            continue
        rule_exact = rule_exact.strip().lower()

        # Direct string match
        if rule_exact == normalized:
            return rule["ects_grade"]

        # Numeric equivalence
        if input_val_float is not None:
            try:
                rule_val = float(rule_exact.replace(',', '.'))
                if input_val_float == rule_val:
                    return rule["ects_grade"]
            except (ValueError, TypeError):
                continue

    return None


def ects_to_iku_vs_mappings(ects_grade: str, mappings: list[dict]) -> str | None:
    """Convert ECTS grade to IKU using frozen mappings snapshot."""
    for m in mappings:
        if m.get("ects_grade") == ects_grade and m.get("is_active", True):
            return m.get("iku_grade")
    return None


def convert_single_grade_from_snapshot(
    local_grade: str,
    rules_snapshot: list[dict],
    ects_iku_mappings: list[dict],
    has_ects: bool = False,
) -> dict:
    """Convert a single grade using frozen snapshot data (not live tables).
    Raises ValueError if no match found.
    """

    if has_ects:
        ects_val = local_grade.strip().upper() if local_grade else ""
        iku = ects_to_iku_vs_mappings(ects_val, ects_iku_mappings)
        if iku is None:
            raise ValueError(f"No ECTS→IKU mapping for '{ects_val}'")
        return {
            "input_grade": ects_val,
            "ects_grade": ects_val,
            "iku_grade": iku,
            "conversion_method": "auto_ects",
        }

    ects = _match_numeric_vs_rules(local_grade, rules_snapshot)
    if not ects:
        ects = _match_exact_vs_rules(local_grade, rules_snapshot)
    if not ects:
        raise ValueError(
            f"No conversion rule matches '{local_grade}' in pinned scheme snapshot"
        )

    iku = ects_to_iku_vs_mappings(ects, ects_iku_mappings)
    return {
        "input_grade": local_grade,
        "ects_grade": ects,
        "iku_grade": iku or "?",
        "conversion_method": "auto_local",
    }


def convert_batch_grades_from_snapshot(
    entries: list[dict],
    rules_snapshot: list[dict],
    ects_iku_mappings: list[dict],
) -> list[dict]:
    """Convert a batch of grades using frozen snapshot data."""

    results = []
    for entry in entries:
        has_ects = entry.get("has_ects", False)
        if not entry.get("local_grade") and entry.get("ects_grade"):
            has_ects = True

        if has_ects:
            input_val = entry.get("ects_grade") or entry.get("local_grade", "")
        else:
            input_val = entry.get("local_grade", "")
        input_val = str(input_val).strip()

        result = {**entry, "iku_grade": None, "ects_grade": None, "conversion_method": None, "error": None}

        if not input_val:
            result["error"] = "Empty grade"
            results.append(result)
            continue

        try:
            converted = convert_single_grade_from_snapshot(
                input_val, rules_snapshot, ects_iku_mappings, has_ects
            )
            result["ects_grade"] = converted["ects_grade"]
            result["iku_grade"] = converted["iku_grade"]
            result["conversion_method"] = converted["conversion_method"]
        except ValueError as e:
            result["error"] = str(e)

        results.append(result)

    return results
