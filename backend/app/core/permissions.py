from enum import Enum
from typing import Dict, List, Set
from dataclasses import dataclass, field


class Permission(str, Enum):
    """System permissions."""

    # User Management
    USER_CREATE = "user:create"
    USER_READ = "user:read"
    USER_UPDATE = "user:update"
    USER_DELETE = "user:delete"
    USER_ASSIGN_ROLE = "user:assign_role"

    # Role Management
    ROLE_CREATE = "role:create"
    ROLE_READ = "role:read"
    ROLE_UPDATE = "role:update"
    ROLE_DELETE = "role:delete"
    ROLE_ASSIGN_PERMISSION = "role:assign_permission"

    # Department Management
    DEPARTMENT_CREATE = "department:create"
    DEPARTMENT_READ = "department:read"
    DEPARTMENT_UPDATE = "department:update"
    DEPARTMENT_DELETE = "department:delete"
    DEPARTMENT_VIEW_ALL = "department:view_all"

    # Employee Management
    EMPLOYEE_CREATE = "employee:create"
    EMPLOYEE_READ = "employee:read"
    EMPLOYEE_UPDATE = "employee:update"
    EMPLOYEE_DELETE = "employee:delete"
    EMPLOYEE_VIEW_ALL = "employee:view_all"
    EMPLOYEE_CHANGE_STATUS = "employee:change_status"

    # Position Management
    POSITION_CREATE = "position:create"
    POSITION_READ = "position:read"
    POSITION_UPDATE = "position:update"
    POSITION_DELETE = "position:delete"

    # Device Management
    DEVICE_CREATE = "device:create"
    DEVICE_READ = "device:read"
    DEVICE_UPDATE = "device:update"
    DEVICE_DELETE = "device:delete"
    DEVICE_SYNC = "device:sync"
    DEVICE_VIEW_LOGS = "device:view_logs"

    # Attendance
    ATTENDANCE_READ = "attendance:read"
    ATTENDANCE_READ_ALL = "attendance:read_all"
    ATTENDANCE_CORRECT = "attendance:correct"
    ATTENDANCE_CORRECT_ALL = "attendance:correct_all"
    ATTENDANCE_EXPORT = "attendance:export"

    # Shifts & Schedules
    SHIFT_CREATE = "shift:create"
    SHIFT_READ = "shift:read"
    SHIFT_UPDATE = "shift:update"
    SHIFT_DELETE = "shift:delete"
    SHIFT_ASSIGN = "shift:assign"

    # Holidays & Leaves
    HOLIDAY_CREATE = "holiday:create"
    HOLIDAY_READ = "holiday:read"
    HOLIDAY_UPDATE = "holiday:update"
    HOLIDAY_DELETE = "holiday:delete"
    LEAVE_CREATE = "leave:create"
    LEAVE_READ = "leave:read"
    LEAVE_APPROVE = "leave:approve"
    LEAVE_READ_ALL = "leave:read_all"

    # Reports
    REPORT_VIEW = "report:view"
    REPORT_EXPORT = "report:export"
    REPORT_DASHBOARD = "report:dashboard"

    # Audit
    AUDIT_READ = "audit:read"
    AUDIT_EXPORT = "audit:export"

    # System Settings
    SETTINGS_READ = "settings:read"
    SETTINGS_UPDATE = "settings:update"
    SETTINGS_BACKUP = "settings:backup"
    SETTINGS_RESTORE = "settings:restore"

    # Super Admin Only
    SYSTEM_ADMIN = "system:admin"


class Role(str, Enum):
    """System roles."""

    SUPER_ADMIN = "super_admin"
    CHIEF_PHYSICIAN = "chief_physician"
    HR_DIRECTOR = "hr_director"
    DEPARTMENT_HEAD = "department_head"
    DIRECTOR = "director"
    ACCOUNTANT = "accountant"
    AUDITOR = "auditor"


@dataclass(frozen=True)
class RoleDefinition:
    """Role definition with permissions and constraints."""

    name: Role
    display_name: str
    description: str
    permissions: Set[Permission] = field(default_factory=set)
    # Constraints
    can_manage_users: bool = False
    can_manage_roles: bool = False
    can_access_all_departments: bool = False
    can_modify_attendance: bool = False
    can_access_system_settings: bool = False
    can_view_audit_logs: bool = False
    max_department_scope: int = 0  # 0 = all, >0 = specific department only


# Role-Permission Matrix
ROLE_DEFINITIONS: Dict[Role, RoleDefinition] = {
    Role.SUPER_ADMIN: RoleDefinition(
        name=Role.SUPER_ADMIN,
        display_name="Super Administrator",
        description="Full system access including user management, system settings, and audit logs",
        permissions=set(Permission),  # All permissions
        can_manage_users=True,
        can_manage_roles=True,
        can_access_all_departments=True,
        can_modify_attendance=True,
        can_access_system_settings=True,
        can_view_audit_logs=True,
        max_department_scope=0,
    ),
    Role.CHIEF_PHYSICIAN: RoleDefinition(
        name=Role.CHIEF_PHYSICIAN,
        display_name="Bosh Shifokor",
        description="View all departments, attendance reports, and statistics. Cannot modify data.",
        permissions={
            Permission.USER_READ,
            Permission.ROLE_READ,
            Permission.DEPARTMENT_READ,
            Permission.DEPARTMENT_VIEW_ALL,
            Permission.EMPLOYEE_READ,
            Permission.EMPLOYEE_VIEW_ALL,
            Permission.POSITION_READ,
            Permission.DEVICE_READ,
            Permission.DEVICE_VIEW_LOGS,
            Permission.ATTENDANCE_READ,
            Permission.ATTENDANCE_READ_ALL,
            Permission.ATTENDANCE_EXPORT,
            Permission.SHIFT_READ,
            Permission.HOLIDAY_READ,
            Permission.LEAVE_READ,
            Permission.LEAVE_READ_ALL,
            Permission.REPORT_VIEW,
            Permission.REPORT_EXPORT,
            Permission.REPORT_DASHBOARD,
        },
        can_manage_users=False,
        can_manage_roles=False,
        can_access_all_departments=True,
        can_modify_attendance=False,
        can_access_system_settings=False,
        can_view_audit_logs=False,
        max_department_scope=0,
    ),
    Role.HR_DIRECTOR: RoleDefinition(
        name=Role.HR_DIRECTOR,
        display_name="Kadrlar Bo'limi Boshliqi",
        description="Manage employees, departments, positions, shifts, holidays, and attendance corrections with full audit trail",
        permissions={
            Permission.USER_CREATE,
            Permission.USER_READ,
            Permission.USER_UPDATE,
            Permission.USER_ASSIGN_ROLE,
            Permission.ROLE_READ,
            Permission.ROLE_ASSIGN_PERMISSION,
            Permission.DEPARTMENT_CREATE,
            Permission.DEPARTMENT_READ,
            Permission.DEPARTMENT_UPDATE,
            Permission.DEPARTMENT_VIEW_ALL,
            Permission.EMPLOYEE_CREATE,
            Permission.EMPLOYEE_READ,
            Permission.EMPLOYEE_UPDATE,
            Permission.EMPLOYEE_DELETE,
            Permission.EMPLOYEE_CHANGE_STATUS,
            Permission.EMPLOYEE_VIEW_ALL,
            Permission.POSITION_CREATE,
            Permission.POSITION_READ,
            Permission.POSITION_UPDATE,
            Permission.POSITION_DELETE,
            Permission.DEVICE_READ,
            Permission.DEVICE_VIEW_LOGS,
            Permission.ATTENDANCE_READ,
            Permission.ATTENDANCE_READ_ALL,
            Permission.ATTENDANCE_CORRECT,
            Permission.ATTENDANCE_CORRECT_ALL,
            Permission.ATTENDANCE_EXPORT,
            Permission.SHIFT_CREATE,
            Permission.SHIFT_READ,
            Permission.SHIFT_UPDATE,
            Permission.SHIFT_DELETE,
            Permission.SHIFT_ASSIGN,
            Permission.HOLIDAY_CREATE,
            Permission.HOLIDAY_READ,
            Permission.HOLIDAY_UPDATE,
            Permission.HOLIDAY_DELETE,
            Permission.LEAVE_CREATE,
            Permission.LEAVE_READ,
            Permission.LEAVE_APPROVE,
            Permission.LEAVE_READ_ALL,
            Permission.REPORT_VIEW,
            Permission.REPORT_EXPORT,
            Permission.REPORT_DASHBOARD,
            Permission.AUDIT_READ,
            Permission.AUDIT_EXPORT,
        },
        can_manage_users=True,
        can_manage_roles=False,  # Cannot assign Super Admin role
        can_access_all_departments=True,
        can_modify_attendance=True,
        can_access_system_settings=False,
        can_view_audit_logs=True,
        max_department_scope=0,
    ),
    Role.DEPARTMENT_HEAD: RoleDefinition(
        name=Role.DEPARTMENT_HEAD,
        display_name="Bo'lim Boshliqi",
        description="View only assigned department's employees and attendance. Cannot modify data.",
        permissions={
            Permission.EMPLOYEE_READ,
            Permission.DEPARTMENT_READ,
            Permission.POSITION_READ,
            Permission.ATTENDANCE_READ,
            Permission.SHIFT_READ,
            Permission.HOLIDAY_READ,
            Permission.LEAVE_READ,
            Permission.REPORT_VIEW,
            Permission.REPORT_DASHBOARD,
        },
        can_manage_users=False,
        can_manage_roles=False,
        can_access_all_departments=False,
        can_modify_attendance=False,
        can_access_system_settings=False,
        can_view_audit_logs=False,
        max_department_scope=1,  # Only own department
    ),
    Role.DIRECTOR: RoleDefinition(
        name=Role.DIRECTOR,
        display_name="Direktor",
        description="View all departments, attendance reports, and statistics. Cannot modify data.",
        permissions={
            Permission.USER_READ,
            Permission.ROLE_READ,
            Permission.DEPARTMENT_READ,
            Permission.DEPARTMENT_VIEW_ALL,
            Permission.EMPLOYEE_READ,
            Permission.EMPLOYEE_VIEW_ALL,
            Permission.POSITION_READ,
            Permission.DEVICE_READ,
            Permission.DEVICE_VIEW_LOGS,
            Permission.ATTENDANCE_READ,
            Permission.ATTENDANCE_READ_ALL,
            Permission.ATTENDANCE_EXPORT,
            Permission.SHIFT_READ,
            Permission.HOLIDAY_READ,
            Permission.LEAVE_READ,
            Permission.LEAVE_READ_ALL,
            Permission.REPORT_VIEW,
            Permission.REPORT_EXPORT,
            Permission.REPORT_DASHBOARD,
        },
        can_manage_users=False,
        can_manage_roles=False,
        can_access_all_departments=True,
        can_modify_attendance=False,
        can_access_system_settings=False,
        can_view_audit_logs=True,
        max_department_scope=0,
    ),
    Role.ACCOUNTANT: RoleDefinition(
        name=Role.ACCOUNTANT,
        display_name="Hisobchi",
        description="View attendance and leave reports. Cannot modify data or manage users.",
        permissions={
            Permission.EMPLOYEE_READ,
            Permission.DEPARTMENT_READ,
            Permission.POSITION_READ,
            Permission.ATTENDANCE_READ,
            Permission.ATTENDANCE_READ_ALL,
            Permission.ATTENDANCE_EXPORT,
            Permission.LEAVE_READ,
            Permission.LEAVE_READ_ALL,
            Permission.HOLIDAY_READ,
            Permission.REPORT_VIEW,
            Permission.REPORT_EXPORT,
            Permission.REPORT_DASHBOARD,
        },
        can_manage_users=False,
        can_manage_roles=False,
        can_access_all_departments=True,
        can_modify_attendance=False,
        can_access_system_settings=False,
        can_view_audit_logs=False,
        max_department_scope=0,
    ),
    Role.AUDITOR: RoleDefinition(
        name=Role.AUDITOR,
        display_name="Kuzatuvchi/Auditor",
        description="Read-only access to permitted reports only",
        permissions={
            Permission.REPORT_VIEW,
            Permission.ATTENDANCE_READ,
            Permission.EMPLOYEE_READ,
            Permission.DEPARTMENT_READ,
        },
        can_manage_users=False,
        can_manage_roles=False,
        can_access_all_departments=True,
        can_modify_attendance=False,
        can_access_system_settings=False,
        can_view_audit_logs=False,
        max_department_scope=0,
    ),
}


def get_role_permissions(role: Role) -> Set[Permission]:
    """Get all permissions for a role."""
    return ROLE_DEFINITIONS.get(role, RoleDefinition(name=role, display_name="", description="")).permissions


def get_role_definition(role: Role) -> RoleDefinition:
    """Get role definition."""
    return ROLE_DEFINITIONS.get(role, RoleDefinition(name=role, display_name="", description=""))


def has_permission(user_permissions: Set[Permission], required: Permission) -> bool:
    """Check if user has a specific permission."""
    return required in user_permissions


def has_any_permission(user_permissions: Set[Permission], required: List[Permission]) -> bool:
    """Check if user has any of the required permissions."""
    return any(p in user_permissions for p in required)


def has_all_permissions(user_permissions: Set[Permission], required: List[Permission]) -> bool:
    """Check if user has all required permissions."""
    return all(p in user_permissions for p in required)