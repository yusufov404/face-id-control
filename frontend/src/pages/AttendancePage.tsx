import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  CheckCircle2,
  Clock3,
  Eye,
  FileSpreadsheet,
  FileText,
  Pencil,
  RefreshCw,
} from 'lucide-react'
import { attendanceApi, departmentsApi, reportsApi, shiftsApi } from '@/api/services'
import type { AttendanceCorrection, AttendanceRecord, AttendanceCorrectionInput } from '@/api/types'
import { useAuth } from '@/auth/AuthProvider'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { ConfirmDialog, Modal } from '@/components/ui/Modal'
import { DataTable, Pagination, type Column } from '@/components/ui/DataTable'
import { Field, Input, Select, Textarea } from '@/components/ui/Field'
import { Alert } from '@/components/ui/Feedback'
import { FilterBar, InfoGrid, PageHeader, SearchInput } from '@/components/ui/LayoutBits'
import { Tabs } from '@/components/ui/Tabs'
import { useToast } from '@/components/ui/Toast'
import { useDebouncedValue, useDocumentTitle } from '@/lib/hooks'
import {
  addDaysISO,
  CORRECTION_TYPE_LABELS,
  formatDate,
  formatDateTime,
  formatDateTimeInput,
  formatMinutes,
  formatTime,
  parseTashkentDateTime,
  STATUS_LABELS,
  STATUS_TONES,
  todayISO,
} from '@/lib/format'
import {
  collectErrors,
  hasErrors,
  required,
  type ValidationErrors,
} from '@/lib/validation'

interface CorrectionForm {
  type: string
  checkIn: string
  checkOut: string
  status: string
  shiftId: string
  reason: string
}

function toLocalInput(value: string | null | undefined, recordDate: string, fallbackTime: string): string {
  if (!value) return `${recordDate}T${fallbackTime}`
  const formatted = formatDateTimeInput(value)
  return formatted || `${recordDate}T${fallbackTime}`
}

export default function AttendancePage() {
  const { can } = useAuth()
  const toast = useToast()
  const queryClient = useQueryClient()
  useDocumentTitle('Davomat')

  const [tab, setTab] = useState('records')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [search, setSearch] = useState('')
  const [dateFrom, setDateFrom] = useState(addDaysISO(-7))
  const [dateTo, setDateTo] = useState(todayISO())
  const [departmentId, setDepartmentId] = useState('')
  const [status, setStatus] = useState('')
  const [correctionPage, setCorrectionPage] = useState(1)
  const [correctionPageSize, setCorrectionPageSize] = useState(20)
  const [approvalFilter, setApprovalFilter] = useState('')
  const [viewTarget, setViewTarget] = useState<AttendanceRecord | null>(null)
  const [correctTarget, setCorrectTarget] = useState<AttendanceRecord | null>(null)
  const [recalcTarget, setRecalcTarget] = useState<AttendanceRecord | null>(null)
  const [approveTarget, setApproveTarget] = useState<AttendanceCorrection | null>(null)
  const [correctionForm, setCorrectionForm] = useState<CorrectionForm>({ type: 'check_in', checkIn: '', checkOut: '', status: 'present', shiftId: '', reason: '' })
  const [correctionErrors, setCorrectionErrors] = useState<ValidationErrors>({})
  const [correctionError, setCorrectionError] = useState('')
  const [exporting, setExporting] = useState<'excel' | 'pdf' | null>(null)

  const debouncedSearch = useDebouncedValue(search)

  const departmentsQuery = useQuery({ queryKey: ['departments', 'options'], queryFn: departmentsApi.options })
  const shiftsQuery = useQuery({
    queryKey: ['shifts', 'all'],
    queryFn: () => shiftsApi.list({ page: 1, page_size: 100, is_active: true }),
    enabled: Boolean(correctTarget),
  })

  const attendanceQuery = useQuery({
    queryKey: ['attendance', page, pageSize, debouncedSearch, dateFrom, dateTo, departmentId, status],
    queryFn: () => attendanceApi.list({
      page,
      page_size: pageSize,
      search: debouncedSearch || undefined,
      date_from: dateFrom || undefined,
      date_to: dateTo || undefined,
      department_id: departmentId || undefined,
      status: status || undefined,
    }),
  })

  const correctionsQuery = useQuery({
    queryKey: ['attendance-corrections', correctionPage, correctionPageSize, approvalFilter],
    queryFn: () => attendanceApi.corrections({
      page: correctionPage,
      page_size: correctionPageSize,
      is_approved: approvalFilter === '' ? undefined : approvalFilter === 'true',
    }),
    enabled: tab === 'corrections',
  })

  const correctionMutation = useMutation({
    mutationFn: () => {
      if (!correctTarget) throw new Error('Yozuv tanlanmagan')
      const payload: AttendanceCorrectionInput = {
        attendance_record_id: correctTarget.id,
        correction_type: correctionForm.type,
        field_name: '',
        reason: correctionForm.reason.trim(),
        employee_id: correctTarget.employee_id,
      }
      if (correctionForm.type === 'check_in') {
        payload.field_name = 'actual_check_in'
        payload.new_check_in = parseTashkentDateTime(correctionForm.checkIn)
      } else if (correctionForm.type === 'check_out') {
        payload.field_name = 'actual_check_out'
        payload.new_check_out = parseTashkentDateTime(correctionForm.checkOut)
      } else if (correctionForm.type === 'status') {
        payload.field_name = 'status'
        payload.new_value = correctionForm.status
      } else if (correctionForm.type === 'shift') {
        payload.field_name = 'shift_id'
        payload.new_value = correctionForm.shiftId
      } else if (correctionForm.type === 'full_day') {
        payload.field_name = 'full_day'
        payload.new_check_in = parseTashkentDateTime(correctionForm.checkIn)
        payload.new_check_out = parseTashkentDateTime(correctionForm.checkOut)
      }
      return attendanceApi.createCorrection(payload)
    },
    onSuccess: () => {
      toast.success("Tuzatish qo'llanildi va tasdiqlash uchun yuborildi")
      setCorrectTarget(null)
      void queryClient.invalidateQueries({ queryKey: ['attendance'] })
      void queryClient.invalidateQueries({ queryKey: ['attendance-corrections'] })
    },
    onError: (error) => setCorrectionError(error instanceof Error ? error.message : "Tuzatishni saqlab bo'lmadi"),
  })

  const recalcMutation = useMutation({
    mutationFn: (record: AttendanceRecord) => attendanceApi.recalculate(record.id),
    onSuccess: () => {
      toast.success('Davomat qayta hisoblandi')
      setRecalcTarget(null)
      void queryClient.invalidateQueries({ queryKey: ['attendance'] })
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Qayta hisoblab bo'lmadi"),
  })

  const approveMutation = useMutation({
    mutationFn: (correction: AttendanceCorrection) => attendanceApi.approveCorrection(correction.id),
    onSuccess: () => {
      toast.success('Tuzatish tasdiqlandi')
      setApproveTarget(null)
      void queryClient.invalidateQueries({ queryKey: ['attendance-corrections'] })
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Tuzatishni tasdiqlab bo'lmadi"),
  })

  function openCorrection(record: AttendanceRecord) {
    setCorrectTarget(record)
    setCorrectionForm({
      type: 'check_in',
      checkIn: toLocalInput(record.actual_check_in, record.record_date, record.scheduled_check_in ? record.scheduled_check_in.slice(0, 5) : '09:00'),
      checkOut: toLocalInput(record.actual_check_out, record.record_date, record.scheduled_check_out ? record.scheduled_check_out.slice(0, 5) : '18:00'),
      status: record.status,
      shiftId: record.shift_id ? String(record.shift_id) : '',
      reason: '',
    })
    setCorrectionErrors({})
    setCorrectionError('')
  }

  function submitCorrection(event: FormEvent) {
    event.preventDefault()
    const errors = collectErrors([
      ['reason', required(correctionForm.reason, 'Sabab') || (correctionForm.reason.trim().length < 3 ? "Sabab kamida 3 belgidan iborat bo'lishi kerak" : null)],
      ['checkIn', ['check_in', 'full_day'].includes(correctionForm.type) ? required(correctionForm.checkIn, 'Kirish vaqti') : null],
      ['checkOut', ['check_out', 'full_day'].includes(correctionForm.type) ? required(correctionForm.checkOut, 'Chiqish vaqti') : null],
      ['shiftId', correctionForm.type === 'shift' ? required(correctionForm.shiftId, 'Smena') : null],
      ['time_order', correctionForm.type === 'full_day' && correctionForm.checkIn && correctionForm.checkOut && correctionForm.checkOut <= correctionForm.checkIn ? 'Chiqish vaqti kirish vaqtidan keyin bo\'lishi kerak' : null],
    ])
    setCorrectionErrors(errors)
    setCorrectionError('')
    if (hasErrors(errors)) return
    correctionMutation.mutate()
  }

  async function exportReport(format: 'excel' | 'pdf') {
    setExporting(format)
    try {
      await reportsApi.downloadAttendance({
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
        department_id: departmentId || undefined,
        status: status || undefined,
      }, format)
      toast.success('Hisobot yuklandi')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Hisobotni yuklab bo'lmadi")
    } finally {
      setExporting(null)
    }
  }

  const recordColumns: Column<AttendanceRecord>[] = [
    {
      key: 'date',
      header: 'Sana',
      cell: (record) => <span className="whitespace-nowrap text-xs font-semibold tabular-nums text-slate-700">{formatDate(record.record_date)}</span>,
    },
    {
      key: 'employee',
      header: 'Xodim',
      cell: (record) => (
        <div className="min-w-0">
          <p className="max-w-[210px] truncate text-xs font-semibold text-slate-900">{record.employee_name || '—'}</p>
          <p className="mt-0.5 max-w-[210px] truncate text-[10px] text-slate-400">{record.department_name || "Bo'lim yo'q"}</p>
        </div>
      ),
    },
    {
      key: 'shift',
      header: 'Smena / jadval',
      cell: (record) => (
        <div className="text-xs">
          <p className="text-slate-700">{record.shift_name || '—'}</p>
          <p className="mt-0.5 text-[10px] tabular-nums text-slate-400">{formatTime(record.scheduled_check_in)} – {formatTime(record.scheduled_check_out)}</p>
        </div>
      ),
    },
    {
      key: 'actual',
      header: 'Amaldagi vaqt',
      cell: (record) => (
        <div className="text-xs tabular-nums">
          <p className="text-slate-700">{formatTime(record.actual_check_in)} – {formatTime(record.actual_check_out)}</p>
          <p className="mt-0.5 text-[10px] text-slate-400">Ishlangan: {formatMinutes(record.work_minutes)}</p>
        </div>
      ),
    },
    {
      key: 'delay',
      header: 'Kechikish',
      cell: (record) => (
        <div className="text-xs tabular-nums">
          <p className={record.late_minutes > 0 ? 'font-semibold text-amber-700' : 'text-slate-400'}>{formatMinutes(record.late_minutes)}</p>
          {record.overtime_minutes > 0 ? <p className="mt-0.5 text-[10px] text-emerald-600">+{formatMinutes(record.overtime_minutes)}</p> : null}
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Holat',
      cell: (record) => (
        <div className="flex flex-col items-start gap-1">
          <Badge tone={(STATUS_TONES[record.status] as 'green' | 'red' | 'amber' | 'blue' | 'violet' | 'slate' | 'teal') || 'slate'}>{STATUS_LABELS[record.status] || record.status}</Badge>
          {record.is_manual ? <span className="text-[9px] font-semibold uppercase tracking-wide text-violet-500">Qo'lda</span> : null}
        </div>
      ),
    },
    {
      key: 'actions',
      header: '',
      headerClassName: 'text-right',
      className: 'text-right',
      cell: (record) => (
        <div className="flex items-center justify-end gap-0.5">
          <button type="button" onClick={() => setViewTarget(record)} className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700" title="Ko'rish"><Eye className="h-4 w-4" /></button>
          {can('attendance:correct') ? (
            <button type="button" onClick={() => openCorrection(record)} className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-teal-700" title="Tuzatish"><Pencil className="h-4 w-4" /></button>
          ) : null}
          {can('attendance:correct') && !record.is_manual ? (
            <button type="button" onClick={() => setRecalcTarget(record)} className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-violet-700" title="Qayta hisoblash"><RefreshCw className="h-4 w-4" /></button>
          ) : null}
        </div>
      ),
    },
  ]

  const correctionColumns: Column<AttendanceCorrection>[] = [
    {
      key: 'created',
      header: 'Yaratilgan',
      cell: (correction) => <span className="whitespace-nowrap text-[11px] text-slate-600">{formatDateTime(correction.created_at)}</span>,
    },
    {
      key: 'employee',
      header: 'Xodim',
      cell: (correction) => <span className="text-xs font-semibold text-slate-800">{correction.employee_name || `Xodim #${correction.employee_id}`}</span>,
    },
    {
      key: 'type',
      header: 'Turi',
      cell: (correction) => <Badge tone="blue">{CORRECTION_TYPE_LABELS[correction.correction_type] || correction.correction_type}</Badge>,
    },
    {
      key: 'values',
      header: "O'zgarish",
      cell: (correction) => (
        <div className="max-w-[280px] text-[11px]">
          <p className="truncate text-slate-400">Eski: {correction.old_value || '—'}</p>
          <p className="mt-0.5 truncate font-medium text-slate-700">Yangi: {correction.new_value || '—'}</p>
        </div>
      ),
    },
    {
      key: 'reason',
      header: 'Sabab',
      cell: (correction) => <span className="line-clamp-2 max-w-[260px] text-[11px] text-slate-600">{correction.reason}</span>,
    },
    {
      key: 'status',
      header: 'Tasdiq',
      cell: (correction) => correction.is_approved ? <Badge tone="green">Tasdiqlangan</Badge> : <Badge tone="amber">Kutilmoqda</Badge>,
    },
    {
      key: 'actions',
      header: '',
      headerClassName: 'text-right',
      className: 'text-right',
      cell: (correction) => can('attendance:correct_all') && !correction.is_approved ? (
        <button type="button" onClick={() => setApproveTarget(correction)} className="rounded p-1.5 text-slate-400 hover:bg-emerald-50 hover:text-emerald-700" title="Tasdiqlash"><CheckCircle2 className="h-4 w-4" /></button>
      ) : <span className="text-[10px] text-slate-400">{correction.corrector_name || '—'}</span>,
    },
  ]

  return (
    <div className="animate-in">
      <PageHeader
        eyebrow="Davomat"
        title="Davomat yozuvlari"
        description="Kunlik davomat, kechikishlar va qo'lda tuzatishlar. Tuzatish darhol qo'llanadi, tasdiqlash esa audit uchun alohida qayd etiladi."
        actions={(
          <div className="flex flex-wrap gap-2">
            {can('report:view') && can('report:export') ? (
              <>
                <Button variant="secondary" size="sm" icon={<FileSpreadsheet className="h-4 w-4" />} loading={exporting === 'excel'} onClick={() => void exportReport('excel')}>Excel</Button>
                <Button variant="secondary" size="sm" icon={<FileText className="h-4 w-4" />} loading={exporting === 'pdf'} onClick={() => void exportReport('pdf')}>PDF</Button>
              </>
            ) : null}
            <Button variant="secondary" icon={<RefreshCw className="h-4 w-4" />} onClick={() => { void attendanceQuery.refetch(); void correctionsQuery.refetch() }} loading={attendanceQuery.isFetching}>Yangilash</Button>
          </div>
        )}
      />

      <Tabs
        className="mb-4"
        value={tab}
        onChange={(value) => { setTab(value); setPage(1); setCorrectionPage(1) }}
        items={[
          { key: 'records', label: 'Yozuvlar', icon: <Clock3 className="h-3.5 w-3.5" />, count: attendanceQuery.data?.total },
          { key: 'corrections', label: 'Tuzatishlar', icon: <Pencil className="h-3.5 w-3.5" />, count: correctionsQuery.data?.total },
        ]}
      />

      {tab === 'records' ? (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <FilterBar>
            <SearchInput value={search} onChange={(value) => { setSearch(value); setPage(1) }} placeholder="Xodim F.I.Sh. yoki ichki ID…" className="lg:w-64" />
            <div className="flex items-center gap-1.5">
              <Input type="date" value={dateFrom} onChange={(event) => { setDateFrom(event.target.value); setPage(1) }} className="w-[145px]" aria-label="Boshlanish sanasi" />
              <span className="text-[11px] text-slate-400">—</span>
              <Input type="date" value={dateTo} onChange={(event) => { setDateTo(event.target.value); setPage(1) }} className="w-[145px]" aria-label="Tugash sanasi" />
            </div>
            <Select value={departmentId} onChange={(event) => { setDepartmentId(event.target.value); setPage(1) }} className="lg:w-52" aria-label="Bo'lim">
              <option value="">Barcha bo'limlar</option>
              {departmentsQuery.data?.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}
            </Select>
            <Select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1) }} className="lg:w-44" aria-label="Holat">
              <option value="">Barcha holatlar</option>
              {Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </Select>
            <div className="flex-1" />
            <span className="text-[11px] text-slate-400">{attendanceQuery.data ? `${attendanceQuery.data.total} ta yozuv` : ''}</span>
          </FilterBar>
          <DataTable
            columns={recordColumns}
            rows={attendanceQuery.data?.items}
            rowKey={(record) => record.id}
            loading={attendanceQuery.isLoading}
            error={attendanceQuery.error instanceof Error ? attendanceQuery.error.message : null}
            onRetry={() => void attendanceQuery.refetch()}
            emptyTitle="Davomat yozuvlari topilmadi"
            emptyDescription="Tanlangan davr va filtrlar bo'yicha yozuv yo'q. Face ID hodisalari kelgach yozuvlar avtomatik hisoblanadi."
            emptyIcon={<Clock3 className="h-6 w-6" />}
            footer={attendanceQuery.data ? (
              <Pagination
                page={attendanceQuery.data.page}
                pages={attendanceQuery.data.pages}
                total={attendanceQuery.data.total}
                pageSize={attendanceQuery.data.page_size}
                onPageChange={setPage}
                onPageSizeChange={(size) => { setPageSize(size); setPage(1) }}
                loading={attendanceQuery.isFetching}
              />
            ) : null}
          />
        </div>
      ) : null}

      {tab === 'corrections' ? (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <FilterBar>
            <Select value={approvalFilter} onChange={(event) => { setApprovalFilter(event.target.value); setCorrectionPage(1) }} className="lg:w-52" aria-label="Tasdiqlash holati">
              <option value="">Barcha tuzatishlar</option>
              <option value="false">Tasdiqlanmagan</option>
              <option value="true">Tasdiqlangan</option>
            </Select>
            <div className="flex-1" />
            <span className="text-[11px] text-slate-400">{correctionsQuery.data ? `${correctionsQuery.data.total} ta tuzatish` : ''}</span>
          </FilterBar>
          <DataTable
            columns={correctionColumns}
            rows={correctionsQuery.data?.items}
            rowKey={(correction) => correction.id}
            loading={correctionsQuery.isLoading}
            error={correctionsQuery.error instanceof Error ? correctionsQuery.error.message : null}
            onRetry={() => void correctionsQuery.refetch()}
            emptyTitle="Tuzatishlar yo'q"
            emptyDescription="Davomat yozuvidagi qalam belgisi orqali tuzatish kiriting."
            emptyIcon={<Pencil className="h-6 w-6" />}
            footer={correctionsQuery.data ? (
              <Pagination
                page={correctionsQuery.data.page}
                pages={correctionsQuery.data.pages}
                total={correctionsQuery.data.total}
                pageSize={correctionsQuery.data.page_size}
                onPageChange={setCorrectionPage}
                onPageSizeChange={(size) => { setCorrectionPageSize(size); setCorrectionPage(1) }}
                loading={correctionsQuery.isFetching}
              />
            ) : null}
          />
        </div>
      ) : null}

      <Modal
        open={Boolean(viewTarget)}
        onClose={() => setViewTarget(null)}
        title="Davomat yozuvi"
        description={viewTarget ? `${viewTarget.employee_name || 'Xodim'} · ${formatDate(viewTarget.record_date)}` : undefined}
        size="lg"
        footer={<Button variant="secondary" onClick={() => setViewTarget(null)}>Yopish</Button>}
      >
        {viewTarget ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={(STATUS_TONES[viewTarget.status] as 'green' | 'red' | 'amber' | 'blue' | 'violet' | 'slate') || 'slate'}>{STATUS_LABELS[viewTarget.status] || viewTarget.status}</Badge>
              {viewTarget.is_manual ? <Badge tone="violet">Qo'lda tuzatilgan</Badge> : null}
              {viewTarget.is_confirmed ? <Badge tone="green">Tasdiqlangan</Badge> : <Badge tone="amber">Tasdiqlanmagan</Badge>}
            </div>
            <InfoGrid
              columns={3}
              items={[
                { label: 'Xodim', value: viewTarget.employee_name || '—' },
                { label: "Bo'lim", value: viewTarget.department_name || '—' },
                { label: 'Smena', value: viewTarget.shift_name || '—' },
                { label: 'Rejadagi kirish', value: formatTime(viewTarget.scheduled_check_in) },
                { label: 'Rejadagi chiqish', value: formatTime(viewTarget.scheduled_check_out) },
                { label: 'Ishlangan', value: formatMinutes(viewTarget.work_minutes) },
                { label: 'Amaldagi kirish', value: formatDateTime(viewTarget.actual_check_in) },
                { label: 'Amaldagi chiqish', value: formatDateTime(viewTarget.actual_check_out) },
                { label: 'Kechikish', value: formatMinutes(viewTarget.late_minutes) },
                { label: 'Erta ketish', value: formatMinutes(viewTarget.early_leave_minutes) },
                { label: 'Qo‘shimcha ish', value: formatMinutes(viewTarget.overtime_minutes) },
                { label: 'Tanaffus', value: formatMinutes(viewTarget.break_minutes) },
              ]}
            />
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Izoh</p>
              <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{viewTarget.notes || '—'}</p>
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={Boolean(correctTarget)}
        onClose={() => setCorrectTarget(null)}
        title="Davomatni tuzatish"
        description={correctTarget ? `${correctTarget.employee_name || 'Xodim'} · ${formatDate(correctTarget.record_date)}. Tuzatish darhol qo'llanadi va audit jurnaliga yoziladi.` : undefined}
        size="lg"
        footer={(
          <>
            <Button variant="secondary" onClick={() => setCorrectTarget(null)} disabled={correctionMutation.isPending}>Bekor qilish</Button>
            <Button variant="primary" onClick={() => document.getElementById('correction-form')?.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }))} loading={correctionMutation.isPending}>Tuzatishni saqlash</Button>
          </>
        )}
      >
        <form id="correction-form" onSubmit={submitCorrection} className="space-y-4" noValidate>
          {correctionError ? <Alert tone="danger">{correctionError}</Alert> : null}
          <Alert tone="warning">
            Tuzatish yozuvni qo'lda tasdiqlangan holatga o'tkazadi. Face ID xom hodisalari o'zgartirilmaydi.
          </Alert>
          <Field label="Tuzatish turi" htmlFor="correction_type" required>
            <Select id="correction_type" value={correctionForm.type} onChange={(event) => setCorrectionForm({ ...correctionForm, type: event.target.value })}>
              {Object.entries(CORRECTION_TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </Select>
          </Field>
          {correctionForm.type === 'check_in' || correctionForm.type === 'full_day' ? (
            <Field label="Yangi kirish vaqti" htmlFor="correction_check_in" required error={correctionErrors.checkIn}>
              <Input id="correction_check_in" type="datetime-local" value={correctionForm.checkIn} onChange={(event) => setCorrectionForm({ ...correctionForm, checkIn: event.target.value })} invalid={Boolean(correctionErrors.checkIn)} />
            </Field>
          ) : null}
          {correctionForm.type === 'check_out' || correctionForm.type === 'full_day' ? (
            <Field label="Yangi chiqish vaqti" htmlFor="correction_check_out" required error={correctionErrors.checkOut || correctionErrors.time_order}>
              <Input id="correction_check_out" type="datetime-local" value={correctionForm.checkOut} onChange={(event) => setCorrectionForm({ ...correctionForm, checkOut: event.target.value })} invalid={Boolean(correctionErrors.checkOut || correctionErrors.time_order)} />
            </Field>
          ) : null}
          {correctionForm.type === 'status' ? (
            <Field label="Yangi holat" htmlFor="correction_status" required>
              <Select id="correction_status" value={correctionForm.status} onChange={(event) => setCorrectionForm({ ...correctionForm, status: event.target.value })}>
                {Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </Select>
            </Field>
          ) : null}
          {correctionForm.type === 'shift' ? (
            <Field label="Yangi smena" htmlFor="correction_shift" required error={correctionErrors.shiftId}>
              <Select id="correction_shift" value={correctionForm.shiftId} onChange={(event) => setCorrectionForm({ ...correctionForm, shiftId: event.target.value })} invalid={Boolean(correctionErrors.shiftId)}>
                <option value="">Smenani tanlang</option>
                {shiftsQuery.data?.items.map((shift) => <option key={shift.id} value={shift.id}>{shift.name} ({formatTime(shift.start_time)}–{formatTime(shift.end_time)})</option>)}
              </Select>
            </Field>
          ) : null}
          <Field label="Sabab" htmlFor="correction_reason" required error={correctionErrors.reason} hint="Audit jurnalida saqlanadi; aniq va qisqa yozing">
            <Textarea id="correction_reason" value={correctionForm.reason} onChange={(event) => setCorrectionForm({ ...correctionForm, reason: event.target.value })} invalid={Boolean(correctionErrors.reason)} placeholder="Masalan: qurilma nosozligi sababli kirish vaqti qo'lda kiritildi" />
          </Field>
        </form>
      </Modal>

      <ConfirmDialog
        open={Boolean(recalcTarget)}
        title="Davomatni qayta hisoblash"
        message={recalcTarget ? <><strong>{recalcTarget.employee_name}</strong> uchun {formatDate(recalcTarget.record_date)} yozuvi smena va qurilma hodisalari asosida qayta hisoblanadi. Qo'lda tuzatilgan yozuvlar qayta hisoblanmaydi.</> : ''}
        confirmLabel="Qayta hisoblash"
        loading={recalcMutation.isPending}
        onConfirm={() => recalcTarget && recalcMutation.mutate(recalcTarget)}
        onClose={() => setRecalcTarget(null)}
      />

      <ConfirmDialog
        open={Boolean(approveTarget)}
        title="Tuzatishni tasdiqlash"
        message={approveTarget ? <><strong>{approveTarget.employee_name}</strong> uchun tuzatishni tasdiqlaysizmi? Tasdiqlash audit jurnalida alohida qayd etiladi.</> : ''}
        confirmLabel="Tasdiqlash"
        loading={approveMutation.isPending}
        onConfirm={() => approveTarget && approveMutation.mutate(approveTarget)}
        onClose={() => setApproveTarget(null)}
      />
    </div>
  )
}
