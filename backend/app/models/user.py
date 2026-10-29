from datetime import datetime
from typing import TYPE_CHECKING, Optional, List

from sqlalchemy import (
    String,
    Text,
    DateTime,
    ForeignKey,
    Boolean,
    UniqueConstraint,
    Table,
    Column,
    Index,
    Integer,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from app.models.base import SoftDeleteBase

if TYPE_CHECKING:
    from app.models.employee import Employee


# Association tables (keep in sync with migration 0001_initial)
user_roles = Table(
    "user_roles",
    SoftDeleteBase.metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("user_id", Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
    Column("role_id", Integer, ForeignKey("roles.id", ondelete="CASCADE"), nullable=False),
    Column("assigned_by", Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
    Column("assigned_at", DateTime(timezone=True), server_default=func.now(), nullable=False),
    Column("expires_at", DateTime(timezone=True), nullable=True),
    UniqueConstraint("user_id", "role_id", name="uq_user_roles_user_role"),
)

role_permissions = Table(
    "role_permissions",
    SoftDeleteBase.metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("role_id", Integer, ForeignKey("roles.id", ondelete="CASCADE"), nullable=False),
    Column("permission_id", Integer, ForeignKey("permissions.id", ondelete="CASCADE"), nullable=False),
    Column("assigned_at", DateTime(timezone=True), server_default=func.now(), nullable=False),
    UniqueConstraint("role_id", "permission_id", name="uq_role_permissions_role_permission"),
)


class User(SoftDeleteBase):
    """System user model."""

    __tablename__ = "users"

    # Uniqueness only applies to live rows: accounts are soft-deleted, so a plain
    # UNIQUE constraint would keep the login/email of a removed person blocked
    # forever and make re-creating that account fail with a 500.
    __table_args__ = (
        Index(
            "uq_users_username_active", "username", unique=True,
            postgresql_where=text("is_deleted IS false"),
        ),
        Index(
            "uq_users_email_active", "email", unique=True,
            postgresql_where=text("is_deleted IS false"),
        ),
        Index(
            "uq_users_employee_id_active", "employee_id", unique=True,
            postgresql_where=text("employee_id IS NOT NULL AND is_deleted IS false"),
        ),
    )

    username: Mapped[str] = mapped_column(String(50), nullable=False)
    email: Mapped[str] = mapped_column(String(100), nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    full_name: Mapped[str] = mapped_column(String(100), nullable=False)
    phone: Mapped[str | None] = mapped_column(String(20), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    is_superuser: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    last_login: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    failed_login_attempts: Mapped[int] = mapped_column(default=0, nullable=False)
    locked_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    mfa_enabled: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    mfa_secret: Mapped[str | None] = mapped_column(String(32), nullable=True)
    department_id: Mapped[int | None] = mapped_column(
        ForeignKey("departments.id", ondelete="SET NULL"), nullable=True, index=True
    )
    employee_id: Mapped[int | None] = mapped_column(
        ForeignKey("employees.id", ondelete="SET NULL"), nullable=True
    )

    # Relationships
    roles: Mapped[List["Role"]] = relationship(
        "Role",
        secondary=user_roles,
        primaryjoin="User.id == user_roles.c.user_id",
        secondaryjoin="Role.id == user_roles.c.role_id",
        back_populates="users",
        lazy="selectin",
    )
    department: Mapped[Optional["Department"]] = relationship("Department", lazy="selectin")
    employee: Mapped[Optional["Employee"]] = relationship(
        "Employee", foreign_keys=[employee_id], lazy="selectin"
    )

    def __repr__(self) -> str:
        return f"<User(id={self.id}, username={self.username!r}, email={self.email!r})>"


class Role(SoftDeleteBase):
    """Role model."""

    __tablename__ = "roles"

    name: Mapped[str] = mapped_column(String(50), nullable=False, unique=True)
    display_name: Mapped[str] = mapped_column(String(100), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_system: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    can_manage_users: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    can_manage_roles: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    can_access_all_departments: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    can_modify_attendance: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    can_access_system_settings: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    can_view_audit_logs: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    max_department_scope: Mapped[int] = mapped_column(default=0, nullable=False)

    users: Mapped[List["User"]] = relationship(
        "User",
        secondary=user_roles,
        primaryjoin="Role.id == user_roles.c.role_id",
        secondaryjoin="User.id == user_roles.c.user_id",
        back_populates="roles",
        lazy="selectin",
    )
    permissions: Mapped[List["Permission"]] = relationship(
        "Permission", secondary=role_permissions, back_populates="roles", lazy="selectin"
    )

    def __repr__(self) -> str:
        return f"<Role(id={self.id}, name={self.name!r})>"


class Permission(SoftDeleteBase):
    """Permission model."""

    __tablename__ = "permissions"

    name: Mapped[str] = mapped_column(String(100), nullable=False, unique=True)
    display_name: Mapped[str] = mapped_column(String(100), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    category: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    is_system: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    roles: Mapped[List["Role"]] = relationship(
        "Role", secondary=role_permissions, back_populates="permissions", lazy="selectin"
    )

    def __repr__(self) -> str:
        return f"<Permission(id={self.id}, name={self.name!r})>"


# Import Department for relationship resolution
from app.models.department import Department  # noqa: E402,F401