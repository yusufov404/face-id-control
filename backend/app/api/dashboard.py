from datetime import date, datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import AuthContext, require_permission
from app.core.database import get_db
from app.core.permissions import Permission
from app.models.attendance import AttendanceRecord, AttendanceStatus
from app.models.department import Department
from app.models.device import Device, DeviceStatus
from app.models.employee import Employee, EmploymentStatus
from app.schemas.attendance import DashboardStats, DailySummary

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


async def _scope_employee_ids(db: AsyncSession, ctx: AuthContext) -> Optional[set[int]]:
    if ctx.department_scope is None:
        return None
    rows = (await db.execute(
        select(Employee.id).where(Employee.department_id == ctx.department_scope)
    )).scalars().all()
    return set(rows)


@router.get("/stats", response_model=DashboardStats)
async def stats(
    ctx: AuthContext = Depends(require_permission(Permission.REPORT_DASHBOARD)),
    db: AsyncSession = Depends(get_db),
):
    today = date.today()

    emp_stmt = select(func.count(Employee.id)).where(
        Employee.is_deleted.is_(False), Employee.status == EmploymentStatus.ACTIVE
    )
    if ctx.department_scope is not None:
        emp_stmt = emp_stmt.where(Employee.department_id == ctx.department_scope)
    total_emp = (await db.execute(emp_stmt)).scalar_one()

    dept_stmt = select(func.count(Department.id)).where(
        Department.is_deleted.is_(False), Department.is_active.is_(True)
    )
    if ctx.department_scope is not None:
        dept_stmt = dept_stmt.where(Department.id == ctx.department_scope)
    total_dept = (await db.execute(dept_stmt)).scalar_one()

    def status_count(status: AttendanceStatus):
        s = select(func.count(AttendanceRecord.id)).where(
            AttendanceRecord.record_date == today,
            AttendanceRecord.is_deleted.is_(False),
            AttendanceRecord.status == status,
        )
        if ctx.department_scope is not None:
            s = s.join(Employee, AttendanceRecord.employee_id == Employee.id).where(
                Employee.department_id == ctx.department_scope
            )
        return s

    present = (await db.execute(status_count(AttendanceStatus.PRESENT))).scalar_one()
    late = (await db.execute(status_count(AttendanceStatus.LATE))).scalar_one()
    late += (await db.execute(status_count(AttendanceStatus.LATE_AND_EARLY))).scalar_one()
    on_leave = (await db.execute(status_count(AttendanceStatus.ON_LEAVE))).scalar_one()
    absent = (await db.execute(status_count(AttendanceStatus.ABSENT))).scalar_one()

    dev_stmt = select(Device.status, func.count(Device.id)).where(Device.is_deleted.is_(False)).group_by(Device.status)
    if ctx.department_scope is not None:
        dev_stmt = dev_stmt.where(Device.department_id == ctx.department_scope)
    dev_counts = dict((await db.execute(dev_stmt)).all())
    online = dev_counts.get(DeviceStatus.ONLINE, 0)
    offline = dev_counts.get(DeviceStatus.OFFLINE, 0) + dev_counts.get(DeviceStatus.ERROR, 0)
    total_dev = sum(dev_counts.values())

    # Real data only; demo flag true only when explicitly simulated events exist
    from sqlalchemy import cast, String as SAString
    from app.models.device import DeviceEvent
    sim = (await db.execute(
        select(func.count(DeviceEvent.id)).where(
            cast(DeviceEvent.raw_data, SAString).ilike("%_facesys_simulated%")
        )
    )).scalar_one()

    return DashboardStats(
        total_active_employees=total_emp,
        total_departments=total_dept,
        today_present=present,
        today_late=late,
        today_absent=absent if absent else max(total_emp - present - late - on_leave, 0),
        today_on_leave=on_leave,
        devices_online=online,
        devices_offline=offline,
        devices_total=total_dev,
        is_demo_data=sim > 0,
        generated_at=datetime.now(timezone.utc),
    )


@router.get("/daily", response_model=DailySummary)
async def daily(
    day: Optional[date] = None,
    ctx: AuthContext = Depends(require_permission(Permission.REPORT_DASHBOARD)),
    db: AsyncSession = Depends(get_db),
):
    d = day or date.today()

    def count(status: AttendanceStatus):
        s = select(func.count(AttendanceRecord.id)).where(
            AttendanceRecord.record_date == d,
            AttendanceRecord.is_deleted.is_(False),
            AttendanceRecord.status == status,
        )
        if ctx.department_scope is not None:
            s = s.join(Employee, AttendanceRecord.employee_id == Employee.id).where(
                Employee.department_id == ctx.department_scope
            )
        return s

    emp_stmt = select(func.count(Employee.id)).where(
        Employee.is_deleted.is_(False), Employee.status == EmploymentStatus.ACTIVE
    )
    if ctx.department_scope is not None:
        emp_stmt = emp_stmt.where(Employee.department_id == ctx.department_scope)
    total = (await db.execute(emp_stmt)).scalar_one()

    return DailySummary(
        date=d,
        total_active_employees=total,
        present=(await db.execute(count(AttendanceStatus.PRESENT))).scalar_one(),
        late=(await db.execute(count(AttendanceStatus.LATE))).scalar_one(),
        absent=(await db.execute(count(AttendanceStatus.ABSENT))).scalar_one(),
        on_leave=(await db.execute(count(AttendanceStatus.ON_LEAVE))).scalar_one(),
        incomplete=(await db.execute(count(AttendanceStatus.INCOMPLETE))).scalar_one(),
        early_leave=(await db.execute(count(AttendanceStatus.EARLY_LEAVE))).scalar_one(),
    )


@router.get("/trend")
async def trend(
    days: int = Query(14, ge=1, le=90),
    ctx: AuthContext = Depends(require_permission(Permission.REPORT_DASHBOARD)),
    db: AsyncSession = Depends(get_db),
):
    from datetime import timedelta
    out = []
    for i in range(days - 1, -1, -1):
        d = date.today() - timedelta(days=i)
        def count(status):
            s = select(func.count(AttendanceRecord.id)).where(
                AttendanceRecord.record_date == d,
                AttendanceRecord.is_deleted.is_(False),
                AttendanceRecord.status == status,
            )
            if ctx.department_scope is not None:
                s = s.join(Employee, AttendanceRecord.employee_id == Employee.id).where(
                    Employee.department_id == ctx.department_scope
                )
            return s
        out.append({
            "date": d.isoformat(),
            "present": (await db.execute(count(AttendanceStatus.PRESENT))).scalar_one(),
            "late": (await db.execute(count(AttendanceStatus.LATE))).scalar_one(),
            "absent": (await db.execute(count(AttendanceStatus.ABSENT))).scalar_one(),
        })
    return out