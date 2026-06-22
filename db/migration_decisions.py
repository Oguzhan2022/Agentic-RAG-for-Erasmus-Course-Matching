import json
from db.database import engine
from sqlalchemy import text

def run_migration():
    print("Starting database consolidation: coordinator_decisions -> coordinator_reviews...")
    
    with engine.begin() as conn:
        # 1. Make application_id in coordinator_reviews nullable to handle decisions without application_id
        print("Altering coordinator_reviews.application_id to be nullable...")
        conn.execute(text("ALTER TABLE coordinator_reviews ALTER COLUMN application_id DROP NOT NULL;"))
        
        # 2. Add extra analytics and feedback columns to coordinator_reviews if they don't exist
        columns_to_add = [
            ("partner_course_id", "INTEGER REFERENCES courses(id) ON DELETE CASCADE"),
            ("home_course_id", "INTEGER REFERENCES courses(id) ON DELETE SET NULL"),
            ("course_match_id", "INTEGER REFERENCES course_matches(id) ON DELETE SET NULL"),
            ("override_reason_category", "VARCHAR(60)"),
            ("override_details", "TEXT"),
            ("original_score", "DOUBLE PRECISION"),
            ("original_verification_status", "VARCHAR(20)"),
            ("metadata", "JSONB DEFAULT '{}'")
        ]
        
        for col_name, col_type in columns_to_add:
            # Check if column already exists
            exists = conn.execute(text(
                f"SELECT EXISTS (SELECT 1 FROM information_schema.columns "
                f"WHERE table_name='coordinator_reviews' AND column_name='{col_name}')"
            )).scalar()
            
            if not exists:
                print(f"Adding column {col_name} ({col_type}) to coordinator_reviews...")
                conn.execute(text(f"ALTER TABLE coordinator_reviews ADD COLUMN {col_name} {col_type};"))
            else:
                print(f"Column {col_name} already exists in coordinator_reviews.")

        # 3. Migrate records from coordinator_decisions to coordinator_reviews if the decisions table exists
        decisions_exists = conn.execute(text(
            "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='coordinator_decisions')"
        )).scalar()
        
        if decisions_exists:
            print("Migrating records from coordinator_decisions to coordinator_reviews...")
            # We copy all decisions. If selection_id, partner_course_id, etc. match an existing review, we avoid duplicates
            # by comparing coordinator_id, created_at, action (decision) or simply inserting them all.
            # Since coordinator_decisions has more entries, let's copy them all over cleanly.
            
            # Map columns:
            # decision -> action
            # override_details -> override_details AND notes
            # metadata -> metadata
            insert_sql = """
                INSERT INTO coordinator_reviews (
                    coordinator_id, application_id, selection_id, action, notes, 
                    override_home_course_id, partner_course_id, home_course_id, 
                    course_match_id, override_reason_category, override_details, 
                    original_score, original_verification_status, metadata, created_at
                )
                SELECT 
                    coordinator_id, application_id, selection_id, decision, override_details,
                    override_home_course_id, partner_course_id, home_course_id,
                    course_match_id, override_reason_category, override_details,
                    original_score, original_verification_status, metadata, created_at
                FROM coordinator_decisions
            """
            conn.execute(text(insert_sql))
            print("Records migrated successfully.")
            
            # 4. Drop the coordinator_decisions table
            print("Dropping redundant coordinator_decisions table...")
            conn.execute(text("DROP TABLE IF EXISTS coordinator_decisions CASCADE;"))
            print("Redundant table coordinator_decisions dropped successfully!")
        else:
            print("coordinator_decisions table does not exist or has already been dropped.")
            
    print("Consolidation migration complete!")

if __name__ == "__main__":
    run_migration()
