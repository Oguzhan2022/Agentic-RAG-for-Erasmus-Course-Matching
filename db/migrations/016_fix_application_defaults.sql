-- Fix application default status: "not_selected" → "draft"
-- Also set student_editing=true for draft applications so students can edit immediately
UPDATE student_applications
SET status = 'draft'
WHERE status = 'not_selected';

UPDATE student_applications
SET student_editing = true
WHERE status = 'draft' AND (student_editing IS NULL OR student_editing = false);

-- Fix column default for future inserts
ALTER TABLE student_applications ALTER COLUMN status SET DEFAULT 'draft';
ALTER TABLE student_applications ALTER COLUMN student_editing SET DEFAULT true;
