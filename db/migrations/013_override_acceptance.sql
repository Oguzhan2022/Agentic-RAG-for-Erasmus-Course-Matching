ALTER TABLE student_course_selections
  ADD COLUMN IF NOT EXISTS coordinator_override_round INTEGER DEFAULT NULL;
