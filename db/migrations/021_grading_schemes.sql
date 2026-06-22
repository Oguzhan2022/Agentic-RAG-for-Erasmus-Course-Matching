-- 021_grading_schemes.sql
-- Grade conversion schema: local grade → ECTS → IKU

-- ECTS → IKU fixed conversion (senate decision, applies to all universities)
CREATE TABLE IF NOT EXISTS ects_iku_conversion (
    id SERIAL PRIMARY KEY,
    ects_grade VARCHAR(10) NOT NULL UNIQUE,
    iku_grade VARCHAR(10) NOT NULL,
    is_active BOOLEAN DEFAULT TRUE
);

-- University-specific grading system definition
CREATE TABLE IF NOT EXISTS grading_schemes (
    id SERIAL PRIMARY KEY,
    university_id INTEGER REFERENCES universities(id) ON DELETE CASCADE,
    name VARCHAR(200) NOT NULL,
    scheme_type VARCHAR(50) NOT NULL,
    country VARCHAR(100),
    grade_direction VARCHAR(10),
    is_default BOOLEAN DEFAULT TRUE,
    is_active BOOLEAN DEFAULT TRUE,
    source VARCHAR(50),
    source_document VARCHAR(500),
    notes TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Local Grade → ECTS conversion rules
CREATE TABLE IF NOT EXISTS grade_conversion_rules (
    id SERIAL PRIMARY KEY,
    grading_scheme_id INTEGER REFERENCES grading_schemes(id) ON DELETE CASCADE,
    local_grade_min VARCHAR(20),
    local_grade_max VARCHAR(20),
    local_grade_exact VARCHAR(20),
    local_definition VARCHAR(200),
    ects_grade VARCHAR(10) NOT NULL,
    description VARCHAR(200),
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Seed ECTS → IKU fixed table
INSERT INTO ects_iku_conversion (ects_grade, iku_grade) VALUES
    ('A',  'A'),
    ('B',  'A-'),
    ('C',  'B+'),
    ('D',  'C+'),
    ('E',  'C'),
    ('FX', 'F'),
    ('F',  'F'),
    ('P',  'Y'),
    ('Fail','Z')
ON CONFLICT (ects_grade) DO NOTHING;

CREATE INDEX IF NOT EXISTS ix_grading_schemes_university ON grading_schemes(university_id);
CREATE INDEX IF NOT EXISTS ix_grade_rules_scheme ON grade_conversion_rules(grading_scheme_id);
