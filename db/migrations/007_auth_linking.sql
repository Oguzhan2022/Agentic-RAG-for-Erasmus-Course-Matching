-- Migration 007: Add CATS linking columns to users table
-- Supports temp-credentials + CATS-link onboarding flow

ALTER TABLE users ADD COLUMN IF NOT EXISTS temp_password_hash VARCHAR(255);
ALTER TABLE users ADD COLUMN IF NOT EXISTS needs_cats_link BOOLEAN DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS cats_linked_at TIMESTAMP;
