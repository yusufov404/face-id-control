"""Live monitoring dashboard for Face ID events and device health."""
from datetime import datetime, timedelta, timezone
from typing import Optional, List

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select, desc
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import AuthContext, require_permission
from app.core.database import get_db
from app.core.permissions import Permission
from app.models.device import Device, DeviceEvent, DeviceStatus
from app.models.employee import Employee
from app.models.department import Department
from app.schemas.common import Page
from pydantic import BaseModel

router = APIRouter(prefix="/monitoring", tags=["monitoring"])


class LiveEventItem(BaseModel):
    """Single live event for monitoring dashboard."""
    id: int
    device_id: int
    device_name: str
    device_ip: str
    employee_id: Optional[int] = None
    employee_name: Optional[str] = None
    device_user_id: Optional[str] = None
    event_type: str
    verify_mode: Optional[str] = None
    event_time: datetime
    is_simulated: bool = False
    processed: bool
    department_name: Optional[str] = None
    location: Optional[str] = None

    class Config:
        from_attributes = True


class DeviceStatusItem(BaseModel):
    """Device status summary for monitoring."""
    id: int
    name: str
    serial_number: str
    ip_address: str
    status: str
    last_heartbeat: Optional[datetime]
    last_sync: Optional[datetime]
    error_message: Optional[str] = None
    department_name: Optional[str] = None
    location: Optional[str] = None
    sync_enabled: bool

    class Config:
        from_attributes = True


class TodayStats(BaseModel):
    """Today's attendance statistics."""
    total_employees: int
    present: int
    late: int
    absent: int
    on_leave: int
    not_scheduled: int
    incomplete: int
    events_today: int
    devices_online: int
    devices_offline: int
    devices_error: int


@router.get("/live-events", response_model=Page[LiveEventItem])
async def live_events(
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    device_id: Optional[int] = None,
    department_id: Optional[int] = None,
    employee_id: Optional[int] = None,
    event_type: Optional[str] = None,
    processed: Optional[bool] = None,
    hours: int = Query(24, ge=1, le=168),
    ctx: AuthContext = Depends(require_permission(Permission.ATTENDANCE_READ)),
    db: AsyncSession = Depends(get_db),
):
    """Get recent device events for live monitoring."""
    end_time = datetime.now(timezone.utc)
    start_time = end_time - timedelta(hours=hours)
    
    stmt = (
        select(DeviceEvent)
        .options(
            selectinload(DeviceEvent.device).selectinload(Device.department),
            selectinload(DeviceEvent.employee)
        )
        .where(
            DeviceEvent.is_deleted.is_(False),
            DeviceEvent.event_time >= start_time,
            DeviceEvent.event_time <= end_time,
        )
    )
    
    if ctx.department_scope is not None:
        stmt = stmt.join(DeviceEvent.device).where(Device.department_id == ctx.department_scope)
    
    if device_id is not None:
        stmt = stmt.where(DeviceEvent.device_id == device_id)
    
    if department_id is not None:
        stmt = stmt.join(DeviceEvent.device).where(Device.department_id == department_id)
    
    if employee_id is not None:
        stmt = stmt.where(DeviceEvent.employee_id == employee_id)
    
    if event_type is not None:
        stmt = stmt.where(DeviceEvent.event_type == event_type)
    
    if processed is not None:
        stmt = stmt.where(DeviceEvent.processed.is_(processed))
    
    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar_one()
    
    rows = (await db.execute(
        stmt.order_by(desc(DeviceEvent.event_time))
        .offset((page - 1) * page_size)
        .limit(page_size)
    )).scalars().all()
    
    items = []
    for e in rows:
        item = LiveEventItem(
            id=e.id,
            device_id=e.device_id,
            device_name=e.device.name if e.device else "Unknown",
            device_ip=e.device.ip_address if e.device else "Unknown",
            employee_id=e.employee_id,
            employee_name=e.employee.full_name if e.employee else None,
            device_user_id=e.device_user_id,
            event_type=e.event_type,
            verify_mode=e.verify_mode,
            event_time=e.event_time,
            is_simulated=e.raw_data.get("_facesys_simulated", False) if e.raw_data else False,
            processed=e.processed,
            department_name=e.device.department.name if e.device and e.device.department else None,
            location=e.device.location if e.device else None,
        )
        items.append(item)
    
    return Page[LiveEventItem](
        items=items, total=total, page=page, page_size=page_size,
        pages=(total + page_size - 1) // page_size,
    )


@router.get("/devices-status", response_model=List[DeviceStatusItem])
async def devices_status(
    department_id: Optional[int] = None,
    ctx: AuthContext = Depends(require_permission(Permission.DEVICE_READ)),
    db: AsyncSession = Depends(get_db),
):
    """Get current status of all devices."""
    stmt = (
        select(Device)
        .options(selectinload(Device.department))
        .where(Device.is_deleted.is_(False))
    )
    
    if ctx.department_scope is not None:
        stmt = stmt.where(Device.department_id == ctx.department_scope)
    
    if department_id is not None:
        stmt = stmt.where(Device.department_id == department_id)
    
    rows = (await db.execute(stmt.order_by(Device.name))).scalars().all()
    
    return [
        DeviceStatusItem(
            id=d.id,
            name=d.name,
            serial_number=d.serial_number,
            ip_address=d.ip_address,
            status=d.status,
            last_heartbeat=d.last_heartbeat,
            last_sync=d.last_sync,
            error_message=d.error_message,
            department_name=d.department.name if d.department else None,
            location=d.location,
            sync_enabled=d.sync_enabled,
        )
        for d in rows
    ]


@router.get("/today-stats", response_model=TodayStats)
async def today_stats(
    department_id: Optional[int] = None,
    ctx: AuthContext = Depends(require_permission(Permission.REPORT_DASHBOARD)),
    db: AsyncSession = Depends(get_db),
):
    """Get today's attendance and device statistics."""
    from app.models.attendance import AttendanceRecord, AttendanceStatus
    
    today = datetime.now(timezone.utc).astimezone().date()
    
    # Employee stats
    emp_stmt = select(Employee).where(Employee.is_deleted.is_(False), Employee.status == "active")
    if ctx.department_scope is not None:
        emp_stmt = emp_stmt.where(Employee.department_id == ctx.department_scope)
    if department_id is not None:
        emp_stmt = emp_stmt.where(Employee.department_id == department_id)
    
    employees = (await db.execute(emp_stmt)).scalars().all()
    total_employees = len(employees)
    
    # Attendance records for today
    emp_ids = [e.id for e in employees]
    if emp_ids:
        att_stmt = select(AttendanceRecord).where(
            AttendanceRecord.employee_id.in_(emp_ids),
            AttendanceRecord.record_date == today,
            AttendanceRecord.is_deleted.is_(False),
        )
        records = (await db.execute(att_stmt)).scalars().all()
        
        present = sum(1 for r in records if r.status == AttendanceStatus.PRESENT)
        late = sum(1 for r in records if r.status == AttendanceStatus.LATE)
        absent = sum(1 for r in records if r.status == AttendanceStatus.ABSENT)
        on_leave = sum(1 for r in records if r.status == AttendanceStatus.ON_LEAVE)
        not_scheduled = sum(1 for r in records if r.status == AttendanceStatus.NOT_SCHEDULED)
        incomplete = sum(1 for r in records if r.status == AttendanceStatus.INCOMPLETE)
    else:
        present = late = absent = on_leave = not_scheduled = incomplete = 0
    
    # Events today
    end_time = datetime.now(timezone.utc)
    start_time = datetime.combine(today, datetime.min.time()).replace(tzinfo=timezone.utc)
    evt_stmt = select(func.count(DeviceEvent.id)).where(
        DeviceEvent.is_deleted.is_(False),
        DeviceEvent.event_time >= start_time,
        DeviceEvent.event_time <= end_time,
    )
    if ctx.department_scope is not None:
        evt_stmt = evt_stmt.join(DeviceEvent.device).where(Device.department_id == ctx.department_scope)
    if department_id is not None:
        evt_stmt = evt_stmt.join(DeviceEvent.device).where(Device.department_id == department_id)
    events_today = (await db.execute(evt_stmt)).scalar_one() or 0
    
    # Device status counts
    dev_stmt = select(Device.status, func.count(Device.id)).where(Device.is_deleted.is_(False))
    if ctx.department_scope is not None:
        dev_stmt = dev_stmt.where(Device.department_id == ctx.department_scope)
    if department_id is not None:
        dev_stmt = dev_stmt.where(Device.department_id == department_id)
    dev_status = (await db.execute(dev_stmt.group_by(Device.status))).all()
    
    devices_online = sum(c for s, c in dev_status if s == DeviceStatus.ONLINE)
    devices_offline = sum(c for s, c in dev_status if s == DeviceStatus.OFFLINE)
    devices_error = sum(c for s, c in dev_status if s == DeviceStatus.ERROR)
    
    return TodayStats(
        total_employees=total_employees,
        present=present,
        late=late,
        absent=absent,
        on_leave=on_leave,
        not_scheduled=not_scheduled,
        incomplete=incomplete,
        events_today=events_today,
        devices_online=devices_online,
        devices_offline=devices_offline,
        devices_error=devices_error,
    )


@router.get("/departments-options")
async def departments_options(
    ctx: AuthContext = Depends(require_permission(Permission.DEPARTMENT_READ)),
    db: AsyncSession = Depends(get_db),
):
    """Get departments for filter dropdown."""
    stmt = select(Department.id, Department.name).where(Department.is_deleted.is_(False))
    if ctx.department_scope is not None:
        stmt = stmt.where(Department.id == ctx.department_scope)
    rows = (await db.execute(stmt.order_by(Department.name))).all()
    return [{"id": r[0], "name": r[1]} for r in rows]