"""Event ingestion: raw device events -> device_events -> attendance_records.

Idempotency: unique(device_id, device_event_id) with ON CONFLICT DO NOTHING.
No biometric templates or images are stored.
"""
import logging
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.crypto import decrypt_secret
from app.integrations.hikvision.client import AcsEvent, HikvisionClient
from app.models.device import Device, DeviceEvent, EventType, VerifyMode
from app.models.employee import Employee
from app.services import attendance as attendance_service

logger = logging.getLogger("facesys.hikvision.ingest")

SUB_TYPE_MAP: dict[int, EventType] = {
    1: EventType.CHECK_IN,
    75: EventType.CHECK_IN,
    2: EventType.CHECK_OUT,
    76: EventType.CHECK_OUT,
}

# Raw ISAPI payloads are kept for diagnostics only. Anything that could be a
# biometric template, face image, card number or credential is stripped before
# the event is written. Only attendance metadata is retained.
_SENSITIVE_KEY_PARTS = (
    "password", "passwd", "pwd", "cardno", "card_no", "idcard", "id_card",
    "face", "finger", "template", "image", "photo", "picture", "picurl",
    "url", "bio",
)


def sanitize_raw(value, depth: int = 0):
    """Recursively drop sensitive/biometric fields and bound string sizes."""
    if depth > 5:
        return None
    if isinstance(value, dict):
        out = {}
        for key, item in value.items():
            name = str(key)
            lowered = name.lower()
            if any(part in lowered for part in _SENSITIVE_KEY_PARTS):
                continue
            out[name] = sanitize_raw(item, depth + 1)
        return out
    if isinstance(value, (list, tuple)):
        return [sanitize_raw(item, depth + 1) for item in value[:50]]
    if isinstance(value, str):
        return value[:500]
    if isinstance(value, (int, float, bool)) or value is None:
        return value
    return str(value)[:500]


def map_event_type(sub_type: int) -> EventType:
    return SUB_TYPE_MAP.get(sub_type, EventType.UNKNOWN)


def map_verify_mode(value: Optional[str]) -> Optional[VerifyMode]:
    if not value:
        return None
    v = str(value).lower()
    if "face" in v and ("fp" in v or "finger" in v):
        return VerifyMode.FACE_FINGERPRINT
    if "face" in v:
        return VerifyMode.FACE
    if "fp" in v or "finger" in v:
        return VerifyMode.FINGERPRINT
    if "card" in v:
        return VerifyMode.CARD
    if "pw" in v or "password" in v:
        return VerifyMode.PASSWORD
    return VerifyMode.MULTI


async def get_client_for_device(device: Device) -> HikvisionClient:
    password = decrypt_secret(device.password_encrypted)
    if password is None:
        raise RuntimeError("Qurilma parolini deshifrlash imkonsiz")
    return HikvisionClient(
        device.ip_address,
        device.port,
        device.username,
        password,
        scheme=device.connection_type.value,
        timeout=device.timeout,
    )


async def store_event(
    db: AsyncSession,
    device: Device,
    *,
    device_event_id: str,
    device_user_id: Optional[str],
    event_time: datetime,
    event_type: EventType,
    verify_mode: Optional[VerifyMode] = None,
    similarity: Optional[float] = None,
    raw: Optional[dict] = None,
    is_simulated: bool = False,
) -> Optional[DeviceEvent]:
    """Insert a raw event idempotently. Returns None if duplicate."""
    employee = None
    if device_user_id:
        res = await db.execute(
            select(Employee).where(
                Employee.device_user_id == device_user_id,
                Employee.is_deleted.is_(False),
            )
        )
        employee = res.scalar_one_or_none()

    sanitized = sanitize_raw(raw or {})
    payload = sanitized if isinstance(sanitized, dict) else {}
    if is_simulated:
        payload["_facesys_simulated"] = True

    stmt = (
        pg_insert(DeviceEvent)
        .values(
            device_id=device.id,
            employee_id=employee.id if employee else None,
            device_user_id=device_user_id,
            event_type=event_type,
            verify_mode=verify_mode,
            event_time=event_time,
            device_event_id=device_event_id,
            similarity=similarity,
            raw_data=payload,
            processed=False,
            is_deleted=False,
            created_at=datetime.now(timezone.utc),
            updated_at=datetime.now(timezone.utc),
        )
        .on_conflict_do_nothing(index_elements=["device_id", "device_event_id"])
        .returning(DeviceEvent.id)
    )
    result = await db.execute(stmt)
    new_id = result.scalar_one_or_none()
    if new_id is None:
        return None  # duplicate — idempotent no-op

    res = await db.execute(select(DeviceEvent).where(DeviceEvent.id == new_id))
    event = res.scalar_one()
    await process_event(db, event)
    return event


async def ingest_acs_events(
    db: AsyncSession, device: Device, events: list[AcsEvent], *, is_simulated: bool = False
) -> int:
    stored = 0
    for e in events:
        created = await store_event(
            db,
            device,
            device_event_id=e.event_id,
            device_user_id=e.employee_no,
            event_time=e.event_time,
            event_type=map_event_type(e.sub_type),
            verify_mode=map_verify_mode(e.verify_mode),
            similarity=e.similarity,
            raw=e.raw,
            is_simulated=is_simulated,
        )
        if created is not None:
            stored += 1
    return stored


async def process_event(db: AsyncSession, event: DeviceEvent) -> None:
    """Recompute the affected attendance day for the event's employee."""
    if event.processed:
        return
    if event.employee_id is None:
        # Keep processed=False so the event is retried after the device user is
        # mapped to an employee (reprocess_pending) instead of silently hiding it.
        event.processed = False
        event.error_message = "Xodim device_user_id bo'yicha topilmadi"
        return

    res = await db.execute(select(Employee).where(Employee.id == event.employee_id))
    employee = res.scalar_one_or_none()
    if employee is None:
        event.processed = True
        event.processed_at = datetime.now(timezone.utc)
        event.error_message = "Xodim topilmadi"
        return

    try:
        assignment = await attendance_service.find_assignment(
            db, employee.id, attendance_service.to_local(event.event_time).date()
        )
        shift = assignment.shift if assignment else None
        work_date = attendance_service.work_date_for_event(event.event_time, shift)
        record = await attendance_service.compute_day(db, employee, work_date)
        if record is not None and record.id is not None:
            event.attendance_record_id = record.id
        event.processed = True
        event.processed_at = datetime.now(timezone.utc)
    except Exception as exc:  # noqa: BLE001
        logger.exception("Event processing failed for event %s", event.id)
        event.error_message = str(exc)[:500]
        event.processed = False


async def reprocess_pending(
    db: AsyncSession, device_id: int, *, limit: int = 200
) -> int:
    """Retry events that could not be linked or calculated earlier.

    This covers two real cases: a device user was not yet mapped to an employee
    when the event arrived, or a transient error interrupted calculation.
    Events whose employee mapping is still missing stay unprocessed and are
    retried on the next poll cycle (bounded query, no unbounded backlog scan).
    """
    res = await db.execute(
        select(DeviceEvent)
        .where(
            DeviceEvent.device_id == device_id,
            DeviceEvent.processed.is_(False),
            DeviceEvent.is_deleted.is_(False),
        )
        .order_by(DeviceEvent.event_time)
        .limit(limit)
    )
    pending = res.scalars().all()
    if not pending:
        return 0

    employees: dict[str, int] = {}
    processed = 0
    for event in pending:
        if event.employee_id is None and event.device_user_id:
            if event.device_user_id not in employees:
                emp = (await db.execute(
                    select(Employee).where(
                        Employee.device_user_id == event.device_user_id,
                        Employee.is_deleted.is_(False),
                    )
                )).scalar_one_or_none()
                employees[event.device_user_id] = emp.id if emp else 0
            employee_id = employees[event.device_user_id]
            if employee_id:
                event.employee_id = employee_id
        if event.employee_id is not None:
            await process_event(db, event)
            processed += int(event.processed)
    return processed


async def recalc_day(db: AsyncSession, employee_id: int, work_date) -> None:
    res = await db.execute(select(Employee).where(Employee.id == employee_id))
    employee = res.scalar_one_or_none()
    if employee is None:
        return
    await attendance_service.compute_day(db, employee, work_date)