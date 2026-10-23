"""Audit logging service.

Audit entries are append-only. They are written in the same transaction as the
mutation they describe so a rollback removes both.
"""
from datetime import datetime, timezone
from typing import Optional, Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.audit import AuditLog


def _serialize(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, dict):
        return {k: _serialize(v) for k, v in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [_serialize(v) for v in value]
    return str(value)


def diff_fields(old: dict, new: dict) -> dict:
    """Return {field: (old, new)} for changed fields."""
    changed = {}
    for key in set(old) | set(new):
        if old.get(key) != new.get(key):
            changed[key] = (old.get(key), new.get(key))
    return changed


class AuditService:
    def __init__(self, db: AsyncSession):
        self.db = db

    def record(
        self,
        *,
        action: str,
        resource_type: str,
        resource_id: Optional[int | str] = None,
        user_id: Optional[int] = None,
        old_values: Optional[dict] = None,
        new_values: Optional[dict] = None,
        description: Optional[str] = None,
        user_ip: Optional[str] = None,
        user_agent: Optional[str] = None,
        request_method: Optional[str] = None,
        request_path: Optional[str] = None,
        request_id: Optional[str] = None,
        success: bool = True,
        error_message: Optional[str] = None,
    ) -> AuditLog:
        old_s = _serialize(old_values) if old_values else None
        new_s = _serialize(new_values) if new_values else None
        changed: list[str] = []
        if old_s and new_s:
            changed = sorted(diff_fields(old_s, new_s).keys())
        elif new_s:
            changed = sorted(new_s.keys())

        entry = AuditLog(
            timestamp=datetime.now(timezone.utc),
            user_id=user_id,
            user_ip=user_ip,
            user_agent=user_agent,
            action=action,
            resource_type=resource_type,
            resource_id=str(resource_id) if resource_id is not None else None,
            old_values=old_s,
            new_values=new_s,
            changed_fields=changed,
            description=description,
            request_method=request_method,
            request_path=request_path,
            request_id=request_id,
            success=success,
            error_message=error_message,
        )
        self.db.add(entry)
        return entry

    def record_correction(
        self,
        *,
        user_id: int,
        employee_id: int,
        attendance_record_id: int,
        field_name: str,
        old_value: Any,
        new_value: Any,
        reason: str,
        ip: Optional[str] = None,
    ) -> AuditLog:
        return self.record(
            action="attendance.correct",
            resource_type="attendance_record",
            resource_id=attendance_record_id,
            user_id=user_id,
            old_values={"employee_id": employee_id, field_name: old_value},
            new_values={"employee_id": employee_id, field_name: new_value},
            description=f"Davomat tuzatildi. Sabab: {reason}",
            user_ip=ip,
        )


async def write_audit(db: AsyncSession, **kwargs) -> AuditLog:
    service = AuditService(db)
    entry = service.record(**kwargs)
    await db.flush()
    return entry