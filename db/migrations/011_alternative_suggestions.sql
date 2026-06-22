-- Migration 011: Student alternative match suggestions
ALTER TABLE student_course_selections
    ADD COLUMN IF NOT EXISTS alternative_home_course_ids JSONB DEFAULT '[]',
    ADD COLUMN IF NOT EXISTS alternative_reason TEXT;
