-- 019_university_profiles.sql
-- Stores rich university profile data scraped from ranking sites + LLM-generated content

CREATE TABLE IF NOT EXISTS university_profiles (
    id                          SERIAL PRIMARY KEY,
    university_id               INTEGER NOT NULL UNIQUE REFERENCES universities(id) ON DELETE CASCADE,

    -- Rankings (scraped)
    qs_world                    INTEGER,
    qs_subject                  INTEGER,
    qs_subject_name             VARCHAR(100),
    the_world                   INTEGER,
    the_subject                 INTEGER,
    the_subject_name            VARCHAR(100),
    cwur_world                  INTEGER,
    shanghai_world              INTEGER,
    urap_world                  INTEGER,
    edurank_world               INTEGER,
    edurank_cs                  INTEGER,
    unirank_world               INTEGER,
    unirank_country             INTEGER,
    rankings_scraped_at         TIMESTAMP,

    -- Numbeo cost of living (scraped)
    numbeo_city_slug            VARCHAR(100),
    numbeo_monthly_total_eur    INTEGER,
    numbeo_rent_monthly_eur     INTEGER,
    numbeo_food_monthly_eur     INTEGER,
    numbeo_transport_monthly_eur INTEGER,
    numbeo_scraped_at           TIMESTAMP,

    -- LLM-generated content (coordinator copy-pastes JSON)
    city_description            TEXT,
    safety_level                VARCHAR(20),       -- high/medium/low
    english_friendliness        VARCHAR(20),
    climate                     VARCHAR(255),
    city_population             INTEGER,

    nearest_airport             VARCHAR(255),
    airport_distance_km         INTEGER,
    airport_transport           TEXT,
    public_transport_quality    TEXT,
    distance_to_city_center     VARCHAR(100),
    notable_connections         JSONB DEFAULT '[]',

    dorm_available              BOOLEAN,
    dorm_cost_min_eur           INTEGER,
    dorm_cost_max_eur           INTEGER,
    private_room_min_eur        INTEGER,
    private_room_max_eur        INTEGER,
    housing_difficulty          VARCHAR(20),       -- easy/moderate/hard
    accommodation_notes         TEXT,

    erasmus_grant_sufficient    BOOLEAN,
    numbeo_url                  VARCHAR(500),

    nightlife                   TEXT,
    erasmus_community           TEXT,
    student_organizations       TEXT,
    key_spots                   JSONB DEFAULT '[]',

    language_of_instruction     VARCHAR(100),
    english_courses_available   BOOLEAN,
    notable_programs            JSONB DEFAULT '[]',
    academic_notes              TEXT,

    best_for                    JSONB DEFAULT '[]',
    watch_out_for               JSONB DEFAULT '[]',
    overall_rating              VARCHAR(30),       -- budget_heaven/good_value/expensive

    sources                     JSONB DEFAULT '[]',   -- [{title, url}]

    llm_imported_at             TIMESTAMP,
    created_at                  TIMESTAMP DEFAULT NOW(),
    updated_at                  TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_university_profiles_university_id ON university_profiles(university_id);
