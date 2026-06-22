-- Task 5.2: Senate Decision Archive

CREATE TABLE IF NOT EXISTS senate_decisions (
    id SERIAL PRIMARY KEY,
    title VARCHAR(500) NOT NULL,
    decision_date TIMESTAMP WITH TIME ZONE NOT NULL,
    reference_no VARCHAR(100) NOT NULL,
    decision_type VARCHAR(100) NOT NULL,
    department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL,
    university_id INTEGER REFERENCES universities(id) ON DELETE SET NULL,
    summary TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    file_path VARCHAR(500),
    original_filename VARCHAR(500),
    file_size INTEGER,
    uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_senate_ref UNIQUE (reference_no, department_id, university_id)
);
