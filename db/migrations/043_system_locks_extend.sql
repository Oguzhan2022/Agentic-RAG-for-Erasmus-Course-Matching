-- Migration: 043_system_locks_extend.sql
-- Goal: Extend system_locks.worker_id type length to allow larger JSON strings for progress and auth limits

BEGIN;

CREATE TABLE IF NOT EXISTS system_locks (
    name VARCHAR(255) PRIMARY KEY,
    worker_id VARCHAR(255) NOT NULL,
    last_heartbeat TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    worker_pid INTEGER,
    hostname VARCHAR(255)
);

ALTER TABLE system_locks ALTER COLUMN worker_id TYPE VARCHAR(1000);

COMMIT;
