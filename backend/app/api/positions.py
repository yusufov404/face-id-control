from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import AuthContext, require_permission
from app.api.serializers import safe_attr
from app.audit.service import AuditService
from app.core.database import get_db
from app.core.permissions import Permission
from app.models.employee import Employee
from app.models.position import Position
from app.schemas.common import Message, Page
from app.schemas.hr import PositionCreate, PositionRead, PositionUpdate

router = APIRouter(prefix="/positions", tags=["positions"])


def _to_read(p: Position) -> PositionRead:
    data = PositionRead.model_validate(p)
    dept = safe_attr(p, "department")
    if dept is not None:
        data.department_name = dept.name
    return data


@router.get("", response_model=Page[PositionRead])
async def list_positions(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    search: Optional[str] = None,
    department_id: Optional[int] = None,
    ctx: AuthContext = Depends(require_permission(Permission.POSITION_READ)),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(Position).options(selectinload(Position.department)).where(Position.is_deleted.is_(False))
    if search:
        like = f"%{search}%"
        stmt = stmt.where((Position.name.ilike(like)) | (Position.code.ilike(like)))
    if department_id is not None:
        stmt = stmt.where(Position.department_id == department_id)
    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar_one()
    rows = (await db.execute(
        stmt.order_by(Position.sort_order, Position.name).offset((page - 1) * page_size).limit(page_size)
    )).scalars().all()
    return Page[PositionRead](
        items=[_to_read(p) for p in rows], total=total, page=page, page_size=page_size,
        pages=(total + page_size - 1) // page_size,
    )


@router.post("", response_model=PositionRead, status_code=201)
async def create_position(
    payload: PositionCreate,
    ctx: AuthContext = Depends(require_permission(Permission.POSITION_CREATE)),
    db: AsyncSession = Depends(get_db),
):
    dup = await db.execute(
        select(Position.id).where(
            (Position.code == payload.code) | (Position.name == payload.name),
            Position.is_deleted.is_(False),
        )
    )
    if dup.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Shu nom yoki kod bilan lavozim mavjud")
    pos = Position(**payload.model_dump())
    db.add(pos)
    await db.flush()
    AuditService(db).record(
        action="position.create", resource_type="position", resource_id=pos.id,
        user_id=ctx.user_id, new_values=payload.model_dump(), description=f"Lavozim: {pos.name}",
    )
    await db.commit()
    await db.refresh(pos)
    return _to_read(pos)


@router.patch("/{position_id}", response_model=PositionRead)
async def update_position(
    position_id: int,
    payload: PositionUpdate,
    ctx: AuthContext = Depends(require_permission(Permission.POSITION_UPDATE)),
    db: AsyncSession = Depends(get_db),
):
    pos = await db.get(Position, position_id)
    if pos is None or pos.is_deleted:
        raise HTTPException(status_code=404, detail="Lavozim topilmadi")
    updates = payload.model_dump(exclude_unset=True)
    old = {k: getattr(pos, k) for k in updates}
    for k, v in updates.items():
        setattr(pos, k, v)
    AuditService(db).record(
        action="position.update", resource_type="position", resource_id=pos.id,
        user_id=ctx.user_id, old_values=old, new_values=updates,
        description=f"Lavozim tahrirlandi: {pos.name}",
    )
    await db.commit()
    await db.refresh(pos)
    return _to_read(pos)


@router.delete("/{position_id}", response_model=Message)
async def delete_position(
    position_id: int,
    ctx: AuthContext = Depends(require_permission(Permission.POSITION_DELETE)),
    db: AsyncSession = Depends(get_db),
):
    pos = await db.get(Position, position_id)
    if pos is None or pos.is_deleted:
        raise HTTPException(status_code=404, detail="Lavozim topilmadi")
    used = (await db.execute(
        select(func.count(Employee.id)).where(
            Employee.position_id == position_id, Employee.is_deleted.is_(False)
        )
    )).scalar_one()
    if used:
        raise HTTPException(status_code=409, detail=f"Bu lavozimda {used} ta xodim bor")
    pos.is_deleted = True
    pos.deleted_at = datetime.now(timezone.utc)
    AuditService(db).record(
        action="position.delete", resource_type="position", resource_id=pos.id,
        user_id=ctx.user_id, description=f"Lavozim o'chirildi: {pos.name}",
    )
    await db.commit()
    return Message(detail="Lavozim o'chirildi")