import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  BarChart3,
  Building2,
  CalendarDays,
  Download,
  FileSpreadsheet,
  FileText,
  UsersRound,
} from 'lucide-react'
import { departmentsApi, reportsApi } from '@/api/services'
import type { AttendanceReportItem, DepartmentStat, LeaveReportItem } from '@/api/types'
import { useAuth } from '@/auth/AuthProvider'
import { EmployeeCombobox } from '@/components/forms/EmployeeCombobox'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { Input, Select } from '@/components/ui/Field'
import { Alert, EmptyState } from '@/components/ui/Feedback'
import { PageHeader } from '@/components/ui/LayoutBits'
import { Tabs } from '@/components/ui/Tabs'
import { useToast } from '@/components/ui/Toast'
import { useDocumentTitle } from '@/lib/hooks'
import {
  addDaysISO,
  formatDate,
  formatMinutes,
  formatNumber,
  formatTime,
  LEAVE_STATUS_LABELS,
  LEAVE_STATUS_TONES,
  LEAVE_TYPE_LABELS,
  STATUS_LABELS,
  STATUS_TONES,
  todayISO,
} from '@/lib/format'

function monthStart(): string {
  return `${todayISO().slice(0, 7)}-01`
}

export default function ReportsPage() {
  const { can } = useAuth()
  const toast = useToast()
  useDocumentTitle('Hisobotlar')

  const [tab, setTab] = useState('attendance')
  const [dateFrom, setDateFrom] = useState(addDaysISO(-30))
  const [dateTo, setDateTo] = useState(todayISO())
  const [departmentId, setDepartmentId] = useState('')
  const [employeeId, setEmployeeId] = useState<number | null>(null)
  const [status, setStatus] = useState('')
  const [exporting, setExporting] = useState<'excel' | 'pdf' | null>(null)

  const rangeError = dateFrom && dateTo && dateTo < dateFrom ? "Tugash sanasi boshlanish sanasidan keyin bo'lishi kerak" : ''
  const validRange = !rangeError

  function changeTab(value: string) {
    setTab(value)
    setEmployeeId(null)
    setStatus('')
  }

  const departmentsQuery = useQuery({
    queryKey: ['departments', 'options'],
    queryFn: departmentsApi.options,
  })
  const attendanceQuery = useQuery({
    queryKey: ['report-attendance', dateFrom, dateTo, departmentId, employeeId, status],
    queryFn: () => reportsApi.attendance({
      date_from: dateFrom || undefined,
      date_to: dateTo || undefined,
      department_id: departmentId || undefined,
      employee_id: employeeId || undefined,
      status: status || undefined,
    }),
    enabled: tab === 'attendance' && validRange,
  })
  const departmentReportQuery = useQuery({
    queryKey: ['report-departments', dateFrom, dateTo],
    queryFn: () => reportsApi.departments({
      date_from: dateFrom || undefined,
      date_to: dateTo || undefined,
    }),
    enabled: tab === 'departments' && validRange,
  })
  const leavesQuery = useQuery({
    queryKey: ['report-leaves', dateFrom, dateTo],
    queryFn: () => reportsApi.leaves({
      date_from: dateFrom || undefined,
      date_to: dateTo || undefined,
    }),
    enabled: tab === 'leaves' && validRange,
  })

  async function exportReport(format: 'excel' | 'pdf') {
    setExporting(format)
    try {
      if (tab === 'attendance') {
        await reportsApi.downloadAttendance({
          date_from: dateFrom || undefined,
          date_to: dateTo || undefined,
          department_id: departmentId || undefined,
          employee_id: employeeId || undefined,
          status: status || undefined,
        }, format)
      } else {
        await reportsApi.downloadLeaves({
          date_from: dateFrom || undefined,
          date_to: dateTo || undefined,
        }, format)
      }
      toast.success('Hisobot yuklandi')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Hisobotni yuklab bo'lmadi")
    } finally {
      setExporting(null)
    }
  }

  function setPreset(preset: 'today' | 'week' | 'month' | 'this_month') {
    const today = todayISO()
    if (preset === 'today') {
      setDateFrom(today)
      setDateTo(today)
    } else if (preset === 'week') {
      setDateFrom(addDaysISO(-7))
      setDateTo(today)
    } else if (preset === 'month') {
      setDateFrom(addDaysISO(-30))
      setDateTo(today)
    } else {
      setDateFrom(monthStart())
      setDateTo(today)
    }
  }

  const attendanceColumns: Column<AttendanceReportItem>[] = [
    {
      key: 'date',
      header: 'Sana',
      cell: (item) => <span className="whitespace-nowrap text-xs font-semibold tabular-nums text-slate-700">{formatDate(item.date)}</span>,
    },
    {
      key: 'employee',
      header: 'Xodim',
      cell: (item) => (
        <div>
          <p className="text-xs font-semibold text-slate-800">{item.employee || '—'}</p>
          <p className="mt-0.5 font-mono text-[10px] text-slate-400">{item.internal_id || '—'}</p>
        </div>
      ),
    },
    {
      key: 'department',
      header: "Bo'lim",
      cell: (item) => <span className="text-xs text-slate-600">{item.department || '—'}</span>,
    },
    {
      key: 'status',
      header: 'Holat',
      cell: (item) => <Badge tone={(STATUS_TONES[item.status] as 'green' | 'red' | 'amber' | 'blue' | 'violet' | 'slate') || 'slate'}>{item.status_label || STATUS_LABELS[item.status] || item.status}</Badge>,
    },
    {
      key: 'time',
      header: 'Kirish / chiqish',
      cell: (item) => <span className="whitespace-nowrap text-xs tabular-nums text-slate-600">{formatTime(item.check_in)} – {formatTime(item.check_out)}</span>,
    },
    {
      key: 'late',
      header: 'Kechikish',
      cell: (item) => <span className={`text-xs tabular-nums ${item.late_minutes > 0 ? 'font-semibold text-amber-700' : 'text-slate-400'}`}>{formatMinutes(item.late_minutes)}</span>,
    },
    {
      key: 'early',
      header: 'Erta ketish',
      cell: (item) => <span className={`text-xs tabular-nums ${item.early_leave_minutes > 0 ? 'font-semibold text-amber-700' : 'text-slate-400'}`}>{formatMinutes(item.early_leave_minutes)}</span>,
    },
    {
      key: 'work',
      header: 'Ishlangan',
      cell: (item) => <span className="text-xs tabular-nums text-slate-700">{formatMinutes(item.work_minutes)}</span>,
    },
  ]

  const departmentColumns: Column<DepartmentStat>[] = [
    {
      key: 'department',
      header: "Bo'lim",
      cell: (item) => (
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-sky-50 text-sky-700 ring-1 ring-sky-100"><Building2 className="h-4 w-4" /></span>
          <span className="text-xs font-semibold text-slate-800">{item.department_name}</span>
        </div>
      ),
    },
    {
      key: 'employees',
      header: 'Faol xodim',
      cell: (item) => <span className="text-xs tabular-nums text-slate-700">{formatNumber(item.employee_count)}</span>,
    },
    {
      key: 'present',
      header: 'Kelgan',
      cell: (item) => <span className="text-xs font-semibold tabular-nums text-emerald-700">{formatNumber(item.present)}</span>,
    },
    {
      key: 'late',
      header: 'Kechikkan',
      cell: (item) => <span className="text-xs font-semibold tabular-nums text-amber-700">{formatNumber(item.late)}</span>,
    },
    {
      key: 'absent',
      header: 'Kelmagan',
      cell: (item) => <span className="text-xs font-semibold tabular-nums text-red-600">{formatNumber(item.absent)}</span>,
    },
    {
      key: 'leave',
      header: "Ta'tilda",
      cell: (item) => <span className="text-xs tabular-nums text-sky-700">{formatNumber(item.on_leave)}</span>,
    },
    {
      key: 'rate',
      header: 'Davomat darajasi',
      cell: (item) => (
        <div className="flex min-w-[120px] items-center gap-2">
          <div className="h-1.5 w-20 overflow-hidden rounded-full bg-slate-100">
            <div className="h-full rounded-full bg-teal-500" style={{ width: `${Math.min(100, Math.max(0, item.attendance_rate))}%` }} />
          </div>
          <span className="text-[11px] font-bold tabular-nums text-slate-700">{item.attendance_rate}%</span>
        </div>
      ),
    },
  ]

  const leaveColumns: Column<LeaveReportItem>[] = [
    {
      key: 'employee',
      header: 'Xodim',
      cell: (item) => <span className="text-xs font-semibold text-slate-800">{item.employee || '—'}</span>,
    },
    {
      key: 'type',
      header: 'Turi',
      cell: (item) => <Badge tone="blue">{LEAVE_TYPE_LABELS[item.type] || item.type}</Badge>,
    },
    {
      key: 'period',
      header: 'Davr',
      cell: (item) => <span className="whitespace-nowrap text-xs tabular-nums text-slate-600">{formatDate(item.start)} — {formatDate(item.end)}</span>,
    },
    {
      key: 'days',
      header: 'Kun',
      cell: (item) => <span className="text-xs font-semibold tabular-nums text-slate-700">{item.days}</span>,
    },
    {
      key: 'status',
      header: 'Holat',
      cell: (item) => <Badge tone={(LEAVE_STATUS_TONES[item.status] as 'green' | 'red' | 'amber' | 'slate') || 'slate'}>{LEAVE_STATUS_LABELS[item.status] || item.status}</Badge>,
    },
  ]

  const attendanceData = attendanceQuery.data
  const departmentData = departmentReportQuery.data
  const leaveData = leavesQuery.data
  const canExport = can('report:export')
  const exportDisabled = tab === 'departments' || !validRange

  return (
    <div className="animate-in">
      <PageHeader
        eyebrow="Tahlil"
        title="Hisobotlar"
        description="Davomat, bo'limlar va ta'tillar bo'yicha real ma'lumotlar. Eksport fayllari serverda shakllantiriladi; natija limiti oshsa ogohlantirish ko'rsatiladi."
        actions={canExport ? (
          <div className="flex gap-2">
            <Button
              variant="secondary"
              icon={<FileSpreadsheet className="h-4 w-4" />}
              loading={exporting === 'excel'}
              disabled={exportDisabled || exporting !== null}
              onClick={() => void exportReport('excel')}
            >
              Excel
            </Button>
            <Button
              variant="secondary"
              icon={<FileText className="h-4 w-4" />}
              loading={exporting === 'pdf'}
              disabled={exportDisabled || exporting !== null}
              onClick={() => void exportReport('pdf')}
            >
              PDF
            </Button>
          </div>
        ) : undefined}
      />

      <Tabs
        className="mb-4"
        value={tab}
        onChange={changeTab}
        items={[
          { key: 'attendance', label: 'Davomat', icon: <CalendarDays className="h-3.5 w-3.5" />, count: attendanceData?.count },
          { key: 'departments', label: "Bo'limlar", icon: <Building2 className="h-3.5 w-3.5" />, count: departmentData?.length },
          { key: 'leaves', label: "Ta'tillar", icon: <UsersRound className="h-3.5 w-3.5" />, count: leaveData?.count },
        ]}
      />

      <div className="mb-4 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-end">
          <div className="flex flex-wrap items-center gap-1.5">
            <Button variant="ghost" size="sm" onClick={() => setPreset('today')}>Bugun</Button>
            <Button variant="ghost" size="sm" onClick={() => setPreset('week')}>7 kun</Button>
            <Button variant="ghost" size="sm" onClick={() => setPreset('month')}>30 kun</Button>
            <Button variant="ghost" size="sm" onClick={() => setPreset('this_month')}>Bu oy</Button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} className="w-[150px]" aria-label="Boshlanish sanasi" />
            <span className="text-xs text-slate-400">—</span>
            <Input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} className="w-[150px]" aria-label="Tugash sanasi" />
          </div>
          {tab === 'attendance' ? (
            <>
              <Select value={departmentId} onChange={(event) => setDepartmentId(event.target.value)} className="xl:w-52" aria-label="Bo'lim">
                <option value="">Barcha bo'limlar</option>
                {departmentsQuery.data?.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}
              </Select>
              <div className="w-full xl:w-56">
                <EmployeeCombobox value={employeeId} onChange={setEmployeeId} placeholder="Xodim bo'yicha…" />
              </div>
              <Select value={status} onChange={(event) => setStatus(event.target.value)} className="xl:w-44" aria-label="Holat">
                <option value="">Barcha holatlar</option>
                {Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </Select>
            </>
          ) : null}
        </div>
        {rangeError ? <p className="mt-2 text-xs font-medium text-red-600">{rangeError}</p> : null}
      </div>

      {!canExport ? (
        <Alert tone="info" className="mb-4">
          Excel/PDF eksport uchun <b>report:export</b> ruxsati kerak. Hisobot ma'lumotlari ekranda ko'rinadi.
        </Alert>
      ) : null}

      {tab === 'departments' && canExport ? (
        <Alert tone="info" className="mb-4">
          Bo'limlar hisoboti uchun serverda eksport endpointi mavjud emas; bu jadval faqat ekranda ko'rsatiladi.
        </Alert>
      ) : null}

      {tab === 'attendance' && validRange ? (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          {attendanceData?.truncated ? (
            <div className="border-b border-amber-200 bg-amber-50 px-4 py-2.5 text-[11px] text-amber-900">
              Natija {attendanceData.limit} qator bilan cheklandi. Aniqroq hisobot uchun davrni yoki filtrlarni qisqartiring.
            </div>
          ) : null}
          <DataTable
            columns={attendanceColumns}
            rows={attendanceData?.items}
            rowKey={(item) => item.id}
            loading={attendanceQuery.isLoading}
            error={attendanceQuery.error instanceof Error ? attendanceQuery.error.message : null}
            onRetry={() => void attendanceQuery.refetch()}
            emptyTitle="Davomat yozuvlari topilmadi"
            emptyDescription="Tanlangan davr va filtrlar bo'yicha ma'lumot yo'q."
            emptyIcon={<BarChart3 className="h-6 w-6" />}
            dense
            footer={attendanceData ? (
              <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
                <span>Jami: <b className="text-slate-800">{formatNumber(attendanceData.count)}</b> yozuv</span>
                <span>Davr: {formatDate(dateFrom)} — {formatDate(dateTo)}</span>
              </div>
            ) : null}
          />
        </div>
      ) : null}

      {tab === 'departments' && validRange ? (
        <div className="space-y-4">
          {departmentData?.length ? (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {departmentData.slice(0, 4).map((department) => (
                <div key={department.department_id} className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm">
                  <p className="truncate text-[11px] font-semibold uppercase tracking-wide text-slate-500">{department.department_name}</p>
                  <p className="mt-1 text-2xl font-black tabular-nums text-slate-900">{department.attendance_rate}%</p>
                  <p className="mt-0.5 text-[10px] text-slate-400">{formatNumber(department.employee_count)} faol xodim</p>
                </div>
              ))}
            </div>
          ) : null}
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <DataTable
              columns={departmentColumns}
              rows={departmentData}
              rowKey={(item) => item.department_id}
              loading={departmentReportQuery.isLoading}
              error={departmentReportQuery.error instanceof Error ? departmentReportQuery.error.message : null}
              onRetry={() => void departmentReportQuery.refetch()}
              emptyTitle="Bo'lim statistikasi topilmadi"
              emptyDescription="Tanlangan davrda bo'limlar bo'yicha davomat yozuvlari yo'q."
              emptyIcon={<Building2 className="h-6 w-6" />}
              dense
              footer={departmentData ? (
                <div className="text-[11px] text-slate-500">
                  Jami <b className="text-slate-800">{departmentData.length}</b> bo'lim · Davr: {formatDate(dateFrom)} — {formatDate(dateTo)}
                </div>
              ) : null}
            />
          </div>
        </div>
      ) : null}

      {tab === 'leaves' && validRange ? (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          {leaveData?.truncated ? (
            <div className="border-b border-amber-200 bg-amber-50 px-4 py-2.5 text-[11px] text-amber-900">
              Natija {leaveData.limit} qator bilan cheklandi. Davrni qisqartiring.
            </div>
          ) : null}
          <DataTable
            columns={leaveColumns}
            rows={leaveData?.items}
            rowKey={(item) => item.id}
            loading={leavesQuery.isLoading}
            error={leavesQuery.error instanceof Error ? leavesQuery.error.message : null}
            onRetry={() => void leavesQuery.refetch()}
            emptyTitle="Ta'til yozuvlari topilmadi"
            emptyDescription="Tanlangan davrda ta'til so'rovlari mavjud emas."
            emptyIcon={<CalendarDays className="h-6 w-6" />}
            dense
            footer={leaveData ? (
              <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
                <span>Jami: <b className="text-slate-800">{formatNumber(leaveData.count)}</b> ta'til</span>
                <span>Davr: {formatDate(dateFrom)} — {formatDate(dateTo)}</span>
              </div>
            ) : null}
          />
        </div>
      ) : null}

      {!validRange ? (
        <div className="mt-4">
          <EmptyState title="Sana oralig'i noto'g'ri" description="Tugash sanasini boshlanish sanasidan keyin tanlang." compact icon={<Download className="h-6 w-6" />} />
        </div>
      ) : null}
    </div>
  )
}
