import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Building2,
  CalendarDays,
  CalendarPlus,
  Repeat2,
  Trash2,
} from 'lucide-react'
import { departmentsApi, holidaysApi } from '@/api/services'
import type { Holiday, HolidayCreateInput } from '@/api/types'
import { useAuth } from '@/auth/AuthProvider'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { ConfirmDialog, Modal } from '@/components/ui/Modal'
import { DataTable, Pagination, type Column } from '@/components/ui/DataTable'
import { Checkbox, Field, Input, Select, Textarea } from '@/components/ui/Field'
import { Alert } from '@/components/ui/Feedback'
import { FilterBar, PageHeader } from '@/components/ui/LayoutBits'
import { useToast } from '@/components/ui/Toast'
import { useDocumentTitle } from '@/lib/hooks'
import { formatDate, todayISO } from '@/lib/format'
import { collectErrors, hasErrors, nullableText, required, type ValidationErrors } from '@/lib/validation'

const currentYear = todayISO().slice(0, 4)

interface HolidayForm {
  name: string
  date: string
  is_recurring: boolean
  description: string
  is_working_day: boolean
  applies_to_all: boolean
  department_ids: number[]
}

const emptyForm = (): HolidayForm => ({
  name: '',
  date: `${currentYear}-01-01`,
  is_recurring: false,
  description: '',
  is_working_day: false,
  applies_to_all: true,
  department_ids: [],
})

export default function HolidaysPage() {
  const { can } = useAuth()
  const toast = useToast()
  const queryClient = useQueryClient()
  useDocumentTitle('Bayramlar')

  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  const [year, setYear] = useState(String(currentYear))
  const [createOpen, setCreateOpen] = useState(false)
  const [form, setForm] = useState<HolidayForm>(emptyForm())
  const [errors, setErrors] = useState<ValidationErrors>({})
  const [formError, setFormError] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<Holiday | null>(null)

  const holidaysQuery = useQuery({
    queryKey: ['holidays', page, pageSize, year],
    queryFn: () => holidaysApi.list({
      page,
      page_size: pageSize,
      year: year ? Number(year) : undefined,
    }),
  })
  const departmentsQuery = useQuery({
    queryKey: ['departments', 'options'],
    queryFn: departmentsApi.options,
    enabled: createOpen && !form.applies_to_all,
  })

  const createMutation = useMutation({
    mutationFn: () => {
      const payload: HolidayCreateInput = {
        name: form.name.trim(),
        date: form.date,
        is_recurring: form.is_recurring,
        description: nullableText(form.description),
        is_working_day: form.is_working_day,
        applies_to_all: form.applies_to_all,
        department_ids: form.applies_to_all ? [] : form.department_ids,
      }
      return holidaysApi.create(payload)
    },
    onSuccess: () => {
      toast.success("Bayram qo'shildi")
      setCreateOpen(false)
      setForm(emptyForm())
      setFormError('')
      void queryClient.invalidateQueries({ queryKey: ['holidays'] })
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] })
    },
    onError: (error) => setFormError(error instanceof Error ? error.message : "Bayramni saqlab bo'lmadi"),
  })

  const deleteMutation = useMutation({
    mutationFn: (holiday: Holiday) => holidaysApi.remove(holiday.id),
    onSuccess: (response) => {
      toast.success(response.detail)
      setDeleteTarget(null)
      void queryClient.invalidateQueries({ queryKey: ['holidays'] })
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] })
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Bayramni o'chirib bo'lmadi"),
  })

  function openCreate() {
    setForm(emptyForm())
    setErrors({})
    setFormError('')
    setCreateOpen(true)
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    const nextErrors = collectErrors([
      ['name', required(form.name, 'Bayram nomi')],
      ['date', required(form.date, 'Sana')],
      ['departments', !form.applies_to_all && !form.department_ids.length ? "Kamida bitta bo'limni tanlang" : null],
    ])
    setErrors(nextErrors)
    setFormError('')
    if (hasErrors(nextErrors)) return
    createMutation.mutate()
  }

  const columns: Column<Holiday>[] = [
    {
      key: 'date',
      header: 'Sana',
      cell: (holiday) => (
        <div className="flex items-center gap-2.5">
          <span className="flex h-10 w-10 shrink-0 flex-col items-center justify-center rounded-lg bg-violet-50 text-violet-700 ring-1 ring-violet-100">
            <span className="text-[9px] font-bold uppercase leading-none">{formatDate(holiday.date).slice(3, 5)}</span>
            <span className="mt-0.5 text-sm font-black leading-none">{formatDate(holiday.date).slice(0, 2)}</span>
          </span>
          <div>
            <p className="text-xs font-semibold text-slate-900">{formatDate(holiday.date)}</p>
            <p className="mt-0.5 text-[10px] text-slate-400">{holiday.date.slice(0, 4)}-yil</p>
          </div>
        </div>
      ),
    },
    {
      key: 'name',
      header: 'Bayram',
      cell: (holiday) => (
        <div>
          <p className="text-xs font-semibold text-slate-800">{holiday.name}</p>
          <p className="mt-0.5 max-w-[340px] line-clamp-2 text-[10px] text-slate-500">{holiday.description || 'Tavsif yo‘q'}</p>
        </div>
      ),
    },
    {
      key: 'type',
      header: 'Turi',
      cell: (holiday) => (
        <div className="flex flex-wrap gap-1">
          <Badge tone={holiday.is_working_day ? 'blue' : 'violet'}>{holiday.is_working_day ? 'Ish kuni' : 'Dam olish kuni'}</Badge>
          {holiday.is_recurring ? <Badge tone="teal"><Repeat2 className="mr-0.5 h-3 w-3" />Har yil</Badge> : null}
        </div>
      ),
    },
    {
      key: 'scope',
      header: 'Doira',
      cell: (holiday) => (
        <div className="flex items-start gap-1.5 text-[11px] text-slate-600">
          <Building2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
          <span>{holiday.applies_to_all ? 'Barcha bo‘limlar' : `${holiday.department_ids.length} ta bo'lim`}</span>
        </div>
      ),
    },
    {
      key: 'actions',
      header: '',
      headerClassName: 'text-right',
      className: 'text-right',
      cell: (holiday) => can('holiday:delete') ? (
        <button type="button" onClick={() => setDeleteTarget(holiday)} className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600" title="O'chirish"><Trash2 className="h-4 w-4" /></button>
      ) : <span className="text-[10px] text-slate-400">—</span>,
    },
  ]

  return (
    <div className="animate-in">
      <PageHeader
        eyebrow="Kadrlar"
        title="Bayramlar va dam olish kunlari"
        description="Rasmiy bayramlar, dam olish va ish kunlari. Bu sanalar davomat hisobida 'Bayram' yoki 'Dam olish' holati sifatida hisobga olinadi."
        actions={can('holiday:create') ? <Button variant="primary" icon={<CalendarPlus className="h-4 w-4" />} onClick={openCreate}>Bayram qo'shish</Button> : undefined}
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm">
          <div className="flex items-center gap-2 text-slate-500"><CalendarDays className="h-4 w-4" /><span className="text-[11px] font-semibold uppercase tracking-wide">Tanlangan yil</span></div>
          <p className="mt-1 text-xl font-black tabular-nums text-slate-900">{year || 'Barchasi'}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm">
          <div className="flex items-center gap-2 text-slate-500"><Repeat2 className="h-4 w-4" /><span className="text-[11px] font-semibold uppercase tracking-wide">Jami sanalar</span></div>
          <p className="mt-1 text-xl font-black tabular-nums text-slate-900">{holidaysQuery.data?.total ?? '—'}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm">
          <div className="flex items-center gap-2 text-slate-500"><Building2 className="h-4 w-4" /><span className="text-[11px] font-semibold uppercase tracking-wide">Ko'rinish</span></div>
          <p className="mt-1 text-xs leading-relaxed text-slate-600">O'chirilgan bayram tarixan saqlanadi (soft delete).</p>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <FilterBar>
          <Select value={year} onChange={(event) => { setYear(event.target.value); setPage(1) }} className="lg:w-40" aria-label="Yil">
            <option value="">Barcha yillar</option>
            {Array.from({ length: 7 }, (_, index) => Number(currentYear) + 2 - index).map((value) => <option key={value} value={value}>{value}-yil</option>)}
          </Select>
          <div className="flex-1" />
          <span className="text-[11px] text-slate-400">{holidaysQuery.data ? `${holidaysQuery.data.total} ta sana` : ''}</span>
        </FilterBar>
        <DataTable
          columns={columns}
          rows={holidaysQuery.data?.items}
          rowKey={(holiday) => holiday.id}
          loading={holidaysQuery.isLoading}
          error={holidaysQuery.error instanceof Error ? holidaysQuery.error.message : null}
          onRetry={() => void holidaysQuery.refetch()}
          emptyTitle="Bayramlar topilmadi"
          emptyDescription={year ? `${year}-yil uchun bayramlar kiritilmagan.` : "Hozircha bayramlar kiritilmagan."}
          emptyIcon={<CalendarDays className="h-6 w-6" />}
          emptyAction={can('holiday:create') ? <Button variant="primary" size="sm" icon={<CalendarPlus className="h-3.5 w-3.5" />} onClick={openCreate}>Bayram qo'shish</Button> : undefined}
          footer={holidaysQuery.data ? (
            <Pagination
              page={holidaysQuery.data.page}
              pages={holidaysQuery.data.pages}
              total={holidaysQuery.data.total}
              pageSize={holidaysQuery.data.page_size}
              onPageChange={setPage}
              onPageSizeChange={(size) => { setPageSize(size); setPage(1) }}
              loading={holidaysQuery.isFetching}
            />
          ) : null}
        />
      </div>

      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Yangi bayram / dam olish kuni"
        description="Sanani belgilang. Har yil takrorlanadigan bayramlar uchun 'Har yil' belgisini yoqing. O'zgartirish uchun yozuvni o'chirib qayta qo'shing."
        size="lg"
        footer={(
          <>
            <Button variant="secondary" onClick={() => setCreateOpen(false)} disabled={createMutation.isPending}>Bekor qilish</Button>
            <Button variant="primary" onClick={() => document.getElementById('holiday-form')?.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }))} loading={createMutation.isPending}>Saqlash</Button>
          </>
        )}
      >
        <form id="holiday-form" onSubmit={submit} className="space-y-4" noValidate>
          {formError ? <Alert tone="danger">{formError}</Alert> : null}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Nomi" htmlFor="holiday_name" required error={errors.name}>
              <Input id="holiday_name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} invalid={Boolean(errors.name)} placeholder="Mustaqillik kuni" />
            </Field>
            <Field label="Sana" htmlFor="holiday_date" required error={errors.date}>
              <Input id="holiday_date" type="date" value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })} invalid={Boolean(errors.date)} />
            </Field>
          </div>
          <Field label="Tavsif" htmlFor="holiday_description">
            <Textarea id="holiday_description" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} />
          </Field>
          <div className="space-y-2 rounded-xl border border-slate-200 p-3">
            <Checkbox label="Har yil takrorlanadi" description="Sana oyi va kuni har yili bayram sifatida hisoblanadi" checked={form.is_recurring} onChange={(event) => setForm({ ...form, is_recurring: event.target.checked })} />
            <Checkbox label="Ish kuni" description="Belgilansa, bu sana dam olish emas, ish kuni sifatida hisoblanadi" checked={form.is_working_day} onChange={(event) => setForm({ ...form, is_working_day: event.target.checked })} />
            <Checkbox label="Barcha bo'limlarga tegishli" checked={form.applies_to_all} onChange={(event) => setForm({ ...form, applies_to_all: event.target.checked, department_ids: event.target.checked ? [] : form.department_ids })} />
          </div>
          {!form.applies_to_all ? (
            <div>
              <p className="mb-2 text-xs font-semibold text-slate-700">Bo'limlar <span className="text-red-500">*</span></p>
              {errors.departments ? <p className="mb-2 text-xs text-red-600">{errors.departments}</p> : null}
              {departmentsQuery.isLoading ? <p className="text-xs text-slate-500">Yuklanmoqda…</p> : (
                <div className="grid max-h-48 gap-1.5 overflow-y-auto rounded-lg border border-slate-200 p-2 sm:grid-cols-2">
                  {departmentsQuery.data?.map((department) => (
                    <label key={department.id} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-slate-700 hover:bg-slate-50">
                      <input
                        type="checkbox"
                        checked={form.department_ids.includes(department.id)}
                        onChange={() => setForm({ ...form, department_ids: form.department_ids.includes(department.id) ? form.department_ids.filter((id) => id !== department.id) : [...form.department_ids, department.id] })}
                        className="h-3.5 w-3.5 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
                      />
                      {department.name}
                    </label>
                  ))}
                </div>
              )}
            </div>
          ) : null}
          <Alert tone="info">Bir sanada faqat bitta bayram bo'lishi mumkin. Takroriy yozuvlar ham sana bo'yicha tekshiriladi.</Alert>
        </form>
      </Modal>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Bayramni o'chirish"
        message={deleteTarget ? <><strong>{deleteTarget.name}</strong> ({formatDate(deleteTarget.date)}) o'chirilsinmi? Yozuv arxivlanadi; tarixiy davomat qayta hisoblanmaydi.</> : ''}
        confirmLabel="O'chirish"
        danger
        loading={deleteMutation.isPending}
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
      />
    </div>
  )
}
