"""Start the FastAPI server with auto table creation."""
import os
import uvicorn
import sys
import logging
from backend.logging_utils import setup_logging
setup_logging()
logger = logging.getLogger("run_server")

from db.database import engine, Base
# Import models to ensure they are registered with Base.metadata
from db.models import University, IngestionBatch, Course, User, UniversityProfile

# Create all tables
try:
    logger.info("Attempting to create database tables...")
    Base.metadata.create_all(bind=engine)
    logger.info("Database tables created successfully.")
except Exception as e:
    logger.error(f"CRITICAL ERROR: Failed to create database tables: {e}")
    # In production, we might want to continue or exit depending on config
    # For now, let's see why it fails
    if os.getenv("RENDER"):
        logger.error("Database connection failed on Render. Check DATABASE_URL.")

if __name__ == "__main__":
    port = int(os.getenv("PORT", 8000))
    is_render = os.getenv("RENDER") is not None
    
    logger.info(f"Starting uvicorn on port {port} (RENDER={is_render})")
    
    try:
        reload_dirs = ["backend", "db", "ingestion", "matching"] if not is_render else None
        uvicorn.run(
            "backend.main:app", 
            host="0.0.0.0", 
            port=port, 
            reload=not is_render, # no reload on Render
            reload_dirs=reload_dirs,
            log_level="info"
        )
    except Exception as e:
        logger.error(f"Uvicorn failed to start: {e}")
        sys.exit(1)
