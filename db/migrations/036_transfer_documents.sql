-- Migration 036: Transfer Documents + Verification Results
-- Registrar manual transfer document upload pipeline

CREATE TABLE transfer_documents (
    id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    partner_university_id INTEGER NOT NULL REFERENCES universities(id) ON DELETE CASCADE,
    department_id INTEGER NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
    original_filename VARCHAR(500) NOT NULL,
    file_path VARCHAR(500),
    file_size INTEGER,
    student_name VARCHAR(300),
    student_number VARCHAR(50),
    parsing_method VARCHAR(20),                     -- 'rule_based' | 'llm_fallback'
    parsed_rows JSONB DEFAULT '[]'::jsonb,          -- [{ partnerCode, partnerName, localGrade, ectsGrade, partnerEcts, homeCode, homeName, ikuGrade, homeEcts }]
    grading_scheme_id INTEGER,
    grading_scheme_version_id INTEGER REFERENCES grading_scheme_snapshots(id) ON DELETE SET NULL,
    ects_iku_version_id INTEGER REFERENCES ects_iku_snapshots(id) ON DELETE SET NULL,
    verification_status VARCHAR(30) DEFAULT 'not_verified',  -- 'not_verified' | 'verified' | 'has_issues'
    total_rows INTEGER DEFAULT 0,
    valid_rows INTEGER DEFAULT 0,
    invalid_rows INTEGER DEFAULT 0,
    manual_check_rows INTEGER DEFAULT 0,
    review_status VARCHAR(30) DEFAULT 'pending',    -- 'pending' | 'approved' | 'flagged'
    reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    reviewed_at TIMESTAMP,
    review_notes TEXT,
    uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT now(),
    updated_at TIMESTAMP DEFAULT now()
);

CREATE TABLE transfer_verification_results (
    id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    transfer_document_id INTEGER NOT NULL REFERENCES transfer_documents(id) ON DELETE CASCADE,
    row_index INTEGER NOT NULL DEFAULT 0,
    partner_course_name VARCHAR(500) NOT NULL DEFAULT '',
    partner_course_code VARCHAR(50) DEFAULT '',
    partner_grade VARCHAR(20) DEFAULT '',
    partner_ects VARCHAR(10) DEFAULT '',
    expected_ects_grade VARCHAR(20) DEFAULT '',
    expected_iku_grade VARCHAR(20) DEFAULT '',
    provided_ects_grade VARCHAR(20) DEFAULT '',
    provided_iku_grade VARCHAR(20) DEFAULT '',
    validation_result VARCHAR(30) DEFAULT 'no_rule_found',  -- 'valid' | 'invalid' | 'manual_check_required' | 'no_rule_found'
    grade_rule_used TEXT DEFAULT '',
    explanation TEXT DEFAULT '',
    explanation_version INTEGER DEFAULT 1,
    explanation_generated_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT now()
);

CREATE INDEX idx_transfer_docs_dept ON transfer_documents(department_id);
CREATE INDEX idx_transfer_docs_uni ON transfer_documents(partner_university_id);
CREATE INDEX idx_transfer_docs_review ON transfer_documents(review_status);
CREATE INDEX idx_transfer_verif_doc ON transfer_verification_results(transfer_document_id);
