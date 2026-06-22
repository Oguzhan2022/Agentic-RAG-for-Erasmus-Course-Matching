-- Migration 015: Simplify application statuses from 10 to 5
-- New statuses: draft, submitted, override_pending, rejected, learning_agreement_ready
-- Selection-level statuses remain unchanged

BEGIN;

-- Application status renames
UPDATE student_applications SET status = 'draft'
  WHERE status IN ('not_selected', 'draft_selected');

UPDATE student_applications SET status = 'submitted'
  WHERE status IN ('submitted_for_review', 'manual_review_required', 'reviewed');

UPDATE student_applications SET status = 'override_pending'
  WHERE status = 'pending_override_acceptance';

UPDATE student_applications SET status = 'learning_agreement_ready'
  WHERE status IN ('approved', 'partially_approved');

-- rejected stays the same

COMMIT;
