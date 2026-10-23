import enum
from datetime import date, datetime
from typing import Optional

from sqlalchemy import (
    String,
    Text,
    Date,
    DateTime,
    ForeignKey,
    Boolean,
    Index,
    JSON,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import SoftDeleteBase, enum_col
from app.models.employee import Employee
from app.models.user import User


class LeaveType(str, enum.Enum):
    """Leave type enumeration."""

    ANNUAL = "annual"
    SICK = "sick"
    MATERNITY = "maternity"
    PATERNITY = "paternity"
    UNPAID = "unpaid"
    STUDY = "study"
    MARRIAGE = "marriage"
    BEREAVEMENT = "bereavement"
    OTHER = "other"


class LeaveStatus(str, enum.Enum):
    """Leave request status."""

    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"
    CANCELLED = "cancelled"


class LeaveRequest(SoftDeleteBase):
    """Employee leave request."""

    __tablename__ = "leave_requests"

    employee_id: Mapped[int] = mapped_column(
        ForeignKey("employees.id", ondelete="CASCADE"), nullable=False, index=True
    )
    leave_type: Mapped[LeaveType] = mapped_column(
        enum_col(LeaveType), nullable=False
    )
    start_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    end_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    start_time: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    end_time: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    total_days: Mapped[float] = mapped_column(nullable=False)
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    attachment_url: Mapped[str | None] = mapped_column(String(255), nullable=True)

    status: Mapped[LeaveStatus] = mapped_column(
        enum_col(LeaveStatus, length=20),
        default=LeaveStatus.PENDING,
        nullable=False,
        index=True,
    )
    requested_by: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    approved_by: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    rejection_reason: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Relationships
    employee: Mapped[Employee] = relationship("Employee", back_populates="leave_requests")
    requester: Mapped[User] = relationship("User", foreign_keys=[requested_by])
    approver: Mapped[Optional[User]] = relationship("User", foreign_keys=[approved_by])

    __table_args__ = (
        Index("ix_leave_requests_emp_dates", "employee_id", "start_date", "end_date"),
        Index("ix_leave_requests_status_dates", "status", "start_date", "end_date"),
    )

    def __repr__(self) -> str:
        return f"<LeaveRequest(id={self.id}, emp={self.employee_id}, type={self.leave_type}, {self.start_date}-{self.end_date})>"


class Holiday(SoftDeleteBase):
    """Holiday/non-working day model."""

    __tablename__ = "holidays"

    name: Mapped[str] = mapped_column(String(100), nullable=False)
    date: Mapped[date] = mapped_column(Date, nullable=False, unique=True)
    is_recurring: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_working_day: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    applies_to_all: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    department_ids: Mapped[list[int]] = mapped_column(JSON, default=list, nullable=False)  # JSON array

    __table_args__ = (
        Index("ix_holidays_date_recurring", "date", "is_recurring"),
    )

    def __repr__(self) -> str:
        return f"<Holiday(id={self.id}, name={self.name!r}, date={self.date})>"