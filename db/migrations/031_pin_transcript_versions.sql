-- Add version pinning columns to student_transcripts
-- This ensures a transcript always uses the grading scheme and ECTS-IKU versions
-- that were current when it was created, not later versions.

ALTER TABLE student_transcripts
ADD COLUMN grading_scheme_version_id INTEGER REFERENCES grading_scheme_snapshots(id) ON DELETE SET NULL;

ALTER TABLE student_transcripts
ADD COLUMN ects_iku_version_id INTEGER REFERENCES ects_iku_snapshots(id) ON DELETE SET NULL;
