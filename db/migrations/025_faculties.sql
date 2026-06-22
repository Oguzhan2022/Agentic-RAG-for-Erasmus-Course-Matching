-- Task 0.3: Faculty entity migration
-- Sıra önemli: veri taşı → kolon kaldır

-- 1. Faculties tablosunu oluştur
CREATE TABLE IF NOT EXISTS faculties (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) UNIQUE NOT NULL,
    code VARCHAR(20) UNIQUE NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 2. Varsayılan fakülteleri ekle
INSERT INTO faculties (name, code) VALUES
('Faculty of Engineering', 'ENG'),
('Faculty of Architecture', 'ARCH')
ON CONFLICT (code) DO NOTHING;

-- 3. Yeni faculty_id kolonunu ekle
ALTER TABLE departments ADD COLUMN IF NOT EXISTS faculty_id INTEGER REFERENCES faculties(id) ON DELETE SET NULL;

-- 4. Veri taşı: 'Engineering Faculty' yazan COM'u ENG'ye bağla
UPDATE departments
SET faculty_id = (SELECT id FROM faculties WHERE code = 'ENG')
WHERE faculty = 'Engineering Faculty';

-- 5. NULL faculty_id'leri de ENG'ye bağla (SEN)
UPDATE departments
SET faculty_id = (SELECT id FROM faculties WHERE code = 'ENG')
WHERE faculty_id IS NULL;

-- 6. Eski faculty kolonunu kaldır
ALTER TABLE departments DROP COLUMN IF EXISTS faculty;
