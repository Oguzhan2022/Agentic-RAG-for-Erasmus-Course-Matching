-- Migration 038: Add version tracking to transfer_verification_results
ALTER TABLE transfer_verification_results ADD COLUMN IF NOT EXISTS version_number INTEGER DEFAULT 1;
ALTER TABLE transfer_verification_results ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;
