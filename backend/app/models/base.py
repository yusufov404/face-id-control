from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import DateTime, Integer, Boolean, String, TypeDecorator
from sqlalchemy.orm import Mapped, mapped_column, declared_attr
from sqlalchemy.sql import func

from app.core.database import Base as CoreBase


def enum_values(enum_cls):
    """Store enum .value (lowercase) rather than member name in VARCHAR."""
    return [m.value for m in enum_cls]


class EnumValueType(TypeDecorator):
    """Enum stored as VARCHAR.

    ``SAEnum(native_enum=False)`` compiles to a VARCHAR at DDL time but Alembic
    still reports a type change between VARCHAR and Enum.  Keeping the type
    decorator's implementation as ``String`` lets metadata and the migration
    agree, while bind/result processors still expose Python enum members and
    validate incoming values.
    """

    impl = String
    cache_ok = True

    def __init__(self, enum_cls, length: int = 30, **kwargs):
        self.enum_cls = enum_cls
        super().__init__(length=length, **kwargs)

    @property
    def python_type(self):
        return self.enum_cls

    def process_bind_param(self, value, dialect):
        if value is None:
            return None
        if isinstance(value, self.enum_cls):
            return value.value
        # Raises ValueError for an invalid raw string.
        return self.enum_cls(value).value

    def process_result_value(self, value, dialect):
        if value is None or isinstance(value, self.enum_cls):
            return value
        return self.enum_cls(value)

    def process_literal_param(self, value, dialect):
        return self.process_bind_param(value, dialect)


def enum_col(enum_cls, length: int = 30, **kwargs):
    return EnumValueType(enum_cls, length=length, **kwargs)


class TimestampMixin:
    """Mixin for created_at and updated_at timestamps."""

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        server_default=func.now(),
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        server_default=func.now(),
        server_onupdate=func.now(),
        nullable=False,
    )


class SoftDeleteMixin:
    """Mixin for soft delete functionality."""

    is_deleted: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False, index=True)
    deleted_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)


class Base(CoreBase):
    """Shared declarative base with integer surrogate primary key."""

    __abstract__ = True

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)

    @declared_attr.directive
    def __tablename__(cls) -> str:
        return cls.__name__.lower()

    def __repr__(self) -> str:
        return f"<{self.__class__.__name__}(id={self.id})>"


class TimestampedBase(Base, TimestampMixin):
    __abstract__ = True


class SoftDeleteBase(Base, TimestampMixin, SoftDeleteMixin):
    __abstract__ = True