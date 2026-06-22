-- Migration 008: Module 3 workflow tables
-- Student Applications, Course Selections, Workflow State Log, Coordinator Decisions, Coordinator Reviews

CREATE TABLE IF NOT EXISTS student_applications (
    id SERIAL PRIMARY KEY,
    student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    partner_university_id INTEGER NOT NULL REFERENCES universities(id) ON DELETE CASCADE,
    department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL,
    status VARCHAR(40) DEFAULT 'not_selected',
    total_partner_ects FLOAT DEFAULT 0,
    approved_partner_ects FLOAT DEFAULT 0,
    submitted_at TIMESTAMP,
    reviewed_at TIMESTAMP,
    reviewer_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    student_notes TEXT,
    coordinator_notes TEXT,
    coordinator_viewed_at TIMESTAMP,
    student_draft_viewed_at TIMESTAMP,
    student_editing BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    CONSTRAINT uq_student_app UNIQUE (student_id, partner_university_id)
);

CREATE TABLE IF NOT EXISTS student_course_selections (
    id SERIAL PRIMARY KEY,
    application_id INTEGER NOT NULL REFERENCES student_applications(id) ON DELETE CASCADE,
    partner_course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    selected_home_course_id INTEGER REFERENCES courses(id) ON DELETE SET NULL,
    course_match_id INTEGER REFERENCES course_matches(id) ON DELETE SET NULL,
    status VARCHAR(40) DEFAULT 'not_selected',
    no_match_requested BOOLEAN DEFAULT FALSE,
    student_notes TEXT,
    student_explanation_snapshot JSONB,
    coordinator_explanation_snapshot JSONB,
    explanation_version INTEGER DEFAULT 1,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    CONSTRAINT uq_selection_course UNIQUE (application_id, partner_course_id)
);

CREATE TABLE IF NOT EXISTS workflow_state_logs (
    id SERIAL PRIMARY KEY,
    entity_type VARCHAR(50) NOT NULL,
    entity_id INTEGER NOT NULL,
    from_state VARCHAR(40),
    to_state VARCHAR(40) NOT NULL,
    actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    actor_role VARCHAR(50),
    reason TEXT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS coordinator_decisions (
    id SERIAL PRIMARY KEY,
    coordinator_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    application_id INTEGER REFERENCES student_applications(id) ON DELETE SET NULL,
    selection_id INTEGER REFERENCES student_course_selections(id) ON DELETE SET NULL,
    partner_course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    home_course_id INTEGER REFERENCES courses(id) ON DELETE SET NULL,
    course_match_id INTEGER REFERENCES course_matches(id) ON DELETE SET NULL,
    decision VARCHAR(40) NOT NULL,
    override_reason_category VARCHAR(60),
    override_details TEXT,
    original_score FLOAT,
    original_verification_status VARCHAR(20),
    override_home_course_id INTEGER REFERENCES courses(id) ON DELETE SET NULL,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS coordinator_reviews (
    id SERIAL PRIMARY KEY,
    coordinator_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    application_id INTEGER NOT NULL REFERENCES student_applications(id) ON DELETE CASCADE,
    selection_id INTEGER REFERENCES student_course_selections(id) ON DELETE SET NULL,
    action VARCHAR(40) NOT NULL,
    notes TEXT,
    override_home_course_id INTEGER REFERENCES courses(id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_applications_student ON student_applications(student_id);
CREATE INDEX IF NOT EXISTS idx_applications_status ON student_applications(status);
CREATE INDEX IF NOT EXISTS idx_selections_application ON student_course_selections(application_id);
CREATE INDEX IF NOT EXISTS idx_workflow_entity ON workflow_state_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_decisions_coordinator ON coordinator_decisions(coordinator_id);
CREATE INDEX IF NOT EXISTS idx_reviews_application ON coordinator_reviews(application_id);
