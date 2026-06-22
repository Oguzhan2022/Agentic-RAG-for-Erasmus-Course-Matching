from passlib.context import CryptContext
import jwt
from datetime import datetime, timedelta, timezone
from backend.config import settings

# Argon2 is the recommended hash by OWASP and passlib
pwd_context = CryptContext(schemes=["argon2"], deprecated="auto")

JWT_SECRET = settings.jwt_secret
JWT_ALGORITHM = settings.jwt_algorithm
JWT_EXPIRATION_HOURS = settings.jwt_expiration_hours

def hash_password(password: str) -> str:
    """Hash a password using Argon2."""
    return pwd_context.hash(password)

def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify a plain password against a hashed password."""
    return pwd_context.verify(plain_password, hashed_password)

def create_jwt(user_data: dict, expiration_minutes: int = None) -> str:
    if expiration_minutes:
        exp = datetime.now(timezone.utc) + timedelta(minutes=expiration_minutes)
    else:
        exp = datetime.now(timezone.utc) + timedelta(hours=JWT_EXPIRATION_HOURS)
    payload = {
        **user_data,
        "exp": exp,
        "iat": datetime.now(timezone.utc),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)

def decode_jwt(token: str) -> dict:
    return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])

def generate_temp_credentials() -> tuple[str, str]:
    """Generate a temporary username and password for onboarding."""
    import secrets
    import string
    temp_eid = f"temp_{secrets.token_hex(4)}"
    chars = string.ascii_letters + string.digits + "!@#$%"
    temp_password = ''.join(secrets.choice(chars) for _ in range(14))
    return temp_eid, temp_password
