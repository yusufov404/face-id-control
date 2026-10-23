from datetime import date, datetime
from typing import Optional
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import AuthContext, require_permission
from app.core.database import get_db
from app.core.permissions import Permission
from app.models.audit import AuditLog
from app.models.user import User
from app.schemas.attendance import AuditLogRead
from app.schemas.common import Page
from app.services.exports import build_excel

router = APIRouter(prefix="/audit", tags=["audit"])


async def _to_read(db: AsyncSession, log: AuditLog) -> AuditLogRead:
    data = AuditLogRead.model_validate(log)
    if log.user_id:
        u = await db.get(User, log.user_id)
        data.user_name = u.full_name if u else None
    return data


@router.get("", response_model=Page[AuditLogRead])
async def list_audit(
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=100),
    user_id: Optional[int] = None,
    action: Optional[str] = None,
    resource_type: Optional[str] = None,
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    search: Optional[str] = None,
    ctx: AuthContext = Depends(require_permission(Permission.AUDIT_READ)),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(AuditLog)
    if user_id:
        stmt = stmt.where(AuditLog.user_id == user_id)
    if action:
        stmt = stmt.where(AuditLog.action.ilike(f"%{action}%"))
    if resource_type:
        stmt = stmt.where(AuditLog.resource_type == resource_type)
    if date_from:
        stmt = stmt.where(AuditLog.timestamp >= datetime.combine(date_from, datetime.min.time()))
    if date_to:
        stmt = stmt.where(AuditLog.timestamp <= datetime.combine(date_to, datetime.max.time()))
    if search:
        like = f"%{search}%"
        stmt = stmt.where(or_(
            AuditLog.action.ilike(like), AuditLog.description.ilike(like),
            AuditLog.resource_type.ilike(like), AuditLog.resource_id.ilike(like),
        ))
    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar_one()
    rows = (await db.execute(
        stmt.order_by(AuditLog.timestamp.desc()).offset((page - 1) * page_size).limit(page_size)
    )).scalars().all()
    items = [await _to_read(db, log) for log in rows]
    return Page[AuditLogRead](
        items=items, total=total, page=page, page_size=page_size,
        pages=(total + page_size - 1) // page_size,
    )


@router.get("/export")
async def export_audit(
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    ctx: AuthContext = Depends(require_permission(Permission.AUDIT_EXPORT)),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(AuditLog)
    if date_from:
        stmt = stmt.where(AuditLog.timestamp >= datetime.combine(date_from, datetime.min.time()))
    if date_to:
        stmt = stmt.where(AuditLog.timestamp <= datetime.combine(date_to, datetime.max.time()))
    rows = (await db.execute(stmt.order_by(AuditLog.timestamp.desc()).limit(10000))).scalars().all()

    headers = ["Vaqt", "Foydalanuvchi", "Amal", "Resurs", "Resurs ID", "Tavsif", "Muvaffaqiyat"]
    data = []
    for log in rows:
        user_name = ""
        if log.user_id:
            u = await db.get(User, log.user_id)
            user_name = u.full_name if u else ""
        data.append([
            log.timestamp, user_name, log.action, log.resource_type,
            log.resource_id, log.description, "Ha" if log.success else "Yo'q",
        ])
    content = build_excel("Audit jurnali", headers, data,
                          meta={"Jami": len(data), "Davr": f"{date_from or '...'} — {date_to or '...'}"})
    return Response(
        content=content,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote('audit.xlsx')}"},
    )


@router.get("/{log_id}", response_model=AuditLogRead)
async def get_audit(
    log_id: int,
    ctx: AuthContext = Depends(require_permission(Permission.AUDIT_READ)),
    db: AsyncSession = Depends(get_db),
):
    log = await db.get(AuditLog, log_id)
    if log is None:
        raise HTTPException(status_code=404, detail="Audit yozuvi topilmadi")
    return await _to_read(db, log)