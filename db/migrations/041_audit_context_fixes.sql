-- Migration: 041_audit_context_fixes.sql
-- Goal: Prevent context loss in grade_conversion_audit when a grade entry is deleted

BEGIN;

-- 1. Add snapshot columns to audit table
ALTER TABLE grade_conversion_audit ADD COLUMN IF NOT EXISTS partner_course_name VARCHAR(500);
ALTER TABLE grade_conversion_audit ADD COLUMN IF NOT EXISTS partner_course_code VARCHAR(50);

-- 2. Populate existing audit rows with course details from transcript_grade_entries before they get lost
UPDATE grade_conversion_audit gca
SET 
    partner_course_name = tge.partner_course_name,
    partner_course_code = tge.partner_course_code
FROM transcript_grade_entries tge
WHERE gca.grade_entry_id = tge.id;

-- 3. Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_gca_course_name ON grade_conversion_audit(partner_course_name);

COMMIT;
