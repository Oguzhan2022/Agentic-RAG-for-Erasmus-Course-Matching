-- 022_transcripts.sql
-- Student transcript upload and grade entry tables

CREATE TABLE IF NOT EXISTS student_transcripts (
    id SERIAL PRIMARY KEY,
    student_id INTEGER REFERENCES users(id) ON DELETE CASCADE NOT NULL,
    application_id INTEGER REFERENCES student_applications(id) ON DELETE SET NULL,
    partner_university_id INTEGER REFERENCES universities(id) ON DELETE CASCADE NOT NULL,
    file_path VARCHAR(500) NOT NULL,
    original_filename VARCHAR(500),
    status VARCHAR(30) DEFAULT 'uploaded',
    graded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    graded_at TIMESTAMP,
    notes TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS transcript_grade_entries (
    id SERIAL PRIMARY KEY,
    transcript_id INTEGER REFERENCES student_transcripts(id) ON DELETE CASCADE NOT NULL,
    partner_course_id INTEGER REFERENCES courses(id) ON DELETE SET NULL,
    partner_course_name VARCHAR(500) NOT NULL,
    partner_course_code VARCHAR(50),
    partner_ects FLOAT,
    local_grade VARCHAR(20),
    ects_grade VARCHAR(10),
    iku_grade VARCHAR(10),
    grading_scheme_id INTEGER REFERENCES grading_schemes(id) ON DELETE SET NULL,
    conversion_method VARCHAR(30),
    is_db_course BOOLEAN DEFAULT FALSE,
    entered_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    notes TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_transcripts_student ON student_transcripts(student_id);
CREATE INDEX IF NOT EXISTS ix_transcripts_university ON student_transcripts(partner_university_id);
CREATE INDEX IF NOT EXISTS ix_transcripts_status ON student_transcripts(status);
CREATE INDEX IF NOT EXISTS ix_grade_entries_transcript ON transcript_grade_entries(transcript_id);
