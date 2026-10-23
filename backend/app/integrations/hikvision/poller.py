"""Polling loop: fetch AcsEvent pages, ingest idempotently, track cursor.

Runs as a background task started from app startup. If a device goes offline
the loop backs off exponentially. On reconnect it searches from the last
successful cursor, recovering missed events where AcsEvent search is supported.
"""
import asyncio
import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from app.core.database import async_session_maker
from app.integrations.hikvision.client import ISAPIError
from app.integrations.hikvision.diagnostics import diagnose_device, update_device_status
from app.integrations.hikvision.ingest import (
    get_client_for_device,
    ingest_acs_events,
    reprocess_pending,
)
from app.models.device import Device, DeviceStatus

logger = logging.getLogger("facesys.hikvision.poller")

MAX_BACKOFF = 300
# Never scan more than this far back on a cold start / long outage.
MAX_BACKFILL = timedelta(days=7)


class DevicePoller:
    def __init__(self, device_id: int):
        self.device_id = device_id
        self._cursor: datetime | None = None
        self._task: asyncio.Task | None = None
        self._stopping = asyncio.Event()
        self._backoff = 5

    def start(self) -> None:
        if self._task is None or self._task.done():
            self._stopping.clear()
            self._task = asyncio.create_task(self._run(), name=f"poller-{self.device_id}")

    async def stop(self) -> None:
        self._stopping.set()
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass

    async def _run(self) -> None:
        while not self._stopping.is_set():
            try:
                await self._cycle()
                self._backoff = 5
                await self._sleep(30)
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # noqa: BLE001
                logger.warning("Poller %s cycle failed: %s", self.device_id, exc)
                await self._sleep(self._backoff)
                self._backoff = min(self._backoff * 2, MAX_BACKOFF)

    async def _sleep(self, seconds: float) -> None:
        try:
            await asyncio.wait_for(self._stopping.wait(), timeout=seconds)
        except asyncio.TimeoutError:
            pass

    async def _cycle(self) -> None:
        async with async_session_maker() as db:
            res = await db.execute(select(Device).where(Device.id == self.device_id))
            device = res.scalar_one_or_none()
            if device is None or device.is_deleted or not device.sync_enabled:
                return

            # Full diagnostics are relatively expensive (several HTTP probes,
            # including opening the alert stream). Only run them on first
            # contact or after the device was reported offline; otherwise rely
            # on the cached capability map.
            needs_diagnostics = (
                not device.capabilities
                or device.status in (DeviceStatus.UNKNOWN, DeviceStatus.OFFLINE)
            )
            if needs_diagnostics:
                diag = await diagnose_device(device)
                await update_device_status(db, device, diag)
                await db.commit()

                if not diag["reachable"]:
                    return
                if not diag["event_search_supported"]:
                    logger.info(
                        "Device %s: AcsEvent search unsupported — polling skipped",
                        device.id,
                    )
                    return
            elif not device.capabilities.get("event_search"):
                # Cached capabilities say event search cannot work.
                return

            client = await get_client_for_device(device)
            end = datetime.now(timezone.utc)
            # Resume from the newest of: in-memory cursor, last successful sync,
            # or a bounded backfill window. last_sync survives restarts, so a
            # service restart does not silently lose events.
            start = self._cursor
            if start is None and device.last_sync is not None:
                start = device.last_sync - timedelta(seconds=30)
            if start is None:
                start = end - timedelta(minutes=10)
            if end - start > MAX_BACKFILL:
                start = end - MAX_BACKFILL

            position = 0
            total = 0
            try:
                while True:
                    events = await client.search_events(
                        start=start, end=end, position=position, max_results=30
                    )
                    if not events:
                        break
                    total += await ingest_acs_events(db, device, events)
                    await db.commit()
                    position += len(events)
                    if len(events) < 30:
                        break
            except ISAPIError as exc:
                logger.warning("AcsEvent search failed for %s: %s", device.id, exc)
                device.status = DeviceStatus.OFFLINE
                device.error_message = str(exc)[:1000]
                await db.commit()
                raise

            # Retry events that arrived before the device user was mapped or
            # whose calculation failed transiently.
            retried = await reprocess_pending(db, device.id)
            await db.commit()

            self._cursor = end - timedelta(seconds=30)  # 30s overlap for safety
            device.last_sync = end
            await db.commit()
            if total:
                logger.info("Device %s ingested %s new events", device.id, total)
            if retried:
                logger.info("Device %s processed %s pending events", device.id, retried)


class PollerRegistry:
    def __init__(self):
        self._pollers: dict[int, DevicePoller] = {}
        self._active = False

    async def start_all(self) -> None:
        self._active = True
        async with async_session_maker() as db:
            res = await db.execute(
                select(Device.id).where(
                    Device.is_deleted.is_(False), Device.sync_enabled.is_(True)
                )
            )
            for (device_id,) in res.all():
                self.start(device_id)

    def start(self, device_id: int) -> None:
        # Do not create background tasks when the app lifespan is not running
        # (for example under pytest, where devices are created via the API but
        # no real network probing should start).
        if not self._active:
            return
        if device_id not in self._pollers:
            p = DevicePoller(device_id)
            self._pollers[device_id] = p
            p.start()

    async def stop(self, device_id: int) -> None:
        p = self._pollers.pop(device_id, None)
        if p:
            await p.stop()

    async def stop_all(self) -> None:
        self._active = False
        for p in list(self._pollers.values()):
            await p.stop()
        self._pollers.clear()

    def restart(self, device_id: int) -> None:
        asyncio.create_task(self._restart(device_id))

    async def _restart(self, device_id: int) -> None:
        await self.stop(device_id)
        self.start(device_id)


registry = PollerRegistry()