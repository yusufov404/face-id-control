import type { components } from './schema'

export type CurrentUser = components['schemas']['CurrentUser']
export type TokenResponse = components['schemas']['TokenResponse']
export type LoginRequest = components['schemas']['LoginRequest']
export type PasswordChange = components['schemas']['PasswordChange']

export type Department = components['schemas']['DepartmentRead']
export type DepartmentOption = components['schemas']['DepartmentOption']
export type DepartmentCreateInput = components['schemas']['DepartmentCreate']
export type DepartmentUpdateInput = components['schemas']['DepartmentUpdate']

export type Position = components['schemas']['PositionRead']
export type PositionCreateInput = components['schemas']['PositionCreate']
export type PositionUpdateInput = components['schemas']['PositionUpdate']

export type Employee = components['schemas']['EmployeeRead']
export type EmployeeCreateInput = components['schemas']['EmployeeCreate']
export type EmployeeUpdateInput = components['schemas']['EmployeeUpdate']
export type EmployeeStatusInput = components['schemas']['EmployeeStatusUpdate']

export type User = components['schemas']['UserRead']
export type UserCreateInput = components['schemas']['UserCreate']
export type UserUpdateInput = components['schemas']['UserUpdate']
export type Role = components['schemas']['RoleRead']
export type Permission = components['schemas']['PermissionRead']
export type UserRoleAssignInput = components['schemas']['UserRoleAssign']

export type Device = components['schemas']['DeviceRead']
export type DeviceCreateInput = components['schemas']['DeviceCreate']
export type DeviceUpdateInput = components['schemas']['DeviceUpdate']
export type DeviceDiagnostics = components['schemas']['DeviceDiagnostics']
export type DeviceEvent = components['schemas']['DeviceEventRead']
export type DeviceStatus = components['schemas']['DeviceStatusItem']
export type LiveEvent = components['schemas']['LiveEventItem']
export type TodayStats = components['schemas']['TodayStats']
export type ManualEventInput = components['schemas']['ManualEventIngest']

export type AttendanceRecord = components['schemas']['AttendanceRecordRead']
export type AttendanceCorrection = components['schemas']['AttendanceCorrectionRead']
export type AttendanceCorrectionInput = components['schemas']['AttendanceCorrectionCreate']

export type Shift = components['schemas']['ShiftRead']
export type ShiftCreateInput = components['schemas']['ShiftCreate']
export type ShiftUpdateInput = components['schemas']['ShiftUpdate']
export type ShiftAssignment = components['schemas']['EmployeeShiftAssignmentRead']
export type ShiftAssignmentInput = components['schemas']['EmployeeShiftAssignmentCreate']

export type LeaveRequest = components['schemas']['LeaveRequestRead']
export type LeaveRequestInput = components['schemas']['LeaveRequestCreate']
export type LeaveDecisionInput = components['schemas']['LeaveDecision']
export type Holiday = components['schemas']['HolidayRead']
export type HolidayCreateInput = components['schemas']['HolidayCreate']

export type DepartmentStat = components['schemas']['DepartmentStat']
export type AuditLog = components['schemas']['AuditLogRead']
export type SystemSetting = components['schemas']['SystemSettingRead']
export type BackupInfo = components['schemas']['BackupInfo']
export type DashboardStats = components['schemas']['DashboardStats']
export type DailySummary = components['schemas']['DailySummary']
export type DeviceEventPage = components['schemas']['Page_DeviceEventRead_']

export interface Page<T> {
  items: T[]
  total: number
  page: number
  page_size: number
  pages: number
}

export interface TrendPoint {
  date: string
  present: number
  late: number
  absent: number
}

export interface AttendanceReportItem {
  id: number
  date: string
  employee: string | null
  department: string | null
  internal_id: string | null
  status: string
  status_label: string
  check_in: string | null
  check_out: string | null
  late_minutes: number
  early_leave_minutes: number
  work_minutes: number
}

export interface AttendanceReport {
  count: number
  truncated: boolean
  limit: number | null
  items: AttendanceReportItem[]
}

export interface LeaveReportItem {
  id: number
  employee: string | null
  type: string
  start: string
  end: string
  days: number
  status: string
}

export interface LeaveReport {
  count: number
  truncated: boolean
  limit: number | null
  items: LeaveReportItem[]
}

export type QueryValue = string | number | boolean | null | undefined
export type QueryParams = Record<string, QueryValue | QueryValue[]>

export interface MessageResponse {
  detail: string
}
