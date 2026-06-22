-- Migration 037: Add partial_rows to transfer_documents
ALTER TABLE transfer_documents ADD COLUMN IF NOT EXISTS partial_rows INTEGER DEFAULT 0;
