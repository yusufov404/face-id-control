from datetime import date, time as dtime, datetime, timezone
from typing import Optional
import io
import re

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
import pandas as pd

from app.api.deps import AuthContext, require_permission
from app.audit.service import AuditService
from app.core.database import get_db
from app.core.permissions import Permission
from app.models.employee import Employee
from app.models.shift import EmployeeShiftAssignment, Shift, ShiftType
from app.schemas.common import Message, Page
from app.schemas.hr import (
    EmployeeShiftAssignmentCreate,
    EmployeeShiftAssignmentRead,
    ShiftCreate,
    ShiftRead,
    ShiftUpdate,
)

router = APIRouter(prefix="/shifts", tags=["shifts"])


def _parse_time(value: str) -> dtime:
    try:
        return dtime.fromisoformat(value)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Vaqt formati xato: {value} (HH:MM)")


@router.get("", response_model=Page[ShiftRead])
async def list_shifts(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    search: Optional[str] = None,
    is_active: Optional[bool] = None,
    ctx: AuthContext = Depends(require_permission(Permission.SHIFT_READ)),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(Shift).where(Shift.is_deleted.is_(False))
    if search:
        like = f"%{search}%"
        stmt = stmt.where((Shift.name.ilike(like)) | (Shift.code.ilike(like)))
    if is_active is not None:
        stmt = stmt.where(Shift.is_active.is_(is_active))
    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar_one()
    rows = (await db.execute(
        stmt.order_by(Shift.name).offset((page - 1) * page_size).limit(page_size)
    )).scalars().all()
    return Page[ShiftRead](
        items=[ShiftRead.model_validate(s) for s in rows],
        total=total, page=page, page_size=page_size,
        pages=(total + page_size - 1) // page_size,
    )


def _apply_times(data: dict) -> dict:
    for field in ("start_time", "end_time", "break_start", "break_end"):
        if field in data and data[field] is not None:
            data[field] = _parse_time(data[field])
    return data


@router.post("", response_model=ShiftRead, status_code=201)
async def create_shift(
    payload: ShiftCreate,
    ctx: AuthContext = Depends(require_permission(Permission.SHIFT_CREATE)),
    db: AsyncSession = Depends(get_db),
):
    dup = await db.execute(select(Shift.id).where(Shift.code == payload.code, Shift.is_deleted.is_(False)))
    if dup.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Bu kod bilan smena mavjud")
    data = _apply_times(payload.model_dump())
    start, end = data["start_time"], data["end_time"]
    data["crosses_midnight"] = data.get("crosses_midnight") or end <= start
    shift = Shift(**data)
    db.add(shift)
    await db.flush()
    AuditService(db).record(
        action="shift.create", resource_type="shift", resource_id=shift.id,
        user_id=ctx.user_id, new_values={k: str(v) for k, v in data.items()},
        description=f"Smena yaratildi: {shift.name}",
    )
    await db.commit()
    await db.refresh(shift)
    return ShiftRead.model_validate(shift)


@router.patch("/{shift_id}", response_model=ShiftRead)
async def update_shift(
    shift_id: int,
    payload: ShiftUpdate,
    ctx: AuthContext = Depends(require_permission(Permission.SHIFT_UPDATE)),
    db: AsyncSession = Depends(get_db),
):
    shift = await db.get(Shift, shift_id)
    if shift is None or shift.is_deleted:
        raise HTTPException(status_code=404, detail="Smena topilmadi")
    updates = _apply_times(payload.model_dump(exclude_unset=True))
    old = {k: str(getattr(shift, k)) for k in updates}
    for k, v in updates.items():
        setattr(shift, k, v)
    if shift.end_time <= shift.start_time:
        shift.crosses_midnight = True
    AuditService(db).record(
        action="shift.update", resource_type="shift", resource_id=shift.id,
        user_id=ctx.user_id, old_values=old, new_values={k: str(v) for k, v in updates.items()},
        description=f"Smena tahrirlandi: {shift.name}",
    )
    await db.commit()
    await db.refresh(shift)
    return ShiftRead.model_validate(shift)


@router.delete("/{shift_id}", response_model=Message)
async def delete_shift(
    shift_id: int,
    ctx: AuthContext = Depends(require_permission(Permission.SHIFT_DELETE)),
    db: AsyncSession = Depends(get_db),
):
    shift = await db.get(Shift, shift_id)
    if shift is None or shift.is_deleted:
        raise HTTPException(status_code=404, detail="Smena topilmadi")
    active = (await db.execute(select(func.count(EmployeeShiftAssignment.id)).where(
        EmployeeShiftAssignment.shift_id == shift_id,
        EmployeeShiftAssignment.is_deleted.is_(False),
        EmployeeShiftAssignment.is_active.is_(True),
    ))).scalar_one()
    if active:
        raise HTTPException(status_code=409, detail=f"Bu smena {active} ta xodimga biriktirilgan")
    shift.is_deleted = True
    shift.deleted_at = datetime.now(timezone.utc)
    AuditService(db).record(
        action="shift.delete", resource_type="shift", resource_id=shift.id,
        user_id=ctx.user_id, description=f"Smena o'chirildi: {shift.name}",
    )
    await db.commit()
    return Message(detail="Smena o'chirildi")


# ---------------------------------------------------------------- assignments
assign_router = APIRouter(prefix="/shift-assignments", tags=["shifts"])


@assign_router.get("", response_model=Page[EmployeeShiftAssignmentRead])
async def list_assignments(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    employee_id: Optional[int] = None,
    shift_id: Optional[int] = None,
    ctx: AuthContext = Depends(require_permission(Permission.SHIFT_READ)),
    db: AsyncSession = Depends(get_db),
):
    stmt = (
        select(EmployeeShiftAssignment)
        .options(
            selectinload(EmployeeShiftAssignment.employee),
            selectinload(EmployeeShiftAssignment.shift),
        )
        .where(EmployeeShiftAssignment.is_deleted.is_(False))
    )
    if ctx.department_scope is not None:
        from app.models.employee import Employee
        stmt = stmt.join(Employee, EmployeeShiftAssignment.employee_id == Employee.id).where(
            Employee.department_id == ctx.department_scope
        )
    if employee_id is not None:
        stmt = stmt.where(EmployeeShiftAssignment.employee_id == employee_id)
    if shift_id is not None:
        stmt = stmt.where(EmployeeShiftAssignment.shift_id == shift_id)
    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar_one()
    rows = (await db.execute(
        stmt.order_by(EmployeeShiftAssignment.start_date.desc())
        .offset((page - 1) * page_size).limit(page_size)
    )).scalars().all()
    items = []
    for a in rows:
        item = EmployeeShiftAssignmentRead.model_validate(a)
        if a.employee:
            item.employee_name = a.employee.full_name
        if a.shift:
            item.shift_name = a.shift.name
        items.append(item)
    return Page[EmployeeShiftAssignmentRead](
        items=items, total=total, page=page, page_size=page_size,
        pages=(total + page_size - 1) // page_size,
    )


@assign_router.post("", response_model=EmployeeShiftAssignmentRead, status_code=201)
async def create_assignment(
    payload: EmployeeShiftAssignmentCreate,
    ctx: AuthContext = Depends(require_permission(Permission.SHIFT_ASSIGN)),
    db: AsyncSession = Depends(get_db),
):
    from app.models.employee import Employee
    emp = await db.get(Employee, payload.employee_id)
    if emp is None or emp.is_deleted:
        raise HTTPException(status_code=404, detail="Xodim topilmadi")
    ctx.assert_department(emp.department_id)
    shift = await db.get(Shift, payload.shift_id)
    if shift is None or shift.is_deleted:
        raise HTTPException(status_code=404, detail="Smena topilmadi")
    if payload.end_date and payload.end_date < payload.start_date:
        raise HTTPException(status_code=400, detail="end_date start_date dan keyin bo'lishi kerak")

    data = payload.model_dump()
    for f in ("custom_start_time", "custom_end_time"):
        if data.get(f):
            data[f] = _parse_time(data[f])
    assignment = EmployeeShiftAssignment(**data)
    db.add(assignment)
    await db.flush()
    AuditService(db).record(
        action="shift.assign", resource_type="employee_shift_assignment",
        resource_id=assignment.id, user_id=ctx.user_id,
        new_values={k: str(v) for k, v in data.items()},
        description=f"Smena biriktirildi: {emp.full_name} -> {shift.name}",
    )
    await db.commit()
    await db.refresh(assignment)
    item = EmployeeShiftAssignmentRead.model_validate(assignment)
    item.employee_name = emp.full_name
    item.shift_name = shift.name
    return item


@router.post("/import-graph", response_model=Message)
async def import_graph(
    file: UploadFile = File(...),
    month: int = Query(10, ge=1, le=12),
    year: int = Query(2026, ge=2020, le=2100),
    ctx: AuthContext = Depends(require_permission(Permission.SHIFT_ASSIGN)),
    db: AsyncSession = Depends(get_db),
):
    content = await file.read()
    try:
        xls = pd.ExcelFile(io.BytesIO(content))
        df_dict = {name: pd.read_excel(xls, sheet_name=name, header=None) for name in xls.sheet_names}
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Excel o'qishda xatolik: {e}")

    def _parse_shift_code(val):
        if pd.isna(val):
            return None
        s = str(val).strip().lower().replace(' ', '')
        if not s or s in ['nan', '']:
            return None
        if s in ['м/т', 'м/о', 'т/т', 'к/в', 'k/v', 'm/t', 'm/o', 't/t']:
            return s.upper()
        m = re.match(r'^(\d+)\*(\d+)$', s)
        if m:
            return f"{m.group(1)}*{m.group(2)}"
        m2 = re.match(r'^(\d+)$', s)
        if m2 and int(m2.group(1)) in [4, 6, 8, 9, 10, 12]:
            return m2.group(1)
        return s.upper()[:12]

    async def _ensure_shift(code_str):
        if not code_str:
            return None
        c = code_str.upper().replace('*', 'X').replace('/', '_')
        res = await db.execute(select(Shift).where(Shift.code == c, Shift.is_deleted.is_(False)))
        shift = res.scalar_one_or_none()
        if shift:
            return shift
        if '*' in code_str:
            base = code_str.split('*')[0]
            hours = int(base)
            start = dtime(8, 0)
            end = dtime((8 + hours) % 24, 0)
        elif code_str.isdigit():
            hours = int(code_str)
            start = dtime(8, 0)
            end = dtime((8 + hours) % 24, 0)
        elif code_str in ['K/V', 'К/В']:
            start = dtime(20, 0)
            end = dtime(8, 0)
        elif code_str in ['M/T']:
            start = dtime(7, 0)
            end = dtime(19, 0)
        else:
            start = dtime(8, 0)
            end = dtime(17, 0)
        shift = Shift(
            name=f"Smena {code_str}",
            code=c,
            shift_type=ShiftType.NIGHT if code_str in ['K/V', 'К/В'] else ShiftType.FIXED,
            start_time=start,
            end_time=end,
            crosses_midnight=end <= start or code_str in ['K/V', 'К/В'],
            break_duration=60,
            late_threshold=15,
            early_leave_threshold=15,
            min_work_minutes=480,
            overtime_enabled=False,
            applicable_days=['monday','tuesday','wednesday','thursday','friday','saturday'],
            is_active=True,
        )
        db.add(shift)
        await db.flush()
        return shift

    created = 0
    for sheet_name, sdf in df_dict.items():
        hdr_row = None
        for i in range(min(40, len(sdf))):
            cnt = 0
            for v in sdf.iloc[i].values:
                if pd.notna(v):
                    try:
                        s = str(v).strip()
                        if s.isdigit() and 1 <= int(s) <= 31:
                            cnt += 1
                    except Exception:
                        pass
            if cnt >= 5:
                hdr_row = i
                break
        if hdr_row is None:
            continue
        hdr = sdf.iloc[hdr_row].tolist()
        daycols = []
        for c, v in enumerate(hdr):
            if pd.notna(v):
                try:
                    s = str(v).strip()
                    if s.isdigit() and 1 <= int(s) <= 31:
                        daycols.append((c, int(s)))
                except Exception:
                    pass
        emp_res = await db.execute(select(Employee).where(Employee.is_deleted.is_(False)))
        emps = list(emp_res.scalars().all())
        for i in range(hdr_row + 1, min(hdr_row + 90, len(sdf))):
            row = sdf.iloc[i].tolist()
            fio = None
            for c, v in enumerate(row):
                if isinstance(v, str):
                    sv = v.strip()
                    if len(sv) > 4 and ' ' in sv and sv[0].isupper():
                        low = sv.lower()
                        if any(x in low for x in ['ibn', 'klinika', 'rais', 'келиш', 'тасдиқ', "o'rinbos", 'оринбос', 'bo‘lim']):
                            continue
                        fio = sv
                        break
            if not fio:
                continue
            tabel = None
            for v in row:
                try:
                    if isinstance(v, (int, float)) and not isinstance(v, bool) and 1000 < v < 10000:
                        tabel = int(v)
                        break
                except Exception:
                    pass
            emp = None
            for e in emps:
                full = (e.full_name or f"{e.last_name or ''} {e.first_name or ''} {e.middle_name or ''}").strip()
                if full.lower() == fio.lower():
                    emp = e
                    break
                if tabel and getattr(e, 'internal_id', None) == str(tabel):
                    emp = e
                    break
            if not emp:
                continue
            shift_days = {}
            for cc, dn in daycols:
                if cc < len(row) and pd.notna(row[cc]):
                    val = _parse_shift_code(row[cc])
                    if val and val not in ['НАН', '']:
                        if val not in shift_days:
                            shift_days[val] = []
                        shift_days[val].append(dn)
            for scode, days_list in shift_days.items():
                if not days_list:
                    continue
                shift = await _ensure_shift(scode)
                if not shift:
                    continue
                start_d = date(year, month, 1)
                ass = EmployeeShiftAssignment(
                    employee_id=emp.id,
                    shift_id=shift.id,
                    start_date=start_d,
                    end_date=None,
                    priority=0,
                    is_active=True,
                )
                db.add(ass)
                created += 1
    await db.commit()
    AuditService(db).record(
        action="shift.graph.import",
        resource_type="shift",
        resource_id=0,
        user_id=ctx.user_id,
        description=f"Grafik import qilindi: {file.filename}, {created} ta biriktirish",
    )
    await db.commit()
    return Message(detail=f"Import yakunlandi. Yaratilgan biriktirishlar: {created}")
