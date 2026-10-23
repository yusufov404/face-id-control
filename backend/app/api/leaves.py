from datetime import date, datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import AuthContext, require_permission
from app.audit.service import AuditService
from app.core.database import get_db
from app.core.permissions import Permission
from app.models.employee import Employee
from app.models.leave import Holiday, LeaveRequest, LeaveStatus, LeaveType
from app.schemas.attendance import (
    HolidayCreate,
    HolidayRead,
    LeaveDecision,
    LeaveRequestCreate,
    LeaveRequestRead,
)
from app.schemas.common import Message, Page

router = APIRouter(prefix="/leaves", tags=["leaves"])
holiday_router = APIRouter(prefix="/holidays", tags=["holidays"])


def _leave_to_read(leave: LeaveRequest, emp: Optional[Employee] = None) -> LeaveRequestRead:
    data = LeaveRequestRead.model_validate(leave)
    if emp:
        data.employee_name = emp.full_name
    return data


@router.get("", response_model=Page[LeaveRequestRead])
async def list_leaves(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    employee_id: Optional[int] = None,
    status: Optional[str] = None,
    ctx: AuthContext = Depends(require_permission(Permission.LEAVE_READ)),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(LeaveRequest).where(LeaveRequest.is_deleted.is_(False))
    if ctx.department_scope is not None:
        stmt = stmt.join(Employee, LeaveRequest.employee_id == Employee.id).where(
            Employee.department_id == ctx.department_scope
        )
    if employee_id is not None:
        stmt = stmt.where(LeaveRequest.employee_id == employee_id)
    if status:
        try:
            stmt = stmt.where(LeaveRequest.status == LeaveStatus(status))
        except ValueError:
            raise HTTPException(status_code=400, detail="Noto'g'ri status")
    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar_one()
    rows = (await db.execute(
        stmt.order_by(LeaveRequest.start_date.desc()).offset((page - 1) * page_size).limit(page_size)
    )).scalars().all()
    items = []
    for leave in rows:
        emp = await db.get(Employee, leave.employee_id)
        items.append(_leave_to_read(leave, emp))
    return Page[LeaveRequestRead](
        items=items, total=total, page=page, page_size=page_size,
        pages=(total + page_size - 1) // page_size,
    )


@router.post("", response_model=LeaveRequestRead, status_code=201)
async def create_leave(
    payload: LeaveRequestCreate,
    ctx: AuthContext = Depends(require_permission(Permission.LEAVE_CREATE)),
    db: AsyncSession = Depends(get_db),
):
    emp = await db.get(Employee, payload.employee_id)
    if emp is None or emp.is_deleted:
        raise HTTPException(status_code=404, detail="Xodim topilmadi")
    ctx.assert_department(emp.department_id)
    if payload.end_date < payload.start_date:
        raise HTTPException(status_code=400, detail="Tugash sanasi boshlanishdan keyin bo'lishi kerak")
    try:
        ltype = LeaveType(payload.leave_type)
    except ValueError:
        raise HTTPException(status_code=400, detail="Noto'g'ri ta'til turi")
    days = (payload.end_date - payload.start_date).days + 1
    leave = LeaveRequest(
        employee_id=payload.employee_id,
        leave_type=ltype,
        start_date=payload.start_date,
        end_date=payload.end_date,
        total_days=days,
        reason=payload.reason,
        attachment_url=payload.attachment_url,
        status=LeaveStatus.PENDING,
        requested_by=ctx.user_id,
    )
    db.add(leave)
    await db.flush()
    AuditService(db).record(
        action="leave.create", resource_type="leave_request", resource_id=leave.id,
        user_id=ctx.user_id,
        new_values={"employee_id": emp.id, "type": ltype.value, "days": days},
        description=f"Ta'til so'rovi: {emp.full_name} ({ltype.value})",
    )
    await db.commit()
    await db.refresh(leave)
    return _leave_to_read(leave, emp)


@router.post("/{leave_id}/decision", response_model=LeaveRequestRead)
async def decide_leave(
    leave_id: int,
    payload: LeaveDecision,
    ctx: AuthContext = Depends(require_permission(Permission.LEAVE_APPROVE)),
    db: AsyncSession = Depends(get_db),
):
    leave = await db.get(LeaveRequest, leave_id)
    if leave is None or leave.is_deleted:
        raise HTTPException(status_code=404, detail="So'rov topilmadi")
    if leave.status != LeaveStatus.PENDING:
        raise HTTPException(status_code=409, detail="So'rov allaqachon ko'rib chiqilgan")
    emp = await db.get(Employee, leave.employee_id)
    ctx.assert_department(emp.department_id if emp else None)

    leave.status = LeaveStatus.APPROVED if payload.approve else LeaveStatus.REJECTED
    leave.approved_by = ctx.user_id
    leave.approved_at = datetime.now(timezone.utc)
    if not payload.approve:
        leave.rejection_reason = payload.rejection_reason

    AuditService(db).record(
        action="leave.decision", resource_type="leave_request", resource_id=leave.id,
        user_id=ctx.user_id,
        new_values={"status": leave.status.value, "reason": payload.rejection_reason},
        description=f"Ta'til qarori: {leave.status.value}",
    )
    await db.commit()

    # Approved leave affects attendance for those dates
    if leave.status == LeaveStatus.APPROVED and emp:
        from app.services import attendance as attendance_service
        d = leave.start_date
        while d <= leave.end_date:
            await attendance_service.compute_day(db, emp, d)
            d = date.fromordinal(d.toordinal() + 1)
        await db.commit()
    await db.refresh(leave)
    return _leave_to_read(leave, emp)


# ---------------------------------------------------------------- holidays
@holiday_router.get("", response_model=Page[HolidayRead])
async def list_holidays(
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=100),
    year: Optional[int] = None,
    ctx: AuthContext = Depends(require_permission(Permission.HOLIDAY_READ)),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(Holiday).where(Holiday.is_deleted.is_(False))
    if year:
        stmt = stmt.where(func.extract("year", Holiday.date) == year)
    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar_one()
    rows = (await db.execute(
        stmt.order_by(Holiday.date).offset((page - 1) * page_size).limit(page_size)
    )).scalars().all()
    return Page[HolidayRead](
        items=[HolidayRead.model_validate(h) for h in rows],
        total=total, page=page, page_size=page_size,
        pages=(total + page_size - 1) // page_size,
    )


@holiday_router.post("", response_model=HolidayRead, status_code=201)
async def create_holiday(
    payload: HolidayCreate,
    ctx: AuthContext = Depends(require_permission(Permission.HOLIDAY_CREATE)),
    db: AsyncSession = Depends(get_db),
):
    dup = await db.execute(select(Holiday.id).where(Holiday.date == payload.date, Holiday.is_deleted.is_(False)))
    if dup.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Bu sanada bayram allaqachon mavjud")
    h = Holiday(**payload.model_dump())
    db.add(h)
    await db.flush()
    AuditService(db).record(
        action="holiday.create", resource_type="holiday", resource_id=h.id,
        user_id=ctx.user_id, new_values=payload.model_dump(mode="json"),
        description=f"Bayram qo'shildi: {h.name} ({h.date})",
    )
    await db.commit()
    await db.refresh(h)
    return HolidayRead.model_validate(h)


@holiday_router.delete("/{holiday_id}", response_model=Message)
async def delete_holiday(
    holiday_id: int,
    ctx: AuthContext = Depends(require_permission(Permission.HOLIDAY_DELETE)),
    db: AsyncSession = Depends(get_db),
):
    h = await db.get(Holiday, holiday_id)
    if h is None or h.is_deleted:
        raise HTTPException(status_code=404, detail="Bayram topilmadi")
    h.is_deleted = True
    h.deleted_at = datetime.now(timezone.utc)
    AuditService(db).record(
        action="holiday.delete", resource_type="holiday", resource_id=h.id,
        user_id=ctx.user_id, description=f"Bayram o'chirildi: {h.name}",
    )
    await db.commit()
    return Message(detail="Bayram o'chirildi")