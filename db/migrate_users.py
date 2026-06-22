import os
import sys

# Add the project root to sys.path to allow imports from db and backend
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import create_engine, text
from db.database import DATABASE_URL

def migrate():
    engine = create_engine(DATABASE_URL)
    with engine.connect() as conn:
        print("Checking 'users' table...")

        # Check if 'eid' column exists
        res = conn.execute(text("SELECT column_name FROM information_schema.columns WHERE table_name='users' AND column_name='eid'"))
        if not res.fetchone():
            print("Adding 'eid' column...")
            conn.execute(text("ALTER TABLE users ADD COLUMN eid VARCHAR(50) UNIQUE"))

        # Check if 'last_login' column exists
        res = conn.execute(text("SELECT column_name FROM information_schema.columns WHERE table_name='users' AND column_name='last_login'"))
        if not res.fetchone():
            print("Adding 'last_login' column...")
            conn.execute(text("ALTER TABLE users ADD COLUMN last_login TIMESTAMP"))

        # Check if 'updated_at' column exists
        res = conn.execute(text("SELECT column_name FROM information_schema.columns WHERE table_name='users' AND column_name='updated_at'"))
        if not res.fetchone():
            print("Adding 'updated_at' column...")
            conn.execute(text("ALTER TABLE users ADD COLUMN updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP"))

        # Remove old columns if they exist
        for col in ['role', 'department', 'display_name', 'first_name', 'last_name', 'cats_linked_at', 'is_active']:
            res = conn.execute(text(f"SELECT column_name FROM information_schema.columns WHERE table_name='users' AND column_name='{col}'"))
            if res.fetchone():
                print(f"Removing '{col}' column...")
                conn.execute(text(f"ALTER TABLE users DROP COLUMN {col}"))

        # Create user_credentials table if it doesn't exist
        res = conn.execute(text("SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name='user_credentials')"))
        if not res.fetchone()[0]:
            print("Creating 'user_credentials' table...")
            conn.execute(text("""
                CREATE TABLE user_credentials (
                    id SERIAL PRIMARY KEY,
                    user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
                    password_hash VARCHAR(255),
                    temp_password_hash VARCHAR(255),
                    needs_cats_link BOOLEAN DEFAULT FALSE
                )
            """))

        # Migrate credential data from users if old columns still exist
        res = conn.execute(text("SELECT column_name FROM information_schema.columns WHERE table_name='users' AND column_name='password_hash'"))
        if res.fetchone():
            print("Migrating credentials from users to user_credentials...")
            conn.execute(text("""
                INSERT INTO user_credentials (user_id, password_hash, temp_password_hash, needs_cats_link)
                SELECT id, password_hash, temp_password_hash, COALESCE(needs_cats_link, FALSE)
                FROM users
                ON CONFLICT (user_id) DO NOTHING
            """))

            # Drop old credential columns from users
            for col in ['password_hash', 'temp_password_hash', 'needs_cats_link']:
                print(f"Removing '{col}' column from users...")
                conn.execute(text(f"ALTER TABLE users DROP COLUMN {col}"))

        conn.commit()
    print("Migration completed.")

if __name__ == "__main__":
    migrate()
