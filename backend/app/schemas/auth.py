from datetime import datetime
from typing import Optional, List

from pydantic import BaseModel, Field, EmailStr

from app.schemas.common import ORMModel, SoftDeleteSchema


class LoginRequest(BaseModel):
    username: str = Field(..., min_length=2, max_length=100)
    password: str = Field(..., min_length=1, max_length=256)


class RefreshRequest(BaseModel):
    refresh_token: str


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int


class UserCreate(BaseModel):
    username: str = Field(..., min_length=3, max_length=50, pattern=r"^[A-Za-z0-9_.-]+$")
    email: EmailStr
    password: str = Field(..., min_length=8, max_length=128)
    full_name: str = Field(..., min_length=1, max_length=100)
    phone: Optional[str] = None
    department_id: Optional[int] = None
    employee_id: Optional[int] = None
    role_ids: List[int] = []
    is_active: bool = True


class UserUpdate(BaseModel):
    email: Optional[EmailStr] = None
    full_name: Optional[str] = None
    phone: Optional[str] = None
    department_id: Optional[int] = None
    employee_id: Optional[int] = None
    is_active: Optional[bool] = None


class PasswordChange(BaseModel):
    current_password: str
    new_password: str = Field(..., min_length=8, max_length=128)


class RoleRead(SoftDeleteSchema):
    id: int
    name: str
    display_name: str
    description: Optional[str] = None
    is_system: bool = False
    can_manage_users: bool = False
    can_manage_roles: bool = False
    can_access_all_departments: bool = False
    can_modify_attendance: bool = False
    can_access_system_settings: bool = False
    can_view_audit_logs: bool = False
    max_department_scope: int = 0


class PermissionRead(ORMModel):
    id: int
    name: str
    display_name: str
    category: str
    description: Optional[str] = None


class RolePermissionsUpdate(BaseModel):
    permission_ids: List[int]


class UserRoleAssign(BaseModel):
    role_ids: List[int]
    expires_at: Optional[datetime] = None


class UserRead(ORMModel):
    id: int
    username: str
    email: str
    full_name: str
    phone: Optional[str] = None
    is_active: bool
    is_superuser: bool
    last_login: Optional[datetime] = None
    department_id: Optional[int] = None
    department_name: Optional[str] = None
    employee_id: Optional[int] = None
    roles: List[RoleRead] = []
    permissions: List[str] = []
    created_at: datetime
    updated_at: datetime


class CurrentUser(BaseModel):
    id: int
    username: str
    email: str
    full_name: str
    is_superuser: bool
    roles: List[str]
    permissions: List[str]
    department_id: Optional[int] = None
    department_scope: Optional[int] = None  # None = all departments
