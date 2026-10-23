from datetime import datetime, timezone
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
from app.models.employee import Employee, EmploymentStatus
from app.schemas.common import Message, Page
from app.schemas.hr import (
    EmployeeCreate,
    EmployeeRead,
    EmployeeStatusUpdate,
    EmployeeUpdate,
)

router = APIRouter(prefix="/employees", tags=["employees"])


def _to_read(emp: Employee) -> EmployeeRead:
    data = EmployeeRead.model_validate(emp)
    data.full_name = emp.full_name
    dept = safe_attr(emp, "department")
    if dept is not None:
        data.department_name = dept.name
    pos = safe_attr(emp, "position")
    if pos is not None:
        data.position_name = pos.name
    sup = safe_attr(emp, "supervisor")
    if sup is not None:
        data.supervisor_name = sup.full_name
    return data


async def _load_employee(db: AsyncSession, employee_id: int) -> Optional[Employee]:
    """Reload an employee with the relationships used by EmployeeRead."""
    stmt = (
        select(Employee)
        .options(
            selectinload(Employee.department),
            selectinload(Employee.position),
            selectinload(Employee.supervisor),
        )
        .where(Employee.id == employee_id, Employee.is_deleted.is_(False))
    )
    return (await db.execute(stmt)).scalar_one_or_none()


@router.get("", response_model=Page[EmployeeRead])
async def list_employees(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    search: Optional[str] = None,
    department_id: Optional[int] = None,
    position_id: Optional[int] = None,
    status: Optional[str] = None,
    ctx: AuthContext = Depends(require_permission(Permission.EMPLOYEE_READ)),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(Employee).options(
        selectinload(Employee.department),
        selectinload(Employee.position),
        selectinload(Employee.supervisor),
    ).where(Employee.is_deleted.is_(False))

    # Department boundary enforced server-side
    if ctx.department_scope is not None:
        stmt = stmt.where(Employee.department_id == ctx.department_scope)
    elif department_id is not None:
        stmt = stmt.where(Employee.department_id == department_id)

    if position_id is not None:
        stmt = stmt.where(Employee.position_id == position_id)
    if status:
        try:
            stmt = stmt.where(Employee.status == EmploymentStatus(status))
        except ValueError:
            raise HTTPException(status_code=400, detail="Noto'g'ri status")
    if search:
        like = f"%{search}%"
        stmt = stmt.where(or_(
            Employee.first_name.ilike(like),
            Employee.last_name.ilike(like),
            Employee.middle_name.ilike(like),
            Employee.internal_id.ilike(like),
            Employee.device_user_id.ilike(like),
            Employee.phone.ilike(like),
        ))

    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar_one()
    stmt = stmt.order_by(Employee.last_name, Employee.first_name).offset((page - 1) * page_size).limit(page_size)
    rows = (await db.execute(stmt)).scalars().all()
    return Page[EmployeeRead](
        items=[_to_read(e) for e in rows], total=total, page=page, page_size=page_size,
        pages=(total + page_size - 1) // page_size,
    )


@router.get("/{employee_id}", response_model=EmployeeRead)
async def get_employee(
    employee_id: int,
    ctx: AuthContext = Depends(require_permission(Permission.EMPLOYEE_READ)),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(Employee).options(
        selectinload(Employee.department),
        selectinload(Employee.position),
        selectinload(Employee.supervisor),
    ).where(Employee.id == employee_id, Employee.is_deleted.is_(False))
    emp = (await db.execute(stmt)).scalar_one_or_none()
    if emp is None:
        raise HTTPException(status_code=404, detail="Xodim topilmadi")
    # IDOR guard: out-of-scope must look like 404
    ctx.assert_department(emp.department_id)
    return _to_read(emp)


@router.post("", response_model=EmployeeRead, status_code=201)
async def create_employee(
    payload: EmployeeCreate,
    ctx: AuthContext = Depends(require_permission(Permission.EMPLOYEE_CREATE)),
    db: AsyncSession = Depends(get_db),
):
    # HR/Admin can only create within their scope
    if ctx.department_scope is not None:
        if payload.department_id != ctx.department_scope:
            raise HTTPException(status_code=403, detail="Boshqa bo'limga xodim qo'sha olmaysiz")

    dup = await db.execute(
        select(Employee.id).where(Employee.internal_id == payload.internal_id, Employee.is_deleted.is_(False))
    )
    if dup.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Bu ichki ID allaqachon mavjud")
    if payload.device_user_id:
        dup2 = await db.execute(
            select(Employee.id).where(Employee.device_user_id == payload.device_user_id, Employee.is_deleted.is_(False))
        )
        if dup2.scalar_one_or_none():
            raise HTTPException(status_code=409, detail="Bu qurilma ID allaqachon mavjud")

    data = payload.model_dump()
    try:
        data["status"] = EmploymentStatus(data["status"])
    except ValueError:
        raise HTTPException(status_code=400, detail="Noto'g'ri status")
    emp = Employee(**data)
    db.add(emp)
    await db.flush()
    AuditService(db).record(
        action="employee.create", resource_type="employee", resource_id=emp.id,
        user_id=ctx.user_id, new_values={k: str(v) for k, v in payload.model_dump().items()},
        description=f"Xodim yaratildi: {emp.full_name}",
    )
    await db.commit()
    loaded = await _load_employee(db, emp.id)
    return _to_read(loaded or emp)


@router.patch("/{employee_id}", response_model=EmployeeRead)
async def update_employee(
    employee_id: int,
    payload: EmployeeUpdate,
    ctx: AuthContext = Depends(require_permission(Permission.EMPLOYEE_UPDATE)),
    db: AsyncSession = Depends(get_db),
):
    emp = await db.get(Employee, employee_id)
    if emp is None or emp.is_deleted:
        raise HTTPException(status_code=404, detail="Xodim topilmadi")
    ctx.assert_department(emp.department_id)
    if ctx.department_scope is not None and payload.department_id not in (None, ctx.department_scope):
        raise HTTPException(status_code=403, detail="Boshqa bo'limga ko'chira olmaysiz")

    updates = payload.model_dump(exclude_unset=True)
    if "status" in updates:
        try:
            updates["status"] = EmploymentStatus(updates["status"])
        except ValueError:
            raise HTTPException(status_code=400, detail="Noto'g'ri status")
    old = {k: getattr(emp, k) for k in updates}
    for k, v in updates.items():
        setattr(emp, k, v)
    AuditService(db).record(
        action="employee.update", resource_type="employee", resource_id=emp.id,
        user_id=ctx.user_id, old_values={k: str(v) for k, v in old.items()},
        new_values={k: str(v) for k, v in updates.items()},
        description=f"Xodim tahrirlandi: {emp.full_name}",
    )
    await db.commit()
    loaded = await _load_employee(db, emp.id)
    return _to_read(loaded or emp)


@router.post("/{employee_id}/status", response_model=EmployeeRead)
async def change_status(
    employee_id: int,
    payload: EmployeeStatusUpdate,
    ctx: AuthContext = Depends(require_permission(Permission.EMPLOYEE_CHANGE_STATUS)),
    db: AsyncSession = Depends(get_db),
):
    emp = await db.get(Employee, employee_id)
    if emp is None or emp.is_deleted:
        raise HTTPException(status_code=404, detail="Xodim topilmadi")
    ctx.assert_department(emp.department_id)
    try:
        new_status = EmploymentStatus(payload.status)
    except ValueError:
        raise HTTPException(status_code=400, detail="Noto'g'ri status")
    old = emp.status
    emp.status = new_status
    if new_status == EmploymentStatus.TERMINATED and payload.termination_date:
        emp.termination_date = payload.termination_date
    AuditService(db).record(
        action="employee.change_status", resource_type="employee", resource_id=emp.id,
        user_id=ctx.user_id, old_values={"status": old.value}, new_values={"status": new_status.value},
        description=f"Holat o'zgardi: {old.value} -> {new_status.value}. Sabab: {payload.reason or '-'}",
    )
    await db.commit()
    loaded = await _load_employee(db, emp.id)
    return _to_read(loaded or emp)


@router.delete("/{employee_id}", response_model=Message)
async def delete_employee(
    employee_id: int,
    ctx: AuthContext = Depends(require_permission(Permission.EMPLOYEE_DELETE)),
    db: AsyncSession = Depends(get_db),
):
    emp = await db.get(Employee, employee_id)
    if emp is None or emp.is_deleted:
        raise HTTPException(status_code=404, detail="Xodim topilmadi")
    ctx.assert_department(emp.department_id)
    # Soft delete — historical attendance is preserved
    emp.is_deleted = True
    emp.deleted_at = datetime.now(timezone.utc)
    emp.status = EmploymentStatus.TERMINATED
    AuditService(db).record(
        action="employee.delete", resource_type="employee", resource_id=emp.id,
        user_id=ctx.user_id, description=f"Xodim o'chirildi (soft): {emp.full_name}",
    )
    await db.commit()
    return Message(detail="Xodim o'chirildi. Tarixiy davomat saqlanadi.")