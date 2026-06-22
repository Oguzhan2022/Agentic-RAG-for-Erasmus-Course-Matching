"""Grade Conversion Audit Service — logs every conversion for audit trail."""

from db.models import GradeConversionAudit


def log_conversion(db, grade_entry, *, is_override=False, overridden_by=None, previous_iku=None, notes=None):
    """
    Log a grade conversion event.
    Caller is responsible for db.commit().
    grade_entry must be flushed (have an id) before calling.
    """
    db.add(GradeConversionAudit(
        grade_entry_id=grade_entry.id,
        transcript_id=grade_entry.transcript_id,
        partner_course_name=grade_entry.partner_course_name,
        partner_course_code=grade_entry.partner_course_code,
        source_grade=grade_entry.local_grade or grade_entry.ects_grade,
        target_iku_grade=grade_entry.iku_grade,
        conversion_method=grade_entry.conversion_method,
        is_manual_override=is_override,
        overridden_by=overridden_by,
        previous_iku_grade=previous_iku,
        notes=notes,
    ))
