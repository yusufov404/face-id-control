from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import AuthContext, get_current_user
from app.audit.service import AuditService
from app.core.config import settings
from app.core.database import get_db
from app.core.rate_limit import SlidingWindowLimiter, client_key
from app.core.security import (
    create_token_pair,
    decode_token,
    get_password_hash,
    verify_password,
)
from app.models.user import User
from app.schemas.auth import (
    CurrentUser,
    LoginRequest,
    PasswordChange,
    RefreshRequest,
    TokenResponse,
)
from app.schemas.common import Message

router = APIRouter(prefix="/auth", tags=["auth"])

login_limiter = SlidingWindowLimiter(settings.LOGIN_RATE_LIMIT, settings.LOGIN_RATE_LIMIT_WINDOW)
LOCK_THRESHOLD = 10
LOCK_MINUTES = 15


def _token_payload(user: User) -> dict:
    return {
        "sub": user.username,
        "user_id": user.id,
        "email": user.email,
        "is_superuser": user.is_superuser,
    }


@router.post("/login", response_model=TokenResponse)
async def login(
    payload: LoginRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    login_limiter.check(client_key(request, "login"))

    result = await db.execute(
        select(User).where(
            (User.username == payload.username) | (User.email == payload.username),
            User.is_deleted.is_(False),
        )
    )
    user = result.scalar_one_or_none()

    audit = AuditService(db)
    ip = client_key(request, "ip").split(":", 1)[1]
    ua = request.headers.get("user-agent", "")[:500]

    if user is None:
        audit.record(
            action="auth.login.failed",
            resource_type="user",
            user_id=None,
            description=f"Noma'lum login: {payload.username}",
            user_ip=ip, user_agent=ua, success=False,
            error_message="invalid_credentials",
        )
        await db.commit()
        raise HTTPException(status_code=401, detail="Login yoki parol xato")

    now = datetime.now(timezone.utc)
    locked_until = user.locked_until
    if locked_until is not None and locked_until.tzinfo is None:
        # Defensive: some drivers return naive timestamps for timestamptz.
        locked_until = locked_until.replace(tzinfo=timezone.utc)
    if locked_until and locked_until > now:
        raise HTTPException(
            status_code=status.HTTP_423_LOCKED,
            detail="Hisob vaqtincha bloklangan. Keyinroq urinib ko'ring.",
        )

    if not user.is_active:
        raise HTTPException(status_code=403, detail="Foydalanuvchi faol emas")

    if not verify_password(payload.password, user.password_hash):
        user.failed_login_attempts += 1
        if user.failed_login_attempts >= LOCK_THRESHOLD:
            user.locked_until = now + timedelta(minutes=LOCK_MINUTES)
            user.failed_login_attempts = 0
        audit.record(
            action="auth.login.failed", resource_type="user", resource_id=user.id,
            user_id=user.id, description="Parol xato", user_ip=ip, user_agent=ua,
            success=False, error_message="invalid_credentials",
        )
        await db.commit()
        raise HTTPException(status_code=401, detail="Login yoki parol xato")

    user.failed_login_attempts = 0
    user.locked_until = None
    user.last_login = now

    audit.record(
        action="auth.login", resource_type="user", resource_id=user.id,
        user_id=user.id, description="Muvaffaqiyatli kirish", user_ip=ip, user_agent=ua,
    )
    await db.commit()

    tokens = create_token_pair(_token_payload(user))
    return TokenResponse(**tokens.model_dump())


@router.post("/refresh", response_model=TokenResponse)
async def refresh(payload: RefreshRequest, db: AsyncSession = Depends(get_db)):
    data = decode_token(payload.refresh_token, token_type="refresh")
    if data is None:
        raise HTTPException(status_code=401, detail="Refresh token yaroqsiz")
    result = await db.execute(
        select(User).where(User.id == data.user_id, User.is_deleted.is_(False))
    )
    user = result.scalar_one_or_none()
    if user is None or not user.is_active:
        raise HTTPException(status_code=401, detail="Foydalanuvchi faol emas")
    tokens = create_token_pair(_token_payload(user))
    return TokenResponse(**tokens.model_dump())


@router.get("/me", response_model=CurrentUser)
async def me(ctx: AuthContext = Depends(get_current_user)):
    return CurrentUser(
        id=ctx.user.id,
        username=ctx.user.username,
        email=ctx.user.email,
        full_name=ctx.user.full_name,
        is_superuser=ctx.user.is_superuser,
        roles=sorted(ctx.roles),
        permissions=sorted(ctx.permissions),
        department_id=ctx.user.department_id,
        department_scope=ctx.department_scope,
    )


@router.post("/change-password", response_model=Message)
async def change_password(
    payload: PasswordChange,
    request: Request,
    ctx: AuthContext = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not verify_password(payload.current_password, ctx.user.password_hash):
        raise HTTPException(status_code=400, detail="Joriy parol xato")
    ctx.user.password_hash = get_password_hash(payload.new_password)
    AuditService(db).record(
        action="auth.password_change", resource_type="user", resource_id=ctx.user.id,
        user_id=ctx.user.id, description="Parol o'zgartirildi",
    )
    await db.commit()
    return Message(detail="Parol yangilandi")


@router.post("/logout", response_model=Message)
async def logout(
    ctx: AuthContext = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    AuditService(db).record(
        action="auth.logout", resource_type="user", resource_id=ctx.user.id,
        user_id=ctx.user.id, description="Tizimdan chiqdi",
    )
    await db.commit()
    return Message(detail="Tizimdan chiqdingiz")