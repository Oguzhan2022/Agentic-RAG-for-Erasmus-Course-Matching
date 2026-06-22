-- Migration 006: Add llm_mode column to match_jobs
-- Distinguishes sequential (3 LLM calls) vs batch (1 LLM call) match jobs.

ALTER TABLE match_jobs
    ADD COLUMN IF NOT EXISTS llm_mode VARCHAR(20) NOT NULL DEFAULT 'sequential';

-- Existing jobs are sequential
UPDATE match_jobs SET llm_mode = 'sequential' WHERE llm_mode IS NULL OR llm_mode = '';

COMMENT ON COLUMN match_jobs.llm_mode IS 'LLM call strategy: sequential (3 calls per course) or batch (1 call for all candidates)';
