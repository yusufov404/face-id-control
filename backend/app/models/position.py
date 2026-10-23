from typing import TYPE_CHECKING

from sqlalchemy import String, Text, ForeignKey, Index
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import SoftDeleteBase

if TYPE_CHECKING:
    from app.models.department import Department
    from app.models.employee import Employee


class Position(SoftDeleteBase):
    """Position/Job title model."""

    __tablename__ = "positions"

    name: Mapped[str] = mapped_column(String(100), nullable=False, unique=True)
    code: Mapped[str] = mapped_column(String(20), nullable=False, unique=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    department_id: Mapped[int | None] = mapped_column(
        ForeignKey("departments.id", ondelete="SET NULL"), nullable=True, index=True
    )
    is_active: Mapped[bool] = mapped_column(default=True, nullable=False)
    sort_order: Mapped[int] = mapped_column(default=0, nullable=False)

    # Relationships
    department: Mapped["Department | None"] = relationship("Department")
    employees: Mapped[list["Employee"]] = relationship(
        "Employee", back_populates="position", foreign_keys="Employee.position_id"
    )

    __table_args__ = (
        Index("ix_positions_dept_active", "department_id", "is_active"),
    )

    def __repr__(self) -> str:
        return f"<Position(id={self.id}, name={self.name!r}, code={self.code!r})>"