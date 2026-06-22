-- Migration 009: Add semester to student_applications
ALTER TABLE student_applications ADD COLUMN IF NOT EXISTS semester VARCHAR(20);
