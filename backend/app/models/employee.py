import enum
from datetime import date
from typing import TYPE_CHECKING

from sqlalchemy import (
    String,
    Text,
    Date,
    ForeignKey,
    Index,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import SoftDeleteBase, enum_col

if TYPE_CHECKING:
    from app.models.attendance import AttendanceCorrection, AttendanceRecord
    from app.models.department import Department
    from app.models.device import DeviceEvent
    from app.models.employee_device import EmployeeDeviceUserId
    from app.models.leave import LeaveRequest
    from app.models.position import Position
    from app.models.shift import EmployeeShiftAssignment


class EmploymentStatus(str, enum.Enum):
    """Employee employment status."""

    ACTIVE = "active"
    ON_LEAVE = "on_leave"
    SUSPENDED = "suspended"
    TERMINATED = "terminated"
    PROBATION = "probation"


class Gender(str, enum.Enum):
    """Employee gender."""

    MALE = "male"
    FEMALE = "female"
    OTHER = "other"


class Employee(SoftDeleteBase):
    """Employee model."""

    __tablename__ = "employees"

    # Internal ID (our system)
    internal_id: Mapped[str] = mapped_column(String(20), nullable=False)
    # Hikvision device ID (separate from internal_id)
    device_user_id: Mapped[str | None] = mapped_column(String(32), nullable=True)

    # Personal info
    first_name: Mapped[str] = mapped_column(String(50), nullable=False)
    last_name: Mapped[str] = mapped_column(String(50), nullable=False)
    middle_name: Mapped[str | None] = mapped_column(String(50), nullable=True)
    gender: Mapped[Gender | None] = mapped_column(
        enum_col(Gender, length=20), nullable=True
    )
    birth_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    phone: Mapped[str | None] = mapped_column(String(20), nullable=True)
    email: Mapped[str | None] = mapped_column(String(100), nullable=True)
    address: Mapped[str | None] = mapped_column(Text, nullable=True)
    photo_url: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # Employment info
    status: Mapped[EmploymentStatus] = mapped_column(
        enum_col(EmploymentStatus, length=20),
        default=EmploymentStatus.ACTIVE,
        nullable=False,
        index=True,
    )
    hire_date: Mapped[date] = mapped_column(Date, nullable=False)
    termination_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    department_id: Mapped[int | None] = mapped_column(
        ForeignKey("departments.id", ondelete="SET NULL"), nullable=True, index=True
    )
    position_id: Mapped[int | None] = mapped_column(
        ForeignKey("positions.id", ondelete="SET NULL"), nullable=True, index=True
    )
    supervisor_id: Mapped[int | None] = mapped_column(
        ForeignKey("employees.id", ondelete="SET NULL"), nullable=True
    )

    # Additional info
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Relationships
    department: Mapped["Department | None"] = relationship(
        "Department", back_populates="employees", foreign_keys=[department_id]
    )
    position: Mapped["Position | None"] = relationship(
        "Position", back_populates="employees", foreign_keys=[position_id]
    )
    supervisor: Mapped["Employee | None"] = relationship(
        "Employee", remote_side="Employee.id", foreign_keys=[supervisor_id]
    )
    subordinates: Mapped[list["Employee"]] = relationship(
        "Employee", back_populates="supervisor", foreign_keys=[supervisor_id]
    )
    shift_assignments: Mapped[list["EmployeeShiftAssignment"]] = relationship(
        "EmployeeShiftAssignment", back_populates="employee"
    )
    attendances: Mapped[list["AttendanceRecord"]] = relationship(
        "AttendanceRecord", back_populates="employee"
    )
    leave_requests: Mapped[list["LeaveRequest"]] = relationship(
        "LeaveRequest", back_populates="employee"
    )
    attendance_corrections: Mapped[list["AttendanceCorrection"]] = relationship(
        "AttendanceCorrection", back_populates="employee"
    )
    device_events: Mapped[list["DeviceEvent"]] = relationship(
        "DeviceEvent", back_populates="employee"
    )
    device_user_ids: Mapped[list["EmployeeDeviceUserId"]] = relationship(
        "EmployeeDeviceUserId", back_populates="employee", cascade="all, delete-orphan"
    )

    __table_args__ = (
        Index("ix_employees_dept_status", "department_id", "status"),
        Index("ix_employees_name", "last_name", "first_name"),
        Index("ix_employees_hire_date", "hire_date"),
        UniqueConstraint("internal_id", name="uq_employees_internal_id"),
    )

    @property
    def full_name(self) -> str:
        parts = [self.last_name, self.first_name]
        if self.middle_name:
            parts.append(self.middle_name)
        return " ".join(parts)

    @property
    def short_name(self) -> str:
        parts = [self.last_name]
        if self.first_name:
            parts.append(self.first_name[0] + ".")
        if self.middle_name:
            parts.append(self.middle_name[0] + ".")
        return " ".join(parts)

    def __repr__(self) -> str:
        return f"<Employee(id={self.id}, internal_id={self.internal_id!r}, name={self.full_name!r})>"