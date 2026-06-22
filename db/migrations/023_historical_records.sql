-- 023_historical_records.sql
-- Historical Erasmus records: archival of finalized transcripts + DOCX import

CREATE TABLE IF NOT EXISTS historical_erasmus_records (
    id SERIAL PRIMARY KEY,
    source VARCHAR(30) NOT NULL DEFAULT 'auto_archive',
    -- 'auto_archive' = finalized transcript copy
    -- 'docx_import' = imported from Ders Transfer Formları
    -- 'manual' = manually entered

    source_transcript_id INTEGER REFERENCES student_transcripts(id) ON DELETE CASCADE,
    -- NULL for DOCX/manual entries; CASCADE ensures delete sync

    student_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    anonymous_student_label VARCHAR(50),

    partner_university_id INTEGER REFERENCES universities(id) ON DELETE CASCADE NOT NULL,
    department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL,
    academic_year VARCHAR(20),
    semester VARCHAR(20),

    total_partner_ects FLOAT DEFAULT 0,
    total_home_ects FLOAT DEFAULT 0,
    learning_agreement_ready BOOLEAN DEFAULT FALSE,
    coordinator_decision_summary JSONB DEFAULT '{}',

    notes TEXT,
    import_batch_id VARCHAR(50),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS historical_record_courses (
    id SERIAL PRIMARY KEY,
    record_id INTEGER REFERENCES historical_erasmus_records(id) ON DELETE CASCADE NOT NULL,

    partner_course_id INTEGER REFERENCES courses(id) ON DELETE SET NULL,
    partner_course_name VARCHAR(500) NOT NULL,
    partner_course_code VARCHAR(50),
    partner_ects FLOAT,

    home_course_id INTEGER REFERENCES courses(id) ON DELETE SET NULL,
    home_course_name VARCHAR(500),
    home_course_code VARCHAR(50),
    home_ects FLOAT,

    local_grade VARCHAR(20),
    ects_grade VARCHAR(10),
    iku_grade VARCHAR(10),
    grading_scheme_id INTEGER REFERENCES grading_schemes(id) ON DELETE SET NULL,
    conversion_method VARCHAR(30),

    coordinator_decision VARCHAR(30),
    is_db_partner_course BOOLEAN DEFAULT FALSE,
    is_db_home_course BOOLEAN DEFAULT FALSE,

    notes TEXT,
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_hist_records_source ON historical_erasmus_records(source);
CREATE INDEX IF NOT EXISTS ix_hist_records_university ON historical_erasmus_records(partner_university_id);
CREATE INDEX IF NOT EXISTS ix_hist_records_transcript ON historical_erasmus_records(source_transcript_id);
CREATE INDEX IF NOT EXISTS ix_hist_record_courses_record ON historical_record_courses(record_id);
CREATE INDEX IF NOT EXISTS ix_hist_record_courses_partner ON historical_record_courses(partner_course_id);
CREATE INDEX IF NOT EXISTS ix_hist_record_courses_home ON historical_record_courses(home_course_id);
