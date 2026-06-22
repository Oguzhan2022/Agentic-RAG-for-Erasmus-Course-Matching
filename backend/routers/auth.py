import os
import logging
import httpx
import threading
from datetime import datetime, timezone, timedelta
from collections import defaultdict
from fastapi import APIRouter, Response, Request, HTTPException, Depends
from sqlalchemy.orm import Session, selectinload, joinedload
from pydantic import BaseModel

from db.database import get_db
from db.models import User, Role, UserRoleAssignment, UserCredentials
from authorization.auth_utils import create_jwt, decode_jwt, verify_password
from backend.config import settings

router = APIRouter(prefix="/api/auth", tags=["auth"])
logger = logging.getLogger("auth")

CATS_BASE = "https://cats.iku.edu.tr"

import json
from db.models import SystemLock

# Rate limiting settings
MAX_ATTEMPTS = 5
LOCKOUT_MINUTES = 15

class LoginRequest(BaseModel):
    eid: str
    password: str

def _get_client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"

def _check_rate_limit(ip: str, db: Session):
    now = datetime.now()
    cutoff = now - timedelta(minutes=LOCKOUT_MINUTES)

    # 1. Check active lockout
    lockout_name = f"auth_lockout_{ip}"
    lockout = db.query(SystemLock).filter(SystemLock.name == lockout_name).first()
    if lockout and lockout.is_active:
        if lockout.last_heartbeat and lockout.last_heartbeat > cutoff:
            raise HTTPException(status_code=429, detail="Too many failed attempts. Try again later.")
        else:
            # Lockout expired, deactivate it
            lockout.is_active = False
            db.commit()

    # 2. Check failed attempts counts
    failed_name = f"auth_failed_{ip}"
    failed_record = db.query(SystemLock).filter(SystemLock.name == failed_name).first()
    if failed_record and failed_record.is_active:
        try:
            data = json.loads(failed_record.worker_id)
            attempts = [datetime.fromisoformat(t) for t in data.get("attempts", [])]
            # filter attempts inside cutoff
            attempts = [t for t in attempts if t > cutoff]
            if len(attempts) >= MAX_ATTEMPTS:
                # Forcefully activate lockout
                lockout_record = db.query(SystemLock).filter(SystemLock.name == lockout_name).first()
                if not lockout_record:
                    lockout_record = SystemLock(name=lockout_name, worker_id="lockout", is_active=True, last_heartbeat=now)
                    db.add(lockout_record)
                else:
                    lockout_record.is_active = True
                    lockout_record.last_heartbeat = now
                db.commit()
                raise HTTPException(status_code=429, detail="Too many failed attempts. Try again later.")
        except Exception as e:
            if isinstance(e, HTTPException):
                raise
            logger.error(f"[Auth RateLimit] Failed to parse failed attempts for IP {ip}: {e}")

def _record_failure(ip: str, db: Session):
    now = datetime.now()
    cutoff = now - timedelta(minutes=LOCKOUT_MINUTES)
    failed_name = f"auth_failed_{ip}"
    lockout_name = f"auth_lockout_{ip}"

    failed_record = db.query(SystemLock).filter(SystemLock.name == failed_name).first()
    attempts = []

    if failed_record:
        try:
            data = json.loads(failed_record.worker_id)
            attempts = [datetime.fromisoformat(t) for t in data.get("attempts", [])]
        except Exception:
            pass

    attempts.append(now)
    # filter old attempts
    attempts = [t for t in attempts if t > cutoff]

    if len(attempts) >= MAX_ATTEMPTS:
        # Create or update lockout record
        lockout_record = db.query(SystemLock).filter(SystemLock.name == lockout_name).first()
        if not lockout_record:
            lockout_record = SystemLock(name=lockout_name, worker_id="lockout", is_active=True, last_heartbeat=now)
            db.add(lockout_record)
        else:
            lockout_record.is_active = True
            lockout_record.last_heartbeat = now

    if not failed_record:
        failed_record = SystemLock(
            name=failed_name,
            worker_id=json.dumps({"attempts": [t.isoformat() for t in attempts]}),
            is_active=True,
            last_heartbeat=now
        )
        db.add(failed_record)
    else:
        failed_record.worker_id = json.dumps({"attempts": [t.isoformat() for t in attempts]})
        failed_record.is_active = True
        failed_record.last_heartbeat = now

    try:
        db.commit()
    except Exception as e:
        db.rollback()
        logger.error(f"[Auth RateLimit] Failed to commit failure record for IP {ip}: {e}")

def _clear_failures(ip: str, db: Session):
    failed_name = f"auth_failed_{ip}"
    lockout_name = f"auth_lockout_{ip}"
    db.query(SystemLock).filter(SystemLock.name.in_([failed_name, lockout_name])).delete(synchronize_session=False)
    try:
        db.commit()
    except Exception as e:
        db.rollback()
        logger.error(f"[Auth RateLimit] Failed to clear failures for IP {ip}: {e}")


def _eager_load_user(db: Session, **filters) -> User | None:
    """Load a user with eagerly loaded credentials, role_assignments, roles, and departments."""
    query = db.query(User).options(
        selectinload(User.credentials),
        selectinload(User.role_assignments).joinedload(UserRoleAssignment.role),
        selectinload(User.role_assignments).joinedload(UserRoleAssignment.department)
    )
    for key, val in filters.items():
        query = query.filter(getattr(User, key) == val)
    return query.first()

def get_user_roles_data(user: User):
    """Format user roles for JWT/Frontend."""
    roles = []
    for ra in user.role_assignments:
        if not ra.is_active:
            continue
        roles.append({
            "role": ra.role.name,
            "department_id": ra.department_id,
            "department_name": ra.department.name if ra.department else None,
            "department_code": ra.department.code if ra.department else None,
            "faculty_id": ra.faculty_id,
            "faculty_code": ra.faculty.code if ra.faculty else None,
        })
    return roles

def _compute_is_admin(user: User) -> bool:
    return any(
        ra.role.name in ("super_admin", "dept_admin", "faculty_affairs_admin")
        for ra in user.role_assignments if ra.is_active
    )

def _compute_redirect(roles: list[dict]) -> str:
    role_names = [r["role"] for r in roles]
    if "super_admin" in role_names or "dept_admin" in role_names or "faculty_affairs_admin" in role_names:
        return "/admin"
    if "coordinator" in role_names:
        return "/matching"
    if "registrar" in role_names:
        return "/transcripts"
    if any(r["role"] == "student" and not r.get("department_code") for r in roles):
        return "/select-department"
    return "/"

async def _cats_authenticate(eid: str, password: str) -> dict:
    """Authenticate against CATS portal and return user data."""
    try:
        async with httpx.AsyncClient(follow_redirects=False, timeout=15) as client:
            init = await client.get(f"{CATS_BASE}/portal")
            cookies = dict(init.cookies)
            login_resp = await client.post(
                f"{CATS_BASE}/portal/xlogin",
                data={"eid": eid, "pw": password, "submit": "Giriş"},
                cookies=cookies,
                headers={"Referer": f"{CATS_BASE}/portal"}
            )
            if login_resp.status_code not in (302, 301):
                raise HTTPException(status_code=401, detail="Invalid credentials")

            user_resp = await client.get(
                f"{CATS_BASE}/direct/user/current.json",
                cookies={**cookies, **dict(login_resp.cookies)}
            )
            if user_resp.status_code != 200:
                raise HTTPException(status_code=401, detail="CATS info fetch failed")

            cats_data = user_resp.json()
            if not cats_data.get("eid") or cats_data.get("eid") == "admin":
                raise HTTPException(status_code=401, detail="Invalid credentials")

            return cats_data
    except httpx.RequestError:
        raise HTTPException(status_code=503, detail="CATS portal unreachable")


@router.post("/login")
async def login(body: LoginRequest, request: Request, response: Response, db: Session = Depends(get_db)):
    client_ip = _get_client_ip(request)
    _check_rate_limit(client_ip, db)

    db_user = _eager_load_user(db, eid=body.eid)

    # --- Case 1: Permanent local account (admin) ---
    if db_user and db_user.password_hash and not db_user.needs_cats_link:
        if not verify_password(body.password, db_user.password_hash):
            logger.warning(f"Failed login attempt for local user: {body.eid} from IP: {client_ip}")
            _record_failure(client_ip, db)
            raise HTTPException(status_code=401, detail="Invalid credentials")
        logger.info(f"Successful local login for user: {db_user.eid} (ID: {db_user.id})")

    # --- Case 2: Temp account awaiting CATS link ---
    elif db_user and db_user.needs_cats_link and db_user.temp_password_hash:
        if not verify_password(body.password, db_user.temp_password_hash):
            logger.warning(f"Failed login attempt for temp user: {body.eid} from IP: {client_ip}")
            _record_failure(client_ip, db)
            raise HTTPException(status_code=401, detail="Invalid credentials")
        logger.info(f"Successful temp login for user: {db_user.eid}, needs CATS link")

        _clear_failures(client_ip, db)
        db_user.last_login = datetime.now(timezone.utc)
        db.commit()

        # Return short-lived token for CATS linking (5 min)
        temp_token = create_jwt({"eid": db_user.eid, "link_allowed": True}, expiration_minutes=5)
        return {"success": True, "needs_cats_link": True, "temp_token": temp_token}

    # --- Case 3: CATS portal authentication ---
    else:
        try:
            cats_data = await _cats_authenticate(body.eid, body.password)
        except HTTPException as e:
            if e.status_code == 401:
                logger.warning(f"Failed CATS login attempt for: {body.eid} from IP: {client_ip}")
                _record_failure(client_ip, db)
            raise e

        # Create or update user
        if not db_user:
            db_user = User(
                eid=cats_data["eid"],
                email=cats_data.get("email"),
                name=cats_data.get("displayName"),
            )
            db.add(db_user)
            db.commit()
            db.refresh(db_user)
            # Assign default student role
            student_role = db.query(Role).filter(Role.name == "student").first()
            if student_role:
                db.add(UserRoleAssignment(user_id=db_user.id, role_id=student_role.id))
                db.commit()
            # Reload with relationships
            db_user = _eager_load_user(db, id=db_user.id)
            logger.info(f"New user registered via CATS: {db_user.eid} (ID: {db_user.id})")
        else:
            logger.info(f"Successful CATS login for existing user: {db_user.eid} (ID: {db_user.id})")

    # --- Finalize login ---
    _clear_failures(client_ip, db)
    db_user.last_login = datetime.now(timezone.utc)
    db.commit()

    roles = get_user_roles_data(db_user)
    is_admin = _compute_is_admin(db_user)

    if not any(r["role"] for r in roles):
        return {"success": True, "deactivated": True}

    redirect = _compute_redirect(roles)

    user_data = {
        "eid": db_user.eid,
        "displayName": db_user.name,
        "email": db_user.email or "",
    }
    jwt_payload = {**user_data, "roles": roles, "is_admin": is_admin}
    token = create_jwt(jwt_payload)

    response.set_cookie(
        key="auth_token",
        value=token,
        httponly=True,
        samesite="lax",
        max_age=settings.jwt_expiration_hours * 3600,
        secure=bool(os.getenv("RENDER")),
        path="/"
    )
    return {"success": True, "user": jwt_payload, "redirect": redirect}


@router.post("/link-cats")
async def link_cats(body: LoginRequest, request: Request, response: Response, db: Session = Depends(get_db)):
    """Link a temp-credential account with real CATS identity."""
    # 1. Verify temp token from Authorization header
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing linking token")

    token = auth_header.split(" ")[1]
    try:
        payload = decode_jwt(token)
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid or expired linking token")

    if not payload.get("link_allowed"):
        raise HTTPException(status_code=403, detail="Invalid linking token")

    # 2. Authenticate against CATS
    cats_data = await _cats_authenticate(body.eid, body.password)

    # 3. Check if the CATS eid is already taken by another user
    existing_cats_user = db.query(User).filter(User.eid == cats_data["eid"]).first()
    if existing_cats_user and existing_cats_user.eid != payload["eid"]:
        raise HTTPException(status_code=400, detail="This CATS account is already linked to another user")

    # 4. Update temp user with real CATS identity
    db_user = _eager_load_user(db, eid=payload["eid"])
    if not db_user:
        raise HTTPException(status_code=404, detail="Temp user not found")

    db_user.eid = cats_data["eid"]
    db_user.email = cats_data.get("email")
    db_user.name = cats_data.get("displayName")
    db_user.needs_cats_link = False
    db_user.temp_password_hash = None  # Invalidate temp password
    db_user.last_login = datetime.now(timezone.utc)
    db.commit()
    logger.info(f"Successfully linked CATS account for user: {db_user.eid} (ID: {db_user.id})")

    # Reload for fresh relationships
    db_user = _eager_load_user(db, id=db_user.id)

    # 5. Issue normal JWT cookie
    roles = get_user_roles_data(db_user)
    is_admin = _compute_is_admin(db_user)
    redirect = _compute_redirect(roles)

    user_data = {
        "eid": db_user.eid,
        "displayName": db_user.name,
        "email": db_user.email or "",
    }
    jwt_payload = {**user_data, "roles": roles, "is_admin": is_admin}
    auth_token = create_jwt(jwt_payload)

    response.set_cookie(
        key="auth_token",
        value=auth_token,
        httponly=True,
        samesite="lax",
        max_age=settings.jwt_expiration_hours * 3600,
        secure=bool(os.getenv("RENDER")),
        path="/"
    )
    return {"success": True, "user": jwt_payload, "redirect": redirect}


@router.get("/me")
async def get_me(request: Request, db: Session = Depends(get_db)):
    token = request.cookies.get("auth_token")
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")

    try:
        payload = decode_jwt(token)
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid token")

    db_user = _eager_load_user(db, eid=payload["eid"])
    if not db_user:
        raise HTTPException(status_code=401, detail="User not found")

    return {
        "eid": db_user.eid,
        "displayName": db_user.name,
        "email": db_user.email or "",
        "roles": get_user_roles_data(db_user),
        "is_admin": _compute_is_admin(db_user),
    }

@router.post("/logout")
async def logout(response: Response, request: Request):
    token = request.cookies.get("auth_token")
    if token:
        try:
            payload = decode_jwt(token)
            logger.info(f"User logged out: {payload.get('eid')}")
        except Exception:
            logger.info("Logout for invalid/expired token session")
    
    response.delete_cookie(key="auth_token", path="/")
    return {"success": True}
