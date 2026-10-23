"""Device diagnostics — read-only mode, safe to run before ingestion is enabled."""
import logging
from datetime import datetime, timezone

from sqlalchemy.ext.asyncio import AsyncSession

from app.integrations.hikvision.client import ISAPIError
from app.integrations.hikvision.ingest import get_client_for_device
from app.models.device import Device

logger = logging.getLogger("facesys.hikvision.diagnostics")


async def diagnose_device(device: Device) -> dict:
    errors: list[str] = []
    result = {
        "device_id": device.id,
        "reachable": False,
        "model": None,
        "firmware": None,
        "serial_number": None,
        "device_type": None,
        "alert_stream_supported": None,
        "event_search_supported": None,
        "time_sync_supported": None,
        "device_time": None,
        "server_time": datetime.now(timezone.utc).isoformat(),
        "time_drift_seconds": None,
        "capabilities": {},
        "errors": errors,
        "checked_at": datetime.now(timezone.utc),
    }
    try:
        client = await get_client_for_device(device)
    except RuntimeError as exc:
        errors.append(str(exc))
        return result

    try:
        info = await client.get_device_info()
        result.update(
            reachable=True,
            model=info.model,
            firmware=info.firmware,
            serial_number=info.serial_number,
            device_type=info.device_type,
        )
    except ISAPIError as exc:
        errors.append(str(exc))
        return result

    caps = await client.get_capabilities()
    result["capabilities"] = caps
    result["alert_stream_supported"] = caps.get("alert_stream", False)
    result["event_search_supported"] = caps.get("event_search", False)
    result["time_sync_supported"] = caps.get("time_sync", False)

    try:
        dt = await client.get_device_time()
        if dt is not None:
            result["device_time"] = dt.isoformat()
            drift = await client.check_time_drift()
            result["time_drift_seconds"] = drift
            if drift is not None and abs(drift) > 120:
                errors.append(
                    f"Qurilma vaqti serverdan {drift} soniya farq qiladi — NTP tekshiring"
                )
    except ISAPIError as exc:
        errors.append(str(exc))

    if not caps.get("event_search") and not caps.get("alert_stream"):
        errors.append(
            "Na alertStream, na AcsEvent search qo'llab-quvvatlanadi — "
            "bu firmware uchun davomat integratsiyasi ishlamaydi"
        )
    return result


async def update_device_status(db: AsyncSession, device: Device, diag: dict) -> None:
    from app.models.device import DeviceStatus

    if diag["reachable"]:
        device.status = DeviceStatus.ONLINE
        device.error_message = None if not diag["errors"] else "; ".join(diag["errors"])[:1000]
    else:
        device.status = DeviceStatus.OFFLINE
        device.error_message = "; ".join(diag["errors"])[:1000]
    if diag.get("model"):
        device.model = diag["model"]
    if diag.get("firmware"):
        device.firmware_version = diag["firmware"]
    device.capabilities = diag.get("capabilities", {})
    device.last_heartbeat = datetime.now(timezone.utc)