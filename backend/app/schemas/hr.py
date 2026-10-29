from datetime import date, time
from typing import Optional, List

from pydantic import BaseModel, Field, field_validator

from app.schemas.common import ORMModel, SoftDeleteSchema


class DepartmentBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    code: str = Field(..., min_length=1, max_length=20, pattern=r"^[A-Za-z0-9_-]+$")
    description: Optional[str] = None
    parent_id: Optional[int] = None
    head_employee_id: Optional[int] = None
    sort_order: int = 0
    is_active: bool = True


class DepartmentCreate(DepartmentBase):
    pass


class DepartmentUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    code: Optional[str] = Field(None, min_length=1, max_length=20, pattern=r"^[A-Za-z0-9_-]+$")
    description: Optional[str] = None
    parent_id: Optional[int] = None
    head_employee_id: Optional[int] = None
    sort_order: Optional[int] = None
    is_active: Optional[bool] = None


class DepartmentRead(DepartmentBase, SoftDeleteSchema):
    id: int
    parent_name: Optional[str] = None
    head_name: Optional[str] = None
    employee_count: int = 0


class DepartmentOption(ORMModel):
    id: int
    name: str
    code: str


class PositionBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    code: str = Field(..., min_length=1, max_length=20, pattern=r"^[A-Za-z0-9_-]+$")
    description: Optional[str] = None
    department_id: Optional[int] = None
    is_active: bool = True
    sort_order: int = 0


class PositionCreate(PositionBase):
    pass


class PositionUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    code: Optional[str] = Field(None, min_length=1, max_length=20)
    description: Optional[str] = None
    department_id: Optional[int] = None
    is_active: Optional[bool] = None
    sort_order: Optional[int] = None


class PositionRead(PositionBase, SoftDeleteSchema):
    id: int
    department_name: Optional[str] = None


class EmployeeBase(BaseModel):
    internal_id: str = Field(..., min_length=1, max_length=20)
    device_user_id: Optional[str] = Field(None, max_length=32)
    first_name: str = Field(..., min_length=1, max_length=50)
    last_name: str = Field(..., min_length=1, max_length=50)
    middle_name: Optional[str] = Field(None, max_length=50)
    gender: Optional[str] = None
    birth_date: Optional[date] = None
    phone: Optional[str] = Field(None, max_length=20)
    email: Optional[str] = Field(None, max_length=100)
    address: Optional[str] = None
    photo_url: Optional[str] = None
    status: str = "active"
    hire_date: date
    termination_date: Optional[date] = None
    department_id: Optional[int] = None
    position_id: Optional[int] = None
    supervisor_id: Optional[int] = None
    notes: Optional[str] = None

    @field_validator("termination_date")
    @classmethod
    def check_dates(cls, v, info):
        hire = info.data.get("hire_date")
        if v and hire and v < hire:
            raise ValueError("termination_date hire_date dan keyin bo'lishi kerak")
        return v


class EmployeeCreate(EmployeeBase):
    pass


class EmployeeUpdate(BaseModel):
    device_user_id: Optional[str] = None
    first_name: Optional[str] = Field(None, min_length=1, max_length=50)
    last_name: Optional[str] = Field(None, min_length=1, max_length=50)
    middle_name: Optional[str] = None
    gender: Optional[str] = None
    birth_date: Optional[date] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    address: Optional[str] = None
    photo_url: Optional[str] = None
    status: Optional[str] = None
    hire_date: Optional[date] = None
    termination_date: Optional[date] = None
    department_id: Optional[int] = None
    position_id: Optional[int] = None
    supervisor_id: Optional[int] = None
    notes: Optional[str] = None


class EmployeeDeviceMappingRead(ORMModel):
    id: int
    device_id: int
    device_user_id: str
    device_name: Optional[str] = None


class EmployeeDeviceMappingCreate(BaseModel):
    device_id: int
    device_user_id: str = Field(..., min_length=1, max_length=32)


class EmployeeRead(EmployeeBase, SoftDeleteSchema):
    id: int
    full_name: str = ""
    department_name: Optional[str] = None
    position_name: Optional[str] = None
    supervisor_name: Optional[str] = None
    device_mappings: List[EmployeeDeviceMappingRead] = []


class EmployeeStatusUpdate(BaseModel):
    status: str
    termination_date: Optional[date] = None
    reason: Optional[str] = None


class ShiftBase(BaseModel):
    name: str
    code: str
    description: Optional[str] = None
    shift_type: str = "fixed"
    start_time: str
    end_time: str
    crosses_midnight: bool = False
    break_start: Optional[str] = None
    break_end: Optional[str] = None
    break_duration: int = 0
    late_threshold: int = 15
    early_leave_threshold: int = 15
    min_work_minutes: int = 480
    overtime_enabled: bool = False
    overtime_start_after: int = 0
    max_overtime_minutes: Optional[int] = None
    rotation_pattern: Optional[dict] = None
    applicable_days: List[str] = []
    is_active: bool = True


class ShiftCreate(ShiftBase):
    pass


class ShiftUpdate(BaseModel):
    name: Optional[str] = None
    code: Optional[str] = None
    description: Optional[str] = None
    shift_type: Optional[str] = None
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    crosses_midnight: Optional[bool] = None
    break_start: Optional[str] = None
    break_end: Optional[str] = None
    break_duration: Optional[int] = None
    late_threshold: Optional[int] = None
    early_leave_threshold: Optional[int] = None
    min_work_minutes: Optional[int] = None
    overtime_enabled: Optional[bool] = None
    overtime_start_after: Optional[int] = None
    max_overtime_minutes: Optional[int] = None
    applicable_days: Optional[List[str]] = None
    is_active: Optional[bool] = None


class ShiftRead(SoftDeleteSchema):
    id: int
    name: str
    code: str
    description: Optional[str] = None
    shift_type: str
    start_time: time
    end_time: time
    crosses_midnight: bool
    break_start: Optional[time] = None
    break_end: Optional[time] = None
    break_duration: int
    late_threshold: int
    early_leave_threshold: int
    min_work_minutes: int
    overtime_enabled: bool
    overtime_start_after: int
    max_overtime_minutes: Optional[int] = None
    applicable_days: List[str] = []
    is_active: bool


class EmployeeShiftAssignmentBase(BaseModel):
    employee_id: int
    shift_id: int
    start_date: date
    end_date: Optional[date] = None
    priority: int = 0
    is_active: bool = True
    custom_start_time: Optional[str] = None
    custom_end_time: Optional[str] = None


class EmployeeShiftAssignmentCreate(EmployeeShiftAssignmentBase):
    pass


class EmployeeShiftAssignmentRead(SoftDeleteSchema):
    id: int
    employee_id: int
    shift_id: int
    start_date: date
    end_date: Optional[date] = None
    priority: int = 0
    is_active: bool = True
    custom_start_time: Optional[time] = None
    custom_end_time: Optional[time] = None
    employee_name: Optional[str] = None
    shift_name: Optional[str] = None