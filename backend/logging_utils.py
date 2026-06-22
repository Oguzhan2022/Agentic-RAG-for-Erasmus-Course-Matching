import logging
from datetime import datetime
from zoneinfo import ZoneInfo
import os

def custom_time_converter(*args):
    """Returns the current time in Europe/Istanbul (UTC+3) for logging."""
    return datetime.now(ZoneInfo("Europe/Istanbul")).timetuple()

def setup_logging():
    """Configures global logging to use UTC+3 timestamps."""
    logging.Formatter.converter = custom_time_converter
    
    # Check if we are on Render or local
    log_level = logging.INFO
    
    logging.basicConfig(
        level=log_level,
        format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
        datefmt='%Y-%m-%d %H:%M:%S',
        force=True # Override any previous configuration
    )
    
    # Also attempt to configure uvicorn logging if it's already loaded
    for logger_name in ["uvicorn", "uvicorn.error", "uvicorn.access"]:
        logger = logging.getLogger(logger_name)
        for handler in logger.handlers:
            handler.setFormatter(logging.Formatter(
                '%(asctime)s - %(name)s - %(levelname)s - %(message)s',
                '%Y-%m-%d %H:%M:%S'
            ))
