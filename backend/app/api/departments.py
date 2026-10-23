from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import AuthContext, require_permission
from app.api.serializers import safe_attr
from app.audit.service import AuditService
from app.core.database import get_db
from app.core.permissions import Permission
from app.models.department import Department
from app.models.employee import Employee
from app.schemas.common import Message, Page
from app.schemas.hr import (
    DepartmentCreate,
    DepartmentOption,
    DepartmentRead,
    DepartmentUpdate,
)

router = APIRouter(prefix="/departments", tags=["departments"])


def _to_read(dept: Department, count: int = 0) -> DepartmentRead:
    data = DepartmentRead.model_validate(dept)
    data.employee_count = count
    parent = safe_attr(dept, "parent")
    if parent is not None:
        data.parent_name = parent.name
    return data


@router.get("", response_model=Page[DepartmentRead])
async def list_departments(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    search: Optional[str] = None,
    is_active: Optional[bool] = None,
    ctx: AuthContext = Depends(require_permission(Permission.DEPARTMENT_READ)),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(Department).where(Department.is_deleted.is_(False))
    if ctx.department_scope is not None:
        stmt = stmt.where(Department.id == ctx.department_scope)
    if search:
        like = f"%{search}%"
        stmt = stmt.where((Department.name.ilike(like)) | (Department.code.ilike(like)))
    if is_active is not None:
        stmt = stmt.where(Department.is_active.is_(is_active))

    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar_one()
    stmt = stmt.order_by(Department.sort_order, Department.name).offset((page - 1) * page_size).limit(page_size)
    rows = (await db.execute(stmt)).scalars().all()

    counts = dict(
        (
            await db.execute(
                select(Employee.department_id, func.count(Employee.id))
                .where(Employee.is_deleted.is_(False), Employee.status == "active")
                .group_by(Employee.department_id)
            )
        ).all()
    )
    items = [_to_read(d, counts.get(d.id, 0)) for d in rows]
    return Page[DepartmentRead](
        items=items, total=total, page=page, page_size=page_size,
        pages=(total + page_size - 1) // page_size,
    )


@router.get("/options", response_model=list[DepartmentOption])
async def department_options(
    ctx: AuthContext = Depends(require_permission(Permission.DEPARTMENT_READ)),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(Department).where(Department.is_deleted.is_(False), Department.is_active.is_(True))
    if ctx.department_scope is not None:
        stmt = stmt.where(Department.id == ctx.department_scope)
    rows = (await db.execute(stmt.order_by(Department.name))).scalars().all()
    return [DepartmentOption.model_validate(d) for d in rows]


@router.post("", response_model=DepartmentRead, status_code=201)
async def create_department(
    payload: DepartmentCreate,
    ctx: AuthContext = Depends(require_permission(Permission.DEPARTMENT_CREATE)),
    db: AsyncSession = Depends(get_db),
):
    exists = await db.execute(
        select(Department).where(
            (Department.code == payload.code) | (Department.name == payload.name),
            Department.is_deleted.is_(False),
        )
    )
    if exists.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Shu nom yoki kod bilan bo'lim mavjud")

    dept = Department(**payload.model_dump())
    db.add(dept)
    await db.flush()
    AuditService(db).record(
        action="department.create", resource_type="department", resource_id=dept.id,
        user_id=ctx.user_id, new_values=payload.model_dump(), description=f"Bo'lim yaratildi: {dept.name}",
    )
    await db.commit()
    await db.refresh(dept)
    return _to_read(dept)


@router.get("/{dept_id}", response_model=DepartmentRead)
async def get_department(
    dept_id: int,
    ctx: AuthContext = Depends(require_permission(Permission.DEPARTMENT_READ)),
    db: AsyncSession = Depends(get_db),
):
    ctx.assert_department(dept_id)
    dept = await db.get(Department, dept_id)
    if dept is None or dept.is_deleted:
        raise HTTPException(status_code=404, detail="Bo'lim topilmadi")
    count = (await db.execute(
        select(func.count(Employee.id)).where(
            Employee.department_id == dept_id, Employee.is_deleted.is_(False),
            Employee.status == "active",
        )
    )).scalar_one()
    return _to_read(dept, count)


@router.patch("/{dept_id}", response_model=DepartmentRead)
async def update_department(
    dept_id: int,
    payload: DepartmentUpdate,
    ctx: AuthContext = Depends(require_permission(Permission.DEPARTMENT_UPDATE)),
    db: AsyncSession = Depends(get_db),
):
    dept = await db.get(Department, dept_id)
    if dept is None or dept.is_deleted:
        raise HTTPException(status_code=404, detail="Bo'lim topilmadi")
    if payload.parent_id == dept_id:
        raise HTTPException(status_code=400, detail="Bo'lim o'ziga ota bo'la olmaydi")

    old = {k: getattr(dept, k) for k in payload.model_dump(exclude_unset=True)}
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(dept, field, value)
    AuditService(db).record(
        action="department.update", resource_type="department", resource_id=dept.id,
        user_id=ctx.user_id, old_values=old, new_values=payload.model_dump(exclude_unset=True),
        description=f"Bo'lim tahrirlandi: {dept.name}",
    )
    await db.commit()
    await db.refresh(dept)
    return _to_read(dept)


@router.delete("/{dept_id}", response_model=Message)
async def delete_department(
    dept_id: int,
    ctx: AuthContext = Depends(require_permission(Permission.DEPARTMENT_DELETE)),
    db: AsyncSession = Depends(get_db),
):
    dept = await db.get(Department, dept_id)
    if dept is None or dept.is_deleted:
        raise HTTPException(status_code=404, detail="Bo'lim topilmadi")
    active = (await db.execute(
        select(func.count(Employee.id)).where(
            Employee.department_id == dept_id, Employee.is_deleted.is_(False),
        )
    )).scalar_one()
    if active:
        raise HTTPException(
            status_code=409,
            detail=f"Bo'limda {active} ta xodim bor. Avval ularni ko'chiring.",
        )
    dept.is_deleted = True
    from datetime import datetime, timezone
    dept.deleted_at = datetime.now(timezone.utc)
    AuditService(db).record(
        action="department.delete", resource_type="department", resource_id=dept.id,
        user_id=ctx.user_id, description=f"Bo'lim o'chirildi (soft): {dept.name}",
    )
    await db.commit()
    return Message(detail="Bo'lim o'chirildi")