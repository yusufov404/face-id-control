from datetime import datetime
from typing import Optional, Dict, Any, List

from pydantic import BaseModel, Field

from app.schemas.common import SoftDeleteSchema


class DeviceBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    serial_number: str = Field(..., min_length=1, max_length=50)
    device_type: str = "face_id"
    ip_address: str = Field(..., min_length=7, max_length=45)
    port: int = Field(80, ge=1, le=65535)
    connection_type: str = "http"
    username: str = Field(..., min_length=1, max_length=50)
    department_id: Optional[int] = None
    location: Optional[str] = None
    sync_enabled: bool = True
    sync_interval: int = Field(300, ge=30, le=86400)
    timeout: int = Field(10, ge=1, le=120)
    retry_attempts: int = Field(3, ge=1, le=10)
    notes: Optional[str] = None


class DeviceCreate(DeviceBase):
    password: str = Field(..., min_length=1, max_length=128)


class DeviceUpdate(BaseModel):
    name: Optional[str] = None
    ip_address: Optional[str] = None
    port: Optional[int] = None
    connection_type: Optional[str] = None
    username: Optional[str] = None
    password: Optional[str] = None
    department_id: Optional[int] = None
    location: Optional[str] = None
    sync_enabled: Optional[bool] = None
    sync_interval: Optional[int] = None
    timeout: Optional[int] = None
    retry_attempts: Optional[int] = None
    notes: Optional[str] = None


class DeviceRead(DeviceBase, SoftDeleteSchema):
    id: int
    department_name: Optional[str] = None
    firmware_version: Optional[str] = None
    model: Optional[str] = None
    isapi_version: Optional[str] = None
    capabilities: Dict[str, Any] = {}
    status: str = "unknown"
    last_heartbeat: Optional[datetime] = None
    last_sync: Optional[datetime] = None
    error_message: Optional[str] = None
    # password is never returned


class DeviceDiagnostics(BaseModel):
    device_id: int
    reachable: bool
    model: Optional[str] = None
    firmware: Optional[str] = None
    serial_number: Optional[str] = None
    device_type: Optional[str] = None
    alert_stream_supported: Optional[bool] = None
    event_search_supported: Optional[bool] = None
    time_sync_supported: Optional[bool] = None
    device_time: Optional[str] = None
    server_time: Optional[str] = None
    time_drift_seconds: Optional[int] = None
    capabilities: Dict[str, Any] = {}
    errors: List[str] = []
    checked_at: datetime


class DeviceEventRead(SoftDeleteSchema):
    id: int
    device_id: int
    device_name: Optional[str] = None
    employee_id: Optional[int] = None
    employee_name: Optional[str] = None
    device_user_id: Optional[str] = None
    event_type: str
    verify_mode: Optional[str] = None
    event_time: datetime
    device_event_id: str
    similarity: Optional[float] = None
    processed: bool
    processed_at: Optional[datetime] = None
    error_message: Optional[str] = None


class ManualEventIngest(BaseModel):
    """Manual/demo event ingest — explicitly flagged as simulated."""

    device_id: int
    device_user_id: str
    event_time: datetime
    event_type: str = "check_in"
    verify_mode: Optional[str] = "face"
    is_simulated: bool = True


class SystemSettingRead(SoftDeleteSchema):
    id: int
    key: str
    value: Any
    value_type: str
    category: str
    description: Optional[str] = None
    is_public: bool
    is_readonly: bool


class SystemSettingUpdate(BaseModel):
    value: Any


class ReportFilter(BaseModel):
    date_from: Optional[str] = None
    date_to: Optional[str] = None
    department_id: Optional[int] = None
    employee_id: Optional[int] = None
    status: Optional[str] = None
    search: Optional[str] = None


class DepartmentStat(BaseModel):
    department_id: int
    department_name: str
    employee_count: int = 0
    present: int = 0
    late: int = 0
    absent: int = 0
    on_leave: int = 0
    attendance_rate: float = 0.0


class BackupInfo(BaseModel):
    filename: str
    size_bytes: int
    created_at: datetime
    location: str
    checksum: Optional[str] = None
