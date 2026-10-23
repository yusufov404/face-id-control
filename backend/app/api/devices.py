from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import AuthContext, require_permission
from app.api.serializers import safe_attr
from app.audit.service import AuditService
from app.core.crypto import encrypt_secret
from app.core.database import get_db
from app.core.permissions import Permission
from app.integrations.hikvision.diagnostics import diagnose_device, update_device_status
from app.integrations.hikvision.poller import registry
from app.integrations.hikvision.ingest import store_event, map_verify_mode
from app.integrations.hikvision.client import ISAPIError
from app.models.device import Device, DeviceEvent, DeviceStatus, EventType
from app.schemas.common import Message, Page
from app.schemas.device import (
    DeviceCreate,
    DeviceDiagnostics,
    DeviceEventRead,
    DeviceRead,
    DeviceUpdate,
    ManualEventIngest,
)

router = APIRouter(prefix="/devices", tags=["devices"])


def _to_read(d: Device) -> DeviceRead:
    data = DeviceRead.model_validate(d)
    dept = safe_attr(d, "department")
    if dept is not None:
        data.department_name = dept.name
    return data


@router.get("", response_model=Page[DeviceRead])
async def list_devices(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    search: Optional[str] = None,
    status: Optional[str] = None,
    ctx: AuthContext = Depends(require_permission(Permission.DEVICE_READ)),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(Device).options(selectinload(Device.department)).where(Device.is_deleted.is_(False))
    if ctx.department_scope is not None:
        stmt = stmt.where(Device.department_id == ctx.department_scope)
    if status:
        try:
            stmt = stmt.where(Device.status == DeviceStatus(status))
        except ValueError:
            raise HTTPException(status_code=400, detail="Noto'g'ri status")
    if search:
        like = f"%{search}%"
        stmt = stmt.where((Device.name.ilike(like)) | (Device.serial_number.ilike(like)) | (Device.ip_address.ilike(like)))
    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar_one()
    rows = (await db.execute(
        stmt.order_by(Device.name).offset((page - 1) * page_size).limit(page_size)
    )).scalars().all()
    return Page[DeviceRead](
        items=[_to_read(d) for d in rows], total=total, page=page, page_size=page_size,
        pages=(total + page_size - 1) // page_size,
    )


@router.post("", response_model=DeviceRead, status_code=201)
async def create_device(
    payload: DeviceCreate,
    ctx: AuthContext = Depends(require_permission(Permission.DEVICE_CREATE)),
    db: AsyncSession = Depends(get_db),
):
    dup = await db.execute(select(Device.id).where(Device.serial_number == payload.serial_number))
    if dup.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Bu seriya raqamli qurilma mavjud")
    data = payload.model_dump()
    password = data.pop("password")
    device = Device(**data, password_encrypted=encrypt_secret(password))
    db.add(device)
    await db.flush()
    AuditService(db).record(
        action="device.create", resource_type="device", resource_id=device.id,
        user_id=ctx.user_id,
        new_values={k: v for k, v in payload.model_dump().items() if k != "password"},
        description=f"Qurilma qo'shildi: {device.name}",
    )
    await db.commit()
    await db.refresh(device)
    if device.sync_enabled:
        registry.start(device.id)
    return _to_read(device)


@router.get("/{device_id}", response_model=DeviceRead)
async def get_device(
    device_id: int,
    ctx: AuthContext = Depends(require_permission(Permission.DEVICE_READ)),
    db: AsyncSession = Depends(get_db),
):
    d = (await db.execute(
        select(Device).options(selectinload(Device.department)).where(
            Device.id == device_id, Device.is_deleted.is_(False)
        )
    )).scalar_one_or_none()
    if d is None:
        raise HTTPException(status_code=404, detail="Qurilma topilmadi")
    ctx.assert_department(d.department_id)
    return _to_read(d)


@router.patch("/{device_id}", response_model=DeviceRead)
async def update_device(
    device_id: int,
    payload: DeviceUpdate,
    ctx: AuthContext = Depends(require_permission(Permission.DEVICE_UPDATE)),
    db: AsyncSession = Depends(get_db),
):
    d = await db.get(Device, device_id)
    if d is None or d.is_deleted:
        raise HTTPException(status_code=404, detail="Qurilma topilmadi")
    updates = payload.model_dump(exclude_unset=True)
    password = updates.pop("password", None)
    old = {k: str(getattr(d, k)) for k in updates}
    for k, v in updates.items():
        setattr(d, k, v)
    if password:
        d.password_encrypted = encrypt_secret(password)
    AuditService(db).record(
        action="device.update", resource_type="device", resource_id=d.id,
        user_id=ctx.user_id, old_values=old,
        new_values={k: str(v) for k, v in updates.items()},
        description=f"Qurilma tahrirlandi: {d.name}",
    )
    await db.commit()
    await db.refresh(d)
    if d.sync_enabled:
        registry.restart(d.id)
    else:
        await registry.stop(d.id)
    return _to_read(d)


@router.delete("/{device_id}", response_model=Message)
async def delete_device(
    device_id: int,
    ctx: AuthContext = Depends(require_permission(Permission.DEVICE_DELETE)),
    db: AsyncSession = Depends(get_db),
):
    d = await db.get(Device, device_id)
    if d is None or d.is_deleted:
        raise HTTPException(status_code=404, detail="Qurilma topilmadi")
    await registry.stop(d.id)
    d.is_deleted = True
    d.deleted_at = datetime.now(timezone.utc)
    AuditService(db).record(
        action="device.delete", resource_type="device", resource_id=d.id,
        user_id=ctx.user_id, description=f"Qurilma o'chirildi: {d.name}",
    )
    await db.commit()
    return Message(detail="Qurilma o'chirildi")


@router.post("/{device_id}/diagnose", response_model=DeviceDiagnostics)
async def diagnose(
    device_id: int,
    ctx: AuthContext = Depends(require_permission(Permission.DEVICE_READ)),
    db: AsyncSession = Depends(get_db),
):
    d = await db.get(Device, device_id)
    if d is None or d.is_deleted:
        raise HTTPException(status_code=404, detail="Qurilma topilmadi")
    ctx.assert_department(d.department_id)
    diag = await diagnose_device(d)
    await update_device_status(db, d, diag)
    AuditService(db).record(
        action="device.diagnose", resource_type="device", resource_id=d.id,
        user_id=ctx.user_id,
        description=f"Diagnostika: {d.name} — reachable={diag['reachable']}",
        success=diag["reachable"],
        error_message="; ".join(diag["errors"]) if diag["errors"] else None,
    )
    await db.commit()
    return DeviceDiagnostics(**diag)


@router.post("/{device_id}/sync", response_model=Message)
async def sync_device(
    device_id: int,
    ctx: AuthContext = Depends(require_permission(Permission.DEVICE_SYNC)),
    db: AsyncSession = Depends(get_db),
):
    d = await db.get(Device, device_id)
    if d is None or d.is_deleted:
        raise HTTPException(status_code=404, detail="Qurilma topilmadi")
    # Manual sync of recent events (last 24h)
    from app.integrations.hikvision.ingest import get_client_for_device, ingest_acs_events
    from datetime import timedelta

    try:
        client = await get_client_for_device(d)
        end = datetime.now(timezone.utc)
        start = end - timedelta(hours=24)
        events = await client.search_events(start=start, end=end, max_results=30)
        stored = await ingest_acs_events(db, d, events)
        d.last_sync = end
        AuditService(db).record(
            action="device.sync", resource_type="device", resource_id=d.id,
            user_id=ctx.user_id, description=f"Qo'lda sinxron: {stored} yangi hodisa",
        )
        await db.commit()
        return Message(detail=f"Sinxron yakunlandi: {stored} yangi hodisa")
    except ISAPIError as exc:
        AuditService(db).record(
            action="device.sync", resource_type="device", resource_id=d.id,
            user_id=ctx.user_id, success=False, error_message=str(exc),
            description=f"Sinxron xatosi: {d.name}",
        )
        await db.commit()
        raise HTTPException(status_code=502, detail=f"Qurilma xatosi: {exc}")


@router.get("/{device_id}/events", response_model=Page[DeviceEventRead])
async def device_events(
    device_id: int,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    processed: Optional[bool] = None,
    ctx: AuthContext = Depends(require_permission(Permission.DEVICE_VIEW_LOGS)),
    db: AsyncSession = Depends(get_db),
):
    from app.models.employee import Employee
    d = await db.get(Device, device_id)
    if d is None or d.is_deleted:
        raise HTTPException(status_code=404, detail="Qurilma topilmadi")
    ctx.assert_department(d.department_id)

    stmt = select(DeviceEvent).where(
        DeviceEvent.device_id == device_id, DeviceEvent.is_deleted.is_(False)
    )
    if processed is not None:
        stmt = stmt.where(DeviceEvent.processed.is_(processed))
    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar_one()
    rows = (await db.execute(
        stmt.order_by(DeviceEvent.event_time.desc()).offset((page - 1) * page_size).limit(page_size)
    )).scalars().all()

    items = []
    for e in rows:
        item = DeviceEventRead.model_validate(e)
        item.device_name = d.name
        if e.employee_id:
            emp = await db.get(Employee, e.employee_id)
            item.employee_name = emp.full_name if emp else None
        items.append(item)
    return Page[DeviceEventRead](
        items=items, total=total, page=page, page_size=page_size,
        pages=(total + page_size - 1) // page_size,
    )


@router.post("/events/manual", response_model=Message)
async def manual_event(
    payload: ManualEventIngest,
    ctx: AuthContext = Depends(require_permission(Permission.DEVICE_SYNC)),
    db: AsyncSession = Depends(get_db),
):
    """Explicitly simulated event. Clearly flagged in raw_data and audit."""
    d = await db.get(Device, payload.device_id)
    if d is None or d.is_deleted:
        raise HTTPException(status_code=404, detail="Qurilma topilmadi")
    try:
        et = EventType(payload.event_type)
    except ValueError:
        raise HTTPException(status_code=400, detail="Noto'g'ri event_type")
    event = await store_event(
        db, d,
        device_event_id=f"SIM-{int(datetime.now().timestamp() * 1000)}",
        device_user_id=payload.device_user_id,
        event_time=payload.event_time,
        event_type=et,
        verify_mode=map_verify_mode(payload.verify_mode),
        raw={"simulated": True, "source": "manual_ingest"},
        is_simulated=True,
    )
    AuditService(db).record(
        action="device.event.manual", resource_type="device_event",
        resource_id=event.id if event else None, user_id=ctx.user_id,
        description="SIMULYATSIYA: qo'lda hodisa kiritildi",
        new_values=payload.model_dump(),
    )
    await db.commit()
    return Message(detail="Simulyatsiya hodisasi saqlandi (haqiqiy emas)")