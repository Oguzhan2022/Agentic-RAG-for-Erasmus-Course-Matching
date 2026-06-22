-- 028_grading_versioning.sql
-- Grading Scheme & ECTS-IKU versioning — immutable snapshots on every mutation

-- 1. New tables

CREATE TABLE IF NOT EXISTS grading_scheme_snapshots (
    id SERIAL PRIMARY KEY,
    grading_scheme_id INTEGER REFERENCES grading_schemes(id) ON DELETE SET NULL,
    version_number INTEGER NOT NULL,
    scheme_snapshot JSONB NOT NULL,
    rules_snapshot JSONB NOT NULL,
    changed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ects_iku_snapshots (
    id SERIAL PRIMARY KEY,
    version_number INTEGER NOT NULL,
    mappings_snapshot JSONB NOT NULL,
    changed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Add version FK columns to existing tables

ALTER TABLE transcript_grade_entries
    ADD COLUMN IF NOT EXISTS grading_scheme_version_id INTEGER REFERENCES grading_scheme_snapshots(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS ects_iku_version_id INTEGER REFERENCES ects_iku_snapshots(id) ON DELETE SET NULL;

ALTER TABLE grade_conversion_audit
    ADD COLUMN IF NOT EXISTS grading_scheme_version_id INTEGER REFERENCES grading_scheme_snapshots(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS ects_iku_version_id INTEGER REFERENCES ects_iku_snapshots(id) ON DELETE SET NULL;

-- 3. Seed v1 snapshots — grading schemes

DO $$
DECLARE
    schemerec RECORD;
    rules_json JSONB;
    next_version INT;
    snap_id INT;
BEGIN
    -- ECTS-IKU v1 snapshot
    INSERT INTO ects_iku_snapshots (version_number, mappings_snapshot, changed_by)
    SELECT 1, jsonb_agg(row_to_json(t)), NULL
    FROM (
        SELECT id, ects_grade, iku_grade, is_active
        FROM ects_iku_conversion
        WHERE is_active = TRUE
        ORDER BY id
    ) t;

    -- Scheme v1 snapshots + backfill transcript_grade_entries
    FOR schemerec IN SELECT id FROM grading_schemes LOOP
        -- Collect rules as JSONB
        SELECT COALESCE(jsonb_agg(row_to_json(r) ORDER BY r.sort_order, r.id), '[]'::jsonb)
        INTO rules_json
        FROM (
            SELECT id, local_grade_min, local_grade_max, local_grade_exact,
                   local_definition, ects_grade, description, sort_order
            FROM grade_conversion_rules
            WHERE grading_scheme_id = schemerec.id
        ) r;

        -- Find next version number for this scheme
        SELECT COALESCE(MAX(version_number), 0) + 1 INTO next_version
        FROM grading_scheme_snapshots
        WHERE grading_scheme_id = schemerec.id;

        -- Insert snapshot
        INSERT INTO grading_scheme_snapshots (grading_scheme_id, version_number, scheme_snapshot, rules_snapshot, changed_by)
        SELECT schemerec.id, next_version,
               jsonb_build_object(
                   'name', name, 'scheme_type', scheme_type,
                   'grade_direction', grade_direction, 'source', source,
                   'source_document', source_document, 'notes', notes,
                   'is_active', is_active
               ),
               rules_json,
               NULL
        FROM grading_schemes
        WHERE id = schemerec.id
        RETURNING id INTO snap_id;

        -- Backfill transcript_grade_entries with this scheme
        UPDATE transcript_grade_entries
        SET grading_scheme_version_id = snap_id
        WHERE grading_scheme_id = schemerec.id;
    END LOOP;

    -- Backfill ects_iku_version_id on all existing grade entries
    UPDATE transcript_grade_entries
    SET ects_iku_version_id = (SELECT id FROM ects_iku_snapshots WHERE version_number = 1)
    WHERE ects_iku_version_id IS NULL;

    -- Backfill audit table
    UPDATE grade_conversion_audit
    SET grading_scheme_version_id = (
        SELECT id FROM grading_scheme_snapshots
        WHERE grading_scheme_id = grade_conversion_audit.grading_scheme_id
        ORDER BY id LIMIT 1
    )
    WHERE grading_scheme_id IS NOT NULL
      AND grading_scheme_version_id IS NULL;

    UPDATE grade_conversion_audit
    SET ects_iku_version_id = (SELECT id FROM ects_iku_snapshots WHERE version_number = 1)
    WHERE ects_iku_version_id IS NULL;
END $$;
