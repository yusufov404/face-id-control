"""Attendance calculation engine.

Rules implemented:
  * Pair check-in / check-out events per work-day (shift-aware).
  * Night shifts: a shift whose end_time <= start_time crosses midnight and
    belongs to the *start* date. Events after midnight are attributed to the
    same logical work-day.
  * Debounce: repeated scans within DEBOUNCE_SECONDS are recorded as raw events
    but do not produce a new check-in/check-out pair.
  * Late / early-leave measured against shift thresholds.
  * Incomplete days (only one punch) are status=INCOMPLETE and are NOT
    auto-confirmed.
  * Holidays / weekends / approved leave are honoured.
"""
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone
from typing import Optional, Sequence
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.attendance import AttendanceRecord, AttendanceStatus
from app.models.device import DeviceEvent
from app.models.employee import Employee
from app.models.leave import Holiday, LeaveRequest, LeaveStatus
from app.models.shift import EmployeeShiftAssignment, Shift

TZ = ZoneInfo("Asia/Tashkent")

# Same person scanning again within this window is treated as a duplicate
DEBOUNCE_SECONDS = 60
# A check-out must be at least this many seconds after check-in
MIN_PAIR_GAP_SECONDS = 60


def now_tz() -> datetime:
    return datetime.now(TZ)


def to_local(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc).astimezone(TZ)
    return dt.astimezone(TZ)


def combine(day: date, t: time, tz=TZ) -> datetime:
    return datetime.combine(day, t, tzinfo=tz)


@dataclass
class ShiftWindow:
    work_date: date
    start: datetime
    end: datetime
    break_start: Optional[datetime]
    break_end: Optional[datetime]
    shift: Shift

    @property
    def scheduled_minutes(self) -> int:
        total = int((self.end - self.start).total_seconds() // 60)
        if self.break_start and self.break_end:
            total -= int((self.break_end - self.break_start).total_seconds() // 60)
        return max(total, 0)


def build_shift_window(shift: Shift, work_date: date, assignment: Optional[EmployeeShiftAssignment] = None) -> ShiftWindow:
    start_t = assignment.custom_start_time if assignment and assignment.custom_start_time else shift.start_time
    end_t = assignment.custom_end_time if assignment and assignment.custom_end_time else shift.end_time
    bstart_t = assignment.custom_break_start if assignment and assignment.custom_break_start else shift.break_start
    bend_t = assignment.custom_break_end if assignment and assignment.custom_break_end else shift.break_end

    start = combine(work_date, start_t)
    end = combine(work_date, end_t)
    if end <= start:
        # crosses midnight (explicit flag or implied by end <= start)
        end = end + timedelta(days=1)
    bs = combine(work_date, bstart_t) if bstart_t else None
    be = combine(work_date, bend_t) if bend_t else None
    if bs and be and be <= bs:
        be = be + timedelta(days=1)
    return ShiftWindow(work_date, start, end, bs, be, shift)


async def find_assignment(
    db: AsyncSession, employee_id: int, work_date: date
) -> Optional[EmployeeShiftAssignment]:
    result = await db.execute(
        select(EmployeeShiftAssignment)
        .options(selectinload(EmployeeShiftAssignment.shift))
        .where(
            EmployeeShiftAssignment.employee_id == employee_id,
            EmployeeShiftAssignment.is_active.is_(True),
            EmployeeShiftAssignment.is_deleted.is_(False),
            EmployeeShiftAssignment.start_date <= work_date,
            (EmployeeShiftAssignment.end_date.is_(None))
            | (EmployeeShiftAssignment.end_date >= work_date),
        )
        .order_by(EmployeeShiftAssignment.priority.desc(), EmployeeShiftAssignment.start_date.desc())
        .limit(1)
    )
    return result.scalar_one_or_none()


async def is_holiday(db: AsyncSession, work_date: date, department_id: Optional[int]) -> Optional[Holiday]:
    result = await db.execute(
        select(Holiday).where(
            Holiday.date == work_date,
            Holiday.is_deleted.is_(False),
        )
    )
    holidays = result.scalars().all()
    for h in holidays:
        if h.applies_to_all:
            return h
        if department_id is not None and department_id in (h.department_ids or []):
            return h
    return None


async def approved_leave_on(db: AsyncSession, employee_id: int, work_date: date) -> bool:
    result = await db.execute(
        select(LeaveRequest.id).where(
            LeaveRequest.employee_id == employee_id,
            LeaveRequest.status == LeaveStatus.APPROVED,
            LeaveRequest.is_deleted.is_(False),
            LeaveRequest.start_date <= work_date,
            LeaveRequest.end_date >= work_date,
        ).limit(1)
    )
    return result.scalar_one_or_none() is not None


def _weekday_allowed(shift: Shift, work_date: date) -> bool:
    days = shift.applicable_days or []
    if not days:
        return True
    key = work_date.strftime("%A").lower()
    return key in [str(d).lower() for d in days]


async def pending_events_for_day(
    db: AsyncSession, employee_id: int, window: ShiftWindow
) -> list[DeviceEvent]:
    # include a small pre/post margin so early arrivals and late exits are captured
    lo = window.start - timedelta(hours=4)
    hi = window.end + timedelta(hours=6)
    result = await db.execute(
        select(DeviceEvent)
        .where(
            DeviceEvent.employee_id == employee_id,
            DeviceEvent.is_deleted.is_(False),
            DeviceEvent.event_time >= lo,
            DeviceEvent.event_time <= hi,
        )
        .order_by(DeviceEvent.event_time.asc())
    )
    return list(result.scalars().all())


def pick_check_in_out(events: Sequence[DeviceEvent], window: ShiftWindow):
    """Pick the first credible check-in and the last credible check-out.

    Scans far outside the window are ignored. Duplicate scans within
    DEBOUNCE_SECONDS are collapsed naturally because we take first/last.
    """
    lo = window.start - timedelta(hours=4)
    hi = window.end + timedelta(hours=6)
    filtered = [e for e in events if lo <= to_local(e.event_time) <= hi]
    if not filtered:
        return None, None

    check_in = None
    for e in filtered:
        t = to_local(e.event_time)
        # a scan is a check-in if it happens before the shift midpoint
        if t <= window.start + (window.end - window.start) / 2:
            check_in = e
            break

    check_out = None
    for e in reversed(filtered):
        t = to_local(e.event_time)
        if check_in and e.id == check_in.id:
            break
        if t >= window.start + (window.end - window.start) / 2:
            # A lone evening scan is a valid check-out even without a check-in.
            if check_in is None or (
                (t - to_local(check_in.event_time)).total_seconds() >= MIN_PAIR_GAP_SECONDS
            ):
                check_out = e
                break

    # Fallbacks when only one punch exists
    if check_in is None and filtered:
        check_in = filtered[0]
    if check_out is None and len(filtered) >= 2:
        last = filtered[-1]
        if check_in and last.id != check_in.id:
            gap = (to_local(last.event_time) - to_local(check_in.event_time)).total_seconds()
            if gap >= MIN_PAIR_GAP_SECONDS:
                check_out = last
    return check_in, check_out


def _minutes_between(a: datetime, b: datetime) -> int:
    return max(int((b - a).total_seconds() // 60), 0)


def calculate(
    window: ShiftWindow,
    check_in: Optional[DeviceEvent],
    check_out: Optional[DeviceEvent],
    *,
    holiday: Optional[Holiday] = None,
    on_leave: bool = False,
) -> dict:
    result = {
        "status": AttendanceStatus.UNKNOWN,
        "late_minutes": 0,
        "early_leave_minutes": 0,
        "work_minutes": 0,
        "overtime_minutes": 0,
        "break_minutes": 0,
        "is_confirmed": False,
    }

    if holiday and not holiday.is_working_day:
        result["status"] = AttendanceStatus.HOLIDAY
        return result
    if on_leave:
        result["status"] = AttendanceStatus.ON_LEAVE
        return result

    if check_in is None and check_out is None:
        result["status"] = AttendanceStatus.ABSENT
        return result

    if check_in is None or check_out is None:
        # incomplete — never auto-confirm
        result["status"] = AttendanceStatus.INCOMPLETE
        if check_in:
            result["late_minutes"] = _minutes_between(window.start, to_local(check_in.event_time))
        return result

    cin = to_local(check_in.event_time)
    cout = to_local(check_out.event_time)

    late = _minutes_between(window.start, cin)
    # tolerate a grace period: only count beyond late_threshold
    late = max(late - window.shift.late_threshold, 0)

    early = _minutes_between(cout, window.end)
    early = max(early - window.shift.early_leave_threshold, 0)

    work = _minutes_between(cin, cout)
    break_mins = 0
    if window.break_start and window.break_end and cin < window.break_end and cout > window.break_start:
        overlap_start = max(cin, window.break_start)
        overlap_end = min(cout, window.break_end)
        break_mins = _minutes_between(overlap_start, overlap_end)
    work -= break_mins

    overtime = 0
    if window.shift.overtime_enabled:
        overtime = _minutes_between(window.end, cout)
        overtime = max(overtime - window.shift.overtime_start_after, 0)
        if window.shift.max_overtime_minutes is not None:
            overtime = min(overtime, window.shift.max_overtime_minutes)

    if late > 0 and early > 0:
        status = AttendanceStatus.LATE_AND_EARLY
    elif late > 0:
        status = AttendanceStatus.LATE
    elif early > 0:
        status = AttendanceStatus.EARLY_LEAVE
    elif work < window.shift.min_work_minutes:
        status = AttendanceStatus.EARLY_LEAVE
    else:
        status = AttendanceStatus.PRESENT

    result.update(
        status=status,
        late_minutes=late,
        early_leave_minutes=early,
        work_minutes=max(work, 0),
        overtime_minutes=overtime,
        break_minutes=break_mins,
        is_confirmed=False,
    )
    return result


async def _ensure_record(
    db: AsyncSession, employee_id: int, work_date: date
) -> AttendanceRecord:
    """Get or create the daily record without losing a concurrency race.

    A manual sync and the background poller may process two events for the same
    employee/day at the same time. A nested savepoint keeps the outer
    transaction usable if the unique constraint rejects the duplicate insert.
    """
    record = await get_record(db, employee_id, work_date)
    if record is not None:
        return record

    candidate = AttendanceRecord(employee_id=employee_id, record_date=work_date)
    try:
        async with db.begin_nested():
            db.add(candidate)
            await db.flush()
    except IntegrityError:
        candidate = await get_record(db, employee_id, work_date)
        if candidate is None:
            raise
    return candidate


async def compute_day(
    db: AsyncSession, employee: Employee, work_date: date
) -> Optional[AttendanceRecord]:
    """Compute (upsert) the attendance record for one employee/day."""
    existing = await get_record(db, employee.id, work_date)
    if existing is not None and existing.is_manual:
        # Manual corrections are authoritative; automatic recalculation must not overwrite them
        return existing

    assignment = await find_assignment(db, employee.id, work_date)
    if assignment is None:
        record = await _ensure_record(db, employee.id, work_date)
        record.status = AttendanceStatus.NOT_SCHEDULED
        record.is_confirmed = False
        return record

    shift = assignment.shift
    if shift is None or not _weekday_allowed(shift, work_date):
        record = await _ensure_record(db, employee.id, work_date)
        record.status = AttendanceStatus.WEEKEND
        record.is_confirmed = False
        return record

    window = build_shift_window(shift, work_date, assignment)
    events = await pending_events_for_day(db, employee.id, window)
    check_in, check_out = pick_check_in_out(events, window)

    holiday = await is_holiday(db, work_date, employee.department_id)
    on_leave = await approved_leave_on(db, employee.id, work_date)
    calc = calculate(window, check_in, check_out, holiday=holiday, on_leave=on_leave)

    record = await _ensure_record(db, employee.id, work_date)
    if record.is_manual:
        # manual corrections win; do not overwrite
        return record

    record.shift_id = shift.id
    record.scheduled_check_in = window.start.timetz().replace(tzinfo=None)
    record.scheduled_check_out = window.end.timetz().replace(tzinfo=None)
    record.actual_check_in = check_in.event_time if check_in else None
    record.actual_check_out = check_out.event_time if check_out else None
    record.check_in_event_id = check_in.id if check_in else None
    record.check_out_event_id = check_out.id if check_out else None
    record.status = calc["status"]
    record.late_minutes = calc["late_minutes"]
    record.early_leave_minutes = calc["early_leave_minutes"]
    record.work_minutes = calc["work_minutes"]
    record.overtime_minutes = calc["overtime_minutes"]
    record.break_minutes = calc["break_minutes"]
    record.is_confirmed = calc["is_confirmed"]
    return record


async def get_record(db: AsyncSession, employee_id: int, work_date: date) -> Optional[AttendanceRecord]:
    result = await db.execute(
        select(AttendanceRecord).where(
            AttendanceRecord.employee_id == employee_id,
            AttendanceRecord.record_date == work_date,
            AttendanceRecord.is_deleted.is_(False),
        )
    )
    return result.scalar_one_or_none()


def work_date_for_event(event_time: datetime, shift: Optional[Shift]) -> date:
    """Map an event timestamp to its logical work date.

    For shifts crossing midnight the "morning" part belongs to the previous
    day. The cut-over is the midpoint of the gap between shift end and the next
    shift start, so a slightly late check-out (e.g. 06:05 for a 22:00-06:00
    shift) still counts towards the night that started the day before.
    """
    local = to_local(event_time)
    if shift and (shift.crosses_midnight or shift.end_time <= shift.start_time):
        start_min = shift.start_time.hour * 60 + shift.start_time.minute
        end_min = shift.end_time.hour * 60 + shift.end_time.minute
        gap = (start_min - end_min) % (24 * 60)
        cutoff_min = (end_min + gap // 2) % (24 * 60)
        local_min = local.hour * 60 + local.minute
        if local_min <= cutoff_min:
            return (local - timedelta(days=1)).date()
    return local.date()