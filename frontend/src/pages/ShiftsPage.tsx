import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  CalendarClock,
  CalendarDays,
  FileUp,
  Pencil,
  Plus,
  Trash2,
  UserPlus,
} from 'lucide-react'
import { assignmentsApi, shiftsApi } from '@/api/services'
import type { Shift, ShiftAssignment, ShiftAssignmentInput, ShiftCreateInput, ShiftUpdateInput } from '@/api/types'
import { useAuth } from '@/auth/AuthProvider'
import { EmployeeCombobox } from '@/components/forms/EmployeeCombobox'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { ConfirmDialog, Modal } from '@/components/ui/Modal'
import { DataTable, Pagination, type Column } from '@/components/ui/DataTable'
import { Checkbox, Field, Input, Select, Textarea } from '@/components/ui/Field'
import { Alert } from '@/components/ui/Feedback'
import { FilterBar, PageHeader, SearchInput } from '@/components/ui/LayoutBits'
import { Tabs } from '@/components/ui/Tabs'
import { useToast } from '@/components/ui/Toast'
import { useDebouncedValue, useDocumentTitle } from '@/lib/hooks'
import {
  formatDate,
  formatTime,
  SHIFT_TYPE_LABELS,
  todayISO,
  WEEKDAYS,
} from '@/lib/format'
import {
  collectErrors,
  dateOrderError,
  hasErrors,
  nullableText,
  required,
  type ValidationErrors,
} from '@/lib/validation'

interface ShiftForm {
  name: string
  code: string
  description: string
  shift_type: string
  start_time: string
  end_time: string
  break_start: string
  break_end: string
  break_duration: string
  late_threshold: string
  early_leave_threshold: string
  min_work_minutes: string
  overtime_enabled: boolean
  overtime_start_after: string
  max_overtime_minutes: string
  applicable_days: string[]
  is_active: boolean
}

const emptyShiftForm = (): ShiftForm => ({
  name: '',
  code: '',
  description: '',
  shift_type: 'fixed',
  start_time: '09:00',
  end_time: '18:00',
  break_start: '',
  break_end: '',
  break_duration: '0',
  late_threshold: '15',
  early_leave_threshold: '15',
  min_work_minutes: '480',
  overtime_enabled: false,
  overtime_start_after: '0',
  max_overtime_minutes: '',
  applicable_days: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
  is_active: true,
})

function fromShift(shift: Shift): ShiftForm {
  return {
    name: shift.name,
    code: shift.code,
    description: shift.description || '',
    shift_type: shift.shift_type,
    start_time: shift.start_time.slice(0, 5),
    end_time: shift.end_time.slice(0, 5),
    break_start: shift.break_start ? shift.break_start.slice(0, 5) : '',
    break_end: shift.break_end ? shift.break_end.slice(0, 5) : '',
    break_duration: String(shift.break_duration),
    late_threshold: String(shift.late_threshold),
    early_leave_threshold: String(shift.early_leave_threshold),
    min_work_minutes: String(shift.min_work_minutes),
    overtime_enabled: shift.overtime_enabled,
    overtime_start_after: String(shift.overtime_start_after),
    max_overtime_minutes: shift.max_overtime_minutes === null || shift.max_overtime_minutes === undefined ? '' : String(shift.max_overtime_minutes),
    applicable_days: shift.applicable_days || [],
    is_active: shift.is_active,
  }
}

export default function ShiftsPage() {
  const { can } = useAuth()
  const toast = useToast()
  const queryClient = useQueryClient()
  useDocumentTitle('Smenalar')

  const [tab, setTab] = useState('shifts')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [search, setSearch] = useState('')
  const [activeFilter, setActiveFilter] = useState('')
  const [mode, setMode] = useState<'create' | 'edit' | null>(null)
  const [selected, setSelected] = useState<Shift | null>(null)
  const [form, setForm] = useState<ShiftForm>(emptyShiftForm())
  const [errors, setErrors] = useState<ValidationErrors>({})
  const [formError, setFormError] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<Shift | null>(null)

  const [assignmentPage, setAssignmentPage] = useState(1)
  const [assignmentEmployeeId, setAssignmentEmployeeId] = useState<number | null>(null)
  const [assignmentShiftId, setAssignmentShiftId] = useState('')
  const [assignmentOpen, setAssignmentOpen] = useState(false)
  const [assignmentForm, setAssignmentForm] = useState({
    employee_id: null as number | null,
    shift_id: '',
    start_date: todayISO(),
    end_date: '',
    priority: '0',
    is_active: true,
    custom_start_time: '',
    custom_end_time: '',
  })
  const [assignmentErrors, setAssignmentErrors] = useState<ValidationErrors>({})
  const [assignmentError, setAssignmentError] = useState('')
  const [importOpen, setImportOpen] = useState(false)
  const [importFile, setImportFile] = useState<File | null>(null)
  const [importMonth, setImportMonth] = useState(10)
  const [importYear, setImportYear] = useState(2026)
  const [importing, setImporting] = useState(false)

  const debouncedSearch = useDebouncedValue(search)

  const shiftsQuery = useQuery({
    queryKey: ['shifts', page, pageSize, debouncedSearch, activeFilter],
    queryFn: () => shiftsApi.list({
      page,
      page_size: pageSize,
      search: debouncedSearch || undefined,
      is_active: activeFilter === '' ? undefined : activeFilter === 'true',
    }),
  })
  const shiftOptionsQuery = useQuery({
    queryKey: ['shifts', 'options'],
    queryFn: () => shiftsApi.list({ page: 1, page_size: 100, is_active: true }),
  })
  const assignmentsQuery = useQuery({
    queryKey: ['shift-assignments', assignmentPage, assignmentEmployeeId, assignmentShiftId],
    queryFn: () => assignmentsApi.list({
      page: assignmentPage,
      page_size: 20,
      employee_id: assignmentEmployeeId || undefined,
      shift_id: assignmentShiftId || undefined,
    }),
    enabled: tab === 'assignments',
  })

  const saveMutation = useMutation({
    mutationFn: async () => {
      const base = {
        name: form.name.trim(),
        code: form.code.trim(),
        description: nullableText(form.description),
        shift_type: form.shift_type,
        start_time: form.start_time,
        end_time: form.end_time,
        crosses_midnight: form.end_time <= form.start_time,
        break_start: form.break_start || null,
        break_end: form.break_end || null,
        break_duration: Number(form.break_duration) || 0,
        late_threshold: Number(form.late_threshold) || 0,
        early_leave_threshold: Number(form.early_leave_threshold) || 0,
        min_work_minutes: Number(form.min_work_minutes) || 0,
        overtime_enabled: form.overtime_enabled,
        overtime_start_after: Number(form.overtime_start_after) || 0,
        max_overtime_minutes: form.max_overtime_minutes ? Number(form.max_overtime_minutes) : null,
        applicable_days: form.applicable_days,
        is_active: form.is_active,
      }
      if (mode === 'create') {
        const payload: ShiftCreateInput = base
        return shiftsApi.create(payload)
      }
      if (mode === 'edit' && selected) {
        const payload: ShiftUpdateInput = base
        return shiftsApi.update(selected.id, payload)
      }
      throw new Error('Amal aniqlanmadi')
    },
    onSuccess: () => {
      toast.success(mode === 'create' ? "Smena qo'shildi" : 'Smena yangilandi')
      setMode(null)
      setSelected(null)
      setFormError('')
      void queryClient.invalidateQueries({ queryKey: ['shifts'] })
    },
    onError: (error) => setFormError(error instanceof Error ? error.message : "Smenani saqlab bo'lmadi"),
  })

  const deleteMutation = useMutation({
    mutationFn: (shift: Shift) => shiftsApi.remove(shift.id),
    onSuccess: (response) => {
      toast.success(response.detail)
      setDeleteTarget(null)
      void queryClient.invalidateQueries({ queryKey: ['shifts'] })
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Smenani o'chirib bo'lmadi"),
  })

  const assignmentMutation = useMutation({
    mutationFn: () => {
      const payload: ShiftAssignmentInput = {
        employee_id: assignmentForm.employee_id as number,
        shift_id: Number(assignmentForm.shift_id),
        start_date: assignmentForm.start_date,
        end_date: assignmentForm.end_date || null,
        priority: Number(assignmentForm.priority) || 0,
        is_active: assignmentForm.is_active,
        custom_start_time: assignmentForm.custom_start_time || null,
        custom_end_time: assignmentForm.custom_end_time || null,
      }
      return assignmentsApi.create(payload)
    },
    onSuccess: () => {
      toast.success("Smena xodimga biriktirildi")
      setAssignmentOpen(false)
      void queryClient.invalidateQueries({ queryKey: ['shift-assignments'] })
    },
    onError: (error) => setAssignmentError(error instanceof Error ? error.message : "Biriktirishni saqlab bo'lmadi"),
  })

  function openCreate() {
    setForm(emptyShiftForm())
    setSelected(null)
    setErrors({})
    setFormError('')
    setMode('create')
  }

  function openEdit(shift: Shift) {
    setForm(fromShift(shift))
    setSelected(shift)
    setErrors({})
    setFormError('')
    setMode('edit')
  }

  function openAssignment() {
    setAssignmentForm({
      employee_id: null,
      shift_id: shiftOptionsQuery.data?.items[0]?.id ? String(shiftOptionsQuery.data.items[0].id) : '',
      start_date: todayISO(),
      end_date: '',
      priority: '0',
      is_active: true,
      custom_start_time: '',
      custom_end_time: '',
    })
    setAssignmentErrors({})
    setAssignmentError('')
    setAssignmentOpen(true)
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    const nextErrors = collectErrors([
      ['name', required(form.name, 'Nomi')],
      ['code', required(form.code, 'Kod')],
      ['code_pattern', form.code && !/^[A-Za-z0-9_-]+$/.test(form.code) ? "Kod faqat harf, raqam, _ va - belgilaridan iborat bo'lishi kerak" : null],
      ['start_time', required(form.start_time, 'Boshlanish vaqti')],
      ['end_time', required(form.end_time, 'Tugash vaqti')],
      ['break_order', form.break_start && form.break_end && form.break_end <= form.break_start ? "Tanaffus tugashi boshlanishidan keyin bo'lishi kerak" : null],
      ['min_work', Number(form.min_work_minutes) >= 0 ? null : "Minimal ish vaqti manfiy bo'lishi mumkin emas"],
    ])
    setErrors(nextErrors)
    setFormError('')
    if (hasErrors(nextErrors)) return
    saveMutation.mutate()
  }

  function submitAssignment(event: FormEvent) {
    event.preventDefault()
    const nextErrors = collectErrors([
      ['employee_id', assignmentForm.employee_id ? null : 'Xodimni tanlang'],
      ['shift_id', required(assignmentForm.shift_id, 'Smena')],
      ['start_date', required(assignmentForm.start_date, 'Boshlanish sanasi')],
      ['end_date', dateOrderError(assignmentForm.start_date, assignmentForm.end_date)],
      ['time_order', assignmentForm.custom_start_time && assignmentForm.custom_end_time && assignmentForm.custom_end_time <= assignmentForm.custom_start_time ? "Maxsus tugash vaqti boshlanishdan keyin bo'lishi kerak" : null],
    ])
    setAssignmentErrors(nextErrors)
    setAssignmentError('')
    if (hasErrors(nextErrors)) return
    assignmentMutation.mutate()
  }

  const shiftColumns: Column<Shift>[] = [
    {
      key: 'name',
      header: 'Smena',
      cell: (shift) => (
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-sky-50 text-sky-700 ring-1 ring-sky-100"><CalendarClock className="h-4 w-4" /></span>
          <div>
            <p className="text-xs font-semibold text-slate-900">{shift.name}</p>
            <p className="mt-0.5 font-mono text-[10px] text-slate-400">{shift.code}</p>
          </div>
        </div>
      ),
    },
    {
      key: 'time',
      header: 'Vaqt',
      cell: (shift) => (
        <div className="text-xs tabular-nums">
          <p className="font-medium text-slate-700">{formatTime(shift.start_time)} – {formatTime(shift.end_time)}</p>
          <p className="mt-0.5 text-[10px] text-slate-400">{shift.crosses_midnight ? 'Tungi (keyingi kun)' : 'Kunduzgi'} · {SHIFT_TYPE_LABELS[shift.shift_type] || shift.shift_type}</p>
        </div>
      ),
    },
    {
      key: 'break',
      header: 'Tanaffus',
      cell: (shift) => <span className="text-xs tabular-nums text-slate-600">{shift.break_start ? `${formatTime(shift.break_start)}–${formatTime(shift.break_end)}` : `${shift.break_duration} daq`}</span>,
    },
    {
      key: 'thresholds',
      header: "Kechikish / erta",
      cell: (shift) => <span className="text-xs tabular-nums text-slate-600">{shift.late_threshold} / {shift.early_leave_threshold} daq</span>,
    },
    {
      key: 'days',
      header: 'Ish kunlari',
      cell: (shift) => (
        <div className="flex max-w-[190px] flex-wrap gap-1">
          {shift.applicable_days.length ? shift.applicable_days.map((day) => <Badge key={day} tone="slate">{WEEKDAYS.find((item) => item.value === day)?.label.slice(0, 2) || day}</Badge>) : <span className="text-[11px] text-slate-400">Har kuni</span>}
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Holat',
      cell: (shift) => <Badge tone={shift.is_active ? 'green' : 'slate'}>{shift.is_active ? 'Faol' : 'Nofaol'}</Badge>,
    },
    {
      key: 'actions',
      header: '',
      headerClassName: 'text-right',
      className: 'text-right',
      cell: (shift) => (
        <div className="flex items-center justify-end gap-0.5">
          {can('shift:update') ? <button type="button" onClick={() => openEdit(shift)} className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-teal-700" title="Tahrirlash"><Pencil className="h-4 w-4" /></button> : null}
          {can('shift:delete') ? <button type="button" onClick={() => setDeleteTarget(shift)} className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600" title="O'chirish"><Trash2 className="h-4 w-4" /></button> : null}
        </div>
      ),
    },
  ]

  const assignmentColumns: Column<ShiftAssignment>[] = [
    {
      key: 'employee',
      header: 'Xodim',
      cell: (assignment) => <span className="text-xs font-semibold text-slate-800">{assignment.employee_name || `Xodim #${assignment.employee_id}`}</span>,
    },
    {
      key: 'shift',
      header: 'Smena',
      cell: (assignment) => (
        <div className="text-xs">
          <p className="font-medium text-slate-700">{assignment.shift_name || `Smena #${assignment.shift_id}`}</p>
          <p className="mt-0.5 text-[10px] text-slate-400">{assignment.custom_start_time ? `${formatTime(assignment.custom_start_time)}–${formatTime(assignment.custom_end_time)}` : 'Smena jadvali bo‘yicha'}</p>
        </div>
      ),
    },
    {
      key: 'period',
      header: 'Davr',
      cell: (assignment) => <span className="whitespace-nowrap text-xs tabular-nums text-slate-600">{formatDate(assignment.start_date)} — {assignment.end_date ? formatDate(assignment.end_date) : 'doimiy'}</span>,
    },
    {
      key: 'priority',
      header: 'Prioritet',
      cell: (assignment) => <span className="text-xs tabular-nums text-slate-600">{assignment.priority}</span>,
    },
    {
      key: 'status',
      header: 'Holat',
      cell: (assignment) => <Badge tone={assignment.is_active ? 'green' : 'slate'}>{assignment.is_active ? 'Faol' : 'Nofaol'}</Badge>,
    },
  ]

  return (
    <div className="animate-in">
      <PageHeader
        eyebrow="Davomat"
        title="Smenalar va biriktirishlar"
        description="Ish jadvallari, kechikish chegaralari va xodimlarni smenaga biriktirish. Biriktirishlar serverdagi davomat hisobida ishlatiladi."
        actions={
          <div className="flex items-center gap-2">
            {tab === 'shifts' && can('shift:create') ? <Button variant="secondary" icon={<FileUp className="h-4 w-4" />} onClick={() => setImportOpen(true)}>Grafik import qilish</Button> : null}
            {tab === 'shifts' && can('shift:create') ? <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={openCreate}>Yangi smena</Button> : null}
            {tab === 'assignments' && can('shift:assign') ? <Button variant="primary" icon={<UserPlus className="h-4 w-4" />} onClick={openAssignment}>Smenaga biriktirish</Button> : null}
          </div>
        }
      />

      <Tabs
        className="mb-4"
        value={tab}
        onChange={(value) => { setTab(value); setPage(1); setAssignmentPage(1) }}
        items={[
          { key: 'shifts', label: 'Smenalar', icon: <CalendarClock className="h-3.5 w-3.5" />, count: shiftsQuery.data?.total },
          { key: 'assignments', label: 'Biriktirishlar', icon: <CalendarDays className="h-3.5 w-3.5" />, count: assignmentsQuery.data?.total },
        ]}
      />

      {tab === 'shifts' ? (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <FilterBar>
            <SearchInput value={search} onChange={(value) => { setSearch(value); setPage(1) }} placeholder="Smena nomi yoki kodi…" className="lg:w-72" />
            <Select value={activeFilter} onChange={(event) => { setActiveFilter(event.target.value); setPage(1) }} className="lg:w-44" aria-label="Faollik">
              <option value="">Barcha smenalar</option>
              <option value="true">Faqat faol</option>
              <option value="false">Faqat nofaol</option>
            </Select>
            <div className="flex-1" />
            <span className="text-[11px] text-slate-400">{shiftsQuery.data ? `${shiftsQuery.data.total} ta smena` : ''}</span>
          </FilterBar>
          <DataTable
            columns={shiftColumns}
            rows={shiftsQuery.data?.items}
            rowKey={(shift) => shift.id}
            loading={shiftsQuery.isLoading}
            error={shiftsQuery.error instanceof Error ? shiftsQuery.error.message : null}
            onRetry={() => void shiftsQuery.refetch()}
            emptyTitle="Smenalar topilmadi"
            emptyDescription="Yangi smena yaratib, unga ish vaqti va kechikish chegaralarini belgilang."
            emptyIcon={<CalendarClock className="h-6 w-6" />}
            footer={shiftsQuery.data ? (
              <Pagination
                page={shiftsQuery.data.page}
                pages={shiftsQuery.data.pages}
                total={shiftsQuery.data.total}
                pageSize={shiftsQuery.data.page_size}
                onPageChange={setPage}
                onPageSizeChange={(size) => { setPageSize(size); setPage(1) }}
                loading={shiftsQuery.isFetching}
              />
            ) : null}
          />
        </div>
      ) : null}

      {tab === 'assignments' ? (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <FilterBar>
            <div className="w-full lg:w-64">
              <EmployeeCombobox value={assignmentEmployeeId} onChange={(id) => { setAssignmentEmployeeId(id); setAssignmentPage(1) }} placeholder="Xodim bo'yicha filtr…" />
            </div>
            <Select value={assignmentShiftId} onChange={(event) => { setAssignmentShiftId(event.target.value); setAssignmentPage(1) }} className="lg:w-56" aria-label="Smena">
              <option value="">Barcha smenalar</option>
              {shiftOptionsQuery.data?.items.map((shift) => <option key={shift.id} value={shift.id}>{shift.name}</option>)}
            </Select>
            <div className="flex-1" />
            <span className="text-[11px] text-slate-400">{assignmentsQuery.data ? `${assignmentsQuery.data.total} ta biriktirish` : ''}</span>
          </FilterBar>
          <DataTable
            columns={assignmentColumns}
            rows={assignmentsQuery.data?.items}
            rowKey={(assignment) => assignment.id}
            loading={assignmentsQuery.isLoading}
            error={assignmentsQuery.error instanceof Error ? assignmentsQuery.error.message : null}
            onRetry={() => void assignmentsQuery.refetch()}
            emptyTitle="Biriktirishlar yo'q"
            emptyDescription="Xodimni smenaga biriktiring. Biriktirishni o'chirish API'da mavjud emas; yangi davr biriktirish orqali almashtiring."
            emptyIcon={<CalendarDays className="h-6 w-6" />}
            footer={assignmentsQuery.data ? (
              <Pagination
                page={assignmentsQuery.data.page}
                pages={assignmentsQuery.data.pages}
                total={assignmentsQuery.data.total}
                pageSize={assignmentsQuery.data.page_size}
                onPageChange={setAssignmentPage}
                loading={assignmentsQuery.isFetching}
              />
            ) : null}
          />
        </div>
      ) : null}

      <Modal
        open={mode !== null}
        onClose={() => setMode(null)}
        title={mode === 'create' ? 'Yangi smena' : 'Smenani tahrirlash'}
        description="Vaqtlar HH:MM formatida. Tugash vaqti boshlanishdan oldin bo'lsa, tizim smenani tungi deb hisoblaydi."
        size="xl"
        footer={(
          <>
            <Button variant="secondary" onClick={() => setMode(null)} disabled={saveMutation.isPending}>Bekor qilish</Button>
            <Button variant="primary" onClick={() => document.getElementById('shift-form')?.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }))} loading={saveMutation.isPending}>
              {mode === 'create' ? 'Saqlash' : 'Yangilash'}
            </Button>
          </>
        )}
      >
        <form id="shift-form" onSubmit={submit} className="space-y-5" noValidate>
          {formError ? <Alert tone="danger">{formError}</Alert> : null}
          <div>
            <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">Asosiy</h3>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Nomi" htmlFor="shift_name" required error={errors.name}>
                <Input id="shift_name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} invalid={Boolean(errors.name)} placeholder="Kunduzgi smena" />
              </Field>
              <Field label="Kod" htmlFor="shift_code" required error={errors.code || errors.code_pattern}>
                <Input id="shift_code" value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value.toUpperCase() })} invalid={Boolean(errors.code || errors.code_pattern)} placeholder="DAY" />
              </Field>
              <Field label="Turi" htmlFor="shift_type">
                <Select id="shift_type" value={form.shift_type} onChange={(event) => setForm({ ...form, shift_type: event.target.value })}>
                  {Object.entries(SHIFT_TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </Select>
              </Field>
              <Field label="Minimal ish (daq)" htmlFor="shift_min_work" error={errors.min_work}>
                <Input id="shift_min_work" type="number" min={0} value={form.min_work_minutes} onChange={(event) => setForm({ ...form, min_work_minutes: event.target.value })} invalid={Boolean(errors.min_work)} />
              </Field>
              <Field label="Boshlanish" htmlFor="shift_start" required error={errors.start_time}>
                <Input id="shift_start" type="time" value={form.start_time} onChange={(event) => setForm({ ...form, start_time: event.target.value })} invalid={Boolean(errors.start_time)} />
              </Field>
              <Field label="Tugash" htmlFor="shift_end" required error={errors.end_time}>
                <Input id="shift_end" type="time" value={form.end_time} onChange={(event) => setForm({ ...form, end_time: event.target.value })} invalid={Boolean(errors.end_time)} />
              </Field>
              <Field label="Kechikish chegarasi (daq)" htmlFor="shift_late">
                <Input id="shift_late" type="number" min={0} value={form.late_threshold} onChange={(event) => setForm({ ...form, late_threshold: event.target.value })} />
              </Field>
              <Field label="Erta ketish chegarasi (daq)" htmlFor="shift_early">
                <Input id="shift_early" type="number" min={0} value={form.early_leave_threshold} onChange={(event) => setForm({ ...form, early_leave_threshold: event.target.value })} />
              </Field>
            </div>
          </div>

          <div>
            <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">Tanaffus va qo'shimcha ish</h3>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Tanaffus boshlanishi" htmlFor="shift_break_start">
                <Input id="shift_break_start" type="time" value={form.break_start} onChange={(event) => setForm({ ...form, break_start: event.target.value })} />
              </Field>
              <Field label="Tanaffus tugashi" htmlFor="shift_break_end" error={errors.break_order}>
                <Input id="shift_break_end" type="time" value={form.break_end} onChange={(event) => setForm({ ...form, break_end: event.target.value })} invalid={Boolean(errors.break_order)} />
              </Field>
              <Field label="Tanaffus (daq)" htmlFor="shift_break_duration">
                <Input id="shift_break_duration" type="number" min={0} value={form.break_duration} onChange={(event) => setForm({ ...form, break_duration: event.target.value })} />
              </Field>
              <Field label="Qo'shimcha ish boshlanishi (daq)" htmlFor="shift_ot_after">
                <Input id="shift_ot_after" type="number" min={0} value={form.overtime_start_after} onChange={(event) => setForm({ ...form, overtime_start_after: event.target.value })} />
              </Field>
              <Field label="Maksimal qo'shimcha ish (daq)" htmlFor="shift_ot_max">
                <Input id="shift_ot_max" type="number" min={0} value={form.max_overtime_minutes} onChange={(event) => setForm({ ...form, max_overtime_minutes: event.target.value })} />
              </Field>
            </div>
            <Checkbox className="mt-3" label="Qo'shimcha ish hisoblansin" checked={form.overtime_enabled} onChange={(event) => setForm({ ...form, overtime_enabled: event.target.checked })} />
          </div>

          <div>
            <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">Ish kunlari</h3>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
              {WEEKDAYS.map((day) => (
                <label key={day.value} className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 px-2.5 py-2 text-xs text-slate-700 hover:bg-slate-50">
                  <input
                    type="checkbox"
                    checked={form.applicable_days.includes(day.value)}
                    onChange={() => setForm({ ...form, applicable_days: form.applicable_days.includes(day.value) ? form.applicable_days.filter((value) => value !== day.value) : [...form.applicable_days, day.value] })}
                    className="h-3.5 w-3.5 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
                  />
                  {day.label}
                </label>
              ))}
            </div>
            <p className="mt-1.5 text-[10px] text-slate-400">Bo'sh qoldirilsa, smena har kuni amal qiladi.</p>
          </div>

          <Field label="Tavsif" htmlFor="shift_description">
            <Textarea id="shift_description" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} />
          </Field>
          <Checkbox label="Faol smena" checked={form.is_active} onChange={(event) => setForm({ ...form, is_active: event.target.checked })} />
        </form>
      </Modal>

      <Modal
        open={assignmentOpen}
        onClose={() => setAssignmentOpen(false)}
        title="Xodimni smenaga biriktirish"
        description="Biriktirish tanlangan sanadan boshlab amal qiladi. Bir xil xodim uchun bir nechta davr bo'lishi mumkin."
        size="lg"
        footer={(
          <>
            <Button variant="secondary" onClick={() => setAssignmentOpen(false)} disabled={assignmentMutation.isPending}>Bekor qilish</Button>
            <Button variant="primary" onClick={() => document.getElementById('assignment-form')?.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }))} loading={assignmentMutation.isPending}>Biriktirish</Button>
          </>
        )}
      >
        <form id="assignment-form" onSubmit={submitAssignment} className="space-y-4" noValidate>
          {assignmentError ? <Alert tone="danger">{assignmentError}</Alert> : null}
          <Field label="Xodim" htmlFor="assignment_employee" required error={assignmentErrors.employee_id}>
            <EmployeeCombobox id="assignment_employee" value={assignmentForm.employee_id} onChange={(id) => setAssignmentForm({ ...assignmentForm, employee_id: id })} invalid={Boolean(assignmentErrors.employee_id)} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Smena" htmlFor="assignment_shift" required error={assignmentErrors.shift_id}>
              <Select id="assignment_shift" value={assignmentForm.shift_id} onChange={(event) => setAssignmentForm({ ...assignmentForm, shift_id: event.target.value })} invalid={Boolean(assignmentErrors.shift_id)}>
                <option value="">Smenani tanlang</option>
                {shiftOptionsQuery.data?.items.map((shift) => <option key={shift.id} value={shift.id}>{shift.name} ({formatTime(shift.start_time)}–{formatTime(shift.end_time)})</option>)}
              </Select>
            </Field>
            <Field label="Prioritet" htmlFor="assignment_priority" hint="Yuqori raqam ustunroq">
              <Input id="assignment_priority" type="number" min={0} value={assignmentForm.priority} onChange={(event) => setAssignmentForm({ ...assignmentForm, priority: event.target.value })} />
            </Field>
            <Field label="Boshlanish sanasi" htmlFor="assignment_start" required error={assignmentErrors.start_date}>
              <Input id="assignment_start" type="date" value={assignmentForm.start_date} onChange={(event) => setAssignmentForm({ ...assignmentForm, start_date: event.target.value })} invalid={Boolean(assignmentErrors.start_date)} />
            </Field>
            <Field label="Tugash sanasi" htmlFor="assignment_end" error={assignmentErrors.end_date} hint="Bo'sh bo'lsa, doimiy hisoblanadi">
              <Input id="assignment_end" type="date" value={assignmentForm.end_date} onChange={(event) => setAssignmentForm({ ...assignmentForm, end_date: event.target.value })} invalid={Boolean(assignmentErrors.end_date)} />
            </Field>
            <Field label="Maxsus boshlanish" htmlFor="assignment_custom_start" hint="Ixtiyoriy">
              <Input id="assignment_custom_start" type="time" value={assignmentForm.custom_start_time} onChange={(event) => setAssignmentForm({ ...assignmentForm, custom_start_time: event.target.value })} />
            </Field>
            <Field label="Maxsus tugash" htmlFor="assignment_custom_end" error={assignmentErrors.time_order} hint="Ixtiyoriy">
              <Input id="assignment_custom_end" type="time" value={assignmentForm.custom_end_time} onChange={(event) => setAssignmentForm({ ...assignmentForm, custom_end_time: event.target.value })} invalid={Boolean(assignmentErrors.time_order)} />
            </Field>
          </div>
          <Checkbox label="Faol biriktirish" checked={assignmentForm.is_active} onChange={(event) => setAssignmentForm({ ...assignmentForm, is_active: event.target.checked })} />
        </form>
      </Modal>

      <Modal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        title="Ish grafigini import qilish"
        description="Operativ blok yoki mikroblokka ishlatiladigan Excel (.xls/.xlsx) faylni yuklang. Tizim xodimlarni va kunlik smenalarni avtomatik aniqlaydi."
        footer={(
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setImportOpen(false)} disabled={importing}>Bekor qilish</Button>
            <Button
              variant="primary"
              disabled={!importFile || importing}
              loading={importing}
              onClick={async () => {
                if (!importFile) return
                setImporting(true)
                try {
                  const res = await shiftsApi.importGraph(importFile, importMonth, importYear)
                  toast.success(res.detail)
                  setImportOpen(false)
                  setImportFile(null)
                  void queryClient.invalidateQueries({ queryKey: ['shifts'] })
                  void queryClient.invalidateQueries({ queryKey: ['shift-assignments'] })
                } catch (e: any) {
                  toast.error(e?.response?.data?.detail || 'Importda xatolik yuz berdi')
                } finally {
                  setImporting(false)
                }
              }}
            >
              Import qilish
            </Button>
          </div>
        )}
      >
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Oy">
              <Select value={String(importMonth)} onChange={(e) => setImportMonth(Number(e.target.value))}>
                <option value="1">Yanvar</option><option value="2">Fevral</option><option value="3">Mart</option><option value="4">Aprel</option><option value="5">May</option><option value="6">Iyun</option><option value="7">Iyul</option><option value="8">Avgust</option><option value="9">Sentyabr</option><option value="10">Oktyabr</option><option value="11">Noyabr</option><option value="12">Dekabr</option>
              </Select>
            </Field>
            <Field label="Yil">
              <Input type="number" value={importYear} onChange={(e) => setImportYear(Number(e.target.value))} />
            </Field>
          </div>
          <Field label="Excel fayl">
            <input
              type="file"
              accept=".xls,.xlsx"
              onChange={(e) => setImportFile(e.target.files?.[0] || null)}
              className="block w-full text-xs text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-slate-700 hover:file:bg-slate-200"
            />
          </Field>
          <p className="text-[10px] text-slate-400">Fayl: 10. 2026 OKTABRoper blok grafigi (5) (8) (2).xls kabi tuzilishda ishlaydi.</p>
        </div>
      </Modal>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Smenani o'chirish"
        message={deleteTarget ? <><strong>{deleteTarget.name}</strong> smenasini o'chirmoqchimisiz? Agar smena faol xodimlarga biriktirilgan bo'lsa, server amalni rad etadi.</> : ''}
        confirmLabel="O'chirish"
        danger
        loading={deleteMutation.isPending}
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
      />
    </div>
  )
}
