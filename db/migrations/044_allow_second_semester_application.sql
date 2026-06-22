-- Migration 044: Allow second semester application for the same university
ALTER TABLE student_applications DROP CONSTRAINT IF EXISTS uq_student_app;
ALTER TABLE student_applications ADD CONSTRAINT uq_student_app UNIQUE (student_id, partner_university_id, semester);
