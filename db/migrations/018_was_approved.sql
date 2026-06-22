-- Add was_approved flag to track removed approved courses
ALTER TABLE student_course_selections
ADD COLUMN IF NOT EXISTS was_approved BOOLEAN NOT NULL DEFAULT FALSE;
