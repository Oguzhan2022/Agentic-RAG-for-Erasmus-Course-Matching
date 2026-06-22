-- 034: Add senate_decision_id FK to grading_schemes
ALTER TABLE grading_schemes ADD COLUMN IF NOT EXISTS senate_decision_id INTEGER REFERENCES senate_decisions(id) ON DELETE SET NULL;
