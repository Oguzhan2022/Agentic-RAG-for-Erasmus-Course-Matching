-- Migration 012: Add coordinator_override_course_ids to student_course_selections
ALTER TABLE student_course_selections
    ADD COLUMN IF NOT EXISTS coordinator_override_course_ids JSONB DEFAULT '[]';
