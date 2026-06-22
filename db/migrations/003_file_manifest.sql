-- Add file_manifest column to upload_jobs for resume consistency
-- Stores the original file list so resumed jobs don't rescan the directory
ALTER TABLE upload_jobs ADD COLUMN IF NOT EXISTS file_manifest JSON;
