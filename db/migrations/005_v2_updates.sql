-- Migration 003: V2 Matching and Verification Updates
-- Adds more granular academic insight columns to the course_matches table.

ALTER TABLE course_matches 
    ADD COLUMN IF NOT EXISTS core_home_topics JSONB DEFAULT '[]',
    ADD COLUMN IF NOT EXISTS extra_partner_topics JSONB DEFAULT '[]',
    ADD COLUMN IF NOT EXISTS structural_notes JSONB DEFAULT '[]',
    ADD COLUMN IF NOT EXISTS content_overlap_assessment TEXT,
    ADD COLUMN IF NOT EXISTS core_topic_coverage TEXT;

-- Update existing column comments if needed (Optional but good for DB docs)
COMMENT ON COLUMN course_matches.core_home_topics IS 'Key home course topics identified by LLM for verification';
COMMENT ON COLUMN course_matches.extra_partner_topics IS 'Additional specialized material in partner course (non-penalizing)';
COMMENT ON COLUMN course_matches.structural_notes IS 'Category-specific observations about labs, projects, etc.';
COMMENT ON COLUMN course_matches.content_overlap_assessment IS 'Classification: genuine, partial, or superficial';
COMMENT ON COLUMN course_matches.core_topic_coverage IS 'Qualitative assessment: strong, moderate, or weak';
