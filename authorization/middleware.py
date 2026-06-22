from fastapi import Request, HTTPException, Depends
from typing import List
from sqlalchemy.orm import Session, selectinload, joinedload
from db.database import get_db
from db.models import User, UserRoleAssignment, Role, Department, AuditLog
import jwt

from backend.config import settings

JWT_SECRET = settings.jwt_secret
JWT_ALGORITHM = settings.jwt_algorithm

def decode_jwt(token: str) -> dict:
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

async def get_current_user(request: Request, db: Session = Depends(get_db)) -> User:
    token = request.cookies.get("auth_token")
    if not token:
        auth_header = request.headers.get("Authorization")
        if auth_header and auth_header.startswith("Bearer "):
            token = auth_header.split(" ")[1]
        else:
            raise HTTPException(status_code=401, detail="Not authenticated")

    payload = decode_jwt(token)
    eid = payload.get("eid")
    if not eid:
        raise HTTPException(status_code=401, detail="Invalid token payload")

    user = db.query(User).options(
        selectinload(User.role_assignments).joinedload(UserRoleAssignment.role),
        selectinload(User.role_assignments).joinedload(UserRoleAssignment.department)
    ).filter(User.eid == eid).first()
    if not user:
        raise HTTPException(status_code=401, detail="User not found")

    if not any(ra.is_active for ra in user.role_assignments):
        raise HTTPException(status_code=403, detail="User account is deactivated")

    return user


def _get_user_role_names(user: User) -> List[str]:
    return [ra.role.name for ra in user.role_assignments if ra.is_active]


def _resolve_accessible_dept_ids(user: User, db: Session) -> List[int] | None:
    """Resolve all department IDs accessible to a user based on their role assignments.

    - Faculty-based roles (registrar, faculty_affairs_admin):
      Returns ALL department_id values under the user's faculty assignment(s).
    - Department-based roles (dept_admin, coordinator, student):
      Returns the user's direct department_id assignment(s).
    - super_admin: returns None (meaning all/allowed everywhere).

    Returns None if user has super_admin or should have global access.
    Returns empty list if user has no scope at all (shouldn't happen).
    """
    role_names = _get_user_role_names(user)
    if "super_admin" in role_names:
        return None  # global access

    dept_ids: set[int] = set()

    for ra in user.role_assignments:
        if not ra.is_active:
            continue
        # Faculty-scoped roles: expand faculty → all child departments
        if ra.role.name in ("registrar", "faculty_affairs_admin"):
            if ra.faculty_id:
                child_depts = db.query(Department).filter(
                    Department.faculty_id == ra.faculty_id
                ).all()
                for d in child_depts:
                    dept_ids.add(d.id)
        # Department-scoped roles or direct department assignment
        if ra.department_id:
            dept_ids.add(ra.department_id)

    return list(dept_ids)

def require_role(allowed_roles: List[str], department_aware: bool = False):
    """
    Dependency factory for role checks.
    If department_aware is True, checks if user has the role for the specific
    department referenced in the request (query param or path param department_id).
    """
    async def role_checker(
        request: Request,
        user: User = Depends(get_current_user),
        db: Session = Depends(get_db)
    ):
        # Super admin always bypasses
        user_role_names = [ra.role.name for ra in user.role_assignments if ra.is_active]
        if "super_admin" in user_role_names:
            return user

        if not department_aware:
            # Simple role check — any active matching role is enough
            for ra in user.role_assignments:
                if ra.is_active and ra.role.name in allowed_roles:
                    return user
        else:
            # Department-aware: check if user has the role for the requested department
            dept_id = (
                request.query_params.get("department_id")
                or request.path_params.get("dept_id")
            )
            for ra in user.role_assignments:
                if ra.is_active and ra.role.name in allowed_roles:
                    # If no dept_id in request or role has no dept scope, allow
                    if dept_id is None or ra.department_id is None or str(ra.department_id) == str(dept_id):
                        return user

            # Log unauthorized department access attempt
            try:
                log = AuditLog(
                    actor_id=user.id,
                    action="UNAUTHORIZED_ACCESS",
                    details={
                        "path": str(request.url.path),
                        "method": request.method,
                        "required_roles": allowed_roles,
                        "department_id": dept_id,
                    }
                )
                db.add(log)
                db.commit()
            except Exception:
                db.rollback()

            raise HTTPException(
                status_code=403,
                detail="No access to this department"
            )

        # Log unauthorized access attempt
        try:
            log = AuditLog(
                actor_id=user.id,
                action="UNAUTHORIZED_ACCESS",
                details={
                    "path": str(request.url.path),
                    "method": request.method,
                    "required_roles": allowed_roles,
                }
            )
            db.add(log)
            db.commit()
        except Exception:
            db.rollback()

        raise HTTPException(
            status_code=403,
            detail=f"Operation requires roles: {', '.join(allowed_roles)}"
        )
    return role_checker

def require_super_admin():
    return require_role(["super_admin"])

def require_admin_or_coordinator():
    return require_role(["super_admin", "dept_admin", "coordinator", "faculty_affairs_admin"])
