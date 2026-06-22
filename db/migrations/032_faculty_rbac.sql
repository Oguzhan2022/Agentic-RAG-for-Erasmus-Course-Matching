-- 032_faculty_rbac.sql
-- Task 5.1 + 5.2: Faculty-based RBAC + Senate decision faculty scoping

-- 1. Add faculty_id to user_role_assignments
ALTER TABLE user_role_assignments
    ADD COLUMN IF NOT EXISTS faculty_id INTEGER REFERENCES faculties(id) ON DELETE SET NULL;

-- 2. Add faculty_id to senate_decisions
ALTER TABLE senate_decisions
    ADD COLUMN IF NOT EXISTS faculty_id INTEGER REFERENCES faculties(id) ON DELETE SET NULL;
