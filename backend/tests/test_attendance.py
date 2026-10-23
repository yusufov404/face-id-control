"""Attendance engine tests.

Covers: on-time, late, early leave, incomplete days, duplicates, night shifts
crossing midnight, holidays, approved leave, manual corrections and the rule
that automatic recalculation never overwrites a manual correction.
"""
from datetime import date, datetime, time, timedelta, timezone

from sqlalchemy import select

from app.models.attendance import AttendanceRecord, AttendanceStatus
from app.models.device import DeviceEvent, EventType
from app.models.leave import Holiday, LeaveRequest, LeaveStatus, LeaveType
from app.models.shift import EmployeeShiftAssignment
from app.services import attendance as svc

API = "/api/v1"
TASHKENT = timezone(timedelta(hours=5))
WORK_DATE = date(2026, 3, 2)  # Monday


async def _assign(db, employee, shift, start=date(2024, 1, 1), end=None):
    a = EmployeeShiftAssignment(
        employee_id=employee.id, shift_id=shift.id,
        start_date=start, end_date=end, is_active=True, priority=0,
    )
    db.add(a)
    await db.flush()
    return a


async def _event(db, device, employee, when, event_id, etype=EventType.CHECK_IN):
    e = DeviceEvent(
        device_id=device.id,
        employee_id=employee.id,
        device_user_id=employee.device_user_id,
        event_type=etype,
        event_time=when,
        device_event_id=event_id,
    )
    db.add(e)
    await db.flush()
    return e


async def test_on_time_day_is_present_but_not_auto_confirmed(
    db, employee_factory, shift_factory, device_factory
):
    emp = await employee_factory("E-1", device_user_id="1001")
    shift = await shift_factory("DAY", start=time(8, 0), end=time(17, 0))
    await _assign(db, emp, shift)
    device = await device_factory()

    await _event(db, device, emp, datetime(2026, 3, 2, 8, 0, tzinfo=TASHKENT), "ev-1")
    await _event(db, device, emp, datetime(2026, 3, 2, 17, 0, tzinfo=TASHKENT), "ev-2",
                 EventType.CHECK_OUT)

    rec = await svc.compute_day(db, emp, WORK_DATE)
    assert rec is not None
    assert rec.status == AttendanceStatus.PRESENT
    assert rec.is_confirmed is False
    assert rec.late_minutes == 0
    assert rec.early_leave_minutes == 0
    assert rec.work_minutes == 540
    assert rec.actual_check_in is not None
    assert rec.actual_check_out is not None
    assert rec.scheduled_check_in == time(8, 0)
    assert rec.check_in_event_id is not None
    assert rec.check_out_event_id is not None


async def test_late_minutes_respect_threshold(db, employee_factory, shift_factory,
                                              device_factory):
    emp = await employee_factory("E-2", device_user_id="1002")
    shift = await shift_factory("DAY", start=time(8, 0), end=time(17, 0),
                                late_threshold=15)
    await _assign(db, emp, shift)
    device = await device_factory()

    await _event(db, device, emp, datetime(2026, 3, 2, 8, 20, tzinfo=TASHKENT), "ev-3")
    await _event(db, device, emp, datetime(2026, 3, 2, 17, 5, tzinfo=TASHKENT), "ev-4",
                 EventType.CHECK_OUT)

    rec = await svc.compute_day(db, emp, WORK_DATE)
    assert rec.status == AttendanceStatus.LATE
    assert rec.late_minutes == 5      # 20 minutes late minus 15 minute grace
    assert rec.early_leave_minutes == 0
    assert rec.work_minutes == 525


async def test_early_leave(db, employee_factory, shift_factory, device_factory):
    emp = await employee_factory("E-3", device_user_id="1003")
    shift = await shift_factory("DAY", start=time(8, 0), end=time(17, 0),
                                early_leave_threshold=10)
    await _assign(db, emp, shift)
    device = await device_factory()

    await _event(db, device, emp, datetime(2026, 3, 2, 7, 55, tzinfo=TASHKENT), "ev-5")
    await _event(db, device, emp, datetime(2026, 3, 2, 16, 30, tzinfo=TASHKENT), "ev-6",
                 EventType.CHECK_OUT)

    rec = await svc.compute_day(db, emp, WORK_DATE)
    assert rec.status == AttendanceStatus.EARLY_LEAVE
    assert rec.early_leave_minutes == 20   # 30 minutes early minus 10 minute grace
    assert rec.late_minutes == 0


async def test_late_and_early(db, employee_factory, shift_factory, device_factory):
    emp = await employee_factory("E-4", device_user_id="1004")
    shift = await shift_factory("DAY", start=time(8, 0), end=time(17, 0),
                                late_threshold=0, early_leave_threshold=0)
    await _assign(db, emp, shift)
    device = await device_factory()

    await _event(db, device, emp, datetime(2026, 3, 2, 8, 30, tzinfo=TASHKENT), "ev-7")
    await _event(db, device, emp, datetime(2026, 3, 2, 16, 0, tzinfo=TASHKENT), "ev-8",
                 EventType.CHECK_OUT)

    rec = await svc.compute_day(db, emp, WORK_DATE)
    assert rec.status == AttendanceStatus.LATE_AND_EARLY
    assert rec.late_minutes == 30
    assert rec.early_leave_minutes == 60


async def test_incomplete_day_is_never_confirmed(db, employee_factory, shift_factory,
                                                 device_factory):
    emp = await employee_factory("E-5", device_user_id="1005")
    shift = await shift_factory("DAY")
    await _assign(db, emp, shift)
    device = await device_factory()

    await _event(db, device, emp, datetime(2026, 3, 2, 8, 0, tzinfo=TASHKENT), "ev-9")

    rec = await svc.compute_day(db, emp, WORK_DATE)
    assert rec.status == AttendanceStatus.INCOMPLETE
    assert rec.is_confirmed is False
    assert rec.actual_check_in is not None
    assert rec.actual_check_out is None
    assert rec.work_minutes == 0


async def test_no_events_means_absent(db, employee_factory, shift_factory):
    emp = await employee_factory("E-6", device_user_id="1006")
    shift = await shift_factory("DAY")
    await _assign(db, emp, shift)

    rec = await svc.compute_day(db, emp, WORK_DATE)
    assert rec.status == AttendanceStatus.ABSENT
    assert rec.is_confirmed is False


async def test_no_assignment_means_not_scheduled(db, employee_factory):
    emp = await employee_factory("E-7", device_user_id="1007")
    rec = await svc.compute_day(db, emp, WORK_DATE)
    assert rec.status == AttendanceStatus.NOT_SCHEDULED
    assert rec.is_confirmed is False


async def test_weekday_restriction_means_weekend(db, employee_factory, shift_factory):
    emp = await employee_factory("E-8", device_user_id="1008")
    shift = await shift_factory("MON", start=time(8, 0), end=time(17, 0))
    shift.applicable_days = ["monday"]
    await db.flush()
    await _assign(db, emp, shift)

    # 2026-03-03 is a Tuesday
    rec = await svc.compute_day(db, emp, date(2026, 3, 3))
    assert rec.status == AttendanceStatus.WEEKEND


async def test_night_shift_crosses_midnight(db, employee_factory, shift_factory,
                                            device_factory):
    emp = await employee_factory("E-9", device_user_id="1009")
    shift = await shift_factory("NIGHT", start=time(22, 0), end=time(6, 0),
                                min_work_minutes=480)
    await _assign(db, emp, shift)
    device = await device_factory()

    check_in = datetime(2026, 3, 2, 21, 55, tzinfo=TASHKENT)
    check_out = datetime(2026, 3, 3, 6, 5, tzinfo=TASHKENT)
    e1 = await _event(db, device, emp, check_in, "ev-10")
    e2 = await _event(db, device, emp, check_out, "ev-11", EventType.CHECK_OUT)

    rec = await svc.compute_day(db, emp, WORK_DATE)
    assert rec.status == AttendanceStatus.PRESENT
    assert rec.work_minutes == 490
    assert rec.check_in_event_id == e1.id
    assert rec.check_out_event_id == e2.id

    # A scan after midnight belongs to the previous logical work day.
    assert svc.work_date_for_event(check_out, shift) == WORK_DATE
    assert svc.work_date_for_event(check_in, shift) == WORK_DATE


async def test_duplicate_scan_is_not_a_second_check_in(db, employee_factory,
                                                       shift_factory, device_factory):
    emp = await employee_factory("E-10", device_user_id="1010")
    shift = await shift_factory("DAY")
    await _assign(db, emp, shift)
    device = await device_factory()

    first = await _event(db, device, emp,
                         datetime(2026, 3, 2, 7, 55, tzinfo=TASHKENT), "ev-12")
    await _event(db, device, emp,
                 datetime(2026, 3, 2, 7, 55, 30, tzinfo=TASHKENT), "ev-13")
    await _event(db, device, emp,
                 datetime(2026, 3, 2, 17, 0, tzinfo=TASHKENT), "ev-14",
                 EventType.CHECK_OUT)

    rec = await svc.compute_day(db, emp, WORK_DATE)
    assert rec.check_in_event_id == first.id
    assert rec.status == AttendanceStatus.PRESENT

    # Both raw scans are still stored: nothing is discarded from the raw log.
    rows = (await db.execute(select(DeviceEvent.id))).scalars().all()
    assert len(rows) == 3


async def test_holiday_status(db, employee_factory, shift_factory, device_factory):
    emp = await employee_factory("E-11", device_user_id="1011")
    shift = await shift_factory("DAY")
    await _assign(db, emp, shift)
    db.add(Holiday(name="Navro'z", date=WORK_DATE, applies_to_all=True,
                   is_working_day=False))
    await db.flush()

    rec = await svc.compute_day(db, emp, WORK_DATE)
    assert rec.status == AttendanceStatus.HOLIDAY
    assert rec.work_minutes == 0
    assert rec.is_confirmed is False


async def test_approved_leave_status(db, make_user, employee_factory, shift_factory,
                                     device_factory):
    user, _ = await make_user()
    emp = await employee_factory("E-12", device_user_id="1012")
    shift = await shift_factory("DAY")
    await _assign(db, emp, shift)
    db.add(LeaveRequest(
        employee_id=emp.id, leave_type=LeaveType.ANNUAL,
        start_date=WORK_DATE, end_date=WORK_DATE, total_days=1,
        reason="Test leave", status=LeaveStatus.APPROVED, requested_by=user.id,
    ))
    await db.flush()

    rec = await svc.compute_day(db, emp, WORK_DATE)
    assert rec.status == AttendanceStatus.ON_LEAVE


async def test_manual_record_is_never_overwritten(db, make_user, employee_factory,
                                                  shift_factory, device_factory):
    emp = await employee_factory("E-13", device_user_id="1013")
    shift = await shift_factory("DAY")
    await _assign(db, emp, shift)
    device = await device_factory()

    manual_time = datetime(2026, 3, 2, 9, 30, tzinfo=timezone.utc)
    rec = AttendanceRecord(
        employee_id=emp.id, record_date=WORK_DATE,
        status=AttendanceStatus.PRESENT, is_manual=True,
        actual_check_in=manual_time, work_minutes=450,
    )
    db.add(rec)
    await db.flush()
    rec_id = rec.id

    # Raw events that would normally produce LATE/ABSENT must be ignored.
    await _event(db, device, emp, datetime(2026, 3, 2, 11, 0, tzinfo=TASHKENT), "ev-15")

    result = await svc.compute_day(db, emp, WORK_DATE)
    assert result.id == rec_id
    assert result.status == AttendanceStatus.PRESENT
    assert result.actual_check_in is not None
    assert result.work_minutes == 450
    assert result.is_manual is True


async def test_recalculation_upserts_same_record(db, employee_factory, shift_factory,
                                                 device_factory):
    emp = await employee_factory("E-14", device_user_id="1014")
    shift = await shift_factory("DAY")
    await _assign(db, emp, shift)
    device = await device_factory()

    await _event(db, device, emp, datetime(2026, 3, 2, 8, 0, tzinfo=TASHKENT), "ev-16")
    first = await svc.compute_day(db, emp, WORK_DATE)
    assert first.status == AttendanceStatus.INCOMPLETE
    first_id = first.id

    await _event(db, device, emp, datetime(2026, 3, 2, 17, 0, tzinfo=TASHKENT), "ev-17",
                 EventType.CHECK_OUT)
    second = await svc.compute_day(db, emp, WORK_DATE)
    assert second.id == first_id
    assert second.status == AttendanceStatus.PRESENT

    count = len((await db.execute(select(AttendanceRecord.id))).scalars().all())
    assert count == 1


async def test_recalculate_endpoint_refuses_manual_record(client, db, make_user,
                                                          employee_factory):
    _, headers = await make_user(_role_hr())
    emp = await employee_factory("E-15", device_user_id="1015")
    rec = AttendanceRecord(employee_id=emp.id, record_date=WORK_DATE,
                           status=AttendanceStatus.PRESENT, is_manual=True)
    db.add(rec)
    await db.flush()

    r = await client.post(f"{API}/attendance/{rec.id}/recalculate", headers=headers)
    assert r.status_code == 409


def _role_hr():
    from app.core.permissions import Role
    return Role.HR_DIRECTOR


async def test_correction_preserves_raw_events_and_writes_audit(
    client, db, make_user, employee_factory, shift_factory, device_factory
):
    from app.core.permissions import Role
    from app.models.audit import AuditLog

    hr, headers = await make_user(Role.HR_DIRECTOR)
    emp = await employee_factory("E-16", device_user_id="1016")
    shift = await shift_factory("DAY")
    await _assign(db, emp, shift)
    device = await device_factory()

    e1 = await _event(db, device, emp, datetime(2026, 3, 2, 8, 0, tzinfo=TASHKENT), "ev-18")
    e2 = await _event(db, device, emp, datetime(2026, 3, 2, 17, 0, tzinfo=TASHKENT), "ev-19",
                      EventType.CHECK_OUT)
    rec = await svc.compute_day(db, emp, WORK_DATE)
    await db.flush()
    original_in = e1.event_time
    original_out = e2.event_time

    new_in = "2026-03-02T08:45:00+05:00"
    r = await client.post(f"{API}/attendance/corrections", headers=headers, json={
        "attendance_record_id": rec.id,
        "correction_type": "check_in",
        "field_name": "actual_check_in",
        "new_check_in": new_in,
        "reason": "Xodim kechikish sababini hujjat bilan tasdiqladi",
    })
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["is_approved"] is False
    assert body["corrected_by"] == hr.id
    assert body["old_value"] is not None

    await db.refresh(rec)
    assert rec.is_manual is True
    assert rec.is_confirmed is True
    assert rec.confirmed_by == hr.id
    assert rec.actual_check_in.astimezone(TASHKENT).hour == 8
    assert rec.actual_check_in.astimezone(TASHKENT).minute == 45

    # Raw device events are immutable.
    await db.refresh(e1)
    await db.refresh(e2)
    assert e1.event_time == original_in
    assert e2.event_time == original_out

    logs = (await db.execute(
        select(AuditLog).where(AuditLog.action == "attendance.correct")
    )).scalars().all()
    assert len(logs) == 1
    assert logs[0].user_id == hr.id
    assert logs[0].resource_id == str(rec.id)
    assert logs[0].old_values["actual_check_in"] is not None
    assert logs[0].new_values["actual_check_in"] != logs[0].old_values["actual_check_in"]

    # Automatic recalculation must not touch the manual correction.
    again = await svc.compute_day(db, emp, WORK_DATE)
    assert again.actual_check_in.astimezone(TASHKENT).hour == 8
    assert again.actual_check_in.astimezone(TASHKENT).minute == 45


async def test_correction_requires_reason(client, make_user, employee_factory, db):
    from app.core.permissions import Role

    _, headers = await make_user(Role.HR_DIRECTOR)
    emp = await employee_factory("E-17")
    rec = AttendanceRecord(employee_id=emp.id, record_date=WORK_DATE,
                           status=AttendanceStatus.ABSENT)
    db.add(rec)
    await db.flush()

    r = await client.post(f"{API}/attendance/corrections", headers=headers, json={
        "attendance_record_id": rec.id,
        "correction_type": "status",
        "field_name": "status",
        "new_value": "present",
        "reason": "no",
    })
    assert r.status_code == 422
