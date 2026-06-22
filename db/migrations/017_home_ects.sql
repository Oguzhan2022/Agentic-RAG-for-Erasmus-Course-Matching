-- Add home ECTS tracking columns to student_applications, mirroring partner ECTS.
-- Used by submit / finalize to enforce the >= 30 ECTS home course requirement
-- alongside the existing >= 29 partner ECTS threshold.

ALTER TABLE student_applications
    ADD COLUMN IF NOT EXISTS total_home_ects DOUBLE PRECISION DEFAULT 0;

ALTER TABLE student_applications
    ADD COLUMN IF NOT EXISTS approved_home_ects DOUBLE PRECISION DEFAULT 0;

UPDATE student_applications SET total_home_ects = 0 WHERE total_home_ects IS NULL;
UPDATE student_applications SET approved_home_ects = 0 WHERE approved_home_ects IS NULL;
