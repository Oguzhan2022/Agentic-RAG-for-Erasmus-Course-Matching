ALTER TABLE student_applications
  ADD COLUMN IF NOT EXISTS coordinator_editing BOOLEAN DEFAULT FALSE;
