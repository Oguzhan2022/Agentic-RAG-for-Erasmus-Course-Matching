-- Match Jobs table (batch matching with queue support)
CREATE TABLE IF NOT EXISTS match_jobs (
    id SERIAL PRIMARY KEY,
    partner_university_id INTEGER NOT NULL REFERENCES universities(id) ON DELETE CASCADE,
    home_university_id INTEGER NOT NULL REFERENCES universities(id) ON DELETE CASCADE,
    status VARCHAR(20) DEFAULT 'queued',
    total_courses INTEGER DEFAULT 0,
    processed_courses INTEGER DEFAULT 0,
    failed_courses INTEGER DEFAULT 0,
    current_course VARCHAR(500),
    course_manifest JSON,
    error_log TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP
);

-- Course Matches table (partner course → home course results)
CREATE TABLE IF NOT EXISTS course_matches (
    id SERIAL PRIMARY KEY,
    match_job_id INTEGER NOT NULL REFERENCES match_jobs(id) ON DELETE CASCADE,
    partner_course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    home_course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    overall_score FLOAT,
    score_breakdown JSON DEFAULT '{}',
    matched_topics JSON DEFAULT '[]',
    missing_topics JSON DEFAULT '[]',
    warnings JSON DEFAULT '[]',
    category VARCHAR(20),
    rank INTEGER DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
