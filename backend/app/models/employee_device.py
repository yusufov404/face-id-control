"""Employee-Device User ID mapping model."""
from typing import TYPE_CHECKING

from sqlalchemy import (
    String,
    ForeignKey,
    Index,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import SoftDeleteBase

if TYPE_CHECKING:
    from app.models.employee import Employee
    from app.models.device import Device


class EmployeeDeviceUserId(SoftDeleteBase):
    """Mapping between employee and device user IDs for specific terminals.

    An employee can have different device_user_id values on different terminals.
    """

    __tablename__ = "employee_device_user_ids"

    employee_id: Mapped[int] = mapped_column(
        ForeignKey("employees.id", ondelete="CASCADE"), nullable=False, index=True
    )
    device_id: Mapped[int] = mapped_column(
        ForeignKey("devices.id", ondelete="CASCADE"), nullable=False, index=True
    )
    device_user_id: Mapped[str] = mapped_column(String(32), nullable=False)

    # Relationships
    employee: Mapped["Employee"] = relationship("Employee", back_populates="device_user_ids")
    device: Mapped["Device"] = relationship("Device", back_populates="employee_user_ids")

    __table_args__ = (
        UniqueConstraint("employee_id", "device_id", name="uq_employee_device_user_ids_emp_device"),
        Index("ix_employee_device_user_ids_device_user_id", "device_user_id"),
    )

    def __repr__(self) -> str:
        return f"<EmployeeDeviceUserId(emp={self.employee_id}, device={self.device_id}, user_id={self.device_user_id})>"