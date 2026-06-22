-- 033_fix_snapshot_iku_grades.sql
-- Backfill iku_grade into existing grading_scheme_snapshots.rules_snapshot
-- The 028 migration backfill omitted iku_grade; this adds it from the
-- ECTS-IKU mappings that were current when each snapshot was taken.

DO $$
DECLARE
    snap RECORD;
    rule_elem JSONB;
    ects_g TEXT;
    iku_g TEXT;
    new_rules JSONB;
BEGIN
    FOR snap IN
        SELECT gss.id, gss.rules_snapshot, gss.created_at
        FROM grading_scheme_snapshots gss
        WHERE gss.rules_snapshot IS NOT NULL
    LOOP
        new_rules := '[]'::JSONB;
        FOR rule_elem IN SELECT jsonb_array_elements(snap.rules_snapshot)
        LOOP
            ects_g := rule_elem->>'ects_grade';
            -- Find the iku_grade from the ECTS-IKU snapshot that was current
            -- at the time this scheme snapshot was created
            SELECT m.obj->>'iku_grade' INTO iku_g
            FROM ects_iku_snapshots eis,
                 jsonb_array_elements(eis.mappings_snapshot) AS m(obj)
            WHERE eis.created_at <= snap.created_at
              AND m.obj->>'ects_grade' = ects_g
            ORDER BY eis.id DESC
            LIMIT 1;

            -- Fallback: use current ECTS-IKU mapping
            IF iku_g IS NULL THEN
                SELECT iku_grade INTO iku_g
                FROM ects_iku_conversion
                WHERE ects_grade = ects_g AND is_active = TRUE
                LIMIT 1;
            END IF;

            new_rules := new_rules || jsonb_build_object(
                'id', (rule_elem->>'id')::INT,
                'local_grade_min', rule_elem->'local_grade_min',
                'local_grade_max', rule_elem->'local_grade_max',
                'local_grade_exact', rule_elem->'local_grade_exact',
                'local_definition', rule_elem->'local_definition',
                'ects_grade', ects_g,
                'iku_grade', iku_g,
                'description', rule_elem->'description',
                'sort_order', (rule_elem->>'sort_order')::INT
            );
        END LOOP;

        UPDATE grading_scheme_snapshots
        SET rules_snapshot = new_rules
        WHERE id = snap.id;
    END LOOP;
END $$;
