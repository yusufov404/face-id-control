"""Authentication and authorization dependencies.

Every protected endpoint must use one of:
  - get_current_user
  - require_permission(...)
  - require_role(...)

Department isolation is enforced by get_department_scope / assert_department_access.
"""
from typing import Optional, Set

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.permissions import (
    Permission,
    Role,
    get_role_permissions,
)
from app.core.security import decode_token, TokenData
from app.models.user import User

bearer_scheme = HTTPBearer(auto_error=False)


class AuthContext:
    """Resolved authentication context for the current request."""

    def __init__(
        self,
        user: User,
        token: TokenData,
        permissions: Set[str],
        roles: Set[str],
        department_scope: Optional[int],
    ):
        self.user = user
        self.token = token
        self.permissions = permissions
        self.roles = roles
        self.department_scope = department_scope  # None => all departments

    @property
    def user_id(self) -> int:
        return self.user.id

    @property
    def is_super_admin(self) -> bool:
        """True for the Super Admin role and for legacy is_superuser accounts."""
        return self.user.is_superuser or Role.SUPER_ADMIN.value in self.roles

    def has(self, permission: Permission | str) -> bool:
        p = permission.value if isinstance(permission, Permission) else permission
        return p in self.permissions

    def require(self, *permissions: Permission | str) -> None:
        for permission in permissions:
            if not self.has(permission):
                p = permission.value if isinstance(permission, Permission) else permission
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail=f"Ruxsat yo'q: {p}",
                )

    def require_any(self, *permissions: Permission | str) -> None:
        if not any(self.has(p) for p in permissions):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Bu amal uchun ruxsat yo'q",
            )

    def assert_department(self, department_id: Optional[int]) -> None:
        """Raise 404 (not 403) when out of scope, to avoid ID enumeration."""
        if self.department_scope is None:
            return
        if department_id is None or department_id != self.department_scope:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Ma'lumot topilmadi",
            )


async def _load_auth_context(
    credentials: Optional[HTTPAuthorizationCredentials],
    request: Request,
    db: AsyncSession,
) -> AuthContext:
    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Autentifikatsiya talab qilinadi",
            headers={"WWW-Authenticate": "Bearer"},
        )
    token_data = decode_token(credentials.credentials, token_type="access")
    if token_data is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token yaroqsiz yoki muddati tugagan",
            headers={"WWW-Authenticate": "Bearer"},
        )

    result = await db.execute(
        select(User).where(User.id == token_data.user_id, User.is_deleted.is_(False))
    )
    user = result.scalar_one_or_none()
    if user is None or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Foydalanuvchi faol emas")

    # Recompute permissions server-side from DB (never trust token snapshot)
    permissions: Set[str] = set()
    role_names: Set[str] = set()
    all_departments = user.is_superuser
    department_scope: Optional[int] = None

    roles = [r for r in user.roles if not r.is_deleted]
    for role in roles:
        role_names.add(role.name)
        if role.can_access_all_departments:
            all_departments = True
        if role.name == Role.SUPER_ADMIN.value:
            all_departments = True
        # DB-stored role permissions
        for perm in role.permissions:
            if not perm.is_deleted:
                permissions.add(perm.name)
        # Fall back to code-defined matrix for system roles
        try:
            r = Role(role.name)
            permissions |= {p.value for p in get_role_permissions(r)}
        except ValueError:
            pass

    if user.is_superuser:
        permissions |= {p.value for p in Permission}

    if not all_departments:
        # Fail closed: a department-scoped role without a department must not
        # silently become "all departments" (None means unrestricted).
        if user.department_id is None:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Foydalanuvchi bo'limga biriktirilmagan. Administratorga murojaat qiling.",
            )
        department_scope = user.department_id

    return AuthContext(
        user=user,
        token=token_data,
        permissions=permissions,
        roles=role_names,
        department_scope=department_scope,
    )


async def get_current_user(
    request: Request,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
    db: AsyncSession = Depends(get_db),
) -> AuthContext:
    """Resolve the authenticated user and their effective permissions."""
    ctx = await _load_auth_context(credentials, request, db)
    request.state.auth = ctx
    return ctx


def require_permission(*permissions: Permission):
    """Dependency factory: require all given permissions."""

    async def _dep(ctx: AuthContext = Depends(get_current_user)) -> AuthContext:
        ctx.require(*permissions)
        return ctx

    return _dep


def require_any_permission(*permissions: Permission):
    async def _dep(ctx: AuthContext = Depends(get_current_user)) -> AuthContext:
        ctx.require_any(*permissions)
        return ctx

    return _dep


def require_role(*roles: Role):
    names = {r.value for r in roles}

    async def _dep(ctx: AuthContext = Depends(get_current_user)) -> AuthContext:
        if not (ctx.roles & names) and not ctx.user.is_superuser:
            raise HTTPException(status_code=403, detail="Bu rol uchun ruxsat yo'q")
        return ctx

    return _dep


def enforce_department_scope(ctx: AuthContext, department_id: Optional[int]) -> None:
    """Enforce department boundary; 404 to avoid leaking existence."""
    ctx.assert_department(department_id)


def scope_filter(ctx: AuthContext):
    """Return department_id to filter by, or None when unrestricted."""
    return ctx.department_scope