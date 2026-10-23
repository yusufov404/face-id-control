from datetime import date, datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import AuthContext, require_permission
from app.api.serializers import safe_attr
from app.audit.service import AuditService
from app.core.database import get_db
from app.core.permissions import Permission
from app.models.attendance import (
    AttendanceCorrection,
    AttendanceRecord,
    AttendanceStatus,
    CorrectionType,
)
from app.models.employee import Employee
from app.schemas.attendance import (
    AttendanceCorrectionCreate,
    AttendanceCorrectionRead,
    AttendanceRecordRead,
)
from app.schemas.common import Page
from app.services import attendance as attendance_service

router = APIRouter(prefix="/attendance", tags=["attendance"])


def _to_read(r: AttendanceRecord) -> AttendanceRecordRead:
    data = AttendanceRecordRead.model_validate(r)
    emp = safe_attr(r, "employee")
    if emp is not None:
        data.employee_name = emp.full_name
        data.department_id = emp.department_id
        dept = safe_attr(emp, "department")
        if dept is not None:
            data.department_name = dept.name
    shift = safe_attr(r, "shift")
    if shift is not None:
        data.shift_name = shift.name
    return data


@router.get("", response_model=Page[AttendanceRecordRead])
async def list_attendance(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    employee_id: Optional[int] = None,
    department_id: Optional[int] = None,
    status: Optional[str] = None,
    search: Optional[str] = None,
    ctx: AuthContext = Depends(require_permission(Permission.ATTENDANCE_READ)),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(AttendanceRecord).options(
        selectinload(AttendanceRecord.employee).selectinload(Employee.department),
        selectinload(AttendanceRecord.shift),
    ).where(AttendanceRecord.is_deleted.is_(False))

    if ctx.department_scope is not None:
        stmt = stmt.join(Employee, AttendanceRecord.employee_id == Employee.id).where(
            Employee.department_id == ctx.department_scope
        )
    elif department_id is not None:
        stmt = stmt.join(Employee, AttendanceRecord.employee_id == Employee.id).where(
            Employee.department_id == department_id
        )
    if employee_id is not None:
        stmt = stmt.where(AttendanceRecord.employee_id == employee_id)
    if date_from:
        stmt = stmt.where(AttendanceRecord.record_date >= date_from)
    if date_to:
        stmt = stmt.where(AttendanceRecord.record_date <= date_to)
    if status:
        try:
            stmt = stmt.where(AttendanceRecord.status == AttendanceStatus(status))
        except ValueError:
            raise HTTPException(status_code=400, detail="Noto'g'ri status")
    if search:
        like = f"%{search}%"
        stmt = stmt.join(Employee, AttendanceRecord.employee_id == Employee.id, isouter=True).where(
            or_(Employee.first_name.ilike(like), Employee.last_name.ilike(like),
                Employee.internal_id.ilike(like))
        )

    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar_one()
    rows = (await db.execute(
        stmt.order_by(AttendanceRecord.record_date.desc(), AttendanceRecord.id.desc())
        .offset((page - 1) * page_size).limit(page_size)
    )).scalars().all()
    return Page[AttendanceRecordRead](
        items=[_to_read(r) for r in rows], total=total, page=page, page_size=page_size,
        pages=(total + page_size - 1) // page_size,
    )


@router.get("/{record_id}", response_model=AttendanceRecordRead)
async def get_attendance(
    record_id: int,
    ctx: AuthContext = Depends(require_permission(Permission.ATTENDANCE_READ)),
    db: AsyncSession = Depends(get_db),
):
    r = (await db.execute(
        select(AttendanceRecord).options(
            selectinload(AttendanceRecord.employee).selectinload(Employee.department),
            selectinload(AttendanceRecord.shift),
        ).where(AttendanceRecord.id == record_id, AttendanceRecord.is_deleted.is_(False))
    )).scalar_one_or_none()
    if r is None:
        raise HTTPException(status_code=404, detail="Yozuv topilmadi")
    if r.employee:
        ctx.assert_department(r.employee.department_id)
    return _to_read(r)


@router.post("/{record_id}/recalculate", response_model=AttendanceRecordRead)
async def recalculate(
    record_id: int,
    ctx: AuthContext = Depends(require_permission(Permission.ATTENDANCE_CORRECT)),
    db: AsyncSession = Depends(get_db),
):
    r = await db.get(AttendanceRecord, record_id)
    if r is None or r.is_deleted:
        raise HTTPException(status_code=404, detail="Yozuv topilmadi")
    emp = await db.get(Employee, r.employee_id)
    ctx.assert_department(emp.department_id if emp else None)
    if r.is_manual:
        raise HTTPException(status_code=409, detail="Qo'lda tuzatilgan yozuv qayta hisoblanmaydi")
    rec = await attendance_service.compute_day(db, emp, r.record_date)
    AuditService(db).record(
        action="attendance.recalculate", resource_type="attendance_record", resource_id=r.id,
        user_id=ctx.user_id, description="Davomat qayta hisoblandi",
    )
    await db.commit()
    await db.refresh(rec)
    return _to_read(rec)


def _correction_to_read(c: AttendanceCorrection, emp: Optional[Employee] = None, user_name: str = "") -> AttendanceCorrectionRead:
    data = AttendanceCorrectionRead.model_validate(c)
    if emp:
        data.employee_name = emp.full_name
    data.corrector_name = user_name
    return data


@router.post("/corrections", response_model=AttendanceCorrectionRead, status_code=201)
async def create_correction(
    payload: AttendanceCorrectionCreate,
    ctx: AuthContext = Depends(require_permission(Permission.ATTENDANCE_CORRECT)),
    db: AsyncSession = Depends(get_db),
):
    record = await db.get(AttendanceRecord, payload.attendance_record_id)
    if record is None or record.is_deleted:
        raise HTTPException(status_code=404, detail="Davomat yozuvi topilmadi")
    emp = await db.get(Employee, record.employee_id)
    if emp is None:
        raise HTTPException(status_code=404, detail="Xodim topilmadi")
    ctx.assert_department(emp.department_id)
    # hr_director only within scope; super admin everywhere
    if ctx.department_scope is not None and not ctx.has(Permission.ATTENDANCE_CORRECT_ALL):
        if emp.department_id != ctx.department_scope:
            raise HTTPException(status_code=403, detail="Bu bo'limda tuzatish qila olmaysiz")

    try:
        ctype = CorrectionType(payload.correction_type)
    except ValueError:
        raise HTTPException(status_code=400, detail="Noto'g'ri correction_type")

    # Capture the original values before mutation (raw events remain untouched)
    old_snapshot = {
        "status": record.status.value if hasattr(record.status, "value") else str(record.status),
        "actual_check_in": record.actual_check_in.isoformat() if record.actual_check_in else None,
        "actual_check_out": record.actual_check_out.isoformat() if record.actual_check_out else None,
        "work_minutes": record.work_minutes,
    }

    if ctype == CorrectionType.CHECK_IN:
        if payload.new_check_in is None:
            raise HTTPException(status_code=400, detail="Yangi check-in vaqti kerak")
        record.actual_check_in = payload.new_check_in
    elif ctype == CorrectionType.CHECK_OUT:
        if payload.new_check_out is None:
            raise HTTPException(status_code=400, detail="Yangi check-out vaqti kerak")
        record.actual_check_out = payload.new_check_out
    elif ctype == CorrectionType.STATUS:
        try:
            record.status = AttendanceStatus(payload.new_value)
        except (ValueError, TypeError):
            raise HTTPException(status_code=400, detail="Noto'g'ri status")
    elif ctype == CorrectionType.SHIFT:
        try:
            record.shift_id = int(payload.new_value)
        except (ValueError, TypeError):
            raise HTTPException(status_code=400, detail="Noto'g'ri shift ID")
    elif ctype == CorrectionType.FULL_DAY:
        if payload.new_check_in:
            record.actual_check_in = payload.new_check_in
        if payload.new_check_out:
            record.actual_check_out = payload.new_check_out
        record.status = AttendanceStatus.PRESENT

    # Recompute derived values when times changed
    if ctype in (CorrectionType.CHECK_IN, CorrectionType.CHECK_OUT, CorrectionType.FULL_DAY):
        if record.actual_check_in and record.actual_check_out:
            cin = record.actual_check_in
            cout = record.actual_check_out
            if cin.tzinfo is None:
                cin = cin.replace(tzinfo=timezone.utc)
            if cout.tzinfo is None:
                cout = cout.replace(tzinfo=timezone.utc)
            record.work_minutes = max(int((cout - cin).total_seconds() // 60), 0)
            if record.scheduled_check_in:
                from datetime import datetime as _dt
                sched = _dt.combine(record.record_date, record.scheduled_check_in, tzinfo=cin.tzinfo)
                record.late_minutes = max(int((cin - sched).total_seconds() // 60), 0)
            if record.scheduled_check_out:
                from datetime import datetime as _dt
                sched_out = _dt.combine(record.record_date, record.scheduled_check_out, tzinfo=cout.tzinfo)
                record.early_leave_minutes = max(int((sched_out - cout).total_seconds() // 60), 0)

    record.is_manual = True
    record.is_confirmed = True
    record.confirmed_by = ctx.user_id
    record.confirmed_at = datetime.now(timezone.utc)

    new_snapshot = {
        "status": record.status.value if hasattr(record.status, "value") else str(record.status),
        "actual_check_in": record.actual_check_in.isoformat() if record.actual_check_in else None,
        "actual_check_out": record.actual_check_out.isoformat() if record.actual_check_out else None,
        "work_minutes": record.work_minutes,
    }

    correction = AttendanceCorrection(
        attendance_record_id=record.id,
        employee_id=record.employee_id,
        correction_type=ctype,
        field_name=payload.field_name,
        old_value=old_snapshot.get(payload.field_name, str(old_snapshot)),
        new_value=payload.new_value or str(new_snapshot.get(payload.field_name, new_snapshot)),
        reason=payload.reason,
        corrected_by=ctx.user_id,
        is_approved=False,
    )
    db.add(correction)
    await db.flush()

    AuditService(db).record(
        action="attendance.correct",
        resource_type="attendance_record",
        resource_id=record.id,
        user_id=ctx.user_id,
        old_values=old_snapshot,
        new_values=new_snapshot,
        description=(
            f"Davomat tuzatildi ({ctype.value}). Sabab: {payload.reason}. "
            f"Yozuv ID: {record.id}, xodim: {emp.full_name}"
        ),
    )
    await db.commit()
    await db.refresh(correction)
    return _correction_to_read(correction, emp, ctx.user.full_name)


@router.get("/corrections/list", response_model=Page[AttendanceCorrectionRead])
async def list_corrections(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    employee_id: Optional[int] = None,
    is_approved: Optional[bool] = None,
    ctx: AuthContext = Depends(require_permission(Permission.ATTENDANCE_READ)),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(AttendanceCorrection).where(AttendanceCorrection.is_deleted.is_(False))
    if ctx.department_scope is not None:
        stmt = stmt.join(Employee, AttendanceCorrection.employee_id == Employee.id).where(
            Employee.department_id == ctx.department_scope
        )
    if employee_id is not None:
        stmt = stmt.where(AttendanceCorrection.employee_id == employee_id)
    if is_approved is not None:
        stmt = stmt.where(AttendanceCorrection.is_approved.is_(is_approved))
    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar_one()
    rows = (await db.execute(
        stmt.order_by(AttendanceCorrection.created_at.desc())
        .offset((page - 1) * page_size).limit(page_size)
    )).scalars().all()
    items = []
    for c in rows:
        emp = await db.get(Employee, c.employee_id)
        items.append(_correction_to_read(c, emp))
    return Page[AttendanceCorrectionRead](
        items=items, total=total, page=page, page_size=page_size,
        pages=(total + page_size - 1) // page_size,
    )


@router.post("/corrections/{correction_id}/approve", response_model=AttendanceCorrectionRead)
async def approve_correction(
    correction_id: int,
    ctx: AuthContext = Depends(require_permission(Permission.ATTENDANCE_CORRECT_ALL)),
    db: AsyncSession = Depends(get_db),
):
    c = await db.get(AttendanceCorrection, correction_id)
    if c is None or c.is_deleted:
        raise HTTPException(status_code=404, detail="Tuzatish topilmadi")
    c.is_approved = True
    c.approved_by = ctx.user_id
    c.approved_at = datetime.now(timezone.utc)
    AuditService(db).record(
        action="attendance.correction.approve", resource_type="attendance_correction",
        resource_id=c.id, user_id=ctx.user_id, description="Tuzatish tasdiqlandi",
    )
    await db.commit()
    emp = await db.get(Employee, c.employee_id)
    return _correction_to_read(c, emp, ctx.user.full_name)