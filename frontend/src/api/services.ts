import { http } from './client'
import type {
  AttendanceCorrection,
  AttendanceCorrectionInput,
  AttendanceRecord,
  AttendanceReport,
  AuditLog,
  BackupInfo,
  CurrentUser,
  DailySummary,
  DashboardStats,
  Department,
  DepartmentCreateInput,
  DepartmentOption,
  DepartmentStat,
  DepartmentUpdateInput,
  Device,
  DeviceCreateInput,
  DeviceDiagnostics,
  DeviceEvent,
  DeviceUpdateInput,
  Employee,
  EmployeeCreateInput,
  EmployeeStatusInput,
  EmployeeUpdateInput,
  Holiday,
  HolidayCreateInput,
  LeaveDecisionInput,
  LeaveReport,
  LeaveRequest,
  LeaveRequestInput,
  LiveEvent,
  LoginRequest,
  ManualEventInput,
  MessageResponse,
  Page,
  PasswordChange,
  Permission,
  Position,
  PositionCreateInput,
  PositionUpdateInput,
  QueryParams,
  Role,
  Shift,
  ShiftAssignment,
  ShiftAssignmentInput,
  ShiftCreateInput,
  ShiftUpdateInput,
  SystemSetting,
  TokenResponse,
  TrendPoint,
  User,
  UserCreateInput,
  UserRoleAssignInput,
  UserUpdateInput,
  DeviceStatus,
  TodayStats,
} from './types'

export const authApi = {
  login(body: LoginRequest) {
    return http.post<TokenResponse>('/auth/login', body)
  },
  me() {
    return http.get<CurrentUser>('/auth/me')
  },
  logout() {
    return http.post<MessageResponse>('/auth/logout')
  },
  changePassword(body: PasswordChange) {
    return http.post<MessageResponse>('/auth/change-password', body)
  },
}

export const dashboardApi = {
  stats() {
    return http.get<DashboardStats>('/dashboard/stats')
  },
  daily(day?: string) {
    return http.get<DailySummary>('/dashboard/daily', { day })
  },
  trend(days = 14) {
    return http.get<TrendPoint[]>('/dashboard/trend', { days })
  },
}

export const departmentsApi = {
  list(params: QueryParams) {
    return http.get<Page<Department>>('/departments', params)
  },
  options() {
    return http.get<DepartmentOption[]>('/departments/options')
  },
  create(body: DepartmentCreateInput) {
    return http.post<Department>('/departments', body)
  },
  update(id: number, body: DepartmentUpdateInput) {
    return http.patch<Department>(`/departments/${id}`, body)
  },
  remove(id: number) {
    return http.delete<MessageResponse>(`/departments/${id}`)
  },
}

export const positionsApi = {
  list(params: QueryParams) {
    return http.get<Page<Position>>('/positions', params)
  },
  create(body: PositionCreateInput) {
    return http.post<Position>('/positions', body)
  },
  update(id: number, body: PositionUpdateInput) {
    return http.patch<Position>(`/positions/${id}`, body)
  },
  remove(id: number) {
    return http.delete<MessageResponse>(`/positions/${id}`)
  },
}

export const employeesApi = {
  list(params: QueryParams) {
    return http.get<Page<Employee>>('/employees', params)
  },
  get(id: number) {
    return http.get<Employee>(`/employees/${id}`)
  },
  create(body: EmployeeCreateInput) {
    return http.post<Employee>('/employees', body)
  },
  update(id: number, body: EmployeeUpdateInput) {
    return http.patch<Employee>(`/employees/${id}`, body)
  },
  changeStatus(id: number, body: EmployeeStatusInput) {
    return http.post<Employee>(`/employees/${id}/status`, body)
  },
  remove(id: number) {
    return http.delete<MessageResponse>(`/employees/${id}`)
  },
}

export const usersApi = {
  list(params: QueryParams) {
    return http.get<Page<User>>('/users', params)
  },
  create(body: UserCreateInput) {
    return http.post<User>('/users', body)
  },
  update(id: number, body: UserUpdateInput) {
    return http.patch<User>(`/users/${id}`, body)
  },
  assignRoles(id: number, body: UserRoleAssignInput) {
    return http.put<User>(`/users/${id}/roles`, body)
  },
  remove(id: number) {
    return http.delete<MessageResponse>(`/users/${id}`)
  },
}

export const rolesApi = {
  list() {
    return http.get<Role[]>('/roles')
  },
  permissions(roleId: number) {
    return http.get<Permission[]>(`/roles/${roleId}/permissions`)
  },
  setPermissions(roleId: number, permissionIds: number[]) {
    return http.put<Permission[]>(`/roles/${roleId}/permissions`, { permission_ids: permissionIds })
  },
}

export const permissionsApi = {
  list(category?: string) {
    return http.get<Permission[]>('/permissions', { category })
  },
}

export const devicesApi = {
  list(params: QueryParams) {
    return http.get<Page<Device>>('/devices', params)
  },
  create(body: DeviceCreateInput) {
    return http.post<Device>('/devices', body)
  },
  update(id: number, body: DeviceUpdateInput) {
    return http.patch<Device>(`/devices/${id}`, body)
  },
  remove(id: number) {
    return http.delete<MessageResponse>(`/devices/${id}`)
  },
  diagnose(id: number) {
    return http.post<DeviceDiagnostics>(`/devices/${id}/diagnose`)
  },
  sync(id: number) {
    return http.post<MessageResponse>(`/devices/${id}/sync`)
  },
  events(id: number, params: QueryParams) {
    return http.get<Page<DeviceEvent>>(`/devices/${id}/events`, params)
  },
  manualEvent(body: ManualEventInput) {
    return http.post<MessageResponse>('/devices/events/manual', body)
  },
}

export const attendanceApi = {
  list(params: QueryParams) {
    return http.get<Page<AttendanceRecord>>('/attendance', params)
  },
  get(id: number) {
    return http.get<AttendanceRecord>(`/attendance/${id}`)
  },
  recalculate(id: number) {
    return http.post<AttendanceRecord>(`/attendance/${id}/recalculate`)
  },
  corrections(params: QueryParams) {
    return http.get<Page<AttendanceCorrection>>('/attendance/corrections/list', params)
  },
  createCorrection(body: AttendanceCorrectionInput) {
    return http.post<AttendanceCorrection>('/attendance/corrections', body)
  },
  approveCorrection(id: number) {
    return http.post<AttendanceCorrection>(`/attendance/corrections/${id}/approve`)
  },
}

export const shiftsApi = {
  list(params: QueryParams) {
    return http.get<Page<Shift>>('/shifts', params)
  },
  create(body: ShiftCreateInput) {
    return http.post<Shift>('/shifts', body)
  },
  update(id: number, body: ShiftUpdateInput) {
    return http.patch<Shift>(`/shifts/${id}`, body)
  },
  remove(id: number) {
    return http.delete<MessageResponse>(`/shifts/${id}`)
  },
}

export const assignmentsApi = {
  list(params: QueryParams) {
    return http.get<Page<ShiftAssignment>>('/shift-assignments', params)
  },
  create(body: ShiftAssignmentInput) {
    return http.post<ShiftAssignment>('/shift-assignments', body)
  },
}

export const leavesApi = {
  list(params: QueryParams) {
    return http.get<Page<LeaveRequest>>('/leaves', params)
  },
  create(body: LeaveRequestInput) {
    return http.post<LeaveRequest>('/leaves', body)
  },
  decide(id: number, body: LeaveDecisionInput) {
    return http.post<LeaveRequest>(`/leaves/${id}/decision`, body)
  },
}

export const holidaysApi = {
  list(params: QueryParams) {
    return http.get<Page<Holiday>>('/holidays', params)
  },
  create(body: HolidayCreateInput) {
    return http.post<Holiday>('/holidays', body)
  },
  remove(id: number) {
    return http.delete<MessageResponse>(`/holidays/${id}`)
  },
}

export const reportsApi = {
  attendance(params: QueryParams) {
    return http.get<AttendanceReport>('/reports/attendance', params)
  },
  departments(params: QueryParams) {
    return http.get<DepartmentStat[]>('/reports/departments', params)
  },
  leaves(params: QueryParams) {
    return http.get<LeaveReport>('/reports/leaves', params)
  },
  downloadAttendance(params: QueryParams, format: 'excel' | 'pdf') {
    return http.download('/reports/attendance', { ...params, format }, `davomat_hisoboti.${format === 'excel' ? 'xlsx' : 'pdf'}`)
  },
  downloadLeaves(params: QueryParams, format: 'excel' | 'pdf') {
    return http.download('/reports/leaves', { ...params, format }, `tatillar.${format === 'excel' ? 'xlsx' : 'pdf'}`)
  },
}

export const auditApi = {
  list(params: QueryParams) {
    return http.get<Page<AuditLog>>('/audit', params)
  },
  get(id: number) {
    return http.get<AuditLog>(`/audit/${id}`)
  },
  download(params: QueryParams) {
    return http.download('/audit/export', params, 'audit.xlsx')
  },
}

export const settingsApi = {
  list(category?: string) {
    return http.get<SystemSetting[]>('/settings', { category })
  },
  update(key: string, value: unknown) {
    return http.patch<SystemSetting>(`/settings/${encodeURIComponent(key)}`, { value })
  },
}

export const backupsApi = {
  list() {
    return http.get<BackupInfo[]>('/backups')
  },
  create() {
    return http.post<BackupInfo>('/backups')
  },
  restore(filename: string) {
    return http.post<MessageResponse>(`/backups/${encodeURIComponent(filename)}/restore`, undefined, { confirm: true })
  },
}

export const monitoringApi = {
  liveEvents(params: QueryParams) {
    return http.get<Page<LiveEvent>>('/monitoring/live-events', params)
  },
  devicesStatus(params: QueryParams) {
    return http.get<DeviceStatus[]>('/monitoring/devices-status', params)
  },
  todayStats(params: QueryParams) {
    return http.get<TodayStats>('/monitoring/today-stats', params)
  },
  departmentsOptions() {
    return http.get<DepartmentOption[]>('/monitoring/departments-options')
  },
}
