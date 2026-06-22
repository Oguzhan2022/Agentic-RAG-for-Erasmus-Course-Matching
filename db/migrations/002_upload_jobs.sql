-- Migration 002: Upload Jobs table for queue-based ingestion
-- Run after 001_init.sql

CREATE TABLE IF NOT EXISTS upload_jobs (
    id SERIAL PRIMARY KEY,
    university_id INTEGER NOT NULL REFERENCES universities(id) ON DELETE CASCADE,
    ingestion_batch_id INTEGER REFERENCES ingestion_batches(id) ON DELETE SET NULL,
    semester VARCHAR(20) DEFAULT 'unknown',
    status VARCHAR(20) DEFAULT 'queued'
        CHECK (status IN ('queued', 'uploading', 'parsing', 'paused', 'completed', 'cancelled', 'failed')),
    total_files INTEGER DEFAULT 0,
    processed_files INTEGER DEFAULT 0,
    failed_files INTEGER DEFAULT 0,
    current_file VARCHAR(500),
    error_log TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    completed_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_upload_jobs_university ON upload_jobs(university_id);
CREATE INDEX IF NOT EXISTS idx_upload_jobs_status ON upload_jobs(status);
CREATE INDEX IF NOT EXISTS idx_upload_jobs_created ON upload_jobs(created_at DESC);
