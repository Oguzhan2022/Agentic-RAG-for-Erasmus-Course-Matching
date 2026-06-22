-- 020_fix_university_profiles.sql
-- Adds missing columns to university_profiles in case the table was created before 019 added them

ALTER TABLE university_profiles ADD COLUMN IF NOT EXISTS qs_world                    INTEGER;
ALTER TABLE university_profiles ADD COLUMN IF NOT EXISTS qs_subject                  INTEGER;
ALTER TABLE university_profiles ADD COLUMN IF NOT EXISTS qs_subject_name             VARCHAR(100);
ALTER TABLE university_profiles ADD COLUMN IF NOT EXISTS the_world                   INTEGER;
ALTER TABLE university_profiles ADD COLUMN IF NOT EXISTS the_subject                 INTEGER;
ALTER TABLE university_profiles ADD COLUMN IF NOT EXISTS the_subject_name            VARCHAR(100);
ALTER TABLE university_profiles ADD COLUMN IF NOT EXISTS cwur_world                  INTEGER;
ALTER TABLE university_profiles ADD COLUMN IF NOT EXISTS shanghai_world              INTEGER;
ALTER TABLE university_profiles ADD COLUMN IF NOT EXISTS urap_world                  INTEGER;
ALTER TABLE university_profiles ADD COLUMN IF NOT EXISTS edurank_world               INTEGER;
ALTER TABLE university_profiles ADD COLUMN IF NOT EXISTS edurank_cs                  INTEGER;
ALTER TABLE university_profiles ADD COLUMN IF NOT EXISTS unirank_world               INTEGER;
ALTER TABLE university_profiles ADD COLUMN IF NOT EXISTS unirank_country             INTEGER;
ALTER TABLE university_profiles ADD COLUMN IF NOT EXISTS rankings_scraped_at         TIMESTAMP;

ALTER TABLE university_profiles ADD COLUMN IF NOT EXISTS numbeo_city_slug            VARCHAR(100);
ALTER TABLE university_profiles ADD COLUMN IF NOT EXISTS numbeo_monthly_total_eur    INTEGER;
ALTER TABLE university_profiles ADD COLUMN IF NOT EXISTS numbeo_rent_monthly_eur     INTEGER;
ALTER TABLE university_profiles ADD COLUMN IF NOT EXISTS numbeo_food_monthly_eur     INTEGER;
ALTER TABLE university_profiles ADD COLUMN IF NOT EXISTS numbeo_transport_monthly_eur INTEGER;
ALTER TABLE university_profiles ADD COLUMN IF NOT EXISTS numbeo_scraped_at           TIMESTAMP;

ALTER TABLE university_profiles ADD COLUMN IF NOT EXISTS city_description            TEXT;
ALTER TABLE university_profiles ADD COLUMN IF NOT EXISTS safety_level                VARCHAR(20);
ALTER TABLE university_profiles ADD COLUMN IF NOT EXISTS english_friendliness        VARCHAR(20);
ALTER TABLE university_profiles ADD COLUMN IF NOT EXISTS climate                     VARCHAR(255);
ALTER TABLE university_profiles ADD COLUMN IF NOT EXISTS city_population             INTEGER;

ALTER TABLE university_profiles ADD COLUMN IF NOT EXISTS nearest_airport             VARCHAR(255);
ALTER TABLE university_profiles ADD COLUMN IF NOT EXISTS airport_distance_km         INTEGER;
ALTER TABLE university_profiles ADD COLUMN IF NOT EXISTS airport_transport           TEXT;
ALTER TABLE university_profiles ADD COLUMN IF NOT EXISTS public_transport_quality    TEXT;
ALTER TABLE university_profiles ADD COLUMN IF NOT EXISTS distance_to_city_center     VARCHAR(100);
ALTER TABLE university_profiles ADD COLUMN IF NOT EXISTS notable_connections         JSONB DEFAULT '[]';

ALTER TABLE university_profiles ADD COLUMN IF NOT EXISTS dorm_available              BOOLEAN;
ALTER TABLE university_profiles ADD COLUMN IF NOT EXISTS dorm_cost_min_eur           INTEGER;
ALTER TABLE university_profiles ADD COLUMN IF NOT EXISTS dorm_cost_max_eur           INTEGER;
ALTER TABLE university_profiles ADD COLUMN IF NOT EXISTS private_room_min_eur        INTEGER;
ALTER TABLE university_profiles ADD COLUMN IF NOT EXISTS private_room_max_eur        INTEGER;
ALTER TABLE university_profiles ADD COLUMN IF NOT EXISTS housing_difficulty          VARCHAR(20);
ALTER TABLE university_profiles ADD COLUMN IF NOT EXISTS accommodation_notes         TEXT;

ALTER TABLE university_profiles ADD COLUMN IF NOT EXISTS erasmus_grant_sufficient    BOOLEAN;
ALTER TABLE university_profiles ADD COLUMN IF NOT EXISTS numbeo_url                  VARCHAR(500);

ALTER TABLE university_profiles ADD COLUMN IF NOT EXISTS nightlife                   TEXT;
ALTER TABLE university_profiles ADD COLUMN IF NOT EXISTS erasmus_community           TEXT;
ALTER TABLE university_profiles ADD COLUMN IF NOT EXISTS student_organizations       TEXT;
ALTER TABLE university_profiles ADD COLUMN IF NOT EXISTS key_spots                   JSONB DEFAULT '[]';

ALTER TABLE university_profiles ADD COLUMN IF NOT EXISTS language_of_instruction     VARCHAR(100);
ALTER TABLE university_profiles ADD COLUMN IF NOT EXISTS english_courses_available   BOOLEAN;
ALTER TABLE university_profiles ADD COLUMN IF NOT EXISTS notable_programs            JSONB DEFAULT '[]';
ALTER TABLE university_profiles ADD COLUMN IF NOT EXISTS academic_notes              TEXT;

ALTER TABLE university_profiles ADD COLUMN IF NOT EXISTS best_for                    JSONB DEFAULT '[]';
ALTER TABLE university_profiles ADD COLUMN IF NOT EXISTS watch_out_for               JSONB DEFAULT '[]';
ALTER TABLE university_profiles ADD COLUMN IF NOT EXISTS overall_rating              VARCHAR(30);

ALTER TABLE university_profiles ADD COLUMN IF NOT EXISTS sources                     JSONB DEFAULT '[]';
ALTER TABLE university_profiles ADD COLUMN IF NOT EXISTS llm_imported_at             TIMESTAMP;
ALTER TABLE university_profiles ADD COLUMN IF NOT EXISTS created_at                  TIMESTAMP DEFAULT NOW();
ALTER TABLE university_profiles ADD COLUMN IF NOT EXISTS updated_at                  TIMESTAMP DEFAULT NOW();
