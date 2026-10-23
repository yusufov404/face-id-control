import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  CalendarCheck,
  CalendarPlus,
  CheckCircle2,
  ClipboardList,
  Eye,
  XCircle,
} from 'lucide-react'
import { leavesApi } from '@/api/services'
import type { LeaveDecisionInput, LeaveRequest, LeaveRequestInput } from '@/api/types'
import { useAuth } from '@/auth/AuthProvider'
import { EmployeeCombobox } from '@/components/forms/EmployeeCombobox'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { DataTable, Pagination, type Column } from '@/components/ui/DataTable'
import { Field, Input, Select, Textarea } from '@/components/ui/Field'
import { Alert } from '@/components/ui/Feedback'
import { FilterBar, InfoGrid, PageHeader } from '@/components/ui/LayoutBits'
import { useToast } from '@/components/ui/Toast'
import { useDocumentTitle } from '@/lib/hooks'
import {
  formatDate,
  formatDateTime,
  LEAVE_STATUS_LABELS,
  LEAVE_STATUS_TONES,
  LEAVE_TYPE_LABELS,
  todayISO,
} from '@/lib/format'
import {
  collectErrors,
  dateOrderError,
  hasErrors,
  nullableText,
  required,
  type ValidationErrors,
} from '@/lib/validation'

interface LeaveForm {
  employee_id: number | null
  leave_type: string
  start_date: string
  end_date: string
  reason: string
  attachment_url: string
}

const emptyForm = (): LeaveForm => ({
  employee_id: null,
  leave_type: 'annual',
  start_date: todayISO(),
  end_date: todayISO(),
  reason: '',
  attachment_url: '',
})

function dayCount(start: string, end: string): number | null {
  if (!start || !end) return null
  const from = new Date(`${start}T00:00:00`)
  const to = new Date(`${end}T00:00:00`)
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return null
  const days = Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1
  return days > 0 ? days : null
}

export default function LeavesPage() {
  const { can } = useAuth()
  const toast = useToast()
  const queryClient = useQueryClient()
  useDocumentTitle("Ta'tillar")

  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [statusFilter, setStatusFilter] = useState('')
  const [employeeId, setEmployeeId] = useState<number | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [form, setForm] = useState<LeaveForm>(emptyForm())
  const [errors, setErrors] = useState<ValidationErrors>({})
  const [formError, setFormError] = useState('')
  const [decisionTarget, setDecisionTarget] = useState<LeaveRequest | null>(null)
  const [decision, setDecision] = useState<'approve' | 'reject'>('approve')
  const [rejectionReason, setRejectionReason] = useState('')
  const [decisionError, setDecisionError] = useState('')
  const [viewTarget, setViewTarget] = useState<LeaveRequest | null>(null)

  const leavesQuery = useQuery({
    queryKey: ['leaves', page, pageSize, statusFilter, employeeId],
    queryFn: () => leavesApi.list({
      page,
      page_size: pageSize,
      status: statusFilter || undefined,
      employee_id: employeeId || undefined,
    }),
  })

  const createMutation = useMutation({
    mutationFn: () => {
      const payload: LeaveRequestInput = {
        employee_id: form.employee_id as number,
        leave_type: form.leave_type,
        start_date: form.start_date,
        end_date: form.end_date,
        reason: form.reason.trim(),
        attachment_url: nullableText(form.attachment_url),
      }
      return leavesApi.create(payload)
    },
    onSuccess: () => {
      toast.success("Ta'til so'rovi yaratildi")
      setCreateOpen(false)
      setForm(emptyForm())
      setFormError('')
      void queryClient.invalidateQueries({ queryKey: ['leaves'] })
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] })
    },
    onError: (error) => setFormError(error instanceof Error ? error.message : "So'rovni saqlab bo'lmadi"),
  })

  const decisionMutation = useMutation({
    mutationFn: () => {
      if (!decisionTarget) throw new Error("So'rov tanlanmagan")
      const payload: LeaveDecisionInput = {
        approve: decision === 'approve',
        rejection_reason: decision === 'reject' ? rejectionReason.trim() : null,
      }
      return leavesApi.decide(decisionTarget.id, payload)
    },
    onSuccess: () => {
      toast.success(decision === 'approve' ? "Ta'til tasdiqlandi" : "Ta'til rad etildi")
      setDecisionTarget(null)
      setRejectionReason('')
      setDecisionError('')
      void queryClient.invalidateQueries({ queryKey: ['leaves'] })
      void queryClient.invalidateQueries({ queryKey: ['attendance'] })
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] })
    },
    onError: (error) => setDecisionError(error instanceof Error ? error.message : "Qarorni saqlab bo'lmadi"),
  })

  function openCreate() {
    setForm(emptyForm())
    setErrors({})
    setFormError('')
    setCreateOpen(true)
  }

  function openDecision(leave: LeaveRequest, approve: boolean) {
    setDecisionTarget(leave)
    setDecision(approve ? 'approve' : 'reject')
    setRejectionReason('')
    setDecisionError('')
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    const url = form.attachment_url.trim()
    const nextErrors = collectErrors([
      ['employee_id', form.employee_id ? null : 'Xodimni tanlang'],
      ['start_date', required(form.start_date, 'Boshlanish sanasi')],
      ['end_date', required(form.end_date, 'Tugash sanasi') || dateOrderError(form.start_date, form.end_date)],
      ['reason', required(form.reason, 'Sabab') || (form.reason.trim().length < 3 ? "Sabab kamida 3 belgidan iborat bo'lishi kerak" : null)],
      ['attachment_url', url && !/^https?:\/\/.+/i.test(url) ? "Havola http:// yoki https:// bilan boshlanishi kerak" : null],
    ])
    setErrors(nextErrors)
    setFormError('')
    if (hasErrors(nextErrors)) return
    createMutation.mutate()
  }

  function submitDecision(event: FormEvent) {
    event.preventDefault()
    if (decision === 'reject' && rejectionReason.trim().length < 3) {
      setDecisionError("Rad etish sababi kamida 3 belgidan iborat bo'lishi kerak")
      return
    }
    setDecisionError('')
    decisionMutation.mutate()
  }

  const columns: Column<LeaveRequest>[] = [
    {
      key: 'employee',
      header: 'Xodim',
      cell: (leave) => (
        <div>
          <p className="text-xs font-semibold text-slate-900">{leave.employee_name || `Xodim #${leave.employee_id}`}</p>
          <p className="mt-0.5 font-mono text-[10px] text-slate-400">#{leave.employee_id}</p>
        </div>
      ),
    },
    {
      key: 'type',
      header: 'Turi',
      cell: (leave) => <Badge tone="blue">{LEAVE_TYPE_LABELS[leave.leave_type] || leave.leave_type}</Badge>,
    },
    {
      key: 'period',
      header: 'Davr',
      cell: (leave) => (
        <div className="text-xs tabular-nums">
          <p className="font-medium text-slate-700">{formatDate(leave.start_date)} — {formatDate(leave.end_date)}</p>
          <p className="mt-0.5 text-[10px] text-slate-400">{leave.total_days} kun</p>
        </div>
      ),
    },
    {
      key: 'reason',
      header: 'Sabab',
      cell: (leave) => <span className="line-clamp-2 max-w-[260px] text-[11px] text-slate-600">{leave.reason}</span>,
    },
    {
      key: 'status',
      header: 'Holat',
      cell: (leave) => (
        <div>
          <Badge tone={(LEAVE_STATUS_TONES[leave.status] as 'green' | 'red' | 'amber' | 'slate') || 'slate'}>
            {LEAVE_STATUS_LABELS[leave.status] || leave.status}
          </Badge>
          {leave.status === 'rejected' && leave.rejection_reason ? (
            <p className="mt-1 max-w-[220px] line-clamp-2 text-[10px] text-red-500">{leave.rejection_reason}</p>
          ) : null}
        </div>
      ),
    },
    {
      key: 'created',
      header: 'Yaratilgan',
      cell: (leave) => <span className="whitespace-nowrap text-[10px] text-slate-400">{formatDateTime(leave.created_at)}</span>,
    },
    {
      key: 'actions',
      header: '',
      headerClassName: 'text-right',
      className: 'text-right',
      cell: (leave) => (
        <div className="flex items-center justify-end gap-0.5">
          <button type="button" onClick={() => setViewTarget(leave)} className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700" title="Batafsil"><Eye className="h-4 w-4" /></button>
          {can('leave:approve') && leave.status === 'pending' ? (
            <>
              <button type="button" onClick={() => openDecision(leave, true)} className="rounded p-1.5 text-slate-400 hover:bg-emerald-50 hover:text-emerald-700" title="Tasdiqlash"><CheckCircle2 className="h-4 w-4" /></button>
              <button type="button" onClick={() => openDecision(leave, false)} className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600" title="Rad etish"><XCircle className="h-4 w-4" /></button>
            </>
          ) : null}
        </div>
      ),
    },
  ]

  const formDays = dayCount(form.start_date, form.end_date)
  const hasFilters = Boolean(statusFilter || employeeId)

  return (
    <div className="animate-in">
      <PageHeader
        eyebrow="Kadrlar"
        title="Ta'til so'rovlari"
        description="Ta'til so'rovlarini yaratish va tasdiqlash. Tasdiqlangan ta'til davomat hisobiga darhol ta'sir qiladi va audit jurnaliga yoziladi."
        actions={can('leave:create') ? <Button variant="primary" icon={<CalendarPlus className="h-4 w-4" />} onClick={openCreate}>Yangi so'rov</Button> : undefined}
      />

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <FilterBar>
          <div className="w-full lg:w-72">
            <EmployeeCombobox value={employeeId} onChange={(id) => { setEmployeeId(id); setPage(1) }} placeholder="Xodim bo'yicha filtr…" />
          </div>
          <Select value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value); setPage(1) }} className="lg:w-52" aria-label="Ta'til holati">
            <option value="">Barcha holatlar</option>
            {Object.entries(LEAVE_STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </Select>
          {hasFilters ? (
            <Button variant="ghost" size="sm" onClick={() => { setStatusFilter(''); setEmployeeId(null); setPage(1) }}>Filtrlarni tozalash</Button>
          ) : null}
          <div className="flex-1" />
          <span className="text-[11px] text-slate-400">{leavesQuery.data ? `${leavesQuery.data.total} ta so'rov` : ''}</span>
        </FilterBar>
        <DataTable
          columns={columns}
          rows={leavesQuery.data?.items}
          rowKey={(leave) => leave.id}
          loading={leavesQuery.isLoading}
          error={leavesQuery.error instanceof Error ? leavesQuery.error.message : null}
          onRetry={() => void leavesQuery.refetch()}
          emptyTitle="Ta'til so'rovlari topilmadi"
          emptyDescription={hasFilters ? "Tanlangan filtrlar bo'yicha so'rov yo'q." : "Hozircha ta'til so'rovlari mavjud emas."}
          emptyIcon={<ClipboardList className="h-6 w-6" />}
          emptyAction={can('leave:create') && !hasFilters ? <Button variant="primary" size="sm" icon={<CalendarPlus className="h-3.5 w-3.5" />} onClick={openCreate}>So'rov yaratish</Button> : undefined}
          footer={leavesQuery.data ? (
            <Pagination
              page={leavesQuery.data.page}
              pages={leavesQuery.data.pages}
              total={leavesQuery.data.total}
              pageSize={leavesQuery.data.page_size}
              onPageChange={setPage}
              onPageSizeChange={(size) => { setPageSize(size); setPage(1) }}
              loading={leavesQuery.isFetching}
            />
          ) : null}
        />
      </div>

      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Yangi ta'til so'rovi"
        description="So'rov yaratilganda holat 'Ko'rib chiqilmoqda' bo'ladi. Tasdiqlash yoki rad etish uchun leave:approve ruxsati kerak."
        size="lg"
        footer={(
          <>
            <Button variant="secondary" onClick={() => setCreateOpen(false)} disabled={createMutation.isPending}>Bekor qilish</Button>
            <Button variant="primary" onClick={() => document.getElementById('leave-form')?.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }))} loading={createMutation.isPending}>So'rov yuborish</Button>
          </>
        )}
      >
        <form id="leave-form" onSubmit={submit} className="space-y-4" noValidate>
          {formError ? <Alert tone="danger">{formError}</Alert> : null}
          <Field label="Xodim" htmlFor="leave_employee" required error={errors.employee_id}>
            <EmployeeCombobox id="leave_employee" value={form.employee_id} onChange={(id) => setForm({ ...form, employee_id: id })} invalid={Boolean(errors.employee_id)} />
          </Field>
          <Field label="Ta'til turi" htmlFor="leave_type" required>
            <Select id="leave_type" value={form.leave_type} onChange={(event) => setForm({ ...form, leave_type: event.target.value })}>
              {Object.entries(LEAVE_TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </Select>
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Boshlanish sanasi" htmlFor="leave_start" required error={errors.start_date}>
              <Input id="leave_start" type="date" value={form.start_date} onChange={(event) => setForm({ ...form, start_date: event.target.value })} invalid={Boolean(errors.start_date)} />
            </Field>
            <Field label="Tugash sanasi" htmlFor="leave_end" required error={errors.end_date} hint={formDays ? `${formDays} kun` : undefined}>
              <Input id="leave_end" type="date" value={form.end_date} onChange={(event) => setForm({ ...form, end_date: event.target.value })} invalid={Boolean(errors.end_date)} />
            </Field>
          </div>
          {formDays && form.employee_id ? (
            <div className="rounded-lg border border-teal-100 bg-teal-50/60 px-3 py-2 text-[11px] text-teal-800">
              Xodim {formatDate(form.start_date)} dan {formatDate(form.end_date)} gacha, jami <b>{formDays} kun</b> ta'tilda bo'ladi.
            </div>
          ) : null}
          <Field label="Sabab" htmlFor="leave_reason" required error={errors.reason} hint="Kamida 3 belgi">
            <Textarea id="leave_reason" value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })} invalid={Boolean(errors.reason)} placeholder="Ta'til sababini qisqacha yozing" />
          </Field>
          <Field label="Ilova havolasi" htmlFor="leave_attachment" error={errors.attachment_url} hint="Ixtiyoriy; tashqi hujjat havolasi (https://...)">
            <Input id="leave_attachment" type="url" value={form.attachment_url} onChange={(event) => setForm({ ...form, attachment_url: event.target.value })} invalid={Boolean(errors.attachment_url)} placeholder="https://…" />
          </Field>
          <Alert tone="info">Biometrik yoki tibbiy hujjat fayli serverga yuklanmaydi; faqat havola saqlanadi.</Alert>
        </form>
      </Modal>

      <Modal
        open={Boolean(decisionTarget)}
        onClose={() => setDecisionTarget(null)}
        title="Ta'til so'rovini ko'rib chiqish"
        description={decisionTarget ? `${decisionTarget.employee_name || 'Xodim'} · ${formatDate(decisionTarget.start_date)} — ${formatDate(decisionTarget.end_date)}` : undefined}
        size="md"
        footer={(
          <>
            <Button variant="secondary" onClick={() => setDecisionTarget(null)} disabled={decisionMutation.isPending}>Bekor qilish</Button>
            <Button variant={decision === 'approve' ? 'primary' : 'danger'} onClick={() => document.getElementById('decision-form')?.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }))} loading={decisionMutation.isPending}>
              {decision === 'approve' ? 'Tasdiqlash' : 'Rad etish'}
            </Button>
          </>
        )}
      >
        {decisionTarget ? (
          <form id="decision-form" onSubmit={submitDecision} className="space-y-4" noValidate>
            {decisionError ? <Alert tone="danger">{decisionError}</Alert> : null}
            <InfoGrid
              columns={2}
              items={[
                { label: 'Turi', value: LEAVE_TYPE_LABELS[decisionTarget.leave_type] || decisionTarget.leave_type },
                { label: 'Kunlar', value: `${decisionTarget.total_days} kun` },
                { label: 'Sabab', value: decisionTarget.reason },
                { label: 'Yaratilgan', value: formatDateTime(decisionTarget.created_at) },
              ]}
            />
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setDecision('approve')} className={`rounded-xl border p-3 text-left transition ${decision === 'approve' ? 'border-emerald-400 bg-emerald-50 ring-2 ring-emerald-500/20' : 'border-slate-200 hover:bg-slate-50'}`}>
                <CheckCircle2 className={`h-5 w-5 ${decision === 'approve' ? 'text-emerald-600' : 'text-slate-400'}`} />
                <p className="mt-1.5 text-xs font-bold text-slate-800">Tasdiqlash</p>
                <p className="mt-0.5 text-[10px] text-slate-500">Ta'til davomatda hisobga olinadi</p>
              </button>
              <button type="button" onClick={() => setDecision('reject')} className={`rounded-xl border p-3 text-left transition ${decision === 'reject' ? 'border-red-400 bg-red-50 ring-2 ring-red-500/20' : 'border-slate-200 hover:bg-slate-50'}`}>
                <XCircle className={`h-5 w-5 ${decision === 'reject' ? 'text-red-600' : 'text-slate-400'}`} />
                <p className="mt-1.5 text-xs font-bold text-slate-800">Rad etish</p>
                <p className="mt-0.5 text-[10px] text-slate-500">Sabab majburiy</p>
              </button>
            </div>
            {decision === 'reject' ? (
              <Field label="Rad etish sababi" htmlFor="rejection_reason" required hint="Kamida 3 belgi; xodimga ko'rinadi">
                <Textarea id="rejection_reason" value={rejectionReason} onChange={(event) => setRejectionReason(event.target.value)} placeholder="Nima uchun rad etilganini yozing" />
              </Field>
            ) : (
              <Alert tone="info">Tasdiqlangach ta'til davridagi davomat yozuvlari avtomatik qayta hisoblanadi.</Alert>
            )}
          </form>
        ) : null}
      </Modal>

      <Modal
        open={Boolean(viewTarget)}
        onClose={() => setViewTarget(null)}
        title="Ta'til so'rovi"
        description={viewTarget ? `${viewTarget.employee_name || 'Xodim'} · #${viewTarget.id}` : undefined}
        size="md"
        footer={<Button variant="secondary" onClick={() => setViewTarget(null)}>Yopish</Button>}
      >
        {viewTarget ? (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Badge tone={(LEAVE_STATUS_TONES[viewTarget.status] as 'green' | 'red' | 'amber' | 'slate') || 'slate'}>{LEAVE_STATUS_LABELS[viewTarget.status] || viewTarget.status}</Badge>
              <Badge tone="blue">{LEAVE_TYPE_LABELS[viewTarget.leave_type] || viewTarget.leave_type}</Badge>
            </div>
            <InfoGrid
              columns={2}
              items={[
                { label: 'Boshlanish', value: formatDate(viewTarget.start_date) },
                { label: 'Tugash', value: formatDate(viewTarget.end_date) },
                { label: 'Jami kun', value: `${viewTarget.total_days} kun` },
                { label: 'Yaratilgan', value: formatDateTime(viewTarget.created_at) },
                { label: 'Tasdiqlangan', value: viewTarget.approved_at ? formatDateTime(viewTarget.approved_at) : '—' },
                { label: 'Tasdiqlovchi ID', value: viewTarget.approved_by ? `#${viewTarget.approved_by}` : '—' },
              ]}
            />
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Sabab</p>
              <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{viewTarget.reason}</p>
            </div>
            {viewTarget.rejection_reason ? <Alert tone="danger" title="Rad etish sababi">{viewTarget.rejection_reason}</Alert> : null}
            {viewTarget.attachment_url ? (
              <a href={viewTarget.attachment_url} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1.5 text-xs font-semibold text-teal-700 hover:underline">
                <CalendarCheck className="h-4 w-4" /> Ilova havolasini ochish
              </a>
            ) : null}
          </div>
        ) : null}
      </Modal>
    </div>
  )
}
