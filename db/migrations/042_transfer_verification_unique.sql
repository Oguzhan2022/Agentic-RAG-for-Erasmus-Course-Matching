-- Migration: 042_transfer_verification_unique.sql
-- Goal: Ensure unique indexing on transfer verification results per document and version

BEGIN;

-- 1. Add UniqueConstraint on transfer_verification_results
ALTER TABLE transfer_verification_results 
ADD CONSTRAINT uq_transfer_doc_version_row 
UNIQUE (transfer_document_id, version_number, row_index);

COMMIT;
