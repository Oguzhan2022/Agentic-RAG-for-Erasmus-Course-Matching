CREATE TABLE IF NOT EXISTS manual_review_analyses (
    id                          SERIAL PRIMARY KEY,
    selection_id                INTEGER NOT NULL REFERENCES student_course_selections(id) ON DELETE CASCADE,
    partner_course_id           INTEGER NOT NULL REFERENCES courses(id),
    home_course_id              INTEGER NOT NULL REFERENCES courses(id),
    coordinator_id              INTEGER REFERENCES users(id),

    -- Fusion score
    overall_score               FLOAT,
    score_breakdown             JSONB DEFAULT '{}',

    -- Semantic scores (from single-pair LLM)
    domain_score                FLOAT,
    content_score               FLOAT,
    outcomes_score              FLOAT,
    matched_topics              JSONB DEFAULT '[]',
    missing_topics              JSONB DEFAULT '[]',
    extra_partner_topics        JSONB DEFAULT '[]',
    structural_notes            TEXT,
    domain_evidence             TEXT,
    content_evidence            TEXT,
    outcomes_evidence           TEXT,
    core_home_topics            JSONB DEFAULT '[]',

    -- Deterministic scores
    ects_score                  FLOAT,
    title_score                 FLOAT,
    metadata_score              FLOAT,

    -- Verification
    verification_status         VARCHAR(20),
    verification_confidence     FLOAT,
    verification_reason         TEXT,
    verification_risk_flags     JSONB DEFAULT '[]',
    is_recommended              BOOLEAN DEFAULT FALSE,
    content_overlap_assessment  VARCHAR(30),
    core_topic_coverage         VARCHAR(20),

    -- Academic category (from LLM)
    academic_category           VARCHAR(20),

    created_at                  TIMESTAMP DEFAULT NOW()
);
