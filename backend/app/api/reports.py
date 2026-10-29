from datetime import date
from typing import Optional
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import AuthContext, require_permission
from app.core.config import settings
from app.core.database import get_db
from app.core.permissions import Permission
from app.models.attendance import AttendanceRecord, AttendanceStatus
from app.models.department import Department
from app.models.employee import Employee, EmploymentStatus
from app.models.leave import LeaveRequest
from app.schemas.device import DepartmentStat
from app.services.exports import build_excel, build_pdf

router = APIRouter(prefix="/reports", tags=["reports"])

STATUS_LABELS = {
    "present": "Kelgan",
    "late": "Kechikkan",
    "early_leave": "Erta ketgan",
    "late_and_early": "Kechikkan va erta",
    "absent": "Kelmagan",
    "on_leave": "Ta'tilda",
    "holiday": "Bayram",
    "weekend": "Dam olish",
    "incomplete": "To'liqsiz",
    "not_scheduled": "Smena yo'q",
    "unknown": "Noma'lum",
}


def _apply_scope(stmt, ctx: AuthContext):
    if ctx.department_scope is not None:
        stmt = stmt.join(Employee, AttendanceRecord.employee_id == Employee.id).where(
            Employee.department_id == ctx.department_scope
        )
    return stmt


async def _fetch_attendance_rows(
    db: AsyncSession,
    ctx: AuthContext,
    date_from: Optional[date],
    date_to: Optional[date],
    department_id: Optional[int],
    employee_id: Optional[int],
    status: Optional[str],
):
    stmt = (
        select(AttendanceRecord)
        .join(Employee, AttendanceRecord.employee_id == Employee.id)
        .options(
            selectinload(AttendanceRecord.employee).selectinload(Employee.department),
            selectinload(AttendanceRecord.shift),
        )
        .where(AttendanceRecord.is_deleted.is_(False))
    )
    if ctx.department_scope is not None:
        stmt = stmt.where(Employee.department_id == ctx.department_scope)
    elif department_id is not None:
        stmt = stmt.where(Employee.department_id == department_id)
    if date_from:
        stmt = stmt.where(AttendanceRecord.record_date >= date_from)
    if date_to:
        stmt = stmt.where(AttendanceRecord.record_date <= date_to)
    if employee_id:
        stmt = stmt.where(AttendanceRecord.employee_id == employee_id)
    if status:
        try:
            stmt = stmt.where(AttendanceRecord.status == AttendanceStatus(status))
        except ValueError:
            raise HTTPException(status_code=400, detail="Noto'g'ri status")
    stmt = stmt.order_by(AttendanceRecord.record_date.desc(), Employee.last_name)
    # Hard cap to protect the server and the export builder. One extra row is
    # fetched so the caller can tell whether data was truncated.
    stmt = stmt.limit(settings.EXPORT_MAX_ROWS + 1)
    rows = (await db.execute(stmt)).scalars().all()
    return rows


@router.get("/attendance")
async def attendance_report(
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    department_id: Optional[int] = None,
    employee_id: Optional[int] = None,
    status: Optional[str] = None,
    format: str = Query("json", pattern="^(json|excel|pdf)$"),
    ctx: AuthContext = Depends(require_permission(Permission.REPORT_VIEW)),
    db: AsyncSession = Depends(get_db),
):
    rows = await _fetch_attendance_rows(db, ctx, date_from, date_to, department_id, employee_id, status)
    truncated = len(rows) > settings.EXPORT_MAX_ROWS
    if truncated:
        rows = rows[: settings.EXPORT_MAX_ROWS]

    if format == "json":
        return {
            "count": len(rows),
            "truncated": truncated,
            "limit": settings.EXPORT_MAX_ROWS if truncated else None,
            "items": [
                {
                    "id": r.id,
                    "date": r.record_date.isoformat(),
                    "employee": r.employee.full_name if r.employee else None,
                    "department": r.employee.department.name if r.employee and r.employee.department else None,
                    "internal_id": r.employee.internal_id if r.employee else None,
                    "status": r.status.value if hasattr(r.status, "value") else str(r.status),
                    "status_label": STATUS_LABELS.get(
                        r.status.value if hasattr(r.status, "value") else str(r.status), ""
                    ),
                    "check_in": r.actual_check_in.isoformat() if r.actual_check_in else None,
                    "check_out": r.actual_check_out.isoformat() if r.actual_check_out else None,
                    "late_minutes": r.late_minutes,
                    "early_leave_minutes": r.early_leave_minutes,
                    "work_minutes": r.work_minutes,
                }
                for r in rows
            ],
        }

    if not ctx.has(Permission.REPORT_EXPORT):
        raise HTTPException(status_code=403, detail="Eksport ruxsati yo'q")

    headers = [
        "Sana", "Xodim", "Ichki ID", "Bo'lim", "Holat",
        "Kirish", "Chiqish", "Kechikish (daq)", "Erta ketish (daq)", "Ishlangan (daq)",
    ]
    data_rows = [
        [
            r.record_date,
            r.employee.full_name if r.employee else "",
            r.employee.internal_id if r.employee else "",
            r.employee.department.name if r.employee and r.employee.department else "",
            STATUS_LABELS.get(r.status.value if hasattr(r.status, "value") else str(r.status), ""),
            r.actual_check_in, r.actual_check_out,
            r.late_minutes, r.early_leave_minutes, r.work_minutes,
        ]
        for r in rows
    ]
    meta = {
        "Davr": f"{date_from or '...'} — {date_to or '...'}",
        "Jami yozuv": len(rows),
    }
    if truncated:
        meta["Diqqat"] = (
            f"Natija {settings.EXPORT_MAX_ROWS} qator bilan cheklandi; "
            "davrni qisqartiring."
        )
    if format == "excel":
        content = build_excel("Davomat hisoboti", headers, data_rows, meta=meta)
        return _file_response(content, "davomat_hisoboti.xlsx",
                              "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    content = build_pdf("Davomat hisoboti", headers, data_rows, meta=meta)
    return _file_response(content, "davomat_hisoboti.pdf", "application/pdf")


@router.get("/departments", response_model=list[DepartmentStat])
async def department_stats(
    day: Optional[date] = None,
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    ctx: AuthContext = Depends(require_permission(Permission.REPORT_VIEW)),
    db: AsyncSession = Depends(get_db),
):
    d_from = date_from or day or date.today()
    d_to = date_to or day or date.today()

    dept_stmt = select(Department).where(Department.is_deleted.is_(False))
    if ctx.department_scope is not None:
        dept_stmt = dept_stmt.where(Department.id == ctx.department_scope)
    departments = (await db.execute(dept_stmt.order_by(Department.name))).scalars().all()

    dept_ids = [d.id for d in departments]
    if not dept_ids:
        return []

    # Two grouped queries instead of seven per department: with 35+ departments
    # the old loop issued 245+ round-trips (250 ms+) on every dashboard refresh.
    emp_rows = (await db.execute(
        select(Employee.department_id, func.count(Employee.id))
        .where(
            Employee.department_id.in_(dept_ids),
            Employee.is_deleted.is_(False),
            Employee.status == EmploymentStatus.ACTIVE,
        )
        .group_by(Employee.department_id)
    )).all()
    emp_counts = {dept_id: count for dept_id, count in emp_rows}

    att_rows = (await db.execute(
        select(Employee.department_id, AttendanceRecord.status, func.count(AttendanceRecord.id))
        .join(Employee, AttendanceRecord.employee_id == Employee.id)
        .where(
            Employee.department_id.in_(dept_ids),
            AttendanceRecord.record_date >= d_from,
            AttendanceRecord.record_date <= d_to,
            AttendanceRecord.is_deleted.is_(False),
        )
        .group_by(Employee.department_id, AttendanceRecord.status)
    )).all()
    by_dept: dict[int, dict[AttendanceStatus, int]] = {}
    for dept_id, status, count in att_rows:
        by_dept.setdefault(dept_id, {})[status] = count

    out: list[DepartmentStat] = []
    for dept in departments:
        statuses = by_dept.get(dept.id, {})
        present = statuses.get(AttendanceStatus.PRESENT, 0)
        late = statuses.get(AttendanceStatus.LATE, 0) + statuses.get(AttendanceStatus.LATE_AND_EARLY, 0)
        absent = statuses.get(AttendanceStatus.ABSENT, 0)
        on_leave = statuses.get(AttendanceStatus.ON_LEAVE, 0)
        total = present + late + absent + on_leave
        rate = round((present + late) / total * 100, 1) if total else 0.0
        out.append(DepartmentStat(
            department_id=dept.id, department_name=dept.name,
            employee_count=emp_counts.get(dept.id, 0), present=present, late=late,
            absent=absent, on_leave=on_leave, attendance_rate=rate,
        ))
    return out


@router.get("/leaves")
async def leave_report(
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    format: str = Query("json", pattern="^(json|excel|pdf)$"),
    ctx: AuthContext = Depends(require_permission(Permission.REPORT_VIEW)),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(LeaveRequest).where(LeaveRequest.is_deleted.is_(False))
    if ctx.department_scope is not None:
        stmt = stmt.join(Employee, LeaveRequest.employee_id == Employee.id).where(
            Employee.department_id == ctx.department_scope
        )
    if date_from:
        stmt = stmt.where(LeaveRequest.end_date >= date_from)
    if date_to:
        stmt = stmt.where(LeaveRequest.start_date <= date_to)
    leaves = (await db.execute(
        stmt.order_by(LeaveRequest.start_date.desc())
        .limit(settings.EXPORT_MAX_ROWS + 1)
    )).scalars().all()
    truncated = len(leaves) > settings.EXPORT_MAX_ROWS
    if truncated:
        leaves = leaves[: settings.EXPORT_MAX_ROWS]

    if format == "json":
        items = []
        for leave in leaves:
            emp = await db.get(Employee, leave.employee_id)
            items.append({
                "id": leave.id, "employee": emp.full_name if emp else None,
                "type": leave.leave_type.value, "start": leave.start_date.isoformat(),
                "end": leave.end_date.isoformat(), "days": leave.total_days,
                "status": leave.status.value,
            })
        return {
            "count": len(items),
            "truncated": truncated,
            "limit": settings.EXPORT_MAX_ROWS if truncated else None,
            "items": items,
        }

    if not ctx.has(Permission.REPORT_EXPORT):
        raise HTTPException(status_code=403, detail="Eksport ruxsati yo'q")
    headers = ["Xodim", "Turi", "Boshlanish", "Tugash", "Kun", "Holat"]
    rows = []
    for leave in leaves:
        emp = await db.get(Employee, leave.employee_id)
        rows.append([emp.full_name if emp else "", leave.leave_type.value,
                     leave.start_date, leave.end_date, leave.total_days, leave.status.value])
    meta = {"Davr": f"{date_from or '...'} — {date_to or '...'}", "Jami": len(rows)}
    if truncated:
        meta["Diqqat"] = (
            f"Natija {settings.EXPORT_MAX_ROWS} qator bilan cheklandi; "
            "davrni qisqartiring."
        )
    if format == "excel":
        return _file_response(build_excel("Ta'tillar hisoboti", headers, rows, meta=meta),
                              "tatillar.xlsx",
                              "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    return _file_response(build_pdf("Ta'tillar hisoboti", headers, rows, meta=meta),
                          "tatillar.pdf", "application/pdf")


def _file_response(content: bytes, filename: str, media_type: str) -> Response:
    return Response(
        content=content,
        media_type=media_type,
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(filename)}"},
    )