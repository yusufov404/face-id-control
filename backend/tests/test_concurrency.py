"""Idempotency and concurrency.

Real database sessions committed outside the per-test transaction are needed
for these tests, so they clean up after themselves.
"""
import asyncio
import uuid
from datetime import datetime, timezone

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.core.crypto import encrypt_secret
from app.integrations.hikvision.ingest import store_event
from app.models.attendance import AttendanceRecord
from app.models.device import Device, DeviceEvent, EventType
from app.models.employee import Employee
from app.models.shift import EmployeeShiftAssignment, Shift


async def test_duplicate_event_is_ignored(db, employee_factory, device_factory):
    await employee_factory("CON-1", device_user_id="C1")
    device = await device_factory(serial_number="SN-CON-1")
    when = datetime.now(timezone.utc)

    first = await store_event(db, device, device_event_id="dup-1",
                              device_user_id="C1", event_time=when,
                              event_type=EventType.CHECK_IN)
    second = await store_event(db, device, device_event_id="dup-1",
                               device_user_id="C1", event_time=when,
                               event_type=EventType.CHECK_IN)

    assert first is not None
    assert second is None
    count = (await db.execute(
        select(func.count(DeviceEvent.id)).where(DeviceEvent.device_id == device.id)
    )).scalar_one()
    assert count == 1


async def test_concurrent_duplicate_ingest_stores_one_event(engine):
    """Two independent sessions receive the same device event at the same time."""
    suffix = uuid.uuid4().hex[:8]
    times = {"in": datetime.now(timezone.utc)}
    Session = async_sessionmaker(engine, expire_on_commit=False)

    async with Session() as s:
        emp = Employee(
            internal_id=f"CC-{suffix}", device_user_id=f"CCU-{suffix}",
            first_name="Concurrent", last_name="Test",
            hire_date=datetime(2024, 1, 1).date(),
        )
        device = Device(
            name="Concurrency terminal", serial_number=f"SN-CC-{suffix}",
            ip_address="192.0.2.55", username="admin",
            password_encrypted=encrypt_secret("pw"), sync_enabled=False,
        )
        s.add_all([emp, device])
        await s.commit()
        emp_id, device_id, emp_no = emp.id, device.id, emp.device_user_id

    async def ingest():
        async with Session() as s:
            dev = await s.get(Device, device_id)
            event = await store_event(
                s, dev, device_event_id="same-event-id",
                device_user_id=emp_no, event_time=times["in"],
                event_type=EventType.CHECK_IN,
            )
            await s.commit()
            return event is not None

    try:
        results = await asyncio.gather(ingest(), ingest())
        assert sum(results) == 1, results

        async with Session() as s:
            count = (await s.execute(
                select(func.count(DeviceEvent.id))
                .where(DeviceEvent.device_id == device_id)
            )).scalar_one()
            assert count == 1
    finally:
        async with engine.begin() as conn:
            await conn.execute(delete(DeviceEvent).where(DeviceEvent.device_id == device_id))
            await conn.execute(delete(AttendanceRecord).where(AttendanceRecord.employee_id == emp_id))
            await conn.execute(delete(Device).where(Device.id == device_id))
            await conn.execute(delete(Employee).where(Employee.id == emp_id))


async def test_concurrent_day_computation_creates_one_record(engine):
    """Two sync paths computing the same employee/day must not crash or duplicate."""
    from datetime import date, time

    suffix = uuid.uuid4().hex[:8]
    work_date = date(2026, 4, 1)
    Session = async_sessionmaker(engine, expire_on_commit=False)

    async with Session() as s:
        emp = Employee(
            internal_id=f"CD-{suffix}", device_user_id=f"CDU-{suffix}",
            first_name="Concurrent", last_name="Day",
            hire_date=date(2024, 1, 1),
        )
        shift = Shift(
            name=f"Shift {suffix}", code=f"CD-{suffix}",
            start_time=time(8, 0), end_time=time(17, 0),
            applicable_days=[],
        )
        s.add_all([emp, shift])
        await s.flush()
        assignment = EmployeeShiftAssignment(
            employee_id=emp.id, shift_id=shift.id,
            start_date=date(2024, 1, 1), is_active=True,
        )
        s.add(assignment)
        await s.commit()
        emp_id, shift_id = emp.id, shift.id

    async def compute():
        from app.services.attendance import compute_day

        async with Session() as s:
            employee = await s.get(Employee, emp_id)
            record = await compute_day(s, employee, work_date)
            await s.commit()
            return record.id

    try:
        ids = await asyncio.gather(compute(), compute())
        assert len(set(ids)) == 1, ids

        async with Session() as s:
            count = (await s.execute(
                select(func.count(AttendanceRecord.id))
                .where(AttendanceRecord.employee_id == emp_id,
                       AttendanceRecord.record_date == work_date)
            )).scalar_one()
            assert count == 1
    finally:
        async with engine.begin() as conn:
            await conn.execute(delete(AttendanceRecord).where(AttendanceRecord.employee_id == emp_id))
            await conn.execute(delete(EmployeeShiftAssignment).where(
                EmployeeShiftAssignment.employee_id == emp_id))
            await conn.execute(delete(Shift).where(Shift.id == shift_id))
            await conn.execute(delete(Employee).where(Employee.id == emp_id))
