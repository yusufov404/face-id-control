import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Fingerprint,
  History,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  XCircle,
  Zap,
} from 'lucide-react'
import { departmentsApi, devicesApi } from '@/api/services'
import type { Device, DeviceCreateInput, DeviceDiagnostics, DeviceEvent, DeviceUpdateInput } from '@/api/types'
import { useAuth } from '@/auth/AuthProvider'
import { Badge, Dot } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { ConfirmDialog, Modal } from '@/components/ui/Modal'
import { DataTable, Pagination, type Column } from '@/components/ui/DataTable'
import { Checkbox, Field, Input, Select, Textarea } from '@/components/ui/Field'
import { Alert, EmptyState } from '@/components/ui/Feedback'
import { FilterBar, InfoGrid, PageHeader, SearchInput } from '@/components/ui/LayoutBits'
import { useToast } from '@/components/ui/Toast'
import { useDebouncedValue, useDocumentTitle } from '@/lib/hooks'
import {
  DEVICE_STATUS_LABELS,
  DEVICE_STATUS_TONES,
  DEVICE_TYPE_LABELS,
  EVENT_TYPE_LABELS,
  formatDateTime,
  nowDateTimeInput,
  parseTashkentDateTime,
  VERIFY_MODE_LABELS,
} from '@/lib/format'
import {
  collectErrors,
  hasErrors,
  nullableText,
  required,
  type ValidationErrors,
} from '@/lib/validation'

interface DeviceForm {
  name: string
  serial_number: string
  device_type: string
  ip_address: string
  port: string
  connection_type: string
  username: string
  password: string
  department_id: string
  location: string
  sync_enabled: boolean
  sync_interval: string
  timeout: string
  retry_attempts: string
  notes: string
}

const emptyForm = (): DeviceForm => ({
  name: '',
  serial_number: '',
  device_type: 'face_id',
  ip_address: '',
  port: '80',
  connection_type: 'http',
  username: 'admin',
  password: '',
  department_id: '',
  location: '',
  sync_enabled: true,
  sync_interval: '300',
  timeout: '10',
  retry_attempts: '3',
  notes: '',
})

function fromDevice(device: Device): DeviceForm {
  return {
    name: device.name,
    serial_number: device.serial_number,
    device_type: device.device_type,
    ip_address: device.ip_address,
    port: String(device.port),
    connection_type: device.connection_type,
    username: device.username,
    password: '',
    department_id: device.department_id ? String(device.department_id) : '',
    location: device.location || '',
    sync_enabled: device.sync_enabled,
    sync_interval: String(device.sync_interval),
    timeout: String(device.timeout),
    retry_attempts: String(device.retry_attempts),
    notes: device.notes || '',
  }
}

function capabilityLabel(value: boolean | null | undefined): { label: string; tone: 'green' | 'red' | 'slate' } {
  if (value === true) return { label: "Qo'llab-quvvatlanadi", tone: 'green' }
  if (value === false) return { label: "Qo'llab-quvvatlanmaydi", tone: 'red' }
  return { label: 'Aniqlanmadi', tone: 'slate' }
}

export default function DevicesPage() {
  const { can } = useAuth()
  const toast = useToast()
  const queryClient = useQueryClient()
  useDocumentTitle('Face ID qurilmalari')

  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [mode, setMode] = useState<'create' | 'edit' | null>(null)
  const [selected, setSelected] = useState<Device | null>(null)
  const [form, setForm] = useState<DeviceForm>(emptyForm())
  const [errors, setErrors] = useState<ValidationErrors>({})
  const [formError, setFormError] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<Device | null>(null)
  const [diagnoseTarget, setDiagnoseTarget] = useState<Device | null>(null)
  const [diagnostics, setDiagnostics] = useState<DeviceDiagnostics | null>(null)
  const [diagnoseError, setDiagnoseError] = useState('')
  const [eventsTarget, setEventsTarget] = useState<Device | null>(null)
  const [eventPage, setEventPage] = useState(1)
  const [eventProcessed, setEventProcessed] = useState('')
  const [manualForm, setManualForm] = useState({
    device_user_id: '',
    event_time: nowDateTimeInput(),
    event_type: 'check_in',
    verify_mode: 'face',
  })
  const [manualError, setManualError] = useState('')
  const [quickOpen, setQuickOpen] = useState(false)
  const [quickForm, setQuickForm] = useState({
    name: '',
    ip_address: '',
    port: '80',
    connection_type: 'http',
    username: 'admin',
    password: '',
    serial_number: '',
  })
  const [quickErrors, setQuickErrors] = useState<ValidationErrors>({})
  const [quickError, setQuickError] = useState('')

  const debouncedSearch = useDebouncedValue(search)

  const devicesQuery = useQuery({
    queryKey: ['devices', page, pageSize, debouncedSearch, statusFilter],
    queryFn: () => devicesApi.list({
      page,
      page_size: pageSize,
      search: debouncedSearch || undefined,
      status: statusFilter || undefined,
    }),
  })
  const departmentsQuery = useQuery({ queryKey: ['departments', 'options'], queryFn: departmentsApi.options })

  const eventsQuery = useQuery({
    queryKey: ['device-events', eventsTarget?.id, eventPage, eventProcessed],
    queryFn: () => devicesApi.events(eventsTarget?.id as number, {
      page: eventPage,
      page_size: 20,
      processed: eventProcessed === '' ? undefined : eventProcessed === 'true',
    }),
    enabled: Boolean(eventsTarget) && can('device:view_logs'),
  })

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (mode === 'create') {
        const payload: DeviceCreateInput = {
          name: form.name.trim(),
          serial_number: form.serial_number.trim(),
          device_type: form.device_type,
          ip_address: form.ip_address.trim(),
          port: Number(form.port),
          connection_type: form.connection_type,
          username: form.username.trim(),
          password: form.password,
          department_id: form.department_id ? Number(form.department_id) : null,
          location: nullableText(form.location),
          sync_enabled: form.sync_enabled,
          sync_interval: Number(form.sync_interval),
          timeout: Number(form.timeout),
          retry_attempts: Number(form.retry_attempts),
          notes: nullableText(form.notes),
        }
        return devicesApi.create(payload)
      }
      if (mode === 'edit' && selected) {
        const payload: DeviceUpdateInput = {
          name: form.name.trim(),
          ip_address: form.ip_address.trim(),
          port: Number(form.port),
          connection_type: form.connection_type,
          username: form.username.trim(),
          password: form.password || undefined,
          department_id: form.department_id ? Number(form.department_id) : null,
          location: nullableText(form.location),
          sync_enabled: form.sync_enabled,
          sync_interval: Number(form.sync_interval),
          timeout: Number(form.timeout),
          retry_attempts: Number(form.retry_attempts),
          notes: nullableText(form.notes),
        }
        return devicesApi.update(selected.id, payload)
      }
      throw new Error('Amal aniqlanmadi')
    },
    onSuccess: () => {
      toast.success(mode === 'create' ? "Qurilma qo'shildi" : "Qurilma ma'lumotlari yangilandi")
      setMode(null)
      setSelected(null)
      setFormError('')
      void queryClient.invalidateQueries({ queryKey: ['devices'] })
    },
    onError: (error) => setFormError(error instanceof Error ? error.message : "Qurilmani saqlab bo'lmadi"),
  })

  const quickCreateMutation = useMutation({
    mutationFn: async () => {
      const sn = quickForm.serial_number.trim() || `SN-${quickForm.ip_address.replace(/\./g, '')}-${Date.now().toString().slice(-6)}`
      const payload: DeviceCreateInput = {
        name: quickForm.name.trim(),
        serial_number: sn,
        device_type: 'face_id',
        ip_address: quickForm.ip_address.trim(),
        port: Number(quickForm.port),
        connection_type: quickForm.connection_type,
        username: quickForm.username.trim(),
        password: quickForm.password,
        department_id: null,
        location: null,
        sync_enabled: true,
        sync_interval: 300,
        timeout: 10,
        retry_attempts: 3,
        notes: null,
      }
      return devicesApi.create(payload)
    },
    onSuccess: () => {
      toast.success("Qurilma qo'shildi")
      setQuickOpen(false)
      setQuickErrors({})
      setQuickError('')
      setQuickForm({ name: '', ip_address: '', port: '80', connection_type: 'http', username: 'admin', password: '', serial_number: '' })
      void queryClient.invalidateQueries({ queryKey: ['devices'] })
    },
    onError: (error) => setQuickError(error instanceof Error ? error.message : "Qurilmani saqlab bo'lmadi"),
  })

  const deleteMutation = useMutation({
    mutationFn: (device: Device) => devicesApi.remove(device.id),
    onSuccess: (response) => {
      toast.success(response.detail)
      setDeleteTarget(null)
      void queryClient.invalidateQueries({ queryKey: ['devices'] })
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Qurilmani o'chirib bo'lmadi"),
  })

  const syncMutation = useMutation({
    mutationFn: (device: Device) => devicesApi.sync(device.id),
    onSuccess: (response) => {
      toast.success(response.detail)
      void queryClient.invalidateQueries({ queryKey: ['devices'] })
      void queryClient.invalidateQueries({ queryKey: ['device-events'] })
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Sinxronizatsiya amalga oshmadi"),
  })

  const diagnoseMutation = useMutation({
    mutationFn: (device: Device) => devicesApi.diagnose(device.id),
    onSuccess: (result) => {
      setDiagnostics(result)
      setDiagnoseError('')
      void queryClient.invalidateQueries({ queryKey: ['devices'] })
    },
    onError: (error) => {
      setDiagnostics(null)
      setDiagnoseError(error instanceof Error ? error.message : "Diagnostika amalga oshmadi")
    },
  })

  const manualMutation = useMutation({
    mutationFn: () => {
      if (!eventsTarget) throw new Error('Qurilma tanlanmagan')
      const payload = {
        device_id: eventsTarget.id,
        device_user_id: manualForm.device_user_id.trim(),
        event_time: parseTashkentDateTime(manualForm.event_time),
        event_type: manualForm.event_type,
        verify_mode: manualForm.verify_mode,
        is_simulated: true,
      }
      return devicesApi.manualEvent(payload)
    },
    onSuccess: (response) => {
      toast.warning(response.detail)
      setManualError('')
      setManualForm((current) => ({ ...current, device_user_id: '' }))
      void queryClient.invalidateQueries({ queryKey: ['device-events', eventsTarget?.id] })
      void queryClient.invalidateQueries({ queryKey: ['attendance'] })
    },
    onError: (error) => setManualError(error instanceof Error ? error.message : "Simulyatsiya hodisasini saqlab bo'lmadi"),
  })

  function openCreate() {
    setForm(emptyForm())
    setErrors({})
    setFormError('')
    setSelected(null)
    setMode('create')
  }

  function openEdit(device: Device) {
    setForm(fromDevice(device))
    setErrors({})
    setFormError('')
    setSelected(device)
    setMode('edit')
  }

  function openDiagnostics(device: Device) {
    setDiagnoseTarget(device)
    setDiagnostics(null)
    setDiagnoseError('')
    diagnoseMutation.mutate(device)
  }

  function openEvents(device: Device) {
    setEventsTarget(device)
    setEventPage(1)
    setEventProcessed('')
    setManualError('')
    setManualForm({
      device_user_id: '',
      event_time: nowDateTimeInput(),
      event_type: 'check_in',
      verify_mode: 'face',
    })
  }

  function openQuick() {
    setQuickForm({ name: '', ip_address: '', port: '80', connection_type: 'http', username: 'admin', password: '', serial_number: '' })
    setQuickErrors({})
    setQuickError('')
    setQuickOpen(true)
  }

  function submitQuick(event: FormEvent) {
    event.preventDefault()
    const found = collectErrors([
      ['name', required(quickForm.name, 'Nomi')],
      ['ip_address', required(quickForm.ip_address, 'IP manzil')],
      ['username', required(quickForm.username, 'Login')],
      ['password', required(quickForm.password, 'Parol')],
    ])
    setQuickErrors(found)
    setQuickError('')
    if (hasErrors(found)) return
    quickCreateMutation.mutate()
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    const nextErrors = collectErrors([
      ['name', required(form.name, 'Qurilma nomi')],
      ['serial_number', mode === 'create' ? required(form.serial_number, 'Seriya raqami') : null],
      ['ip_address', required(form.ip_address, 'IP manzil')],
      ['username', required(form.username, 'Foydalanuvchi')],
      ['password', mode === 'create' ? required(form.password, 'Parol') : null],
      ['port', Number(form.port) >= 1 && Number(form.port) <= 65535 ? null : "Port 1–65535 oralig'ida bo'lishi kerak"],
      ['sync_interval', Number(form.sync_interval) >= 30 ? null : "Sinxron interval kamida 30 soniya bo'lishi kerak"],
      ['timeout', Number(form.timeout) >= 1 && Number(form.timeout) <= 120 ? null : "Timeout 1–120 soniya oralig'ida bo'lishi kerak"],
      ['retry_attempts', Number(form.retry_attempts) >= 1 && Number(form.retry_attempts) <= 10 ? null : "Qayta urinish 1–10 oralig'ida bo'lishi kerak"],
    ])
    setErrors(nextErrors)
    setFormError('')
    if (hasErrors(nextErrors)) return
    saveMutation.mutate()
  }

  function submitManual(event: FormEvent) {
    event.preventDefault()
    if (!manualForm.device_user_id.trim()) {
      setManualError('Qurilma foydalanuvchi ID sini kiriting')
      return
    }
    if (!manualForm.event_time) {
      setManualError('Hodisa vaqtini kiriting')
      return
    }
    manualMutation.mutate()
  }

  const columns: Column<Device>[] = [
    {
      key: 'device',
      header: 'Qurilma',
      cell: (device) => (
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-900 text-teal-300">
            <Fingerprint className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="max-w-[210px] truncate text-xs font-semibold text-slate-900">{device.name}</p>
            <p className="mt-0.5 max-w-[210px] truncate font-mono text-[10px] text-slate-400">{device.serial_number}</p>
          </div>
        </div>
      ),
    },
    {
      key: 'network',
      header: 'Tarmoq',
      cell: (device) => (
        <div className="text-xs">
          <p className="font-mono text-slate-700">{device.ip_address}:{device.port}</p>
          <p className="mt-0.5 text-[10px] text-slate-400">{device.connection_type.toUpperCase()} · {DEVICE_TYPE_LABELS[device.device_type] || device.device_type}</p>
        </div>
      ),
    },
    {
      key: 'department',
      header: "Bo'lim / joylashuv",
      cell: (device) => (
        <div className="text-xs">
          <p className="text-slate-700">{device.department_name || "Bo'lim yo'q"}</p>
          <p className="mt-0.5 max-w-[180px] truncate text-[10px] text-slate-400">{device.location || 'Joylashuv kiritilmagan'}</p>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Holat',
      cell: (device) => (
        <div>
          <Badge tone={(DEVICE_STATUS_TONES[device.status] as 'green' | 'red' | 'amber' | 'blue' | 'violet' | 'slate') || 'slate'}>
            <Dot tone={(DEVICE_STATUS_TONES[device.status] as 'green' | 'red' | 'amber' | 'blue' | 'violet' | 'slate') || 'slate'} />
            <span className="ml-1">{DEVICE_STATUS_LABELS[device.status] || device.status}</span>
          </Badge>
          <p className="mt-1 text-[10px] text-slate-400">Heartbeat: {device.last_heartbeat ? formatDateTime(device.last_heartbeat) : '—'}</p>
        </div>
      ),
    },
    {
      key: 'sync',
      header: 'Sinxron',
      cell: (device) => (
        <div className="text-[11px]">
          <p className="text-slate-700">{device.sync_enabled ? `${device.sync_interval} s` : "O'chirilgan"}</p>
          <p className="mt-0.5 text-[10px] text-slate-400">{device.last_sync ? formatDateTime(device.last_sync) : 'Hali sinxronlanmagan'}</p>
        </div>
      ),
    },
    {
      key: 'actions',
      header: '',
      headerClassName: 'text-right',
      className: 'text-right',
      cell: (device) => (
        <div className="flex items-center justify-end gap-0.5">
          <button type="button" onClick={() => openDiagnostics(device)} className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-teal-700" title="Diagnostika"><Activity className="h-4 w-4" /></button>
          {can('device:view_logs') ? (
            <button type="button" onClick={() => openEvents(device)} className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-sky-700" title="Hodisalar"><History className="h-4 w-4" /></button>
          ) : null}
          {can('device:sync') ? (
            <button type="button" onClick={() => syncMutation.mutate(device)} className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-violet-700" title="Sinxronlash" disabled={syncMutation.isPending}><RefreshCw className={`h-4 w-4 ${syncMutation.isPending ? 'animate-spin' : ''}`} /></button>
          ) : null}
          {can('device:update') ? (
            <button type="button" onClick={() => openEdit(device)} className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700" title="Tahrirlash"><Pencil className="h-4 w-4" /></button>
          ) : null}
          {can('device:delete') ? (
            <button type="button" onClick={() => setDeleteTarget(device)} className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600" title="O'chirish"><Trash2 className="h-4 w-4" /></button>
          ) : null}
        </div>
      ),
    },
  ]

  const eventColumns: Column<DeviceEvent>[] = [
    {
      key: 'time',
      header: 'Vaqt',
      cell: (event) => <span className="whitespace-nowrap text-[11px] tabular-nums text-slate-700">{formatDateTime(event.event_time)}</span>,
    },
    {
      key: 'employee',
      header: 'Xodim / qurilma ID',
      cell: (event) => (
        <div className="text-xs">
          <p className="font-medium text-slate-800">{event.employee_name || 'Xodim bog‘lanmagan'}</p>
          <p className="mt-0.5 font-mono text-[10px] text-slate-400">{event.device_user_id || '—'}</p>
        </div>
      ),
    },
    {
      key: 'type',
      header: 'Turi',
      cell: (event) => <Badge tone="blue">{EVENT_TYPE_LABELS[event.event_type] || event.event_type}</Badge>,
    },
    {
      key: 'verify',
      header: 'Tasdiqlash',
      cell: (event) => <span className="text-[11px] text-slate-600">{event.verify_mode ? VERIFY_MODE_LABELS[event.verify_mode] || event.verify_mode : '—'}</span>,
    },
    {
      key: 'processed',
      header: 'Qayta ishlangan',
      cell: (event) => (
        <div>
          <Badge tone={event.processed ? 'green' : 'amber'}>{event.processed ? 'Ha' : 'Yo‘q'}</Badge>
          {event.error_message ? <p className="mt-1 max-w-[200px] truncate text-[10px] text-red-500" title={event.error_message}>{event.error_message}</p> : null}
        </div>
      ),
    },
  ]

  return (
    <div className="animate-in">
      <PageHeader
        eyebrow="Tizim"
        title="Face ID qurilmalari"
        description="Hikvision terminallari, ISAPI diagnostikasi va sinxronizatsiya."
        actions={(
          <div className="flex gap-2">
            <Button variant="secondary" icon={<RefreshCw className="h-4 w-4" />} onClick={() => void devicesQuery.refetch()} loading={devicesQuery.isFetching}>Yangilash</Button>
            {can('device:create') ? <Button variant="primary" icon={<Zap className="h-4 w-4" />} onClick={openQuick}>Tezkor qo'shish</Button> : null}
            {can('device:create') ? <Button variant="ghost" icon={<Plus className="h-4 w-4" />} onClick={openCreate}>Batafsil</Button> : null}
          </div>
        )}
      />

      <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3.5 text-[11px] leading-relaxed text-amber-900">
        <div className="flex gap-2">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            Ushbu modul faqat qurilma tomonidan qo'llab-quvvatlanadigan ISAPI funksiyalarini ishlatadi. Yuz shabloni yoki
            biometrik rasm tizimda saqlanmaydi; faqat hodisa metama'lumotlari qayd etiladi. Diagnostikada "Aniqlanmadi"
            ko'rsatkichi qurilma javob bermaganini bildiradi, uni "yo'q" deb talqin qilmang.
          </p>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <FilterBar>
          <SearchInput value={search} onChange={(value) => { setSearch(value); setPage(1) }} placeholder="Nomi, seriya raqami yoki IP…" className="lg:w-72" />
          <Select value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value); setPage(1) }} className="lg:w-44" aria-label="Qurilma holati">
            <option value="">Barcha holatlar</option>
            {Object.entries(DEVICE_STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </Select>
          <div className="flex-1" />
          <span className="text-[11px] text-slate-400">{devicesQuery.data ? `${devicesQuery.data.total} ta qurilma` : ''}</span>
        </FilterBar>
        <DataTable
          columns={columns}
          rows={devicesQuery.data?.items}
          rowKey={(device) => device.id}
          loading={devicesQuery.isLoading}
          error={devicesQuery.error instanceof Error ? devicesQuery.error.message : null}
          onRetry={() => void devicesQuery.refetch()}
          emptyTitle="Qurilmalar qo'shilmagan"
          emptyDescription="Face ID terminalini qo'shing va diagnostika orqali ulanishni tekshiring."
          emptyIcon={<Fingerprint className="h-6 w-6" />}
          emptyAction={can('device:create') ? <Button variant="primary" size="sm" icon={<Zap className="h-3.5 w-3.5" />} onClick={openQuick}>Tezkor qo'shish</Button> : undefined}
          footer={devicesQuery.data ? (
            <Pagination
              page={devicesQuery.data.page}
              pages={devicesQuery.data.pages}
              total={devicesQuery.data.total}
              pageSize={devicesQuery.data.page_size}
              onPageChange={setPage}
              onPageSizeChange={(size) => { setPageSize(size); setPage(1) }}
              loading={devicesQuery.isFetching}
            />
          ) : null}
        />
      </div>

      <Modal
        open={quickOpen}
        onClose={() => setQuickOpen(false)}
        title="Tezkor qo'shish"
        description="IP, port, login, parol va seriya raqamini kiriting"
        size="md"
        footer={(
          <>
            <Button variant="secondary" onClick={() => setQuickOpen(false)} disabled={quickCreateMutation.isPending}>Bekor qilish</Button>
            <Button variant="primary" onClick={() => document.getElementById('quick-device-form')?.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }))} loading={quickCreateMutation.isPending}>
              Saqlash
            </Button>
          </>
        )}
      >
        <form id="quick-device-form" onSubmit={submitQuick} noValidate className="space-y-3">
          {quickError ? <Alert tone="danger">{quickError}</Alert> : null}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Nomi" htmlFor="qd_name" required error={quickErrors.name} className="sm:col-span-2">
              <Input id="qd_name" value={quickForm.name} onChange={(event) => setQuickForm({ ...quickForm, name: event.target.value })} invalid={Boolean(quickErrors.name)} placeholder="Qabulxona Face ID" autoFocus />
            </Field>
            <Field label="IP manzil" htmlFor="qd_ip" required error={quickErrors.ip_address}>
              <Input id="qd_ip" value={quickForm.ip_address} onChange={(event) => setQuickForm({ ...quickForm, ip_address: event.target.value })} invalid={Boolean(quickErrors.ip_address)} placeholder="192.168.1.64" />
            </Field>
            <Field label="Port" htmlFor="qd_port">
              <Input id="qd_port" type="number" min={1} max={65535} value={quickForm.port} onChange={(event) => setQuickForm({ ...quickForm, port: event.target.value })} />
            </Field>
            <Field label="Ulanish turi" htmlFor="qd_conn">
              <Select id="qd_conn" value={quickForm.connection_type} onChange={(event) => setQuickForm({ ...quickForm, connection_type: event.target.value })}>
                <option value="http">HTTP</option>
                <option value="https">HTTPS</option>
              </Select>
            </Field>
            <Field label="Login" htmlFor="qd_user" required error={quickErrors.username}>
              <Input id="qd_user" value={quickForm.username} onChange={(event) => setQuickForm({ ...quickForm, username: event.target.value })} invalid={Boolean(quickErrors.username)} />
            </Field>
            <Field label="Parol" htmlFor="qd_pass" required error={quickErrors.password} className="sm:col-span-2">
              <Input id="qd_pass" type="password" value={quickForm.password} onChange={(event) => setQuickForm({ ...quickForm, password: event.target.value })} invalid={Boolean(quickErrors.password)} autoComplete="new-password" />
            </Field>
            <Field label="Seriya raqami (ixtiyoriy)" htmlFor="qd_sn" className="sm:col-span-2">
              <Input id="qd_sn" value={quickForm.serial_number} onChange={(event) => setQuickForm({ ...quickForm, serial_number: event.target.value })} placeholder="Bo'sh qoldirilsa avtomatik hosil qilinadi" />
            </Field>
          </div>
        </form>
      </Modal>

      <Modal
        open={mode !== null}
        onClose={() => setMode(null)}
        title={mode === 'create' ? "Yangi qurilma qo'shish (batafsil)" : 'Qurilmani tahrirlash'}
        description="Qurilma paroli shifrlangan holda saqlanadi va API orqali hech qachon qaytarilmaydi."
        size="xl"
        footer={(
          <>
            <Button variant="secondary" onClick={() => setMode(null)} disabled={saveMutation.isPending}>Bekor qilish</Button>
            <Button variant="primary" onClick={() => document.getElementById('device-form')?.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }))} loading={saveMutation.isPending}>
              {mode === 'create' ? 'Saqlash' : 'Yangilash'}
            </Button>
          </>
        )}
      >
        <form id="device-form" onSubmit={submit} className="space-y-5" noValidate>
          {formError ? <Alert tone="danger">{formError}</Alert> : null}
          <div>
            <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">Identifikatsiya</h3>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Nomi" htmlFor="device_name" required error={errors.name}>
                <Input id="device_name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} invalid={Boolean(errors.name)} placeholder="Qabulxona Face ID" />
              </Field>
              <Field label="Seriya raqami" htmlFor="device_serial" required error={errors.serial_number} hint={mode === 'edit' ? "O'zgartirilmaydi" : undefined}>
                <Input id="device_serial" value={form.serial_number} onChange={(event) => setForm({ ...form, serial_number: event.target.value })} disabled={mode === 'edit'} invalid={Boolean(errors.serial_number)} />
              </Field>
              <Field label="Qurilma turi" htmlFor="device_type">
                <Select id="device_type" value={form.device_type} onChange={(event) => setForm({ ...form, device_type: event.target.value })} disabled={mode === 'edit'}>
                  {Object.entries(DEVICE_TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </Select>
              </Field>
              <Field label="Ulanish turi" htmlFor="device_connection">
                <Select id="device_connection" value={form.connection_type} onChange={(event) => setForm({ ...form, connection_type: event.target.value })}>
                  <option value="http">HTTP</option>
                  <option value="https">HTTPS</option>
                </Select>
              </Field>
            </div>
          </div>

          <div>
            <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">Tarmoq va autentifikatsiya</h3>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="IP manzil / host" htmlFor="device_ip" required error={errors.ip_address}>
                <Input id="device_ip" value={form.ip_address} onChange={(event) => setForm({ ...form, ip_address: event.target.value })} invalid={Boolean(errors.ip_address)} placeholder="192.168.1.64" />
              </Field>
              <Field label="Port" htmlFor="device_port" required error={errors.port}>
                <Input id="device_port" type="number" min={1} max={65535} value={form.port} onChange={(event) => setForm({ ...form, port: event.target.value })} invalid={Boolean(errors.port)} />
              </Field>
              <Field label="Qurilma foydalanuvchisi" htmlFor="device_username" required error={errors.username}>
                <Input id="device_username" value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} invalid={Boolean(errors.username)} autoComplete="off" />
              </Field>
              <Field label={mode === 'create' ? 'Parol' : 'Yangi parol'} htmlFor="device_password" required={mode === 'create'} error={errors.password} hint={mode === 'edit' ? "Bo'sh qoldirilsa, parol o'zgarmaydi" : undefined}>
                <Input id="device_password" type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} invalid={Boolean(errors.password)} autoComplete="new-password" />
              </Field>
            </div>
          </div>

          <div>
            <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">Joylashuv va sinxronizatsiya</h3>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Bo'lim" htmlFor="device_department">
                <Select id="device_department" value={form.department_id} onChange={(event) => setForm({ ...form, department_id: event.target.value })}>
                  <option value="">Bo'limsiz</option>
                  {departmentsQuery.data?.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}
                </Select>
              </Field>
              <Field label="Joylashuv" htmlFor="device_location">
                <Input id="device_location" value={form.location} onChange={(event) => setForm({ ...form, location: event.target.value })} placeholder="1-qavat, kirish eshigi" />
              </Field>
              <Field label="Sinxron interval (s)" htmlFor="device_sync_interval" required error={errors.sync_interval}>
                <Input id="device_sync_interval" type="number" min={30} max={86400} value={form.sync_interval} onChange={(event) => setForm({ ...form, sync_interval: event.target.value })} invalid={Boolean(errors.sync_interval)} />
              </Field>
              <Field label="Timeout (s)" htmlFor="device_timeout" required error={errors.timeout}>
                <Input id="device_timeout" type="number" min={1} max={120} value={form.timeout} onChange={(event) => setForm({ ...form, timeout: event.target.value })} invalid={Boolean(errors.timeout)} />
              </Field>
              <Field label="Qayta urinish" htmlFor="device_retry" required error={errors.retry_attempts}>
                <Input id="device_retry" type="number" min={1} max={10} value={form.retry_attempts} onChange={(event) => setForm({ ...form, retry_attempts: event.target.value })} invalid={Boolean(errors.retry_attempts)} />
              </Field>
            </div>
            <Checkbox className="mt-3" label="Avtomatik sinxronizatsiya" description="Yoqilganda poller qurilmadan hodisalarni belgilangan intervalda oladi (bitta uvicorn worker talab qilinadi)" checked={form.sync_enabled} onChange={(event) => setForm({ ...form, sync_enabled: event.target.checked })} />
          </div>

          <Field label="Izoh" htmlFor="device_notes">
            <Textarea id="device_notes" value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} />
          </Field>
        </form>
      </Modal>

      <Modal
        open={Boolean(diagnoseTarget)}
        onClose={() => { setDiagnoseTarget(null); setDiagnostics(null) }}
        title="Qurilma diagnostikasi"
        description={diagnoseTarget ? `${diagnoseTarget.name} · ${diagnoseTarget.ip_address}:${diagnoseTarget.port}` : undefined}
        size="lg"
        footer={(
          <div className="flex w-full items-center justify-between gap-2">
            <Button variant="secondary" onClick={() => diagnoseTarget && diagnoseMutation.mutate(diagnoseTarget)} loading={diagnoseMutation.isPending} icon={<RefreshCw className="h-4 w-4" />}>Qayta tekshirish</Button>
            <Button variant="secondary" onClick={() => setDiagnoseTarget(null)}>Yopish</Button>
          </div>
        )}
      >
        {diagnoseMutation.isPending && !diagnostics ? (
          <div className="flex flex-col items-center gap-3 py-10 text-sm text-slate-500">
            <Activity className="h-7 w-7 animate-pulse text-teal-600" />
            <span>Qurilma bilan aloqa tekshirilmoqda…</span>
          </div>
        ) : diagnoseError ? (
          <Alert tone="danger" title="Diagnostika xatosi">{diagnoseError}</Alert>
        ) : diagnostics ? (
          <div className="space-y-4">
            <div className={`flex items-center gap-3 rounded-xl border p-3.5 ${diagnostics.reachable ? 'border-emerald-200 bg-emerald-50' : 'border-red-200 bg-red-50'}`}>
              <div className={`flex h-10 w-10 items-center justify-center rounded-full ${diagnostics.reachable ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                {diagnostics.reachable ? <CheckCircle2 className="h-5 w-5" /> : <XCircle className="h-5 w-5" />}
              </div>
              <div>
                <p className="text-sm font-bold text-slate-900">{diagnostics.reachable ? 'Qurilma javob berdi' : "Qurilmaga ulanib bo'lmadi"}</p>
                <p className="mt-0.5 text-[11px] text-slate-500">Tekshirilgan vaqt: {formatDateTime(diagnostics.checked_at)}</p>
              </div>
            </div>
            <InfoGrid
              columns={3}
              items={[
                { label: 'Model', value: diagnostics.model || '—' },
                { label: 'Firmware', value: diagnostics.firmware || '—' },
                { label: 'Seriya', value: diagnostics.serial_number || '—' },
                { label: 'Qurilma turi', value: diagnostics.device_type || '—' },
                { label: 'Qurilma vaqti', value: diagnostics.device_time || '—' },
                { label: 'Server vaqti', value: diagnostics.server_time || '—' },
                { label: 'Vaqt farqi', value: diagnostics.time_drift_seconds === null || diagnostics.time_drift_seconds === undefined ? '—' : `${diagnostics.time_drift_seconds} s` },
              ]}
            />
            <div>
              <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-slate-500">Aniqlangan imkoniyatlar</p>
              <div className="grid gap-2 sm:grid-cols-3">
                {[
                  { label: 'Alert stream', value: diagnostics.alert_stream_supported },
                  { label: 'Event search', value: diagnostics.event_search_supported },
                  { label: 'Time sync', value: diagnostics.time_sync_supported },
                ].map((item) => {
                  const display = capabilityLabel(item.value)
                  return (
                    <div key={item.label} className="rounded-lg border border-slate-200 p-2.5">
                      <p className="text-[11px] text-slate-500">{item.label}</p>
                      <Badge tone={display.tone} className="mt-1">{display.label}</Badge>
                    </div>
                  )
                })}
              </div>
            </div>
            {diagnostics.errors.length ? (
              <Alert tone="warning" title="Diagnostika xabarlari">
                <ul className="list-disc space-y-0.5 pl-4">{diagnostics.errors.map((error, index) => <li key={index}>{error}</li>)}</ul>
              </Alert>
            ) : null}
            <div>
              <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-slate-500">Xom imkoniyatlar</p>
              <pre className="max-h-40 overflow-auto rounded-lg bg-slate-950 p-3 text-[10px] leading-relaxed text-slate-300">{JSON.stringify(diagnostics.capabilities, null, 2)}</pre>
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={Boolean(eventsTarget)}
        onClose={() => setEventsTarget(null)}
        title="Qurilma hodisalari"
        description={eventsTarget ? `${eventsTarget.name} · faqat metama'lumotlar, biometrik shablonlar emas` : undefined}
        size="xl"
        footer={<Button variant="secondary" onClick={() => setEventsTarget(null)}>Yopish</Button>}
      >
        {eventsTarget && !can('device:view_logs') ? (
          <EmptyState title="Ruxsat yo'q" description="Qurilma hodisalarini ko'rish uchun device:view_logs ruxsati kerak." compact />
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Select value={eventProcessed} onChange={(event) => { setEventProcessed(event.target.value); setEventPage(1) }} className="w-48" aria-label="Qayta ishlash holati">
                <option value="">Barcha hodisalar</option>
                <option value="true">Qayta ishlangan</option>
                <option value="false">Qayta ishlanmagan</option>
              </Select>
              <Button variant="secondary" size="sm" icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={() => void eventsQuery.refetch()} loading={eventsQuery.isFetching}>Yangilash</Button>
            </div>
            <div className="overflow-hidden rounded-xl border border-slate-200">
              <DataTable
                columns={eventColumns}
                rows={eventsQuery.data?.items}
                rowKey={(event) => event.id}
                loading={eventsQuery.isLoading}
                error={eventsQuery.error instanceof Error ? eventsQuery.error.message : null}
                onRetry={() => void eventsQuery.refetch()}
                emptyTitle="Hodisalar yo'q"
                emptyDescription="Qurilma hali hodisa yubormagan yoki sinxronlanmagan."
                emptyIcon={<History className="h-6 w-6" />}
                dense
                footer={eventsQuery.data ? (
                  <Pagination
                    page={eventsQuery.data.page}
                    pages={eventsQuery.data.pages}
                    total={eventsQuery.data.total}
                    pageSize={eventsQuery.data.page_size}
                    onPageChange={setEventPage}
                    loading={eventsQuery.isFetching}
                  />
                ) : null}
              />
            </div>

            {can('device:sync') ? (
              <details className="rounded-xl border border-dashed border-amber-300 bg-amber-50/60 p-3">
                <summary className="cursor-pointer text-xs font-bold text-amber-900">Sinov (simulyatsiya) hodisasini qo'lda kiritish</summary>
                <p className="mt-2 text-[11px] leading-relaxed text-amber-800">
                  Bu haqiqiy Face ID o'rnini bosmaydi. Hodisa <b>simulyatsiya</b> deb belgilanadi va dashboardda ogohlantirish paydo bo'ladi.
                </p>
                {manualError ? <Alert tone="danger" className="mt-2">{manualError}</Alert> : null}
                <form onSubmit={submitManual} className="mt-3 grid gap-2 sm:grid-cols-2">
                  <Field label="Qurilma foydalanuvchi ID" htmlFor="manual_user" required>
                    <Input id="manual_user" value={manualForm.device_user_id} onChange={(event) => setManualForm({ ...manualForm, device_user_id: event.target.value })} placeholder="1001" />
                  </Field>
                  <Field label="Hodisa vaqti" htmlFor="manual_time" required>
                    <Input id="manual_time" type="datetime-local" value={manualForm.event_time} onChange={(event) => setManualForm({ ...manualForm, event_time: event.target.value })} />
                  </Field>
                  <Field label="Hodisa turi" htmlFor="manual_type">
                    <Select id="manual_type" value={manualForm.event_type} onChange={(event) => setManualForm({ ...manualForm, event_type: event.target.value })}>
                      {Object.entries(EVENT_TYPE_LABELS).filter(([value]) => value !== 'unknown').map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                    </Select>
                  </Field>
                  <Field label="Tasdiqlash usuli" htmlFor="manual_verify">
                    <Select id="manual_verify" value={manualForm.verify_mode} onChange={(event) => setManualForm({ ...manualForm, verify_mode: event.target.value })}>
                      {Object.entries(VERIFY_MODE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                    </Select>
                  </Field>
                  <div className="sm:col-span-2">
                    <Button type="submit" variant="primary" size="sm" loading={manualMutation.isPending}>Simulyatsiya hodisasini saqlash</Button>
                  </div>
                </form>
              </details>
            ) : null}
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Qurilmani o'chirish"
        message={deleteTarget ? <><strong>{deleteTarget.name}</strong> qurilmasini o'chirmoqchimisiz? Poller to'xtatiladi, tarixiy hodisalar saqlanadi.</> : ''}
        confirmLabel="O'chirish"
        danger
        loading={deleteMutation.isPending}
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
      />
    </div>
  )
}
