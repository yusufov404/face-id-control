import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  BadgeCheck,
  Eye,
  Pencil,
  Plus,
  ScanFace,
  Trash2,
  Users,
  Zap,
} from 'lucide-react'
import { departmentsApi, devicesApi, employeesApi, positionsApi } from '@/api/services'
import type { Employee, EmployeeCreateInput, EmployeeStatusInput, EmployeeUpdateInput } from '@/api/types'
import { useAuth } from '@/auth/AuthProvider'
import { EmployeeCombobox } from '@/components/forms/EmployeeCombobox'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { ConfirmDialog, Modal } from '@/components/ui/Modal'
import { DataTable, Pagination, type Column } from '@/components/ui/DataTable'
import { Field, Input, Select, Textarea } from '@/components/ui/Field'
import { Alert } from '@/components/ui/Feedback'
import { FilterBar, InfoGrid, PageHeader, SearchInput } from '@/components/ui/LayoutBits'
import { useToast } from '@/components/ui/Toast'
import { useDebouncedValue, useDocumentTitle } from '@/lib/hooks'
import {
  EMPLOYMENT_STATUS_LABELS,
  EMPLOYMENT_STATUS_TONES,
  formatDate,
  formatDateTime,
  initials,
  todayISO,
} from '@/lib/format'
import {
  collectErrors,
  dateOrderError,
  emailError,
  hasErrors,
  nullableText,
  required,
  type ValidationErrors,
} from '@/lib/validation'

type ModalMode = 'create' | 'edit' | 'view' | 'status' | null

interface EmployeeForm {
  internal_id: string
  device_user_id: string
  first_name: string
  last_name: string
  middle_name: string
  gender: string
  birth_date: string
  phone: string
  email: string
  address: string
  status: string
  hire_date: string
  termination_date: string
  department_id: string
  position_id: string
  supervisor_id: number | null
  notes: string
}

const emptyForm = (): EmployeeForm => ({
  internal_id: '',
  device_user_id: '',
  first_name: '',
  last_name: '',
  middle_name: '',
  gender: '',
  birth_date: '',
  phone: '',
  email: '',
  address: '',
  status: 'active',
  hire_date: todayISO(),
  termination_date: '',
  department_id: '',
  position_id: '',
  supervisor_id: null,
  notes: '',
})

function fromEmployee(employee: Employee): EmployeeForm {
  return {
    internal_id: employee.internal_id,
    device_user_id: employee.device_user_id || '',
    first_name: employee.first_name,
    last_name: employee.last_name,
    middle_name: employee.middle_name || '',
    gender: employee.gender || '',
    birth_date: employee.birth_date || '',
    phone: employee.phone || '',
    email: employee.email || '',
    address: employee.address || '',
    status: employee.status,
    hire_date: employee.hire_date,
    termination_date: employee.termination_date || '',
    department_id: employee.department_id ? String(employee.department_id) : '',
    position_id: employee.position_id ? String(employee.position_id) : '',
    supervisor_id: employee.supervisor_id ?? null,
    notes: employee.notes || '',
  }
}

export default function EmployeesPage() {
  const { can } = useAuth()
  const toast = useToast()
  const queryClient = useQueryClient()
  useDocumentTitle('Xodimlar')

  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [search, setSearch] = useState('')
  const [departmentId, setDepartmentId] = useState('')
  const [positionId, setPositionId] = useState('')
  const [status, setStatus] = useState('')
  const [mode, setMode] = useState<ModalMode>(null)
  const [selected, setSelected] = useState<Employee | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Employee | null>(null)
  const [form, setForm] = useState<EmployeeForm>(emptyForm())
  const [errors, setErrors] = useState<ValidationErrors>({})
  const [formError, setFormError] = useState('')
  const [statusForm, setStatusForm] = useState({ status: 'active', termination_date: '', reason: '' })
  const [quickOpen, setQuickOpen] = useState(false)
  const [quickForm, setQuickForm] = useState({
    internal_id: '',
    first_name: '',
    last_name: '',
    middle_name: '',
    department_id: '',
    position_id: '',
    phone: '',
    hire_date: todayISO(),
  })
  const [quickErrors, setQuickErrors] = useState<ValidationErrors>({})
  const [quickError, setQuickError] = useState('')
  const [biometricOpen, setBiometricOpen] = useState(false)
  const [biometricEmployee, setBiometricEmployee] = useState<Employee | null>(null)
  const [biometricDeviceId, setBiometricDeviceId] = useState('')

  const debouncedSearch = useDebouncedValue(search)

  const departmentsQuery = useQuery({ queryKey: ['departments', 'options'], queryFn: departmentsApi.options })
  const positionsQuery = useQuery({
    queryKey: ['positions', 'option-list', departmentId || 'all'],
    queryFn: () => positionsApi.list({ page: 1, page_size: 100, department_id: departmentId || undefined }),
  })
  useQuery({
    queryKey: ['positions', 'quick-list', quickForm.department_id || 'all'],
    queryFn: () => positionsApi.list({ page: 1, page_size: 200, department_id: quickForm.department_id || undefined }),
    enabled: quickOpen,
  })
  const devicesQuery = useQuery({ queryKey: ['devices', 'enroll-options'], queryFn: () => devicesApi.list({ page: 1, page_size: 100 }), enabled: biometricOpen })
  const employeesQuery = useQuery({
    queryKey: ['employees', page, pageSize, debouncedSearch, departmentId, positionId, status],
    queryFn: () => employeesApi.list({
      page,
      page_size: pageSize,
      search: debouncedSearch || undefined,
      department_id: departmentId || undefined,
      position_id: positionId || undefined,
      status: status || undefined,
    }),
  })

  const formPositionsQuery = useQuery({
    queryKey: ['positions', 'form-list', form.department_id || 'all'],
    queryFn: () => positionsApi.list({ page: 1, page_size: 100, department_id: form.department_id || undefined }),
    enabled: mode === 'create' || mode === 'edit',
  })

  const saveMutation = useMutation({
    mutationFn: async () => {
      const department = form.department_id ? Number(form.department_id) : null
      const position = form.position_id ? Number(form.position_id) : null
      const base = {
        device_user_id: nullableText(form.device_user_id),
        first_name: form.first_name.trim(),
        last_name: form.last_name.trim(),
        middle_name: nullableText(form.middle_name),
        gender: form.gender || null,
        birth_date: form.birth_date || null,
        phone: nullableText(form.phone),
        email: nullableText(form.email),
        address: nullableText(form.address),
        status: form.status,
        hire_date: form.hire_date,
        termination_date: form.termination_date || null,
        department_id: department,
        position_id: position,
        supervisor_id: form.supervisor_id,
        notes: nullableText(form.notes),
      }
      if (mode === 'create') {
        const payload: EmployeeCreateInput = { ...base, internal_id: form.internal_id.trim() }
        return employeesApi.create(payload)
      }
      if (mode === 'edit' && selected) {
        const payload: EmployeeUpdateInput = base
        return employeesApi.update(selected.id, payload)
      }
      throw new Error('Amal aniqlanmadi')
    },
    onSuccess: () => {
      toast.success(mode === 'create' ? "Xodim qo'shildi" : "Xodim ma'lumotlari yangilandi")
      setMode(null)
      setSelected(null)
      setErrors({})
      setFormError('')
      void queryClient.invalidateQueries({ queryKey: ['employees'] })
    },
    onError: (error) => setFormError(error instanceof Error ? error.message : "Xodimni saqlab bo'lmadi"),
  })

  const quickCreateMutation = useMutation({
    mutationFn: async () => {
      const department = quickForm.department_id ? Number(quickForm.department_id) : null
      const position = quickForm.position_id ? Number(quickForm.position_id) : null
      const payload: EmployeeCreateInput = {
        internal_id: quickForm.internal_id.trim() || `EMP-${Date.now().toString().slice(-6)}`,
        first_name: quickForm.first_name.trim(),
        last_name: quickForm.last_name.trim(),
        middle_name: nullableText(quickForm.middle_name),
        phone: nullableText(quickForm.phone),
        status: 'active',
        hire_date: quickForm.hire_date,
        department_id: department,
        position_id: position,
        device_user_id: null,
        gender: null,
        birth_date: null,
        email: null,
        address: null,
        supervisor_id: null,
        termination_date: null,
        notes: null,
      }
      return employeesApi.create(payload)
    },
    onSuccess: (employee) => {
      toast.success("Xodim qo'shildi")
      setQuickOpen(false)
      setQuickErrors({})
      setQuickError('')
      setQuickForm({ internal_id: '', first_name: '', last_name: '', middle_name: '', department_id: '', position_id: '', phone: '', hire_date: todayISO() })
      void queryClient.invalidateQueries({ queryKey: ['employees'] })
      setBiometricEmployee(employee)
      const items = (devicesQuery.data as any)?.items || []
      const online = items.filter((d: any) => d.is_online)
      if (online.length === 1) {
        setBiometricDeviceId(String(online[0].id))
        setBiometricOpen(true)
        enrollMutation.mutate()
      } else if (items.length === 1) {
        setBiometricDeviceId(String(items[0].id))
        setBiometricOpen(true)
      } else {
        setBiometricDeviceId(online[0] ? String(online[0].id) : (items[0] ? String(items[0].id) : ''))
        setBiometricOpen(true)
      }
    },
    onError: (error) => setQuickError(error instanceof Error ? error.message : "Xodimni saqlab bo'lmadi"),
  })

  const enrollMutation = useMutation({
    mutationFn: async () => {
      if (!biometricEmployee || !biometricDeviceId) throw new Error('Terminal tanlanmagan')
      return (devicesApi as any).enrollFace(Number(biometricDeviceId), biometricEmployee.id)
    },
    onSuccess: (res: any) => {
      toast.success(res?.detail || "Yuzni ro'yxatdan o'tkazish buyrug'i yuborildi. Terminal oldida ro'yxatdan o'tkazing.")
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Yuzni ro'yxatdan o'tkazib bo'lmadi"),
  })

  const deleteMutation = useMutation({
    mutationFn: (employee: Employee) => employeesApi.remove(employee.id),
    onSuccess: (response) => {
      toast.success(response.detail)
      setDeleteTarget(null)
      void queryClient.invalidateQueries({ queryKey: ['employees'] })
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Xodimni o'chirib bo'lmadi"),
  })

  const statusMutation = useMutation({
    mutationFn: () => {
      if (!selected) throw new Error('Xodim tanlanmagan')
      const payload: EmployeeStatusInput = {
        status: statusForm.status,
        termination_date: statusForm.status === 'terminated' ? statusForm.termination_date || null : null,
        reason: nullableText(statusForm.reason),
      }
      return employeesApi.changeStatus(selected.id, payload)
    },
    onSuccess: () => {
      toast.success("Xodim holati o'zgartirildi")
      setMode(null)
      setSelected(null)
      void queryClient.invalidateQueries({ queryKey: ['employees'] })
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Holatni o'zgartirib bo'lmadi"),
  })

  function openCreate() {
    setForm(emptyForm())
    setErrors({})
    setFormError('')
    setSelected(null)
    setMode('create')
  }

  function openEdit(employee: Employee) {
    setSelected(employee)
    setForm(fromEmployee(employee))
    setErrors({})
    setFormError('')
    setMode('edit')
  }

  function openView(employee: Employee) {
    setSelected(employee)
    setMode('view')
  }

  function openStatus(employee: Employee) {
    setSelected(employee)
    setStatusForm({ status: employee.status, termination_date: employee.termination_date || '', reason: '' })
    setMode('status')
  }

  function openQuickAdd() {
    const nextId = employeesQuery.data?.total !== undefined ? `EMP-${String(employeesQuery.data.total + 1).padStart(4, '0')}` : `EMP-${Date.now().toString().slice(-4)}`
    setQuickForm({ internal_id: nextId, first_name: '', last_name: '', middle_name: '', department_id: '', position_id: '', phone: '', hire_date: todayISO() })
    setQuickErrors({})
    setQuickError('')
    setQuickOpen(true)
  }

  function validateQuick(): ValidationErrors {
    const result = collectErrors([
      ['last_name', required(quickForm.last_name, 'Familiya')],
      ['first_name', required(quickForm.first_name, 'Ism')],
      ['department_id', required(quickForm.department_id, "Bo'lim")],
    ])
    return result
  }

  function submitQuick(event: FormEvent) {
    event.preventDefault()
    const found = validateQuick()
    setQuickErrors(found)
    setQuickError('')
    if (hasErrors(found)) return
    quickCreateMutation.mutate()
  }

  function validateForm(): ValidationErrors {
    const result = collectErrors([
      ['internal_id', mode === 'create' ? required(form.internal_id, 'Ichki ID') : null],
      ['first_name', required(form.first_name, 'Ism')],
      ['last_name', required(form.last_name, 'Familiya')],
      ['hire_date', required(form.hire_date, 'Ishga kirgan sana')],
      ['email', form.email.trim() ? emailError(form.email) : null],
      ['termination_date', dateOrderError(form.hire_date, form.termination_date)],
    ])
    if (form.status === 'terminated' && !form.termination_date) {
      result.termination_date = "Ishdan bo'shatilgan xodim uchun sana majburiy"
    }
    return result
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    const found = validateForm()
    setErrors(found)
    setFormError('')
    if (hasErrors(found)) return
    saveMutation.mutate()
  }

  function submitStatus(event: FormEvent) {
    event.preventDefault()
    if (!selected) return
    if (statusForm.status === 'terminated' && !statusForm.termination_date) {
      toast.error("Ishdan bo'shatish sanasini kiriting")
      return
    }
    statusMutation.mutate()
  }

  const columns: Column<Employee>[] = [
    {
      key: 'employee',
      header: 'Xodim',
      cell: (employee) => (
        <button type="button" onClick={() => openView(employee)} className="flex items-center gap-2.5 text-left">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[10px] font-bold text-slate-600">
            {initials(employee.full_name)}
          </span>
          <span className="min-w-0">
            <span className="block max-w-[230px] truncate text-xs font-semibold text-slate-900 hover:text-teal-700">{employee.full_name}</span>
            <span className="mt-0.5 block font-mono text-[10px] text-slate-400">{employee.internal_id}{employee.device_user_id ? ` · qurilma: ${employee.device_user_id}` : ''}</span>
          </span>
        </button>
      ),
    },
    {
      key: 'org',
      header: "Bo'lim / lavozim",
      cell: (employee) => (
        <div className="text-xs">
          <p className="font-medium text-slate-700">{employee.department_name || "Bo'lim yo'q"}</p>
          <p className="mt-0.5 text-[10px] text-slate-400">{employee.position_name || 'Lavozim yo‘q'}</p>
        </div>
      ),
    },
    {
      key: 'contact',
      header: "Aloqa",
      cell: (employee) => (
        <div className="text-xs">
          <p className="text-slate-700">{employee.phone || '—'}</p>
          <p className="mt-0.5 max-w-[190px] truncate text-[10px] text-slate-400">{employee.email || '—'}</p>
        </div>
      ),
    },
    {
      key: 'hire',
      header: 'Ishga kirgan',
      cell: (employee) => <span className="whitespace-nowrap text-xs tabular-nums text-slate-600">{formatDate(employee.hire_date)}</span>,
    },
    {
      key: 'status',
      header: 'Holat',
      cell: (employee) => (
        <Badge tone={(EMPLOYMENT_STATUS_TONES[employee.status] as 'green' | 'red' | 'amber' | 'blue' | 'violet' | 'slate') || 'slate'}>
          {EMPLOYMENT_STATUS_LABELS[employee.status] || employee.status}
        </Badge>
      ),
    },
    {
      key: 'actions',
      header: '',
      headerClassName: 'text-right',
      className: 'text-right',
      cell: (employee) => (
        <div className="flex items-center justify-end gap-0.5">
          <button type="button" onClick={() => openView(employee)} className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700" title="Ko'rish">
            <Eye className="h-4 w-4" />
          </button>
          {can('employee:update') ? (
            <button type="button" onClick={() => openEdit(employee)} className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-teal-700" title="Tahrirlash">
              <Pencil className="h-4 w-4" />
            </button>
          ) : null}
          {can('employee:change_status') ? (
            <button type="button" onClick={() => openStatus(employee)} className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-violet-700" title="Holatni o'zgartirish">
              <BadgeCheck className="h-4 w-4" />
            </button>
          ) : null}
          {can('employee:delete') ? (
            <button type="button" onClick={() => setDeleteTarget(employee)} className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600" title="O'chirish">
              <Trash2 className="h-4 w-4" />
            </button>
          ) : null}
        </div>
      ),
    },
  ]

  return (
    <div className="animate-in">
      <PageHeader
        eyebrow="Kadrlar"
        title="Xodimlar"
        description="Xodimlarni qo'shish, tahrirlash, holatini o'zgartirish va bo'limlar bo'yicha filtrlash."
        actions={can('employee:create') ? (
          <div className="flex items-center gap-2">
            <Button variant="primary" icon={<Zap className="h-4 w-4" />} onClick={openQuickAdd}>Tezkor qo'shish</Button>
            <Button variant="ghost" icon={<Plus className="h-4 w-4" />} onClick={openCreate}>Batafsil qo'shish</Button>
          </div>
        ) : undefined}
      />

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <FilterBar>
          <SearchInput value={search} onChange={(value) => { setSearch(value); setPage(1) }} placeholder="F.I.Sh., ichki ID yoki telefon…" className="lg:w-72" />
          <Select value={departmentId} onChange={(event) => { setDepartmentId(event.target.value); setPositionId(''); setPage(1) }} className="lg:w-52" aria-label="Bo'lim">
            <option value="">Barcha bo'limlar</option>
            {departmentsQuery.data?.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}
          </Select>
          <Select value={positionId} onChange={(event) => { setPositionId(event.target.value); setPage(1) }} className="lg:w-48" aria-label="Lavozim">
            <option value="">Barcha lavozimlar</option>
            {positionsQuery.data?.items.map((position) => <option key={position.id} value={position.id}>{position.name}</option>)}
          </Select>
          <Select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1) }} className="lg:w-44" aria-label="Holat">
            <option value="">Barcha holatlar</option>
            {Object.entries(EMPLOYMENT_STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </Select>
          <div className="flex-1" />
          <span className="text-[11px] text-slate-400">{employeesQuery.data ? `${employeesQuery.data.total} ta xodim` : ''}</span>
        </FilterBar>

        <DataTable
          columns={columns}
          rows={employeesQuery.data?.items}
          rowKey={(employee) => employee.id}
          loading={employeesQuery.isLoading}
          error={employeesQuery.error instanceof Error ? employeesQuery.error.message : null}
          onRetry={() => void employeesQuery.refetch()}
          emptyTitle="Xodimlar topilmadi"
          emptyDescription="Filtrlarni o'zgartiring yoki yangi xodim qo'shing."
          emptyIcon={<Users className="h-6 w-6" />}
          emptyAction={can('employee:create') ? (
            <div className="flex items-center gap-2">
              <Button variant="secondary" size="sm" icon={<Zap className="h-3.5 w-3.5" />} onClick={openQuickAdd}>Tezkor qo'shish</Button>
              <Button variant="primary" size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={openCreate}>To'liq qo'shish</Button>
            </div>
          ) : undefined}
          footer={employeesQuery.data ? (
            <Pagination
              page={employeesQuery.data.page}
              pages={employeesQuery.data.pages}
              total={employeesQuery.data.total}
              pageSize={employeesQuery.data.page_size}
              onPageChange={setPage}
              onPageSizeChange={(size) => { setPageSize(size); setPage(1) }}
              loading={employeesQuery.isFetching}
            />
          ) : null}
        />
      </div>

      <Modal
        open={quickOpen}
        onClose={() => setQuickOpen(false)}
        title="Tezkor qo'shish"
        description="Familiya, ism va bo'limni kiriting"
        size="md"
        footer={(
          <>
            <Button variant="secondary" onClick={() => setQuickOpen(false)} disabled={quickCreateMutation.isPending}>Bekor qilish</Button>
            <Button variant="primary" onClick={() => document.getElementById('quick-employee-form')?.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }))} loading={quickCreateMutation.isPending}>
              Saqlash
            </Button>
          </>
        )}
      >
        <form id="quick-employee-form" onSubmit={submitQuick} noValidate className="space-y-3">
          {quickError ? <Alert tone="danger">{quickError}</Alert> : null}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Familiya" htmlFor="quick_last_name" required error={quickErrors.last_name}>
              <Input id="quick_last_name" value={quickForm.last_name} onChange={(event) => setQuickForm({ ...quickForm, last_name: event.target.value })} invalid={Boolean(quickErrors.last_name)} autoFocus />
            </Field>
            <Field label="Ism" htmlFor="quick_first_name" required error={quickErrors.first_name}>
              <Input id="quick_first_name" value={quickForm.first_name} onChange={(event) => setQuickForm({ ...quickForm, first_name: event.target.value })} invalid={Boolean(quickErrors.first_name)} />
            </Field>
            <Field label="Bo'lim" htmlFor="quick_department_id" required error={quickErrors.department_id} className="sm:col-span-2">
              <Select id="quick_department_id" value={quickForm.department_id} onChange={(event) => setQuickForm({ ...quickForm, department_id: event.target.value, position_id: '' })}>
                <option value="">Tanlang</option>
                {departmentsQuery.data?.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}
              </Select>
            </Field>
          </div>
        </form>
      </Modal>

      <Modal
        open={biometricOpen && Boolean(biometricEmployee)}
        onClose={() => setBiometricOpen(false)}
        title="Yuzni ro'yxatdan o'tkazish"
        description={biometricEmployee ? `${biometricEmployee.full_name} (${biometricEmployee.internal_id})` : undefined}
        size="sm"
        footer={(
          <>
            <Button variant="secondary" onClick={() => setBiometricOpen(false)} disabled={enrollMutation.isPending}>Tugatish</Button>
            {((devicesQuery.data as any)?.items || []).length > 1 ? (
              <Button variant="primary" icon={<ScanFace className="h-4 w-4" />} onClick={() => enrollMutation.mutate()} loading={enrollMutation.isPending} disabled={!biometricDeviceId}>
                Ro'yxatdan o'tkazishni boshlash
              </Button>
            ) : (
              <Button variant="primary" icon={<ScanFace className="h-4 w-4" />} onClick={() => enrollMutation.mutate()} loading={enrollMutation.isPending} disabled={!biometricDeviceId}>
                Boshlash
              </Button>
            )}
          </>
        )}
      >
        <div className="space-y-3">
          <Alert tone="info">Terminalga "face enroll" buyrug'i yuboriladi. Terminal oldida yuzni ko'rsatib ro'yxatdan o'tkazing.</Alert>
          {((devicesQuery.data as any)?.items || []).length > 1 ? (
            <Field label="Terminal" htmlFor="enroll_device">
              <Select id="enroll_device" value={biometricDeviceId} onChange={(event) => setBiometricDeviceId(event.target.value)}>
                <option value="">Tanlang</option>
                {((devicesQuery.data as any)?.items || []).map((device: any) => (
                  <option key={device.id} value={device.id}>{device.name} {device.is_online ? '(onlayn)' : '(offlayn)'}</option>
                ))}
              </Select>
            </Field>
          ) : null}
        </div>
      </Modal>

      <Modal
        open={mode === 'create' || mode === 'edit'}
        onClose={() => setMode(null)}
        title={mode === 'create' ? "Yangi xodim qo'shish (to'liq)" : 'Xodimni tahrirlash'}
        description="Shaxsiy ma'lumotlarni faqat ish maqsadida kiriting. O'zgarishlar audit jurnaliga yoziladi."
        size="xl"
        footer={(
          <>
            <Button variant="secondary" onClick={() => setMode(null)} disabled={saveMutation.isPending}>Bekor qilish</Button>
            <Button variant="primary" onClick={() => document.getElementById('employee-form')?.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }))} loading={saveMutation.isPending}>
              {mode === 'create' ? 'Saqlash' : 'Yangilash'}
            </Button>
          </>
        )}
      >
        <form id="employee-form" onSubmit={submit} noValidate className="space-y-5">
          {formError ? <Alert tone="danger">{formError}</Alert> : null}

          <div>
            <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">Identifikatsiya</h3>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="Ichki ID" htmlFor="internal_id" required error={errors.internal_id} hint={mode === 'edit' ? "Ichki ID o'zgartirilmaydi" : undefined}>
                <Input id="internal_id" value={form.internal_id} onChange={(event) => setForm({ ...form, internal_id: event.target.value })} disabled={mode === 'edit'} invalid={Boolean(errors.internal_id)} placeholder="EMP-0001" />
              </Field>
              <Field label="Qurilma ID" htmlFor="device_user_id" hint="Hikvision terminalidagi foydalanuvchi ID (ixtiyoriy)">
                <Input id="device_user_id" value={form.device_user_id} onChange={(event) => setForm({ ...form, device_user_id: event.target.value })} placeholder="1001" />
              </Field>
              <Field label="Holat" htmlFor="employee_status">
                <Select id="employee_status" value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value })}>
                  {Object.entries(EMPLOYMENT_STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </Select>
              </Field>
            </div>
          </div>

          <div>
            <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">Shaxsiy ma'lumotlar</h3>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="Familiya" htmlFor="last_name" required error={errors.last_name}>
                <Input id="last_name" value={form.last_name} onChange={(event) => setForm({ ...form, last_name: event.target.value })} invalid={Boolean(errors.last_name)} />
              </Field>
              <Field label="Ism" htmlFor="first_name" required error={errors.first_name}>
                <Input id="first_name" value={form.first_name} onChange={(event) => setForm({ ...form, first_name: event.target.value })} invalid={Boolean(errors.first_name)} />
              </Field>
              <Field label="Otasining ismi" htmlFor="middle_name">
                <Input id="middle_name" value={form.middle_name} onChange={(event) => setForm({ ...form, middle_name: event.target.value })} />
              </Field>
              <Field label="Jinsi" htmlFor="gender">
                <Select id="gender" value={form.gender} onChange={(event) => setForm({ ...form, gender: event.target.value })}>
                  <option value="">Ko'rsatilmagan</option>
                  <option value="male">Erkak</option>
                  <option value="female">Ayol</option>
                  <option value="other">Boshqa</option>
                </Select>
              </Field>
              <Field label="Tug'ilgan sana" htmlFor="birth_date">
                <Input id="birth_date" type="date" value={form.birth_date} onChange={(event) => setForm({ ...form, birth_date: event.target.value })} />
              </Field>
              <Field label="Telefon" htmlFor="phone">
                <Input id="phone" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} placeholder="+998 90 000 00 00" />
              </Field>
              <Field label="Email" htmlFor="email" error={errors.email}>
                <Input id="email" type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} invalid={Boolean(errors.email)} />
              </Field>
              <Field label="Manzil" htmlFor="address" className="sm:col-span-2">
                <Input id="address" value={form.address} onChange={(event) => setForm({ ...form, address: event.target.value })} />
              </Field>
            </div>
          </div>

          <div>
            <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">Ish ma'lumotlari</h3>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="Bo'lim" htmlFor="department_id">
                <Select id="department_id" value={form.department_id} onChange={(event) => setForm({ ...form, department_id: event.target.value, position_id: '' })}>
                  <option value="">Bo'limsiz</option>
                  {departmentsQuery.data?.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}
                </Select>
              </Field>
              <Field label="Lavozim" htmlFor="position_id">
                <Select id="position_id" value={form.position_id} onChange={(event) => setForm({ ...form, position_id: event.target.value })}>
                  <option value="">Lavozimsiz</option>
                  {formPositionsQuery.data?.items.map((position) => <option key={position.id} value={position.id}>{position.name}</option>)}
                </Select>
              </Field>
              <Field label="Rahbar" htmlFor="supervisor_id" hint="Xodimning bevosita rahbari">
                <EmployeeCombobox
                  id="supervisor_id"
                  value={form.supervisor_id}
                  onChange={(id) => setForm({ ...form, supervisor_id: id })}
                  label={selected?.supervisor_id === form.supervisor_id ? selected?.supervisor_name || undefined : undefined}
                />
              </Field>
              <Field label="Ishga kirgan sana" htmlFor="hire_date" required error={errors.hire_date}>
                <Input id="hire_date" type="date" value={form.hire_date} onChange={(event) => setForm({ ...form, hire_date: event.target.value })} invalid={Boolean(errors.hire_date)} />
              </Field>
              <Field label="Ishdan bo'shash sanasi" htmlFor="termination_date" error={errors.termination_date}>
                <Input id="termination_date" type="date" value={form.termination_date} onChange={(event) => setForm({ ...form, termination_date: event.target.value })} invalid={Boolean(errors.termination_date)} />
              </Field>
            </div>
            <Field label="Izoh" htmlFor="notes" className="mt-3">
              <Textarea id="notes" value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} />
            </Field>
          </div>
        </form>
      </Modal>

      <Modal
        open={mode === 'view' && Boolean(selected)}
        onClose={() => setMode(null)}
        title={selected?.full_name || 'Xodim'}
        description={selected ? `${selected.internal_id} · ${selected.department_name || "Bo'limsiz"}` : undefined}
        size="lg"
        footer={<Button variant="secondary" onClick={() => setMode(null)}>Yopish</Button>}
      >
        {selected ? (
          <div className="space-y-5">
            <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3.5">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-900 text-sm font-bold text-white">{initials(selected.full_name)}</div>
              <div>
                <p className="text-sm font-bold text-slate-900">{selected.full_name}</p>
                <p className="text-xs text-slate-500">{selected.position_name || 'Lavozim belgilanmagan'}</p>
                <Badge tone={(EMPLOYMENT_STATUS_TONES[selected.status] as 'green' | 'red' | 'amber' | 'blue' | 'violet' | 'slate') || 'slate'} className="mt-1">
                  {EMPLOYMENT_STATUS_LABELS[selected.status] || selected.status}
                </Badge>
              </div>
            </div>
            <InfoGrid
              columns={3}
              items={[
                { label: 'Ichki ID', value: <span className="font-mono">{selected.internal_id}</span> },
                { label: 'Qurilma ID', value: <span className="font-mono">{selected.device_user_id || '—'}</span> },
                { label: "Bo'lim", value: selected.department_name || '—' },
                { label: 'Lavozim', value: selected.position_name || '—' },
                { label: 'Rahbar', value: selected.supervisor_name || '—' },
                { label: 'Telefon', value: selected.phone || '—' },
                { label: 'Email', value: selected.email || '—' },
                { label: 'Tug‘ilgan sana', value: formatDate(selected.birth_date) },
                { label: 'Ishga kirgan', value: formatDate(selected.hire_date) },
                { label: 'Ishdan bo‘shagan', value: formatDate(selected.termination_date) },
                { label: 'Yaratilgan', value: formatDateTime(selected.created_at) },
                { label: 'Yangilangan', value: formatDateTime(selected.updated_at) },
              ]}
            />
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Manzil</p>
              <p className="mt-1 text-sm text-slate-700">{selected.address || '—'}</p>
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Izoh</p>
              <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{selected.notes || '—'}</p>
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={mode === 'status' && Boolean(selected)}
        onClose={() => setMode(null)}
        title="Xodim holatini o'zgartirish"
        description={selected ? `${selected.full_name} · hozirgi holat: ${EMPLOYMENT_STATUS_LABELS[selected.status] || selected.status}` : undefined}
        size="sm"
        footer={(
          <>
            <Button variant="secondary" onClick={() => setMode(null)} disabled={statusMutation.isPending}>Bekor qilish</Button>
            <Button variant="primary" onClick={() => document.getElementById('status-form')?.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }))} loading={statusMutation.isPending}>Holatni saqlash</Button>
          </>
        )}
      >
        <form id="status-form" onSubmit={submitStatus} className="space-y-3">
          <Field label="Yangi holat" htmlFor="new_status" required>
            <Select id="new_status" value={statusForm.status} onChange={(event) => setStatusForm({ ...statusForm, status: event.target.value })}>
              {Object.entries(EMPLOYMENT_STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </Select>
          </Field>
          {statusForm.status === 'terminated' ? (
            <Field label="Ishdan bo'shash sanasi" htmlFor="status_termination_date" required>
              <Input id="status_termination_date" type="date" value={statusForm.termination_date} onChange={(event) => setStatusForm({ ...statusForm, termination_date: event.target.value })} />
            </Field>
          ) : null}
          <Field label="Sabab / izoh" htmlFor="status_reason" hint="Audit jurnalida saqlanadi">
            <Textarea id="status_reason" value={statusForm.reason} onChange={(event) => setStatusForm({ ...statusForm, reason: event.target.value })} />
          </Field>
        </form>
      </Modal>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Xodimni o'chirish"
        message={deleteTarget ? (
          <>
            <strong>{deleteTarget.full_name}</strong> ni o'chirmoqchimisiz? Xodim arxivlanadi (soft delete),
            tarixiy davomat yozuvlari saqlanadi.
          </>
        ) : ''}
        confirmLabel="O'chirish"
        danger
        loading={deleteMutation.isPending}
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
      />
    </div>
  )
}
