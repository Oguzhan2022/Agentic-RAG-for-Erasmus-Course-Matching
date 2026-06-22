-- Migration: Change embedding column from vector(768) to vector(384)
-- Reason: Using all-MiniLM-L6-v2 (384 dim) instead of Gemini (768 dim)

-- Drop old column and recreate with correct dimension
ALTER TABLE courses DROP COLUMN IF EXISTS embedding;
ALTER TABLE courses ADD COLUMN embedding vector(384);

-- Create HNSW index for fast cosine similarity search
CREATE INDEX IF NOT EXISTS idx_courses_embedding_hnsw
ON courses USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);
