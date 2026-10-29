import re
from datetime import datetime
from typing import Optional, List

from email_validator import EmailNotValidError, validate_email
from pydantic import BaseModel, Field, field_validator

from app.schemas.common import ORMModel, SoftDeleteSchema

# Accounts created without an email get ``<login>@facesys.local``. That domain is
# reserved, so a plain ``EmailStr`` rejects it — which used to break both creating
# a department head and editing any auto-generated account.
INTERNAL_EMAIL_DOMAIN = "facesys.local"
_INTERNAL_LOCAL_PART = re.compile(r"^[A-Za-z0-9_.+-]{1,64}$")


def normalize_email(value: object) -> Optional[str]:
    """Validate an address, allowing the clinic's internal ``*.facesys.local`` domain."""
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    local, _, domain = text.rpartition("@")
    if domain.lower() == INTERNAL_EMAIL_DOMAIN:
        if not _INTERNAL_LOCAL_PART.match(local):
            raise ValueError("Email formati noto'g'ri")
        return text.lower()
    try:
        return validate_email(text, check_deliverability=False).normalized
    except EmailNotValidError as exc:
        raise ValueError(str(exc)) from exc


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
    # Optional: when omitted the API derives ``<username>@facesys.local`` so that
    # accounts can be created with nothing but a login (offline clinic network).
    email: Optional[str] = None
    password: str = Field(..., min_length=8, max_length=128)
    full_name: str = Field(..., min_length=1, max_length=100)
    phone: Optional[str] = None
    department_id: Optional[int] = None
    employee_id: Optional[int] = None
    role_ids: List[int] = []
    is_active: bool = True

    @field_validator("email", mode="before")
    @classmethod
    def _normalize_email(cls, value):
        return normalize_email(value)


class UserUpdate(BaseModel):
    email: Optional[str] = None
    full_name: Optional[str] = None
    phone: Optional[str] = None
    department_id: Optional[int] = None
    employee_id: Optional[int] = None
    is_active: Optional[bool] = None

    @field_validator("email", mode="before")
    @classmethod
    def _normalize_email(cls, value):
        if value is None:
            return None
        return normalize_email(value)


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
