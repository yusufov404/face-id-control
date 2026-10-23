from typing import Optional, Any

from sqlalchemy import (
    String,
    Text,
    ForeignKey,
    Boolean,
    Index,
    JSON,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import SoftDeleteBase
from app.models.user import User


class SettingType(str):
    """Setting value types."""

    STRING = "string"
    INTEGER = "integer"
    FLOAT = "float"
    BOOLEAN = "boolean"
    JSON = "json"
    ENCRYPTED = "encrypted"


class SystemSetting(SoftDeleteBase):
    """System configuration settings."""

    __tablename__ = "system_settings"

    key: Mapped[str] = mapped_column(String(100), nullable=False, unique=True)
    value: Mapped[Any] = mapped_column(JSON, nullable=False)
    value_type: Mapped[str] = mapped_column(String(20), nullable=False, default=SettingType.STRING)
    category: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_public: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_readonly: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    validation_schema: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    updated_by: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    # Relationships
    updater: Mapped[Optional[User]] = relationship("User")

    __table_args__ = (
        Index("ix_system_settings_category_public", "category", "is_public"),
    )

    def __repr__(self) -> str:
        return f"<SystemSetting(key={self.key!r}, category={self.category!r})>"
