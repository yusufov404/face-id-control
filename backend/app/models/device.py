import enum
from datetime import datetime
from typing import TYPE_CHECKING, Optional

from sqlalchemy import (
    String,
    Text,
    Integer,
    Boolean,
    DateTime,
    ForeignKey,

    Index,
    UniqueConstraint,
    JSON,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import SoftDeleteBase, enum_col
from app.models.employee import Employee
from app.models.employee_device import EmployeeDeviceUserId

if TYPE_CHECKING:
    from app.models.attendance import AttendanceRecord
    from app.models.department import Department


class DeviceType(str, enum.Enum):
    """Device type enumeration."""

    FACE_ID = "face_id"
    FINGERPRINT = "fingerprint"
    CARD_READER = "card_reader"
    MULTI_BIOMETRIC = "multi_biometric"


class DeviceStatus(str, enum.Enum):
    """Device connection status."""

    ONLINE = "online"
    OFFLINE = "offline"
    ERROR = "error"
    MAINTENANCE = "maintenance"
    UNKNOWN = "unknown"


class ConnectionType(str, enum.Enum):
    """Device connection type."""

    HTTP = "http"
    HTTPS = "https"


class Device(SoftDeleteBase):
    """Hikvision device model."""

    __tablename__ = "devices"

    name: Mapped[str] = mapped_column(String(100), nullable=False)
    serial_number: Mapped[str] = mapped_column(String(50), nullable=False, unique=True)
    device_type: Mapped[DeviceType] = mapped_column(
        enum_col(DeviceType), default=DeviceType.FACE_ID, nullable=False
    )
    ip_address: Mapped[str] = mapped_column(String(45), nullable=False)
    port: Mapped[int] = mapped_column(Integer, default=80, nullable=False)
    connection_type: Mapped[ConnectionType] = mapped_column(
        enum_col(ConnectionType, length=10), default=ConnectionType.HTTP, nullable=False
    )
    username: Mapped[str] = mapped_column(String(50), nullable=False)
    password_encrypted: Mapped[str] = mapped_column(String(255), nullable=False)
    department_id: Mapped[int | None] = mapped_column(
        ForeignKey("departments.id", ondelete="SET NULL"), nullable=True, index=True
    )
    location: Mapped[str | None] = mapped_column(String(200), nullable=True)
    firmware_version: Mapped[str | None] = mapped_column(String(50), nullable=True)
    model: Mapped[str | None] = mapped_column(String(50), nullable=True)
    isapi_version: Mapped[str | None] = mapped_column(String(20), nullable=True)
    capabilities: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    status: Mapped[DeviceStatus] = mapped_column(
        enum_col(DeviceStatus, length=20),
        default=DeviceStatus.UNKNOWN,
        nullable=False,
        index=True,
    )
    last_heartbeat: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_sync: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    sync_enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    sync_interval: Mapped[int] = mapped_column(Integer, default=300, nullable=False)
    timeout: Mapped[int] = mapped_column(Integer, default=10, nullable=False)
    retry_attempts: Mapped[int] = mapped_column(Integer, default=3, nullable=False)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Relationships
    department: Mapped[Optional["Department"]] = relationship("Department")
    events: Mapped[list["DeviceEvent"]] = relationship(
        "DeviceEvent", back_populates="device", lazy="dynamic"
    )
    employee_user_ids: Mapped[list["EmployeeDeviceUserId"]] = relationship(
        "EmployeeDeviceUserId", back_populates="device", cascade="all, delete-orphan"
    )

    __table_args__ = (
        Index("ix_devices_dept_status", "department_id", "status"),
        Index("ix_devices_ip_port", "ip_address", "port"),
    )

    @property
    def base_url(self) -> str:
        return f"{self.connection_type.value}://{self.ip_address}:{self.port}"

    def __repr__(self) -> str:
        return f"<Device(id={self.id}, name={self.name!r}, ip={self.ip_address}, status={self.status})>"


class EventType(str, enum.Enum):
    """Device event types."""

    CHECK_IN = "check_in"
    CHECK_OUT = "check_out"
    BREAK_START = "break_start"
    BREAK_END = "break_end"
    OVERTIME_START = "overtime_start"
    OVERTIME_END = "overtime_end"
    UNKNOWN = "unknown"


class VerifyMode(str, enum.Enum):
    """Verification mode."""

    FACE = "face"
    FINGERPRINT = "fingerprint"
    CARD = "card"
    PASSWORD = "password"
    FACE_FINGERPRINT = "face_fingerprint"
    FACE_CARD = "face_card"
    MULTI = "multi"


class DeviceEvent(SoftDeleteBase):
    """Raw device event from Hikvision terminal."""

    __tablename__ = "device_events"

    device_id: Mapped[int] = mapped_column(
        ForeignKey("devices.id", ondelete="CASCADE"), nullable=False, index=True
    )
    employee_id: Mapped[int | None] = mapped_column(
        ForeignKey("employees.id", ondelete="SET NULL"), nullable=True, index=True
    )
    device_user_id: Mapped[str | None] = mapped_column(String(32), nullable=True, index=True)
    event_type: Mapped[EventType] = mapped_column(
        enum_col(EventType), default=EventType.UNKNOWN, nullable=False
    )
    verify_mode: Mapped[VerifyMode | None] = mapped_column(
        enum_col(VerifyMode), nullable=True
    )
    event_time: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    device_event_id: Mapped[str] = mapped_column(String(64), nullable=False)
    similarity: Mapped[float | None] = mapped_column(nullable=True)
    temperature: Mapped[float | None] = mapped_column(nullable=True)
    mask_detected: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    raw_data: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    processed: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False, index=True)
    processed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    attendance_record_id: Mapped[int | None] = mapped_column(
        ForeignKey("attendance_records.id", ondelete="SET NULL"), nullable=True
    )
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Relationships
    device: Mapped[Device] = relationship("Device", back_populates="events")
    employee: Mapped[Optional[Employee]] = relationship("Employee", back_populates="device_events")
    attendance_record: Mapped[Optional["AttendanceRecord"]] = relationship(
        "AttendanceRecord", foreign_keys=[attendance_record_id]
    )

    __table_args__ = (
        UniqueConstraint("device_id", "device_event_id", name="uq_device_events_device_event_id"),
        Index("ix_device_events_emp_time", "employee_id", "event_time"),
        Index("ix_device_events_unprocessed", "processed", "event_time"),
    )

    def __repr__(self) -> str:
        return f"<DeviceEvent(id={self.id}, device={self.device_id}, emp={self.employee_id}, time={self.event_time})>"
