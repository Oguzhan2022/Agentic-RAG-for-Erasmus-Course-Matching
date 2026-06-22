-- Migration: Structural fixes from database audit report
-- 1. Add UniqueConstraint on grading_scheme_snapshots(grading_scheme_id, version_number)
-- 2. Mark is_db_course as deprecated (keep column for backward compat, add comment)
-- 3. system_locks table already exists, no DDL needed (ORM model added)

-- 1. Unique constraint for snapshot version deduplication
-- Use IF NOT EXISTS pattern via DO block for idempotency
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'uq_scheme_snapshot_version'
    ) THEN
        ALTER TABLE grading_scheme_snapshots
            ADD CONSTRAINT uq_scheme_snapshot_version UNIQUE (grading_scheme_id, version_number);
    END IF;
END $$;

-- 2. Add column comment to mark is_db_course as deprecated
COMMENT ON COLUMN transcript_grade_entries.is_db_course IS 'DEPRECATED: Redundant with partner_course_id IS NOT NULL. Kept for backward compatibility.';
