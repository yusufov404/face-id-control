import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BriefcaseBusiness, Pencil, Plus, Trash2 } from 'lucide-react'
import { departmentsApi, positionsApi } from '@/api/services'
import type { Position, PositionCreateInput, PositionUpdateInput } from '@/api/types'
import { useAuth } from '@/auth/AuthProvider'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { ConfirmDialog, Modal } from '@/components/ui/Modal'
import { DataTable, Pagination, type Column } from '@/components/ui/DataTable'
import { Checkbox, Field, Input, Select, Textarea } from '@/components/ui/Field'
import { Alert } from '@/components/ui/Feedback'
import { FilterBar, PageHeader, SearchInput } from '@/components/ui/LayoutBits'
import { useToast } from '@/components/ui/Toast'
import { useDebouncedValue, useDocumentTitle } from '@/lib/hooks'
import { formatDateTime } from '@/lib/format'
import {
  collectErrors,
  hasErrors,
  nullableText,
  required,
  type ValidationErrors,
} from '@/lib/validation'

interface PositionForm {
  name: string
  code: string
  department_id: string
  description: string
  sort_order: string
  is_active: boolean
}

const emptyForm = (): PositionForm => ({
  name: '',
  code: '',
  department_id: '',
  description: '',
  sort_order: '0',
  is_active: true,
})

function fromPosition(position: Position): PositionForm {
  return {
    name: position.name,
    code: position.code,
    department_id: position.department_id ? String(position.department_id) : '',
    description: position.description || '',
    sort_order: String(position.sort_order ?? 0),
    is_active: position.is_active,
  }
}

export default function PositionsPage() {
  const { can } = useAuth()
  const toast = useToast()
  const queryClient = useQueryClient()
  useDocumentTitle('Lavozimlar')

  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [search, setSearch] = useState('')
  const [departmentId, setDepartmentId] = useState('')
  const [mode, setMode] = useState<'create' | 'edit' | null>(null)
  const [selected, setSelected] = useState<Position | null>(null)
  const [form, setForm] = useState<PositionForm>(emptyForm())
  const [errors, setErrors] = useState<ValidationErrors>({})
  const [formError, setFormError] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<Position | null>(null)

  const debouncedSearch = useDebouncedValue(search)

  const listQuery = useQuery({
    queryKey: ['positions', page, pageSize, debouncedSearch, departmentId],
    queryFn: () => positionsApi.list({
      page,
      page_size: pageSize,
      search: debouncedSearch || undefined,
      department_id: departmentId || undefined,
    }),
  })
  const departmentsQuery = useQuery({ queryKey: ['departments', 'options'], queryFn: departmentsApi.options })

  const saveMutation = useMutation({
    mutationFn: async () => {
      const base = {
        name: form.name.trim(),
        code: form.code.trim(),
        description: nullableText(form.description),
        department_id: form.department_id ? Number(form.department_id) : null,
        is_active: form.is_active,
        sort_order: Number(form.sort_order) || 0,
      }
      if (mode === 'create') {
        const payload: PositionCreateInput = base
        return positionsApi.create(payload)
      }
      if (mode === 'edit' && selected) {
        const payload: PositionUpdateInput = base
        return positionsApi.update(selected.id, payload)
      }
      throw new Error('Amal aniqlanmadi')
    },
    onSuccess: () => {
      toast.success(mode === 'create' ? "Lavozim qo'shildi" : 'Lavozim yangilandi')
      setMode(null)
      setSelected(null)
      setFormError('')
      void queryClient.invalidateQueries({ queryKey: ['positions'] })
    },
    onError: (error) => setFormError(error instanceof Error ? error.message : "Lavozimni saqlab bo'lmadi"),
  })

  const deleteMutation = useMutation({
    mutationFn: (position: Position) => positionsApi.remove(position.id),
    onSuccess: (response) => {
      toast.success(response.detail)
      setDeleteTarget(null)
      void queryClient.invalidateQueries({ queryKey: ['positions'] })
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Lavozimni o'chirib bo'lmadi"),
  })

  function openCreate() {
    setForm(emptyForm())
    setSelected(null)
    setErrors({})
    setFormError('')
    setMode('create')
  }

  function openEdit(position: Position) {
    setForm(fromPosition(position))
    setSelected(position)
    setErrors({})
    setFormError('')
    setMode('edit')
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    const nextErrors = collectErrors([
      ['name', required(form.name, 'Nomi')],
      ['code', required(form.code, 'Kod')],
      ['code_pattern', form.code && !/^[A-Za-z0-9_-]+$/.test(form.code) ? "Kod faqat harf, raqam, _ va - belgilaridan iborat bo'lishi kerak" : null],
    ])
    setErrors(nextErrors)
    setFormError('')
    if (hasErrors(nextErrors)) return
    saveMutation.mutate()
  }

  const columns: Column<Position>[] = [
    {
      key: 'name',
      header: 'Lavozim',
      cell: (position) => (
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-50 text-violet-700 ring-1 ring-violet-100">
            <BriefcaseBusiness className="h-4 w-4" />
          </span>
          <div>
            <p className="text-xs font-semibold text-slate-900">{position.name}</p>
            <p className="mt-0.5 font-mono text-[10px] text-slate-400">{position.code}</p>
          </div>
        </div>
      ),
    },
    {
      key: 'department',
      header: "Bo'lim",
      cell: (position) => <span className="text-xs text-slate-600">{position.department_name || "Bo'limga bog'lanmagan"}</span>,
    },
    {
      key: 'description',
      header: 'Tavsif',
      cell: (position) => <span className="line-clamp-2 max-w-[320px] text-xs text-slate-500">{position.description || '—'}</span>,
    },
    {
      key: 'sort',
      header: 'Tartib',
      cell: (position) => <span className="text-xs tabular-nums text-slate-500">{position.sort_order}</span>,
    },
    {
      key: 'status',
      header: 'Holat',
      cell: (position) => <Badge tone={position.is_active ? 'green' : 'slate'}>{position.is_active ? 'Faol' : 'Nofaol'}</Badge>,
    },
    {
      key: 'updated',
      header: 'Yangilangan',
      cell: (position) => <span className="whitespace-nowrap text-[11px] text-slate-500">{formatDateTime(position.updated_at)}</span>,
    },
    {
      key: 'actions',
      header: '',
      headerClassName: 'text-right',
      className: 'text-right',
      cell: (position) => (
        <div className="flex items-center justify-end gap-0.5">
          {can('position:update') ? (
            <button type="button" onClick={() => openEdit(position)} className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-teal-700" title="Tahrirlash">
              <Pencil className="h-4 w-4" />
            </button>
          ) : null}
          {can('position:delete') ? (
            <button type="button" onClick={() => setDeleteTarget(position)} className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600" title="O'chirish">
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
        title="Lavozimlar"
        description="Xodimlar uchun lavozimlar ro'yxati. Bo'limga bog'langan lavozimlar xodim kartasida tanlanadi."
        actions={can('position:create') ? <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={openCreate}>Yangi lavozim</Button> : undefined}
      />

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <FilterBar>
          <SearchInput value={search} onChange={(value) => { setSearch(value); setPage(1) }} placeholder="Lavozim nomi yoki kodi…" className="lg:w-72" />
          <Select value={departmentId} onChange={(event) => { setDepartmentId(event.target.value); setPage(1) }} className="lg:w-56" aria-label="Bo'lim">
            <option value="">Barcha bo'limlar</option>
            {departmentsQuery.data?.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}
          </Select>
          <div className="flex-1" />
          <span className="text-[11px] text-slate-400">{listQuery.data ? `${listQuery.data.total} ta lavozim` : ''}</span>
        </FilterBar>
        <DataTable
          columns={columns}
          rows={listQuery.data?.items}
          rowKey={(position) => position.id}
          loading={listQuery.isLoading}
          error={listQuery.error instanceof Error ? listQuery.error.message : null}
          onRetry={() => void listQuery.refetch()}
          emptyTitle="Lavozimlar topilmadi"
          emptyDescription="Filtrlarni o'zgartiring yoki yangi lavozim qo'shing."
          emptyIcon={<BriefcaseBusiness className="h-6 w-6" />}
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
        title={mode === 'create' ? 'Yangi lavozim' : 'Lavozimni tahrirlash'}
        size="lg"
        footer={(
          <>
            <Button variant="secondary" onClick={() => setMode(null)} disabled={saveMutation.isPending}>Bekor qilish</Button>
            <Button variant="primary" onClick={() => document.getElementById('position-form')?.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }))} loading={saveMutation.isPending}>
              {mode === 'create' ? 'Saqlash' : 'Yangilash'}
            </Button>
          </>
        )}
      >
        <form id="position-form" onSubmit={submit} className="space-y-4" noValidate>
          {formError ? <Alert tone="danger">{formError}</Alert> : null}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Nomi" htmlFor="position_name" required error={errors.name}>
              <Input id="position_name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} invalid={Boolean(errors.name)} />
            </Field>
            <Field label="Kod" htmlFor="position_code" required error={errors.code || errors.code_pattern}>
              <Input id="position_code" value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value.toUpperCase() })} invalid={Boolean(errors.code || errors.code_pattern)} placeholder="DOCTOR" />
            </Field>
            <Field label="Bo'lim" htmlFor="position_department">
              <Select id="position_department" value={form.department_id} onChange={(event) => setForm({ ...form, department_id: event.target.value })}>
                <option value="">Bo'limsiz</option>
                {departmentsQuery.data?.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}
              </Select>
            </Field>
            <Field label="Tartib raqami" htmlFor="position_sort">
              <Input id="position_sort" type="number" min={0} value={form.sort_order} onChange={(event) => setForm({ ...form, sort_order: event.target.value })} />
            </Field>
          </div>
          <Field label="Tavsif" htmlFor="position_description">
            <Textarea id="position_description" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} />
          </Field>
          <Checkbox label="Faol lavozim" checked={form.is_active} onChange={(event) => setForm({ ...form, is_active: event.target.checked })} />
        </form>
      </Modal>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Lavozimni o'chirish"
        message={deleteTarget ? <><strong>{deleteTarget.name}</strong> lavozimini o'chirmoqchimisiz? Bu amal audit jurnaliga yoziladi.</> : ''}
        confirmLabel="O'chirish"
        danger
        loading={deleteMutation.isPending}
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
      />
    </div>
  )
}
