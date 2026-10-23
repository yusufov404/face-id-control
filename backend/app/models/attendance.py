import enum
from datetime import date, datetime, time
from typing import TYPE_CHECKING, Optional

from sqlalchemy import (
    Date,
    DateTime,
    Time,
    ForeignKey,

    Boolean,
    Integer,
    Index,
    UniqueConstraint,
    String,
    Text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import SoftDeleteBase, enum_col
from app.models.employee import Employee
from app.models.user import User

if TYPE_CHECKING:
    from app.models.device import DeviceEvent
    from app.models.shift import Shift


class AttendanceStatus(str, enum.Enum):
    """Daily attendance status."""

    PRESENT = "present"
    LATE = "late"
    EARLY_LEAVE = "early_leave"
    LATE_AND_EARLY = "late_and_early"
    ABSENT = "absent"
    ON_LEAVE = "on_leave"
    HOLIDAY = "holiday"
    WEEKEND = "weekend"
    NOT_SCHEDULED = "not_scheduled"
    INCOMPLETE = "incomplete"  # Only check-in or check-out
    UNKNOWN = "unknown"


class CorrectionType(str, enum.Enum):
    """Attendance correction type."""

    CHECK_IN = "check_in"
    CHECK_OUT = "check_out"
    STATUS = "status"
    SHIFT = "shift"
    FULL_DAY = "full_day"


class AttendanceRecord(SoftDeleteBase):
    """Calculated daily attendance record."""

    __tablename__ = "attendance_records"

    employee_id: Mapped[int] = mapped_column(
        ForeignKey("employees.id", ondelete="CASCADE"), nullable=False, index=True
    )
    record_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    shift_id: Mapped[int | None] = mapped_column(
        ForeignKey("shifts.id", ondelete="SET NULL"), nullable=True
    )

    # Scheduled times
    scheduled_check_in: Mapped[time | None] = mapped_column(Time, nullable=True)
    scheduled_check_out: Mapped[time | None] = mapped_column(Time, nullable=True)

    # Actual times
    actual_check_in: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    actual_check_out: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # Break times
    break_start: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    break_end: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # Overtime
    overtime_start: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    overtime_end: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # Calculated fields
    status: Mapped[AttendanceStatus] = mapped_column(
        enum_col(AttendanceStatus),
        default=AttendanceStatus.UNKNOWN,
        nullable=False,
        index=True,
    )
    late_minutes: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    early_leave_minutes: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    work_minutes: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    overtime_minutes: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    break_minutes: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    # Source events
    check_in_event_id: Mapped[int | None] = mapped_column(
        ForeignKey("device_events.id", ondelete="SET NULL"), nullable=True
    )
    check_out_event_id: Mapped[int | None] = mapped_column(
        ForeignKey("device_events.id", ondelete="SET NULL"), nullable=True
    )

    # Flags
    is_manual: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_confirmed: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    confirmed_by: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    confirmed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Relationships
    employee: Mapped[Employee] = relationship("Employee", back_populates="attendances")
    shift: Mapped[Optional["Shift"]] = relationship("Shift")
    check_in_event: Mapped[Optional["DeviceEvent"]] = relationship(
        "DeviceEvent", foreign_keys=[check_in_event_id]
    )
    check_out_event: Mapped[Optional["DeviceEvent"]] = relationship(
        "DeviceEvent", foreign_keys=[check_out_event_id]
    )
    corrections: Mapped[list["AttendanceCorrection"]] = relationship(
        "AttendanceCorrection", back_populates="attendance_record"
    )
    confirmer: Mapped[Optional[User]] = relationship(
        "User", foreign_keys=[confirmed_by]
    )

    __table_args__ = (
        UniqueConstraint("employee_id", "record_date", name="uq_attendance_records_emp_date"),
        Index("ix_attendance_records_date_status", "record_date", "status"),
        Index("ix_attendance_records_emp_date_status", "employee_id", "record_date", "status"),
    )

    def __repr__(self) -> str:
        return f"<AttendanceRecord(id={self.id}, emp={self.employee_id}, date={self.record_date}, status={self.status})>"


class AttendanceCorrection(SoftDeleteBase):
    """Attendance correction with audit trail."""

    __tablename__ = "attendance_corrections"

    attendance_record_id: Mapped[int] = mapped_column(
        ForeignKey("attendance_records.id", ondelete="CASCADE"), nullable=False, index=True
    )
    employee_id: Mapped[int] = mapped_column(
        ForeignKey("employees.id", ondelete="CASCADE"), nullable=False, index=True
    )
    correction_type: Mapped[CorrectionType] = mapped_column(
        enum_col(CorrectionType), nullable=False
    )
    field_name: Mapped[str] = mapped_column(String(50), nullable=False)
    old_value: Mapped[str | None] = mapped_column(Text, nullable=True)
    new_value: Mapped[str | None] = mapped_column(Text, nullable=True)
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    corrected_by: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    approved_by: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    is_approved: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    # Relationships
    attendance_record: Mapped[AttendanceRecord] = relationship(
        "AttendanceRecord", back_populates="corrections"
    )
    employee: Mapped[Employee] = relationship("Employee", back_populates="attendance_corrections")
    corrector: Mapped[User] = relationship("User", foreign_keys=[corrected_by])
    approver: Mapped[Optional[User]] = relationship("User", foreign_keys=[approved_by])

    __table_args__ = (
        Index("ix_attendance_corrections_emp_date", "employee_id", "created_at"),
        Index("ix_attendance_corrections_pending", "is_approved", "created_at"),
    )

    def __repr__(self) -> str:
        return f"<AttendanceCorrection(id={self.id}, record={self.attendance_record_id}, field={self.field_name})>"
