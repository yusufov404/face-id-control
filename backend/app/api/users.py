from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import AuthContext, require_permission
from app.api.serializers import is_loaded, safe_attr
from app.audit.service import AuditService
from app.core.database import get_db
from app.core.permissions import Permission, Role as RoleEnum, get_role_permissions
from app.core.security import get_password_hash
from app.models.user import Permission as PermissionModel, Role, User
from app.schemas.auth import (
    PermissionRead,
    RolePermissionsUpdate,
    RoleRead,
    UserCreate,
    UserRead,
    UserRoleAssign,
    UserUpdate,
)
from app.schemas.common import Message, Page

router = APIRouter(prefix="/users", tags=["users"])


def _to_read(u: User) -> UserRead:
    data = UserRead.model_validate(u)
    data.roles = [RoleRead.model_validate(r) for r in u.roles if not r.is_deleted]
    perms: set[str] = set()
    for r in u.roles:
        if is_loaded(r, "permissions"):
            perms |= {p.name for p in r.permissions if not p.is_deleted}
        try:
            perms |= {p.value for p in get_role_permissions(RoleEnum(r.name))}
        except ValueError:
            pass
    data.permissions = sorted(perms)
    dept = safe_attr(u, "department")
    if dept is not None:
        data.department_name = dept.name
    return data


@router.get("", response_model=Page[UserRead])
async def list_users(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    search: Optional[str] = None,
    is_active: Optional[bool] = None,
    ctx: AuthContext = Depends(require_permission(Permission.USER_READ)),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(User).options(
        selectinload(User.roles).selectinload(Role.permissions),
        selectinload(User.department),
    ).where(User.is_deleted.is_(False))
    if ctx.department_scope is not None:
        stmt = stmt.where(User.department_id == ctx.department_scope)
    if is_active is not None:
        stmt = stmt.where(User.is_active.is_(is_active))
    if search:
        like = f"%{search}%"
        stmt = stmt.where(or_(
            User.username.ilike(like), User.email.ilike(like), User.full_name.ilike(like)
        ))
    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar_one()
    rows = (await db.execute(
        stmt.order_by(User.full_name).offset((page - 1) * page_size).limit(page_size)
    )).scalars().all()
    return Page[UserRead](
        items=[_to_read(u) for u in rows], total=total, page=page, page_size=page_size,
        pages=(total + page_size - 1) // page_size,
    )


async def _get_roles(db: AsyncSession, role_ids: list[int]) -> list[Role]:
    if not role_ids:
        return []
    rows = (await db.execute(select(Role).where(Role.id.in_(role_ids), Role.is_deleted.is_(False)))).scalars().all()
    if len(rows) != len(set(role_ids)):
        raise HTTPException(status_code=400, detail="Ba'zi rollar topilmadi")
    return list(rows)


def _guard_escalation(ctx: AuthContext, roles: list[Role]) -> None:
    """hr_director cannot grant super_admin or roles with manage_roles."""
    if ctx.is_super_admin:
        return
    for r in roles:
        if r.name == RoleEnum.SUPER_ADMIN.value:
            raise HTTPException(status_code=403, detail="Super Admin rolini bera olmaysiz")
        if r.can_manage_roles and not ctx.has(Permission.ROLE_ASSIGN_PERMISSION):
            raise HTTPException(status_code=403, detail="Bu rolni berishga ruxsat yo'q")


@router.post("", response_model=UserRead, status_code=201)
async def create_user(
    payload: UserCreate,
    ctx: AuthContext = Depends(require_permission(Permission.USER_CREATE)),
    db: AsyncSession = Depends(get_db),
):
    if ctx.department_scope is not None and payload.department_id not in (None, ctx.department_scope):
        raise HTTPException(status_code=403, detail="Boshqa bo'limga foydalanuvchi qo'sha olmaysiz")
    if payload.role_ids and not ctx.is_super_admin:
        raise HTTPException(status_code=403, detail="Rol berish faqat Super Admin huquqi")

    email = str(payload.email) if payload.email else f"{payload.username.strip().lower()}@facesys.local"
    dup = await db.execute(select(User.id).where(
        (User.username == payload.username) | (User.email == email), User.is_deleted.is_(False)
    ))
    if dup.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Username yoki email band")

    roles = await _get_roles(db, payload.role_ids)
    _guard_escalation(ctx, roles)

    user = User(
        username=payload.username,
        email=email,
        password_hash=get_password_hash(payload.password),
        full_name=payload.full_name,
        phone=payload.phone,
        department_id=payload.department_id,
        employee_id=payload.employee_id,
        is_active=payload.is_active,
    )
    user.roles = roles
    db.add(user)
    try:
        # flush() already emits the INSERT, so a uniqueness race must be caught
        # here too — otherwise it escaped as an unhandled 500 instead of a 409.
        await db.flush()
        AuditService(db).record(
            action="user.create", resource_type="user", resource_id=user.id,
            user_id=ctx.user_id,
            new_values={"username": user.username, "role_ids": payload.role_ids},
            description=f"Foydalanuvchi yaratildi: {user.username}",
        )
        await db.commit()
    except IntegrityError:
        # Covers races and any uniqueness rule the pre-check cannot see.
        await db.rollback()
        raise HTTPException(status_code=409, detail="Username yoki email band")
    await db.refresh(user)
    return _to_read(user)


@router.get("/{user_id}", response_model=UserRead)
async def get_user(
    user_id: int,
    ctx: AuthContext = Depends(require_permission(Permission.USER_READ)),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(User).options(
        selectinload(User.roles).selectinload(Role.permissions),
        selectinload(User.department),
    ).where(User.id == user_id, User.is_deleted.is_(False))
    u = (await db.execute(stmt)).scalar_one_or_none()
    if u is None:
        raise HTTPException(status_code=404, detail="Foydalanuvchi topilmadi")
    ctx.assert_department(u.department_id)
    return _to_read(u)


@router.patch("/{user_id}", response_model=UserRead)
async def update_user(
    user_id: int,
    payload: UserUpdate,
    ctx: AuthContext = Depends(require_permission(Permission.USER_UPDATE)),
    db: AsyncSession = Depends(get_db),
):
    u = await db.get(User, user_id)
    if u is None or u.is_deleted:
        raise HTTPException(status_code=404, detail="Foydalanuvchi topilmadi")
    ctx.assert_department(u.department_id)
    updates = payload.model_dump(exclude_unset=True)
    old = {k: str(getattr(u, k)) for k in updates}
    for k, v in updates.items():
        setattr(u, k, v)
    AuditService(db).record(
        action="user.update", resource_type="user", resource_id=u.id,
        user_id=ctx.user_id, old_values=old, new_values={k: str(v) for k, v in updates.items()},
        description=f"Foydalanuvchi tahrirlandi: {u.username}",
    )
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=409, detail="Bu email boshqa hisobda ishlatilgan")
    await db.refresh(u)
    return _to_read(u)


@router.put("/{user_id}/roles", response_model=UserRead)
async def assign_roles(
    user_id: int,
    payload: UserRoleAssign,
    ctx: AuthContext = Depends(require_permission(Permission.USER_ASSIGN_ROLE)),
    db: AsyncSession = Depends(get_db),
):
    if not ctx.is_super_admin:
        raise HTTPException(status_code=403, detail="Rol berish faqat Super Admin huquqi")
    u = await db.get(User, user_id)
    if u is None or u.is_deleted:
        raise HTTPException(status_code=404, detail="Foydalanuvchi topilmadi")
    roles = await _get_roles(db, payload.role_ids)
    _guard_escalation(ctx, roles)

    old = [r.name for r in u.roles]
    u.roles = roles
    AuditService(db).record(
        action="user.assign_roles", resource_type="user", resource_id=u.id,
        user_id=ctx.user_id, old_values={"roles": old},
        new_values={"roles": [r.name for r in roles]},
        description=f"Rollar o'zgartirildi: {u.username}",
    )
    await db.commit()
    await db.refresh(u)
    return _to_read(u)


@router.delete("/{user_id}", response_model=Message)
async def delete_user(
    user_id: int,
    ctx: AuthContext = Depends(require_permission(Permission.USER_DELETE)),
    db: AsyncSession = Depends(get_db),
):
    if user_id == ctx.user_id:
        raise HTTPException(status_code=400, detail="O'zingizni o'chira olmaysiz")
    u = await db.get(User, user_id)
    if u is None or u.is_deleted:
        raise HTTPException(status_code=404, detail="Foydalanuvchi topilmadi")
    from datetime import datetime, timezone
    u.is_deleted = True
    u.deleted_at = datetime.now(timezone.utc)
    u.is_active = False
    AuditService(db).record(
        action="user.delete", resource_type="user", resource_id=u.id,
        user_id=ctx.user_id, description=f"Foydalanuvchi o'chirildi: {u.username}",
    )
    await db.commit()
    return Message(detail="Foydalanuvchi o'chirildi")


# ---------------------------------------------------------------- roles & permissions
roles_router = APIRouter(prefix="/roles", tags=["roles"])


@roles_router.get("", response_model=list[RoleRead])
async def list_roles(
    ctx: AuthContext = Depends(require_permission(Permission.ROLE_READ)),
    db: AsyncSession = Depends(get_db),
):
    rows = (await db.execute(select(Role).where(Role.is_deleted.is_(False)).order_by(Role.name))).scalars().all()
    return [RoleRead.model_validate(r) for r in rows]


@roles_router.get("/{role_id}/permissions", response_model=list[PermissionRead])
async def role_permissions(
    role_id: int,
    ctx: AuthContext = Depends(require_permission(Permission.ROLE_READ)),
    db: AsyncSession = Depends(get_db),
):
    role = await db.get(Role, role_id)
    if role is None or role.is_deleted:
        raise HTTPException(status_code=404, detail="Rol topilmadi")
    return [PermissionRead.model_validate(p) for p in role.permissions if not p.is_deleted]


@roles_router.put("/{role_id}/permissions", response_model=list[PermissionRead])
async def set_role_permissions(
    role_id: int,
    payload: RolePermissionsUpdate,
    ctx: AuthContext = Depends(require_permission(Permission.ROLE_ASSIGN_PERMISSION)),
    db: AsyncSession = Depends(get_db),
):
    if not ctx.is_super_admin:
        raise HTTPException(status_code=403, detail="Ruxsat berish faqat Super Admin huquqi")
    role = await db.get(Role, role_id)
    if role is None or role.is_deleted:
        raise HTTPException(status_code=404, detail="Rol topilmadi")
    if role.is_system and not ctx.is_super_admin:
        raise HTTPException(status_code=403, detail="Tizim rolini faqat Super Admin tahrirlaydi")
    perms = (await db.execute(
        select(PermissionModel).where(PermissionModel.id.in_(payload.permission_ids), PermissionModel.is_deleted.is_(False))
    )).scalars().all()
    if len(perms) != len(set(payload.permission_ids)):
        raise HTTPException(status_code=400, detail="Ba'zi ruxsatlar topilmadi")
    old = [p.name for p in role.permissions]
    role.permissions = list(perms)
    AuditService(db).record(
        action="role.assign_permissions", resource_type="role", resource_id=role.id,
        user_id=ctx.user_id, old_values={"permissions": old},
        new_values={"permissions": [p.name for p in perms]},
        description=f"Rol ruxsatlari yangilandi: {role.name}",
    )
    await db.commit()
    return [PermissionRead.model_validate(p) for p in perms]


permissions_router = APIRouter(prefix="/permissions", tags=["permissions"])


@permissions_router.get("", response_model=list[PermissionRead])
async def list_permissions(
    category: Optional[str] = None,
    ctx: AuthContext = Depends(require_permission(Permission.ROLE_READ)),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(PermissionModel).where(PermissionModel.is_deleted.is_(False))
    if category:
        stmt = stmt.where(PermissionModel.category == category)
    rows = (await db.execute(stmt.order_by(PermissionModel.category, PermissionModel.name))).scalars().all()
    return [PermissionRead.model_validate(p) for p in rows]