-- 035: Add senate_decision_id FK to grading_scheme_snapshots
ALTER TABLE grading_scheme_snapshots ADD COLUMN IF NOT EXISTS senate_decision_id INTEGER REFERENCES senate_decisions(id) ON DELETE SET NULL;
