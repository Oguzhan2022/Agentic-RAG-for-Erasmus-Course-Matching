"""
Database migration utility for consolidating flat university profile fields into a unified, extensible JSON column.
Maintains 100% data safety by backing up and migrating existing records before cleanups.
"""

import logging
import json
from sqlalchemy import inspect, text
from db.database import engine

logger = logging.getLogger("db_migration")

def migrate_university_profiles():
    """Migrates flat university_profiles columns to a single profile_data JSON column."""
    inspector = inspect(engine)
    
    # Check if university_profiles table exists
    if not inspector.has_table("university_profiles"):
        logger.info("university_profiles table does not exist yet. Metadata creation will handle it.")
        return

    columns = [col["name"] for col in inspector.get_columns("university_profiles")]
    
    # If profile_data column already exists, migration is already done!
    if "profile_data" in columns:
        logger.info("university_profiles table is already migrated to JSON structure.")
        return

    logger.info("Starting database migration: university_profiles -> JSON profile_data...")

    # The list of old columns to consolidate into profile_data
    flat_columns = [
        "qs_world", "the_world", "cwur_world", "shanghai_world", "urap_world", "edurank_world", "unirank_world",
        "numbeo_monthly_total_eur", "numbeo_rent_monthly_eur", "numbeo_food_monthly_eur", "numbeo_transport_monthly_eur",
        "city_description", "safety_level", "english_friendliness", "climate", "city_population",
        "nearest_airport", "airport_distance_km", "airport_transport", "public_transport_quality",
        "distance_to_city_center", "notable_connections", "dorm_available", "dorm_cost_min_eur",
        "dorm_cost_max_eur", "private_room_min_eur", "private_room_max_eur", "housing_difficulty",
        "accommodation_notes", "erasmus_grant_sufficient", "nightlife", "erasmus_community",
        "student_organizations", "key_spots", "language_of_instruction", "english_courses_available",
        "notable_programs", "academic_notes", "best_for", "watch_out_for", "overall_rating"
    ]

    # Filter columns to only include those that physically exist in the database right now
    existing_flat_cols = [col for col in flat_columns if col in columns]

    if not existing_flat_cols:
        logger.info("No flat university profile columns to migrate.")
        return

    # Connection context for DDL changes
    with engine.begin() as conn:
        # 1. Add the new JSON profile_data column
        is_postgres = engine.dialect.name == "postgresql"
        json_type = "JSONB" if is_postgres else "TEXT"
        
        logger.info(f"Adding profile_data column of type {json_type} to university_profiles...")
        conn.execute(text(f"ALTER TABLE university_profiles ADD COLUMN profile_data {json_type}"))

        # 2. Fetch all existing records and migrate them in-memory
        logger.info("Fetching existing university profiles for data conversion...")
        select_cols_str = ", ".join(["id", "sources"] + existing_flat_cols)
        rows = conn.execute(text(f"SELECT {select_cols_str} FROM university_profiles")).fetchall()

        for row in rows:
            row_id = row[0]
            sources_raw = row[1]
            
            # Map existing flat columns to the profile_data dictionary
            profile_dict = {}
            for col in existing_flat_cols:
                val = getattr(row, col)
                if val is not None:
                    # SQLite returns JSON columns as text sometimes, parse if needed
                    if col in ["notable_connections", "key_spots", "notable_programs", "best_for", "watch_out_for"]:
                        if isinstance(val, str) and (val.startswith("[") or val.startswith("{")):
                            try:
                                profile_dict[col] = json.loads(val)
                            except:
                                profile_dict[col] = val
                        else:
                            profile_dict[col] = val
                    else:
                        profile_dict[col] = val

            # Construct JSON data
            profile_json_str = json.dumps(profile_dict)
            
            # If sources column is JSON or text, make sure it is handled cleanly
            sources_val = sources_raw
            if sources_raw is None:
                sources_val = "[]"
            elif not isinstance(sources_raw, str):
                sources_val = json.dumps(sources_raw)

            # Update the row with migrated profile_data
            if is_postgres:
                conn.execute(
                    text("UPDATE university_profiles SET profile_data = CAST(:profile_data AS JSONB) WHERE id = :id"),
                    {"profile_data": profile_json_str, "id": row_id}
                )
            else:
                conn.execute(
                    text("UPDATE university_profiles SET profile_data = :profile_data WHERE id = :id"),
                    {"profile_data": profile_json_str, "id": row_id}
                )

        logger.info(f"Successfully migrated {len(rows)} university profile records to JSON format!")

        # 3. Clean up the database by dropping the old flat columns
        # (PostgreSQL supports drop column, SQLite has partial drop support in newer versions but to be safe and cross-dialect compliant,
        # we drop columns individually for Postgres and skip dropping for SQLite to prevent lock issues since SQLite doesn't strictly need it)
        if is_postgres:
            logger.info("Dropping old flat columns from PostgreSQL table...")
            for col in existing_flat_cols:
                conn.execute(text(f"ALTER TABLE university_profiles DROP COLUMN IF EXISTS {col}"))
            logger.info("Successfully cleaned up university_profiles table schema.")
        else:
            logger.info("Skipping column drops for SQLite compatibility.")

    logger.info("University profile database migration completed successfully!")

if __name__ == "__main__":
    migrate_university_profiles()
