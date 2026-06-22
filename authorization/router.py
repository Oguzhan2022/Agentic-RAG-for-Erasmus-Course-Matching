from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy.orm import Session, joinedload, selectinload
from sqlalchemy import or_
from typing import List

from db.database import get_db
from db.models import User, Role, Department, Faculty, UserRoleAssignment, AuditLog
from .schemas import (
    UserRead, RoleRead, DepartmentRead, UserCreate, DepartmentCreate, DepartmentUpdate,
    AuditLogRead, UserRoleAssignmentUpdate, TempUserCreate, TempCredentialsResponse,
    AuditLogPagination, FacultyCreate, FacultyRead, FacultyUpdate
)
from .middleware import require_super_admin, require_admin_or_coordinator, get_current_user
from .auth_utils import hash_password, generate_temp_credentials

router = APIRouter(prefix="/api/admin", tags=["admin"])


def _get_admin_dept_ids(user: User) -> list[int]:
    """Return department IDs where user is dept_admin. Empty list if super_admin (means all)."""
    return [
        ra.department_id for ra in user.role_assignments
        if ra.is_active and ra.role.name == "dept_admin" and ra.department_id
    ]


def _get_admin_faculty_ids(user: User) -> list[int]:
    """Return faculty IDs where user is faculty_affairs_admin."""
    return [
        ra.faculty_id for ra in user.role_assignments
        if ra.is_active and ra.role.name == "faculty_affairs_admin" and ra.faculty_id
    ]


def _is_super_admin(user: User) -> bool:
    return any(ra.role.name == "super_admin" and ra.is_active for ra in user.role_assignments)


def _is_faculty_affairs_admin(user: User) -> bool:
    return any(ra.role.name == "faculty_affairs_admin" and ra.is_active for ra in user.role_assignments)


def _get_accessible_dept_ids(user: User) -> list[int]:
    """Return all department IDs this user can access, resolving faculty scope if applicable."""
    dept_ids = set(
        ra.department_id for ra in user.role_assignments
        if ra.is_active and ra.department_id
    )
    # Faculty-based roles: expand to all departments under assigned faculties
    from db.models import Department
    from sqlalchemy.orm import Session
    # We need a temp session for this — caller should pass db
    return list(dept_ids)


def _get_accessible_dept_ids_from_db(user: User, db: Session) -> list[int]:
    """Return all department IDs accessible to user, resolving faculty_id → all child departments."""
    dept_ids = set()
    for ra in user.role_assignments:
        if not ra.is_active:
            continue
        if ra.department_id:
            dept_ids.add(ra.department_id)
        if ra.faculty_id:
            # Expand faculty to all its departments
            child_depts = db.query(Department).filter(
                Department.faculty_id == ra.faculty_id
            ).all()
            for d in child_depts:
                dept_ids.add(d.id)
    return list(dept_ids)


def _can_manage_department(user: User, department_id: int | None) -> bool:
    """Check if user can manage the given department (super_admin can manage all)."""
    if _is_super_admin(user):
        return True
    if department_id is None:
        return False
    return department_id in _get_admin_dept_ids(user)


def _can_manage_faculty(user: User, faculty_id: int | None) -> bool:
    """Check if user can manage the given faculty."""
    if _is_super_admin(user):
        return True
    if faculty_id is None:
        return False
    return faculty_id in _get_admin_faculty_ids(user)


def _registrar_manageable_roles() -> list[str]:
    """Roles that faculty_affairs_admin is allowed to assign."""
    return ["registrar"]

# --- Department Management ---

@router.get("/departments", response_model=List[DepartmentRead])
def list_departments(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """List departments. Dept admins see their depts; faculty affairs admins see depts in their faculty."""
    if _is_super_admin(current_user):
        return db.query(Department).order_by(Department.name).all()
        
    my_dept_ids = _get_accessible_dept_ids_from_db(current_user, db)
    
    if not my_dept_ids:
        return []

    return db.query(Department).filter(Department.id.in_(my_dept_ids)).order_by(Department.name).all()


@router.post("/departments", response_model=DepartmentRead)
def create_department(
    dept: DepartmentCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_super_admin())
):
    existing_name = db.query(Department).filter(Department.name == dept.name).first()
    if existing_name:
        raise HTTPException(status_code=400, detail="Department name already exists")

    existing_code = db.query(Department).filter(Department.code == dept.code).first()
    if existing_code:
        raise HTTPException(status_code=400, detail="Department code already exists")

    db_dept = Department(name=dept.name, code=dept.code, faculty_id=dept.faculty_id)
    db.add(db_dept)

    log = AuditLog(
        actor_id=current_user.id,
        action="CREATE_DEPARTMENT",
        details={"name": dept.name, "code": dept.code}
    )
    db.add(log)
    db.commit()
    db.refresh(db_dept)
    return db_dept

@router.patch("/departments/{dept_id}", response_model=DepartmentRead)
def update_department(
    dept_id: int,
    data: DepartmentUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_super_admin())
):
    dept = db.query(Department).filter(Department.id == dept_id).first()
    if not dept:
        raise HTTPException(status_code=404, detail="Department not found")

    if not _can_manage_department(current_user, dept_id):
        raise HTTPException(status_code=403, detail="Cannot manage this department")

    changes = {}
    if data.name is not None:
        existing = db.query(Department).filter(Department.name == data.name, Department.id != dept_id).first()
        if existing:
            raise HTTPException(status_code=400, detail="Department name already exists")
        changes["name"] = f"{dept.name} -> {data.name}"
        dept.name = data.name
    if data.code is not None:
        existing = db.query(Department).filter(Department.code == data.code, Department.id != dept_id).first()
        if existing:
            raise HTTPException(status_code=400, detail="Department code already exists")
        changes["code"] = f"{dept.code} -> {data.code}"
        dept.code = data.code
    if data.faculty_id is not None:
        fac = db.query(Faculty).filter(Faculty.id == data.faculty_id).first()
        if not fac:
            raise HTTPException(status_code=400, detail="Faculty not found")
        changes["faculty_id"] = f"{dept.faculty_id} -> {data.faculty_id}"
        dept.faculty_id = data.faculty_id
    if data.is_active is not None:
        changes["is_active"] = f"{dept.is_active} -> {data.is_active}"
        dept.is_active = data.is_active

    log = AuditLog(
        actor_id=current_user.id,
        action="UPDATE_DEPARTMENT",
        details={"department_id": dept_id, "changes": changes}
    )
    db.add(log)
    db.commit()
    db.refresh(dept)
    return dept


@router.delete("/departments/{dept_id}")
def delete_department(
    dept_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_super_admin())
):
    dept = db.query(Department).filter(Department.id == dept_id).first()
    if not dept:
        raise HTTPException(status_code=404, detail="Department not found")

    active_assignments = db.query(UserRoleAssignment).filter(
        UserRoleAssignment.department_id == dept_id
    ).count()
    if active_assignments > 0:
        db.query(UserRoleAssignment).filter(
            UserRoleAssignment.department_id == dept_id
        ).delete()

    log = AuditLog(
        actor_id=current_user.id,
        action="DELETE_DEPARTMENT",
        details={"department_id": dept_id, "name": dept.name}
    )
    db.add(log)
    db.delete(dept)
    db.commit()
    return {"success": True, "id": dept_id}

# --- User & Role Management ---

@router.get("/users", response_model=List[UserRead])
def list_users(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin_or_coordinator())
):
    """List users. Dept admins see their dept; faculty_affairs_admin sees own faculty registrars."""
    user_role_names = [ra.role.name for ra in current_user.role_assignments if ra.is_active]
    query = db.query(User).options(
        selectinload(User.credentials),
        selectinload(User.role_assignments).joinedload(UserRoleAssignment.role),
        selectinload(User.role_assignments).joinedload(UserRoleAssignment.department),
        selectinload(User.role_assignments).joinedload(UserRoleAssignment.faculty)
    )

    if "super_admin" not in user_role_names:
        is_fac_admin = "faculty_affairs_admin" in user_role_names
        if is_fac_admin:
            # Faculty affairs admin: own faculty + only registrar/registrar users
            my_fac_ids = [
                ra.faculty_id for ra in current_user.role_assignments
                if ra.is_active and ra.role.name == "faculty_affairs_admin" and ra.faculty_id
            ]
            if my_fac_ids:
                registrar_role_ids = [
                    r.id for r in db.query(Role).filter(Role.name.in_(["registrar", "registrar"])).all()
                ]
                registrar_user_ids = [
                    ura.user_id for ura in db.query(UserRoleAssignment).filter(
                        UserRoleAssignment.role_id.in_(registrar_role_ids),
                        UserRoleAssignment.is_active == True,
                        UserRoleAssignment.faculty_id.in_(my_fac_ids),
                    ).distinct().all()
                ]
                # Also include super_admins for visibility
                super_admin_user_ids = [
                    ura.user_id for ura in db.query(UserRoleAssignment).join(Role).filter(
                        Role.name == "super_admin",
                        UserRoleAssignment.is_active == True
                    ).distinct().all()
                ]
                allowed_ids = set(registrar_user_ids) | set(super_admin_user_ids) | {current_user.id}
                if allowed_ids:
                    query = query.filter(User.id.in_(allowed_ids))
                else:
                    return []
            else:
                return []
        else:
            # Dept admin / coordinator: own department
            my_dept_ids = [
                ra.department_id for ra in current_user.role_assignments
                if ra.is_active and ra.department_id
            ]
            if my_dept_ids:
                super_admin_user_ids = [
                    ura.user_id for ura in db.query(UserRoleAssignment).join(Role).filter(
                        Role.name == "super_admin",
                        UserRoleAssignment.is_active == True
                    ).distinct().all()
                ]
                query = query.filter(
                    or_(
                        User.id.in_(
                            db.query(UserRoleAssignment.user_id).filter(
                                UserRoleAssignment.department_id.in_(my_dept_ids)
                            )
                        ),
                        User.id.in_(super_admin_user_ids) if super_admin_user_ids else False,
                    )
                )
            else:
                return []

    return query.all()

@router.post("/users", response_model=UserRead)
def create_managed_user(
    user_data: UserCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin_or_coordinator())
):
    """Create a user (admin or coordinator) with a manual password."""
    existing_eid = db.query(User).filter(User.eid == user_data.eid).first()
    if existing_eid:
        raise HTTPException(status_code=400, detail="User with this EID already exists")

    if user_data.email:
        existing_email = db.query(User).filter(User.email == user_data.email).first()
        if existing_email:
            raise HTTPException(status_code=400, detail="User with this email already exists")

    new_user = User(
        eid=user_data.eid,
        email=user_data.email,
        name=user_data.name,
        is_active=True
    )
    if user_data.password:
        new_user.password_hash = hash_password(user_data.password)
    db.add(new_user)
    db.flush()

    if not user_data.role_names:
        user_data.role_names = ["student"]

    for role_name in user_data.role_names:
        role = db.query(Role).filter(Role.name == role_name).first()
        if not role:
            raise HTTPException(status_code=400, detail=f"Role '{role_name}' does not exist")
        assignment = UserRoleAssignment(
            user_id=new_user.id,
            role_id=role.id,
            department_id=user_data.department_id,
            assigned_by=current_user.id
        )
        db.add(assignment)

    log = AuditLog(
        actor_id=current_user.id,
        action="CREATE_USER",
        target_user_id=new_user.id,
        details={"eid": user_data.eid, "roles": user_data.role_names}
    )
    db.add(log)
    db.commit()

    user = db.query(User).options(
        selectinload(User.credentials),
        selectinload(User.role_assignments).joinedload(UserRoleAssignment.role),
        selectinload(User.role_assignments).joinedload(UserRoleAssignment.department)
    ).filter(User.id == new_user.id).first()

    return user

@router.post("/users/generate-temp-credentials", response_model=TempCredentialsResponse)
def generate_temp_user(
    data: TempUserCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin_or_coordinator())
):
    """Generate temp credentials for a new staff member. They must link via CATS on first login."""
    is_super = _is_super_admin(current_user)
    is_fac_admin = _is_faculty_affairs_admin(current_user)

    # ── Scope checks ──
    if is_fac_admin:
        # Faculty affairs admin: only within own faculty, only registrar/registrar roles
        my_fac_ids = _get_admin_faculty_ids(current_user)
        if not my_fac_ids:
            raise HTTPException(status_code=403, detail="No faculty admin privileges")
        if data.faculty_id and data.faculty_id not in my_fac_ids:
            raise HTTPException(status_code=403, detail="Cannot create users for other faculties")
        allowed_roles = set(_registrar_manageable_roles())
        if set(data.role_names) - allowed_roles:
            raise HTTPException(status_code=403, detail=f"Can only assign roles: {', '.join(allowed_roles)}")
        # Fallback: use first assigned faculty if none specified
        if not data.faculty_id:
            data.faculty_id = my_fac_ids[0]
    elif not is_super:
        # Dept admin: can only generate for their own department
        admin_dept_ids = _get_admin_dept_ids(current_user)
        if not admin_dept_ids:
            raise HTTPException(status_code=403, detail="No department admin privileges")
        if data.department_id and data.department_id not in admin_dept_ids:
            raise HTTPException(status_code=403, detail="Cannot create users for other departments")
        # Dept admins cannot create super_admin or dept_admin roles
        forbidden = {"super_admin", "dept_admin", "faculty_affairs_admin"}
        if forbidden & set(data.role_names):
            raise HTTPException(status_code=403, detail="Cannot assign admin roles")

    temp_eid, temp_password = generate_temp_credentials()

    new_user = User(
        eid=temp_eid,
        name=data.name,
        is_active=True
    )
    new_user.temp_password_hash = hash_password(temp_password)
    new_user.needs_cats_link = True
    db.add(new_user)
    db.flush()

    if not data.role_names:
        data.role_names = ["coordinator"]

    for role_name in data.role_names:
        role = db.query(Role).filter(Role.name == role_name).first()
        if not role:
            raise HTTPException(status_code=400, detail=f"Role '{role_name}' does not exist")
        db.add(UserRoleAssignment(
            user_id=new_user.id,
            role_id=role.id,
            department_id=data.department_id if not is_fac_admin else None,
            faculty_id=data.faculty_id,
            assigned_by=current_user.id
        ))

    log = AuditLog(
        actor_id=current_user.id,
        action="GENERATE_TEMP_CREDENTIALS",
        target_user_id=new_user.id,
        details={"temp_eid": temp_eid, "roles": data.role_names, "department_id": data.department_id, "faculty_id": data.faculty_id}
    )
    db.add(log)
    db.commit()

    return TempCredentialsResponse(temp_eid=temp_eid, temp_password=temp_password, user_id=new_user.id)

@router.delete("/users/{user_id}")
def delete_user(
    user_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin_or_coordinator())
):
    user = db.query(User).options(
        selectinload(User.role_assignments).joinedload(UserRoleAssignment.role),
        selectinload(User.role_assignments).joinedload(UserRoleAssignment.department)
    ).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    is_super = any(ra.role.name == "super_admin" for ra in user.role_assignments if ra.is_active)
    if is_super and not _is_super_admin(current_user):
        raise HTTPException(status_code=400, detail="Only super admins can delete super admin accounts")

    # Dept admins can only delete users in their department
    if not _is_super_admin(current_user):
        target_dept_ids = {ra.department_id for ra in user.role_assignments if ra.department_id}
        if not any(_can_manage_department(current_user, did) for did in target_dept_ids):
            raise HTTPException(status_code=403, detail="Cannot delete users outside your department")

    # Nullify audit log references before deleting
    db.query(AuditLog).filter(AuditLog.actor_id == user_id).update({"actor_id": None})
    db.query(AuditLog).filter(AuditLog.target_user_id == user_id).update({"target_user_id": None})

    log = AuditLog(
        actor_id=current_user.id,
        action="DELETE_USER",
        details={"eid": user.eid, "deleted_user_id": user_id}
    )
    db.add(log)

    db.query(UserRoleAssignment).filter(UserRoleAssignment.user_id == user_id).delete()
    db.delete(user)
    db.commit()
    return {"success": True, "id": user_id}

@router.post("/users/{user_id}/assign-role")
def assign_role_to_user(
    user_id: int,
    role_id: int,
    department_id: int = None,
    faculty_id: int = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin_or_coordinator())
):
    is_super = _is_super_admin(current_user)
    is_fac_admin = _is_faculty_affairs_admin(current_user)

    # Faculty affairs admin: only registrar/registrar within own faculty
    if is_fac_admin:
        my_fac_ids = _get_admin_faculty_ids(current_user)
        if not my_fac_ids:
            raise HTTPException(status_code=403, detail="No faculty admin privileges")
        if faculty_id and faculty_id not in my_fac_ids:
            raise HTTPException(status_code=403, detail="Cannot assign roles outside your faculty")
        if not faculty_id:
            faculty_id = my_fac_ids[0]
        role = db.query(Role).filter(Role.id == role_id).first()
        if not role or role.name not in _registrar_manageable_roles():
            raise HTTPException(status_code=403, detail=f"Can only assign roles: {', '.join(_registrar_manageable_roles())}")
    elif not is_super:
        # Dept admins: scope check
        if not _can_manage_department(current_user, department_id):
            raise HTTPException(status_code=403, detail="Cannot assign roles outside your department")
        role = db.query(Role).filter(Role.id == role_id).first()
        forbidden = {"super_admin", "dept_admin", "faculty_affairs_admin"}
        if role and role.name in forbidden:
            raise HTTPException(status_code=403, detail="Cannot assign admin roles")

    existing = db.query(UserRoleAssignment).filter(
        UserRoleAssignment.user_id == user_id,
        UserRoleAssignment.role_id == role_id,
        UserRoleAssignment.department_id == department_id,
        UserRoleAssignment.faculty_id == faculty_id,
    ).first()

    if existing:
        raise HTTPException(status_code=400, detail="Role already assigned")

    assignment = UserRoleAssignment(
        user_id=user_id,
        role_id=role_id,
        department_id=department_id,
        faculty_id=faculty_id,
        assigned_by=current_user.id
    )
    db.add(assignment)

    log = AuditLog(
        actor_id=current_user.id,
        action="ASSIGN_ROLE",
        target_user_id=user_id,
        details={"role_id": role_id, "department_id": department_id, "faculty_id": faculty_id}
    )
    db.add(log)

    db.commit()
    return {"success": True}

@router.delete("/users/{user_id}/remove-role/{assignment_id}")
def remove_role_from_user(
    user_id: int,
    assignment_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin_or_coordinator())
):
    assignment = db.query(UserRoleAssignment).options(
        joinedload(UserRoleAssignment.role),
        joinedload(UserRoleAssignment.department)
    ).filter(
        UserRoleAssignment.id == assignment_id,
        UserRoleAssignment.user_id == user_id
    ).first()

    if not assignment:
        raise HTTPException(status_code=404, detail="Assignment not found")

    # No one can remove super_admin roles except super_admin
    if assignment.role.name == "super_admin" and not _is_super_admin(current_user):
        raise HTTPException(status_code=403, detail="Only a super admin can remove super admin roles")

    # Dept admins can only remove roles in their department
    if not _is_super_admin(current_user):
        if not _can_manage_department(current_user, assignment.department_id):
            raise HTTPException(status_code=403, detail="Cannot remove roles outside your department")

    log = AuditLog(
        actor_id=current_user.id,
        action="REMOVE_ROLE",
        target_user_id=user_id,
        details={"assignment_id": assignment_id, "role": assignment.role.name}
    )
    db.add(log)

    db.delete(assignment)
    db.commit()
    return {"success": True}

# --- Personal Settings / Onboarding ---

@router.post("/me/select-department")
def select_department(
    data: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    dept_id = data.get("department_id")
    if not dept_id:
        raise HTTPException(status_code=400, detail="department_id is required")

    dept = db.query(Department).filter(Department.id == dept_id).first()
    if not dept:
        raise HTTPException(status_code=404, detail="Department not found")

    for ra in current_user.role_assignments:
        if not ra.department_id:
            ra.department_id = dept_id

    db.commit()
    return {"success": True}

# --- Roles ---

@router.get("/roles", response_model=List[RoleRead], dependencies=[Depends(require_admin_or_coordinator())])
def list_roles(db: Session = Depends(get_db)):
    return db.query(Role).all()

# --- Faculties ---

@router.get("/faculties", response_model=List[FacultyRead])
def list_faculties(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin_or_coordinator())
):
    """List all faculties (admin view — includes inactive)."""
    return db.query(Faculty).order_by(Faculty.name).all()

@router.post("/faculties", response_model=FacultyRead)
def create_faculty(
    data: FacultyCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_super_admin())
):
    existing = db.query(Faculty).filter(
        (Faculty.name == data.name) | (Faculty.code == str(data.code).upper())
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail="Faculty name or code already exists")

    f = Faculty(name=data.name, code=str(data.code).upper())
    db.add(f)

    log = AuditLog(actor_id=current_user.id, action="CREATE_FACULTY",
                   details={"name": data.name, "code": data.code})
    db.add(log)
    db.commit()
    db.refresh(f)
    return f

@router.patch("/faculties/{faculty_id}", response_model=FacultyRead)
def update_faculty(
    faculty_id: int,
    data: FacultyUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_super_admin())
):
    f = db.query(Faculty).filter(Faculty.id == faculty_id).first()
    if not f:
        raise HTTPException(status_code=404, detail="Faculty not found")
    if data.name is not None:
        f.name = data.name
    if data.is_active is not None:
        f.is_active = data.is_active

    log = AuditLog(actor_id=current_user.id, action="UPDATE_FACULTY",
                   details={"faculty_id": faculty_id, "changes": data.model_dump(exclude_unset=True)})
    db.add(log)
    db.commit()
    db.refresh(f)
    return f

@router.delete("/faculties/{faculty_id}")
def delete_faculty(
    faculty_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_super_admin())
):
    f = db.query(Faculty).filter(Faculty.id == faculty_id).first()
    if not f:
        raise HTTPException(status_code=404, detail="Faculty not found")

    # Fakülteye bağlı departman varsa silinemez (aktif/pasif fark etmez)
    dept_count = db.query(Department).filter(
        Department.faculty_id == faculty_id,
    ).count()
    if dept_count > 0:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot delete faculty '{f.name}': {dept_count} department(s) still assigned. Reassign or delete them first."
        )

    log = AuditLog(actor_id=current_user.id, action="DELETE_FACULTY",
                   details={"faculty_id": faculty_id, "name": f.name})
    db.add(log)
    db.delete(f)
    db.commit()
    return {"success": True, "id": faculty_id}

# --- Audit ---

@router.get("/audit-logs", response_model=AuditLogPagination)
def list_audit_logs(
    skip: int = 0,
    limit: int = 10,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin_or_coordinator())
):
    query = db.query(AuditLog).options(
        joinedload(AuditLog.actor),
        joinedload(AuditLog.target_user)
    )

    # Scope: super_admin sees all; faculty_affairs_admin sees own faculty; dept_admin sees own dept
    if not _is_super_admin(current_user):
        if _is_faculty_affairs_admin(current_user):
            my_fac_ids = _get_admin_faculty_ids(current_user)
            if my_fac_ids:
                fac_dept_ids = [
                    d.id for d in db.query(Department).filter(Department.faculty_id.in_(my_fac_ids)).all()
                ]
                fac_user_ids = set()
                if fac_dept_ids:
                    fac_user_ids.update(
                        uid for (uid,) in db.query(UserRoleAssignment.user_id).filter(
                            UserRoleAssignment.department_id.in_(fac_dept_ids)
                        ).distinct().all()
                    )
                fac_user_ids.update(
                    uid for (uid,) in db.query(UserRoleAssignment.user_id).filter(
                        UserRoleAssignment.faculty_id.in_(my_fac_ids)
                    ).distinct().all()
                )
                fac_user_ids.add(current_user.id)
                if fac_user_ids:
                    query = query.filter(
                        (AuditLog.actor_id.in_(fac_user_ids)) | (AuditLog.target_user_id.in_(fac_user_ids))
                    )
                else:
                    query = query.filter(AuditLog.actor_id == current_user.id)
            else:
                query = query.filter(AuditLog.actor_id == current_user.id)
        else:
            my_dept_ids = _get_admin_dept_ids(current_user)
            if my_dept_ids:
                dept_user_ids = [
                    uid for (uid,) in db.query(UserRoleAssignment.user_id).filter(
                        UserRoleAssignment.department_id.in_(my_dept_ids)
                    ).distinct().all()
                ]
                dept_user_ids.append(current_user.id)
                query = query.filter(
                    (AuditLog.actor_id.in_(dept_user_ids)) | (AuditLog.target_user_id.in_(dept_user_ids))
                )
            else:
                query = query.filter(AuditLog.actor_id == current_user.id)

    total = query.count()
    items = query.order_by(AuditLog.created_at.desc()).offset(skip).limit(limit).all()
    return {"total": total, "items": items}

@router.patch("/role-assignments/{assignment_id}")
def update_role_assignment(
    assignment_id: int,
    update: UserRoleAssignmentUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin_or_coordinator())
):
    assignment = db.query(UserRoleAssignment).options(
        joinedload(UserRoleAssignment.role),
        joinedload(UserRoleAssignment.department)
    ).filter(UserRoleAssignment.id == assignment_id).first()
    if not assignment:
        raise HTTPException(status_code=404, detail="Assignment not found")

    # No one can modify super_admin roles except super_admin
    if assignment.role.name == "super_admin" and not _is_super_admin(current_user):
        raise HTTPException(status_code=403, detail="Only a super admin can modify super admin roles")

    # Dept admins can only toggle roles in their department
    if not _is_super_admin(current_user):
        if not _can_manage_department(current_user, assignment.department_id):
            raise HTTPException(status_code=403, detail="Cannot modify roles outside your department")

    old_status = assignment.is_active
    assignment.is_active = update.is_active

    log = AuditLog(
        actor_id=current_user.id,
        action="TOGGLE_ROLE",
        target_user_id=assignment.user_id,
        details={
            "assignment_id": assignment_id,
            "role": assignment.role.name,
            "old_status": old_status,
            "new_status": update.is_active
        }
    )
    db.add(log)

    db.commit()
    return {"success": True}
