-- Erasmus Course Matching System - Initial Database Schema
-- PostgreSQL + pgvector

CREATE EXTENSION IF NOT EXISTS vector;

-- Ingestion status enum
CREATE TYPE ingestion_status AS ENUM (
    'pending',
    'parsing',
    'parsed',
    'embedding',
    'ready',
    'failed'
);

-- Universities table
CREATE TABLE universities (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL UNIQUE,
    country VARCHAR(100),
    city VARCHAR(100),
    pdf_structure VARCHAR(20) NOT NULL DEFAULT 'individual'
        CHECK (pdf_structure IN ('consolidated', 'individual', 'category_based')),
    is_home BOOLEAN DEFAULT FALSE,
    is_active BOOLEAN DEFAULT TRUE,
    ingestion_status ingestion_status DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Ingestion batch tracking
CREATE TABLE ingestion_batches (
    id SERIAL PRIMARY KEY,
    university_id INTEGER NOT NULL REFERENCES universities(id) ON DELETE CASCADE,
    semester VARCHAR(20) CHECK (semester IN ('fall', 'spring', 'both', 'unknown')),
    status ingestion_status DEFAULT 'pending',
    total_courses INTEGER DEFAULT 0,
    parsed_courses INTEGER DEFAULT 0,
    failed_courses INTEGER DEFAULT 0,
    error_log TEXT,
    started_at TIMESTAMP DEFAULT NOW(),
    completed_at TIMESTAMP
);

CREATE INDEX idx_batches_university ON ingestion_batches(university_id);

-- Courses table
CREATE TABLE courses (
    id SERIAL PRIMARY KEY,
    university_id INTEGER NOT NULL REFERENCES universities(id) ON DELETE CASCADE,
    ingestion_batch_id INTEGER REFERENCES ingestion_batches(id) ON DELETE SET NULL,
    course_code VARCHAR(50),
    course_name VARCHAR(500) NOT NULL,
    department VARCHAR(255),
    semester VARCHAR(20) CHECK (semester IN ('fall', 'spring', 'both', 'unknown')),
    ects REAL,
    level VARCHAR(20) CHECK (level IN ('bachelor', 'master', 'unknown')),
    language VARCHAR(50),
    content TEXT,
    learning_outcomes TEXT,
    academic_context JSONB DEFAULT '{}',
    metadata_quality JSONB DEFAULT '{}',
    source_metadata JSONB DEFAULT '{}',
    raw_text TEXT,
    embedding vector(768),
    warnings JSONB DEFAULT '[]',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_courses_university ON courses(university_id);
CREATE INDEX idx_courses_semester ON courses(semester);
CREATE INDEX idx_courses_batch ON courses(ingestion_batch_id);
CREATE INDEX idx_courses_academic_context ON courses USING gin(academic_context);

-- Users table
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) NOT NULL UNIQUE,
    name VARCHAR(255),
    role VARCHAR(20) NOT NULL DEFAULT 'student'
        CHECK (role IN ('student', 'coordinator', 'admin')),
    department VARCHAR(255),
    created_at TIMESTAMP DEFAULT NOW()
);

-- Match requests table
CREATE TABLE match_requests (
    id SERIAL PRIMARY KEY,
    student_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    partner_course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    home_course_id INTEGER REFERENCES courses(id) ON DELETE SET NULL,
    status VARCHAR(20) DEFAULT 'draft'
        CHECK (status IN ('draft', 'submitted', 'reviewed', 'approved', 'rejected')),
    similarity_score REAL,
    score_breakdown JSONB DEFAULT '{}',
    warnings JSONB DEFAULT '[]',
    coordinator_notes TEXT,
    reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    reviewed_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_match_student ON match_requests(student_id);
CREATE INDEX idx_match_status ON match_requests(status);
