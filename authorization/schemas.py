from pydantic import BaseModel, EmailStr
from typing import List, Optional
from datetime import datetime

class RoleBase(BaseModel):
    name: str
    description: Optional[str] = None

class RoleRead(RoleBase):
    id: int

    class Config:
        from_attributes = True

class FacultyBase(BaseModel):
    name: str
    code: str

class FacultyCreate(FacultyBase):
    pass

class FacultyRead(FacultyBase):
    id: int
    is_active: bool = True

    class Config:
        from_attributes = True

class DepartmentBase(BaseModel):
    name: str
    code: str
    is_active: bool = True

class DepartmentCreate(DepartmentBase):
    faculty_id: Optional[int] = None

class DepartmentUpdate(BaseModel):
    name: Optional[str] = None
    code: Optional[str] = None
    faculty_id: Optional[int] = None
    is_active: Optional[bool] = None

class FacultyUpdate(BaseModel):
    name: Optional[str] = None
    is_active: Optional[bool] = None

class DepartmentRead(DepartmentBase):
    id: int
    faculty: Optional[FacultyRead] = None

    class Config:
        from_attributes = True

class UserRoleAssignmentRead(BaseModel):
    id: int
    role: RoleRead
    department: Optional[DepartmentRead] = None
    faculty: Optional[FacultyRead] = None
    is_active: bool = True

    class Config:
        from_attributes = True

class UserRead(BaseModel):
    id: int
    eid: str
    email: Optional[str] = None
    name: Optional[str] = None
    needs_cats_link: bool = False
    last_login: Optional[datetime] = None
    role_assignments: List[UserRoleAssignmentRead] = []

    class Config:
        from_attributes = True

class LoginRequest(BaseModel):
    eid: str
    password: str

class UserCreate(BaseModel):
    eid: str
    email: Optional[str] = None
    name: Optional[str] = None
    password: Optional[str] = None  # For local admin/coord creation
    role_names: List[str] = ["student"]
    department_id: Optional[int] = None

class UserSimple(BaseModel):
    id: int
    eid: str
    name: Optional[str] = None

    class Config:
        from_attributes = True

class UserRoleAssignmentUpdate(BaseModel):
    is_active: bool

class TempUserCreate(BaseModel):
    role_names: List[str] = ["coordinator"]
    department_id: Optional[int] = None
    faculty_id: Optional[int] = None
    name: Optional[str] = None

class TempCredentialsResponse(BaseModel):
    temp_eid: str
    temp_password: str
    user_id: int

class AuditLogRead(BaseModel):
    id: int
    actor_id: Optional[int]
    action: str
    target_user_id: Optional[int]
    details: dict
    created_at: datetime

    actor: Optional[UserSimple] = None
    target_user: Optional[UserSimple] = None

    class Config:
        from_attributes = True

class AuditLogPagination(BaseModel):
    total: int
    items: List[AuditLogRead]
