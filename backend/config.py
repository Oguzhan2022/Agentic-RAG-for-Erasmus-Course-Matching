import os
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = os.getenv("DATABASE_URL", "postgresql://erasmus:erasmus_dev@localhost:5432/erasmus_match")
    upload_dir: str = os.path.join(os.path.dirname(os.path.dirname(__file__)), "uploads")
    course_contents_dir: str = os.path.join(os.path.dirname(os.path.dirname(__file__)), "Course_Contents")
    gemini_api_key: str = ""
    gemini_model_name: str = "gemma-3-12b-it"

    jwt_secret: str = os.getenv("JWT_SECRET", "")
    jwt_algorithm: str = "HS256"
    jwt_expiration_hours: int = 24
    timezone: str = os.getenv("TZ", "Europe/Istanbul")

    class Config:
        env_file = ".env"
        extra = "ignore"

    def validate_jwt_secret(self):
        if not self.jwt_secret:
            raise ValueError(
                "JWT_SECRET must be set via environment variable or .env file. "
                "Generate one with: python -c \"import secrets; print(secrets.token_hex(32))\""
            )


settings = Settings()
settings.validate_jwt_secret()
