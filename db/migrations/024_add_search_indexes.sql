-- Add search indexes for optimized course autocomplete
CREATE INDEX IF NOT EXISTS ix_courses_course_name ON courses (course_name);
CREATE INDEX IF NOT EXISTS ix_courses_course_code ON courses (course_code);
CREATE INDEX IF NOT EXISTS ix_transcript_grade_entries_partner_course_name ON transcript_grade_entries (partner_course_name);
CREATE INDEX IF NOT EXISTS ix_transcript_grade_entries_partner_course_code ON transcript_grade_entries (partner_course_code);
