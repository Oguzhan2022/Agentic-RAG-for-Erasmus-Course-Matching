-- Task 1.7: Role-Based Access Control and Department Structure Migration

CREATE TABLE IF NOT EXISTS departments (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) UNIQUE NOT NULL,
    code VARCHAR(20) UNIQUE NOT NULL,
    faculty VARCHAR(255),
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS roles (
    id SERIAL PRIMARY KEY,
    name VARCHAR(50) UNIQUE NOT NULL,
    description VARCHAR(255),
    permissions JSONB DEFAULT '[]',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS user_role_assignments (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL,
    assigned_by INTEGER REFERENCES users(id),
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Initial Roles Seeding
INSERT INTO roles (name, description, permissions) VALUES 
('super_admin', 'Global system administrator with full access', '["all"]'),
('dept_admin', 'Department-level administrator', '["manage_dept_users", "manage_dept_courses"]'),
('coordinator', 'Erasmus coordinator with matching authority', '["match_courses", "view_dept_data"]'),
('student', 'Standard student user', '["view_courses", "request_match"]')
ON CONFLICT (name) DO NOTHING;

-- Initial Department Seeding
INSERT INTO departments (name, code, faculty) VALUES 
('Computer Engineering', 'COM', 'Engineering Faculty'),
('Industrial Engineering', 'IE', 'Engineering Faculty'),
('Architecture', 'ARCH', 'Faculty of Architecture')
ON CONFLICT (code) DO NOTHING;
