-- Migration 010: Multi-select support for student course selections
-- A student can now select multiple home course candidates for a single partner course

ALTER TABLE student_course_selections
    ADD COLUMN IF NOT EXISTS selected_home_course_ids JSONB DEFAULT '[]',
    ADD COLUMN IF NOT EXISTS selected_course_match_ids JSONB DEFAULT '[]';
