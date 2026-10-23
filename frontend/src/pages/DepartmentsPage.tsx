import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Building2,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react'
import { departmentsApi } from '@/api/services'
import type { Department, DepartmentCreateInput, DepartmentUpdateInput } from '@/api/types'
import { useAuth } from '@/auth/AuthProvider'
import { EmployeeCombobox } from '@/components/forms/EmployeeCombobox'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { ConfirmDialog, Modal } from '@/components/ui/Modal'
import { DataTable, Pagination, type Column } from '@/components/ui/DataTable'
import { Checkbox, Field, Input, Select, Textarea } from '@/components/ui/Field'
import { Alert } from '@/components/ui/Feedback'
import { FilterBar, PageHeader, SearchInput } from '@/components/ui/LayoutBits'
import { useToast } from '@/components/ui/Toast'
import { useDebouncedValue, useDocumentTitle } from '@/lib/hooks'
import { formatDateTime, formatNumber } from '@/lib/format'
import {
  collectErrors,
  hasErrors,
  nullableText,
  required,
  type ValidationErrors,
} from '@/lib/validation'

interface DepartmentForm {
  name: string
  code: string
  description: string
  parent_id: string
  head_employee_id: number | null
  sort_order: string
  is_active: boolean
}

const emptyForm = (): DepartmentForm => ({
  name: '',
  code: '',
  description: '',
  parent_id: '',
  head_employee_id: null,
  sort_order: '0',
  is_active: true,
})

function fromDepartment(department: Department): DepartmentForm {
  return {
    name: department.name,
    code: department.code,
    description: department.description || '',
    parent_id: department.parent_id ? String(department.parent_id) : '',
    head_employee_id: department.head_employee_id ?? null,
    sort_order: String(department.sort_order ?? 0),
    is_active: department.is_active,
  }
}

export default function DepartmentsPage() {
  const { can } = useAuth()
  const toast = useToast()
  const queryClient = useQueryClient()
  useDocumentTitle("Bo'limlar")

  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [search, setSearch] = useState('')
  const [activeFilter, setActiveFilter] = useState('')
  const [mode, setMode] = useState<'create' | 'edit' | null>(null)
  const [selected, setSelected] = useState<Department | null>(null)
  const [form, setForm] = useState<DepartmentForm>(emptyForm())
  const [errors, setErrors] = useState<ValidationErrors>({})
  const [formError, setFormError] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<Department | null>(null)

  const debouncedSearch = useDebouncedValue(search)

  const listQuery = useQuery({
    queryKey: ['departments', page, pageSize, debouncedSearch, activeFilter],
    queryFn: () => departmentsApi.list({
      page,
      page_size: pageSize,
      search: debouncedSearch || undefined,
      is_active: activeFilter === '' ? undefined : activeFilter === 'true',
    }),
  })
  const optionsQuery = useQuery({ queryKey: ['departments', 'options'], queryFn: departmentsApi.options })

  const saveMutation = useMutation({
    mutationFn: async () => {
      const base = {
        name: form.name.trim(),
        code: form.code.trim(),
        description: nullableText(form.description),
        parent_id: form.parent_id ? Number(form.parent_id) : null,
        head_employee_id: form.head_employee_id,
        sort_order: Number(form.sort_order) || 0,
        is_active: form.is_active,
      }
      if (mode === 'create') {
        const payload: DepartmentCreateInput = base
        return departmentsApi.create(payload)
      }
      if (mode === 'edit' && selected) {
        const payload: DepartmentUpdateInput = base
        return departmentsApi.update(selected.id, payload)
      }
      throw new Error('Amal aniqlanmadi')
    },
    onSuccess: () => {
      toast.success(mode === 'create' ? "Bo'lim qo'shildi" : "Bo'lim yangilandi")
      setMode(null)
      setSelected(null)
      setFormError('')
      void queryClient.invalidateQueries({ queryKey: ['departments'] })
    },
    onError: (error) => setFormError(error instanceof Error ? error.message : "Bo'limni saqlab bo'lmadi"),
  })

  const deleteMutation = useMutation({
    mutationFn: (department: Department) => departmentsApi.remove(department.id),
    onSuccess: (response) => {
      toast.success(response.detail)
      setDeleteTarget(null)
      void queryClient.invalidateQueries({ queryKey: ['departments'] })
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Bo'limni o'chirib bo'lmadi"),
  })

  function openCreate() {
    setForm(emptyForm())
    setErrors({})
    setFormError('')
    setSelected(null)
    setMode('create')
  }

  function openEdit(department: Department) {
    setForm(fromDepartment(department))
    setErrors({})
    setFormError('')
    setSelected(department)
    setMode('edit')
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    const nextErrors = collectErrors([
      ['name', required(form.name, 'Nomi')],
      ['code', required(form.code, 'Kod')],
      ['code_pattern', form.code && !/^[A-Za-z0-9_-]+$/.test(form.code) ? "Kod faqat harf, raqam, _ va - belgilaridan iborat bo'lishi kerak" : null],
    ])
    if (form.parent_id && selected && Number(form.parent_id) === selected.id) {
      nextErrors.parent_id = "Bo'lim o'zini ota bo'lim qilib tanlay olmaydi"
    }
    setErrors(nextErrors)
    setFormError('')
    if (hasErrors(nextErrors)) return
    saveMutation.mutate()
  }

  const columns: Column<Department>[] = [
    {
      key: 'name',
      header: "Bo'lim",
      cell: (department) => (
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-teal-50 text-teal-700 ring-1 ring-teal-100">
            <Building2 className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-xs font-semibold text-slate-900">{department.name}</p>
            <p className="mt-0.5 font-mono text-[10px] text-slate-400">{department.code}</p>
          </div>
        </div>
      ),
    },
    {
      key: 'parent',
      header: 'Ota bo‘lim',
      cell: (department) => <span className="text-xs text-slate-600">{department.parent_name || '—'}</span>,
    },
    {
      key: 'employees',
      header: 'Xodimlar',
      cell: (department) => <span className="text-xs font-semibold tabular-nums text-slate-700">{formatNumber(department.employee_count)}</span>,
    },
    {
      key: 'sort',
      header: 'Tartib',
      cell: (department) => <span className="text-xs tabular-nums text-slate-500">{department.sort_order}</span>,
    },
    {
      key: 'status',
      header: 'Holat',
      cell: (department) => <Badge tone={department.is_active ? 'green' : 'slate'}>{department.is_active ? 'Faol' : 'Nofaol'}</Badge>,
    },
    {
      key: 'updated',
      header: 'Yangilangan',
      cell: (department) => <span className="whitespace-nowrap text-[11px] text-slate-500">{formatDateTime(department.updated_at)}</span>,
    },
    {
      key: 'actions',
      header: '',
      headerClassName: 'text-right',
      className: 'text-right',
      cell: (department) => (
        <div className="flex items-center justify-end gap-0.5">
          {can('department:update') ? (
            <button type="button" onClick={() => openEdit(department)} className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-teal-700" title="Tahrirlash">
              <Pencil className="h-4 w-4" />
            </button>
          ) : null}
          {can('department:delete') ? (
            <button type="button" onClick={() => setDeleteTarget(department)} className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600" title="O'chirish">
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
        title="Bo'limlar"
        description="Klinika tashkiliy tuzilmasi. Bo'limlar xodimlar va qurilmalar uchun server tomonda chegaralovchi omil hisoblanadi."
        actions={can('department:create') ? <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={openCreate}>Yangi bo'lim</Button> : undefined}
      />

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <FilterBar>
          <SearchInput value={search} onChange={(value) => { setSearch(value); setPage(1) }} placeholder="Nomi yoki kodi…" className="lg:w-72" />
          <Select value={activeFilter} onChange={(event) => { setActiveFilter(event.target.value); setPage(1) }} className="lg:w-44" aria-label="Faollik">
            <option value="">Barcha bo'limlar</option>
            <option value="true">Faqat faol</option>
            <option value="false">Faqat nofaol</option>
          </Select>
          <div className="flex-1" />
          <span className="text-[11px] text-slate-400">{listQuery.data ? `${listQuery.data.total} ta bo'lim` : ''}</span>
        </FilterBar>
        <DataTable
          columns={columns}
          rows={listQuery.data?.items}
          rowKey={(department) => department.id}
          loading={listQuery.isLoading}
          error={listQuery.error instanceof Error ? listQuery.error.message : null}
          onRetry={() => void listQuery.refetch()}
          emptyTitle="Bo'limlar topilmadi"
          emptyDescription="Filtrlarni o'zgartiring yoki yangi bo'lim yarating."
          emptyIcon={<Building2 className="h-6 w-6" />}
          footer={listQuery.data ? (
            <Pagination
              page={listQuery.data.page}
              pages={listQuery.data.pages}
              total={listQuery.data.total}
              pageSize={listQuery.data.page_size}
              onPageChange={setPage}
              onPageSizeChange={(size) => { setPageSize(size); setPage(1) }}
              loading={listQuery.isFetching}
            />
          ) : null}
        />
      </div>

      <Modal
        open={mode !== null}
        onClose={() => setMode(null)}
        title={mode === 'create' ? "Yangi bo'lim" : "Bo'limni tahrirlash"}
        description="Bo'lim kodi noyob bo'lishi va faqat harf, raqam, _ yoki - belgilaridan iborat bo'lishi kerak."
        size="lg"
        footer={(
          <>
            <Button variant="secondary" onClick={() => setMode(null)} disabled={saveMutation.isPending}>Bekor qilish</Button>
            <Button variant="primary" onClick={() => document.getElementById('department-form')?.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }))} loading={saveMutation.isPending}>
              {mode === 'create' ? 'Saqlash' : 'Yangilash'}
            </Button>
          </>
        )}
      >
        <form id="department-form" onSubmit={submit} className="space-y-4" noValidate>
          {formError ? <Alert tone="danger">{formError}</Alert> : null}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Nomi" htmlFor="dept_name" required error={errors.name}>
              <Input id="dept_name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} invalid={Boolean(errors.name)} />
            </Field>
            <Field label="Kod" htmlFor="dept_code" required error={errors.code || errors.code_pattern}>
              <Input id="dept_code" value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value.toUpperCase() })} invalid={Boolean(errors.code || errors.code_pattern)} placeholder="CARD" />
            </Field>
            <Field label="Ota bo'lim" htmlFor="dept_parent">
              <Select id="dept_parent" value={form.parent_id} onChange={(event) => setForm({ ...form, parent_id: event.target.value })}>
                <option value="">Ota bo'limsiz</option>
                {optionsQuery.data?.filter((option) => option.id !== selected?.id).map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
              </Select>
            </Field>
            <Field label="Tartib raqami" htmlFor="dept_sort">
              <Input id="dept_sort" type="number" min={0} value={form.sort_order} onChange={(event) => setForm({ ...form, sort_order: event.target.value })} />
            </Field>
          </div>
          <Field label="Bo'lim boshlig'i" htmlFor="dept_head" hint="Ixtiyoriy; xodimlar ro'yxatidan qidirib tanlang">
            <EmployeeCombobox id="dept_head" value={form.head_employee_id} onChange={(id) => setForm({ ...form, head_employee_id: id })} />
          </Field>
          <Field label="Tavsif" htmlFor="dept_description">
            <Textarea id="dept_description" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} />
          </Field>
          <Checkbox label="Faol bo'lim" description="Nofaol bo'limlar yangi xodim biriktirish uchun tanlanmaydi" checked={form.is_active} onChange={(event) => setForm({ ...form, is_active: event.target.checked })} />
        </form>
      </Modal>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Bo'limni o'chirish"
        message={deleteTarget ? (
          <>
            <strong>{deleteTarget.name}</strong> bo'limini o'chirmoqchimisiz? Agar bo'limda xodimlar mavjud bo'lsa,
            server amalni rad etadi. Bu amal audit jurnaliga yoziladi.
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
