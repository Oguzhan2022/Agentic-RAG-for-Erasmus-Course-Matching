-- Migration: 040_relational_mappings.sql
-- Goal: Normalize mapped_home_course_ids into a relational junction table transcript_entry_home_courses

BEGIN;

-- 1. Create junction table
CREATE TABLE IF NOT EXISTS transcript_entry_home_courses (
    entry_id INTEGER NOT NULL REFERENCES transcript_grade_entries(id) ON DELETE CASCADE,
    home_course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    PRIMARY KEY (entry_id, home_course_id)
);

CREATE INDEX IF NOT EXISTS idx_tehc_entry_id ON transcript_entry_home_courses(entry_id);
CREATE INDEX IF NOT EXISTS idx_tehc_home_course_id ON transcript_entry_home_courses(home_course_id);

-- 2. Migrate existing JSON data to junction table
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'transcript_grade_entries' AND column_name = 'mapped_home_course_ids'
    ) THEN
        INSERT INTO transcript_entry_home_courses (entry_id, home_course_id)
        SELECT 
            id AS entry_id, 
            (jsonb_array_elements_text(mapped_home_course_ids::jsonb))::int AS home_course_id
        FROM transcript_grade_entries
        WHERE mapped_home_course_ids IS NOT NULL 
          AND jsonb_typeof(mapped_home_course_ids::jsonb) = 'array'
        ON CONFLICT DO NOTHING;

        -- 3. Drop the redundant JSON column
        ALTER TABLE transcript_grade_entries DROP COLUMN mapped_home_course_ids;
    END IF;
END $$;

COMMIT;
