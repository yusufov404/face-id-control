from typing import TYPE_CHECKING

from sqlalchemy import String, Text, ForeignKey, Index
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import SoftDeleteBase

if TYPE_CHECKING:
    from app.models.employee import Employee


class Department(SoftDeleteBase):
    """Department model."""

    __tablename__ = "departments"

    name: Mapped[str] = mapped_column(String(100), nullable=False, unique=True)
    code: Mapped[str] = mapped_column(String(20), nullable=False, unique=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    parent_id: Mapped[int | None] = mapped_column(
        ForeignKey("departments.id", ondelete="SET NULL"), nullable=True, index=True
    )
    head_employee_id: Mapped[int | None] = mapped_column(
        ForeignKey("employees.id", ondelete="SET NULL"), nullable=True
    )
    sort_order: Mapped[int] = mapped_column(default=0, nullable=False)
    is_active: Mapped[bool] = mapped_column(default=True, nullable=False)

    # Relationships
    parent: Mapped["Department | None"] = relationship(
        "Department",
        remote_side="Department.id",
        back_populates="children",
        foreign_keys=[parent_id],
    )
    children: Mapped[list["Department"]] = relationship(
        "Department", back_populates="parent", foreign_keys=[parent_id]
    )
    head: Mapped["Employee | None"] = relationship(
        "Employee", foreign_keys=[head_employee_id]
    )
    employees: Mapped[list["Employee"]] = relationship(
        "Employee", back_populates="department", foreign_keys="Employee.department_id"
    )

    __table_args__ = (
        Index("ix_departments_parent_active", "parent_id", "is_active"),
        Index("ix_departments_code_active", "code", "is_active"),
    )

    def __repr__(self) -> str:
        return f"<Department(id={self.id}, name={self.name!r}, code={self.code!r})>"