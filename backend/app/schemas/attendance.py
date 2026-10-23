from datetime import date, datetime, time
from typing import Optional, List

from pydantic import BaseModel, Field

from app.schemas.common import ORMModel, SoftDeleteSchema


class AttendanceRecordRead(SoftDeleteSchema):
    id: int
    employee_id: int
    employee_name: Optional[str] = None
    department_id: Optional[int] = None
    department_name: Optional[str] = None
    record_date: date
    shift_id: Optional[int] = None
    shift_name: Optional[str] = None
    scheduled_check_in: Optional[time] = None
    scheduled_check_out: Optional[time] = None
    actual_check_in: Optional[datetime] = None
    actual_check_out: Optional[datetime] = None
    status: str
    late_minutes: int = 0
    early_leave_minutes: int = 0
    work_minutes: int = 0
    overtime_minutes: int = 0
    break_minutes: int = 0
    is_manual: bool = False
    is_confirmed: bool = False
    notes: Optional[str] = None


class AttendanceCorrectionCreate(BaseModel):
    attendance_record_id: int
    correction_type: str  # check_in, check_out, status, shift, full_day
    field_name: str
    new_value: Optional[str] = None
    new_check_in: Optional[datetime] = None
    new_check_out: Optional[datetime] = None
    reason: str = Field(..., min_length=3, max_length=1000)
    employee_id: Optional[int] = None


class AttendanceCorrectionRead(SoftDeleteSchema):
    id: int
    attendance_record_id: int
    employee_id: int
    employee_name: Optional[str] = None
    correction_type: str
    field_name: str
    old_value: Optional[str] = None
    new_value: Optional[str] = None
    reason: str
    corrected_by: int
    corrector_name: Optional[str] = None
    is_approved: bool = False
    approved_by: Optional[int] = None
    approved_at: Optional[datetime] = None
    created_at: datetime


class DailySummary(BaseModel):
    date: date
    total_active_employees: int = 0
    present: int = 0
    late: int = 0
    absent: int = 0
    on_leave: int = 0
    incomplete: int = 0
    early_leave: int = 0


class DashboardStats(BaseModel):
    total_active_employees: int = 0
    total_departments: int = 0
    today_present: int = 0
    today_late: int = 0
    today_absent: int = 0
    today_on_leave: int = 0
    devices_online: int = 0
    devices_offline: int = 0
    devices_total: int = 0
    is_demo_data: bool = False
    generated_at: datetime


class LeaveRequestCreate(BaseModel):
    employee_id: int
    leave_type: str
    start_date: date
    end_date: date
    reason: str = Field(..., min_length=3)
    attachment_url: Optional[str] = None


class LeaveRequestRead(SoftDeleteSchema):
    id: int
    employee_id: int
    employee_name: Optional[str] = None
    leave_type: str
    start_date: date
    end_date: date
    total_days: float
    reason: str
    attachment_url: Optional[str] = None
    status: str
    requested_by: int
    approved_by: Optional[int] = None
    approved_at: Optional[datetime] = None
    rejection_reason: Optional[str] = None


class LeaveDecision(BaseModel):
    approve: bool
    rejection_reason: Optional[str] = None


class HolidayBase(BaseModel):
    name: str
    date: date
    is_recurring: bool = False
    description: Optional[str] = None
    is_working_day: bool = False
    applies_to_all: bool = True
    department_ids: List[int] = []


class HolidayCreate(HolidayBase):
    pass


class HolidayRead(HolidayBase, SoftDeleteSchema):
    id: int


class AuditLogRead(ORMModel):
    id: int
    timestamp: datetime
    user_id: Optional[int] = None
    user_name: Optional[str] = None
    user_ip: Optional[str] = None
    action: str
    resource_type: str
    resource_id: Optional[str] = None
    old_values: Optional[dict] = None
    new_values: Optional[dict] = None
    changed_fields: List[str] = []
    description: Optional[str] = None
    success: bool = True
    error_message: Optional[str] = None
