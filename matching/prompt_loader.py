"""Prompt template loader with caching."""
from pathlib import Path

PROMPTS_DIR = Path(__file__).parent / "prompts"
_cache = {}

def load_prompt(filename: str) -> str:
    with open(PROMPTS_DIR / filename, "r", encoding="utf-8") as f:
        return f.read()
