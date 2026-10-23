import enum
from datetime import time
from typing import TYPE_CHECKING

from sqlalchemy import (
    Date,
    String,
    Text,
    Time,
    ForeignKey,

    Boolean,
    Integer,
    Index,
    JSON,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import SoftDeleteBase, enum_col
from app.models.employee import Employee

if TYPE_CHECKING:
    from app.models.attendance import AttendanceRecord


class ShiftType(str, enum.Enum):
    """Shift type."""

    FIXED = "fixed"
    ROTATING = "rotating"
    FLEXIBLE = "flexible"
    NIGHT = "night"


class WeekDay(str, enum.Enum):
    """Days of week."""

    MONDAY = "monday"
    TUESDAY = "tuesday"
    WEDNESDAY = "wednesday"
    THURSDAY = "thursday"
    FRIDAY = "friday"
    SATURDAY = "saturday"
    SUNDAY = "sunday"


class Shift(SoftDeleteBase):
    """Work shift model."""

    __tablename__ = "shifts"

    name: Mapped[str] = mapped_column(String(100), nullable=False)
    code: Mapped[str] = mapped_column(String(20), nullable=False, unique=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    shift_type: Mapped[ShiftType] = mapped_column(
        enum_col(ShiftType, length=20), default=ShiftType.FIXED, nullable=False
    )

    # Shift times
    start_time: Mapped[time] = mapped_column(Time, nullable=False)
    end_time: Mapped[time] = mapped_column(Time, nullable=False)
    crosses_midnight: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    # Break times
    break_start: Mapped[time | None] = mapped_column(Time, nullable=True)
    break_end: Mapped[time | None] = mapped_column(Time, nullable=True)
    break_duration: Mapped[int] = mapped_column(Integer, default=0, nullable=False)  # minutes

    # Tolerances
    late_threshold: Mapped[int] = mapped_column(Integer, default=15, nullable=False)  # minutes
    early_leave_threshold: Mapped[int] = mapped_column(Integer, default=15, nullable=False)  # minutes
    min_work_minutes: Mapped[int] = mapped_column(Integer, default=480, nullable=False)  # minimum work minutes

    # Overtime
    overtime_enabled: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    overtime_start_after: Mapped[int] = mapped_column(Integer, default=0, nullable=False)  # minutes after shift end
    max_overtime_minutes: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # Rotation pattern (for rotating shifts)
    rotation_pattern: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    # Week days this shift applies to
    applicable_days: Mapped[list[str]] = mapped_column(
        JSON, default=list, nullable=False
    )

    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    # Relationships
    assignments: Mapped[list["EmployeeShiftAssignment"]] = relationship(
        "EmployeeShiftAssignment", back_populates="shift"
    )
    attendances: Mapped[list["AttendanceRecord"]] = relationship(
        "AttendanceRecord", back_populates="shift"
    )

    __table_args__ = (
        Index("ix_shifts_active_type", "is_active", "shift_type"),
    )

    def __repr__(self) -> str:
        return f"<Shift(id={self.id}, name={self.name!r}, code={self.code!r})>"


class EmployeeShiftAssignment(SoftDeleteBase):
    """Employee shift assignment with date range."""

    __tablename__ = "employee_shift_assignments"

    employee_id: Mapped[int] = mapped_column(
        ForeignKey("employees.id", ondelete="CASCADE"), nullable=False, index=True
    )
    shift_id: Mapped[int] = mapped_column(
        ForeignKey("shifts.id", ondelete="CASCADE"), nullable=False, index=True
    )
    start_date: Mapped[Date] = mapped_column(Date, nullable=False)
    end_date: Mapped[Date | None] = mapped_column(Date, nullable=True)
    priority: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    # Override settings
    custom_start_time: Mapped[time | None] = mapped_column(Time, nullable=True)
    custom_end_time: Mapped[time | None] = mapped_column(Time, nullable=True)
    custom_break_start: Mapped[time | None] = mapped_column(Time, nullable=True)
    custom_break_end: Mapped[time | None] = mapped_column(Time, nullable=True)

    # Relationships
    employee: Mapped[Employee] = relationship("Employee", back_populates="shift_assignments")
    shift: Mapped[Shift] = relationship("Shift", back_populates="assignments")

    __table_args__ = (
        Index("ix_emp_shift_assignments_dates", "employee_id", "start_date", "end_date"),
        Index("ix_emp_shift_assignments_active", "employee_id", "is_active", "start_date"),
    )

    def __repr__(self) -> str:
        return f"<EmployeeShiftAssignment(emp={self.employee_id}, shift={self.shift_id}, from={self.start_date})>"
