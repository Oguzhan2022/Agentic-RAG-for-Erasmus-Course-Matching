-- Task 4.12A: Grade Conversion Audit table

CREATE TABLE IF NOT EXISTS grade_conversion_audit (
    id SERIAL PRIMARY KEY,
    grade_entry_id INTEGER REFERENCES transcript_grade_entries(id) ON DELETE SET NULL,
    transcript_id INTEGER NOT NULL REFERENCES student_transcripts(id) ON DELETE CASCADE,
    source_grade VARCHAR(20),
    target_iku_grade VARCHAR(10),
    conversion_method VARCHAR(30),
    grading_scheme_id INTEGER REFERENCES grading_schemes(id) ON DELETE SET NULL,
    is_manual_override BOOLEAN DEFAULT FALSE,
    overridden_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    previous_iku_grade VARCHAR(10),
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
