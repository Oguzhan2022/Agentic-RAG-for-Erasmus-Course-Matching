"""Versioning service — snapshot grading schemes and ECTS-IKU mappings."""

from sqlalchemy.orm import Session
from db.models import GradingScheme, GradingSchemeSnapshot, EctsIkuConversion, EctsIkuSnapshot


def snapshot_grading_scheme(db: Session, scheme_id: int, changed_by: int | None) -> GradingSchemeSnapshot | None:
    """Snapshot the current state of a grading scheme + all its rules.
    Called BEFORE any mutation (update rule, update scheme, delete rule, delete scheme).
    """
    scheme = db.query(GradingScheme).filter(GradingScheme.id == scheme_id).first()
    if not scheme:
        return None

    rules_list = [
        {
            "id": r.id,
            "local_grade_min": r.local_grade_min,
            "local_grade_max": r.local_grade_max,
            "local_grade_exact": r.local_grade_exact,
            "local_definition": r.local_definition,
            "ects_grade": r.ects_grade,
            "description": r.description,
            "sort_order": r.sort_order,
        }
        for r in sorted(scheme.rules, key=lambda r: (r.sort_order or 0, r.id))
    ]

    version_number = (
        db.query(GradingSchemeSnapshot)
        .filter(GradingSchemeSnapshot.grading_scheme_id == scheme_id)
        .count()
    ) + 1

    snap = GradingSchemeSnapshot(
        grading_scheme_id=scheme_id,
        version_number=version_number,
        scheme_snapshot={
            "name": scheme.name,
            "scheme_type": scheme.scheme_type,
            "grade_direction": scheme.grade_direction,
            "source": None,
            "source_document": None,
            "notes": scheme.notes,
            "is_active": scheme.is_active,
            "senate_decision_id": None,
            "senate_decision_ref": None,
        },
        rules_snapshot=rules_list,
        senate_decision_id=None,
        changed_by=changed_by,
    )
    db.add(snap)
    db.flush()
    return snap


def snapshot_ects_iku(db: Session, changed_by: int | None) -> EctsIkuSnapshot | None:
    """Snapshot all current ECTS-IKU mappings.
    Called BEFORE any mutation (create/update/delete mapping).
    """
    mappings = db.query(EctsIkuConversion).filter(EctsIkuConversion.is_active == True).order_by(EctsIkuConversion.id).all()

    mappings_list = [
        {
            "id": m.id,
            "ects_grade": m.ects_grade,
            "iku_grade": m.iku_grade,
            "is_active": m.is_active,
        }
        for m in mappings
    ]

    version_number = db.query(EctsIkuSnapshot).count() + 1

    snap = EctsIkuSnapshot(
        version_number=version_number,
        mappings_snapshot=mappings_list,
        changed_by=changed_by,
    )
    db.add(snap)
    db.flush()
    return snap


def get_latest_scheme_snapshot_id(db: Session, grading_scheme_id: int | None) -> int | None:
    """Return the latest snapshot id for a grading scheme. None if no scheme_id or no snapshots."""
    if not grading_scheme_id:
        return None
    snap = (
        db.query(GradingSchemeSnapshot)
        .filter(GradingSchemeSnapshot.grading_scheme_id == grading_scheme_id)
        .order_by(GradingSchemeSnapshot.id.desc())
        .first()
    )
    return snap.id if snap else None


def get_latest_ects_iku_snapshot_id(db: Session) -> int | None:
    """Return the latest ECTS-IKU snapshot id. None if no snapshots exist."""
    snap = (
        db.query(EctsIkuSnapshot)
        .order_by(EctsIkuSnapshot.id.desc())
        .first()
    )
    return snap.id if snap else None
