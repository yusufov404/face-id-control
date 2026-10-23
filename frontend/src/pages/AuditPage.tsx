import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  CheckCircle2,
  Download,
  Eye,
  FileSpreadsheet,
  ScrollText,
  ShieldAlert,
  XCircle,
} from 'lucide-react'
import { auditApi } from '@/api/services'
import type { AuditLog } from '@/api/types'
import { useAuth } from '@/auth/AuthProvider'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { DataTable, Pagination, type Column } from '@/components/ui/DataTable'
import { Input } from '@/components/ui/Field'
import { Alert, EmptyState } from '@/components/ui/Feedback'
import { FilterBar, InfoGrid, PageHeader, SearchInput } from '@/components/ui/LayoutBits'
import { useToast } from '@/components/ui/Toast'
import { useDebouncedValue, useDocumentTitle } from '@/lib/hooks'
import { addDaysISO, formatDateTime, safeJson, todayISO } from '@/lib/format'

const COMMON_ACTIONS = [
  'auth.login',
  'auth.logout',
  'employee.create',
  'employee.update',
  'employee.delete',
  'user.create',
  'user.update',
  'role.permission_update',
  'attendance.correct',
  'leave.create',
  'leave.decision',
  'device.create',
  'backup.create',
  'backup.restore',
]

export default function AuditPage() {
  const { can } = useAuth()
  const toast = useToast()
  useDocumentTitle('Audit jurnali')

  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  const [search, setSearch] = useState('')
  const [action, setAction] = useState('')
  const [resourceType, setResourceType] = useState('')
  const [dateFrom, setDateFrom] = useState(addDaysISO(-30))
  const [dateTo, setDateTo] = useState(todayISO())
  const [viewTarget, setViewTarget] = useState<AuditLog | null>(null)
  const [exporting, setExporting] = useState(false)

  const debouncedSearch = useDebouncedValue(search)
  const rangeError = dateFrom && dateTo && dateTo < dateFrom ? "Tugash sanasi boshlanish sanasidan keyin bo'lishi kerak" : ''
  const validRange = !rangeError

  const auditQuery = useQuery({
    queryKey: ['audit', page, pageSize, debouncedSearch, action, resourceType, dateFrom, dateTo],
    queryFn: () => auditApi.list({
      page,
      page_size: pageSize,
      search: debouncedSearch || undefined,
      action: action || undefined,
      resource_type: resourceType || undefined,
      date_from: dateFrom || undefined,
      date_to: dateTo || undefined,
    }),
    enabled: validRange,
  })

  async function exportAudit() {
    setExporting(true)
    try {
      await auditApi.download({ date_from: dateFrom || undefined, date_to: dateTo || undefined })
      toast.success('Audit jurnali yuklandi')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Audit jurnalini yuklab bo'lmadi")
    } finally {
      setExporting(false)
    }
  }

  const columns: Column<AuditLog>[] = [
    {
      key: 'time',
      header: 'Vaqt',
      cell: (log) => <span className="whitespace-nowrap text-[11px] tabular-nums text-slate-600">{formatDateTime(log.timestamp)}</span>,
    },
    {
      key: 'user',
      header: 'Foydalanuvchi',
      cell: (log) => (
        <div>
          <p className="text-xs font-semibold text-slate-800">{log.user_name || (log.user_id ? `Foydalanuvchi #${log.user_id}` : 'Tizim')}</p>
          <p className="mt-0.5 font-mono text-[10px] text-slate-400">{log.user_ip || '—'}</p>
        </div>
      ),
    },
    {
      key: 'action',
      header: 'Amal',
      cell: (log) => <Badge tone="blue">{log.action}</Badge>,
    },
    {
      key: 'resource',
      header: 'Resurs',
      cell: (log) => (
        <div className="text-xs">
          <p className="font-medium text-slate-700">{log.resource_type}</p>
          <p className="mt-0.5 font-mono text-[10px] text-slate-400">{log.resource_id || '—'}</p>
        </div>
      ),
    },
    {
      key: 'description',
      header: 'Tavsif',
      cell: (log) => <span className="line-clamp-2 max-w-[360px] text-[11px] text-slate-600">{log.description || '—'}</span>,
    },
    {
      key: 'result',
      header: 'Natija',
      cell: (log) => log.success
        ? <Badge tone="green"><CheckCircle2 className="mr-0.5 h-3 w-3" />Muvaffaqiyat</Badge>
        : <Badge tone="red"><XCircle className="mr-0.5 h-3 w-3" />Xatolik</Badge>,
    },
    {
      key: 'actions',
      header: '',
      headerClassName: 'text-right',
      className: 'text-right',
      cell: (log) => (
        <button type="button" onClick={() => setViewTarget(log)} className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-teal-700" title="Batafsil"><Eye className="h-4 w-4" /></button>
      ),
    },
  ]

  return (
    <div className="animate-in">
      <PageHeader
        eyebrow="Xavfsizlik"
        title="Audit jurnali"
        description="Tizimdagi barcha muhim amallar: kim, qachon, qaysi resursni o'zgartirgani. Audit yozuvlari faqat o'qish uchun; ularni tahrirlash API'da mavjud emas."
        actions={can('audit:export') ? (
          <Button variant="secondary" icon={<FileSpreadsheet className="h-4 w-4" />} loading={exporting} disabled={!validRange} onClick={() => void exportAudit()}>Excel eksport</Button>
        ) : undefined}
      />

      <div className="mb-4 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
        <div className="flex flex-col gap-2 lg:flex-row lg:flex-wrap lg:items-end">
          <SearchInput value={search} onChange={(value) => { setSearch(value); setPage(1) }} placeholder="Tavsif, amal yoki resurs ID…" className="lg:w-72" />
          <Input value={action} onChange={(event) => { setAction(event.target.value); setPage(1) }} placeholder="Amal (masalan: employee.update)" className="lg:w-64" aria-label="Amal" list="audit-actions" />
          <datalist id="audit-actions">
            {COMMON_ACTIONS.map((value) => <option key={value} value={value} />)}
          </datalist>
          <Input value={resourceType} onChange={(event) => { setResourceType(event.target.value); setPage(1) }} placeholder="Resurs turi (masalan: employee)" className="lg:w-56" aria-label="Resurs turi" />
          <div className="flex items-center gap-1.5">
            <Input type="date" value={dateFrom} onChange={(event) => { setDateFrom(event.target.value); setPage(1) }} className="w-[150px]" aria-label="Boshlanish sanasi" />
            <span className="text-xs text-slate-400">—</span>
            <Input type="date" value={dateTo} onChange={(event) => { setDateTo(event.target.value); setPage(1) }} className="w-[150px]" aria-label="Tugash sanasi" />
          </div>
        </div>
        {rangeError ? <p className="mt-2 text-xs font-medium text-red-600">{rangeError}</p> : null}
      </div>

      {can('audit:export') && (action || resourceType || debouncedSearch) ? (
        <Alert tone="warning" className="mb-4">
          Excel eksport serverda faqat <b>sana oralig'ini</b> qo'llaydi. Amal, resurs va qidiruv filtrlari faylga ta'sir qilmaydi.
        </Alert>
      ) : null}

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <FilterBar>
          <div className="flex items-center gap-2 text-[11px] text-slate-500">
            <ShieldAlert className="h-4 w-4 text-slate-400" />
            Audit yozuvi o'zgartirilmaydi va o'chirilmaydi.
          </div>
          <div className="flex-1" />
          <span className="text-[11px] text-slate-400">{auditQuery.data ? `${auditQuery.data.total} ta yozuv` : ''}</span>
        </FilterBar>
        {validRange ? (
          <DataTable
            columns={columns}
            rows={auditQuery.data?.items}
            rowKey={(log) => log.id}
            loading={auditQuery.isLoading}
            error={auditQuery.error instanceof Error ? auditQuery.error.message : null}
            onRetry={() => void auditQuery.refetch()}
            emptyTitle="Audit yozuvlari topilmadi"
            emptyDescription="Tanlangan davr va filtrlar bo'yicha yozuv yo'q."
            emptyIcon={<ScrollText className="h-6 w-6" />}
            dense
            footer={auditQuery.data ? (
              <Pagination
                page={auditQuery.data.page}
                pages={auditQuery.data.pages}
                total={auditQuery.data.total}
                pageSize={auditQuery.data.page_size}
                onPageChange={setPage}
                onPageSizeChange={(size) => { setPageSize(size); setPage(1) }}
                loading={auditQuery.isFetching}
              />
            ) : null}
          />
        ) : (
          <EmptyState title="Sana oralig'i noto'g'ri" description={rangeError} compact icon={<Download className="h-6 w-6" />} />
        )}
      </div>

      <Modal
        open={Boolean(viewTarget)}
        onClose={() => setViewTarget(null)}
        title="Audit yozuvi"
        description={viewTarget ? `#${viewTarget.id} · ${formatDateTime(viewTarget.timestamp)}` : undefined}
        size="lg"
        footer={<Button variant="secondary" onClick={() => setViewTarget(null)}>Yopish</Button>}
      >
        {viewTarget ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={viewTarget.success ? 'green' : 'red'}>{viewTarget.success ? 'Muvaffaqiyatli' : 'Xatolik'}</Badge>
              <Badge tone="blue">{viewTarget.action}</Badge>
              <Badge tone="slate">{viewTarget.resource_type}{viewTarget.resource_id ? `:${viewTarget.resource_id}` : ''}</Badge>
            </div>
            <InfoGrid
              columns={2}
              items={[
                { label: 'Foydalanuvchi', value: viewTarget.user_name || (viewTarget.user_id ? `#${viewTarget.user_id}` : 'Tizim') },
                { label: 'IP manzil', value: viewTarget.user_ip || '—' },
                { label: 'Resurs', value: viewTarget.resource_type },
                { label: 'Resurs ID', value: viewTarget.resource_id || '—' },
              ]}
            />
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Tavsif</p>
              <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{viewTarget.description || '—'}</p>
            </div>
            {viewTarget.changed_fields.length ? (
              <div>
                <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">O'zgargan maydonlar</p>
                <div className="flex flex-wrap gap-1">{viewTarget.changed_fields.map((field) => <Badge key={field} tone="amber">{field}</Badge>)}</div>
              </div>
            ) : null}
            {viewTarget.error_message ? <Alert tone="danger" title="Xatolik xabari">{viewTarget.error_message}</Alert> : null}
            <div className="grid gap-3 lg:grid-cols-2">
              <div>
                <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Eski qiymatlar</p>
                <pre className="max-h-48 overflow-auto rounded-lg bg-slate-950 p-3 text-[10px] leading-relaxed text-slate-300">{safeJson(viewTarget.old_values)}</pre>
              </div>
              <div>
                <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Yangi qiymatlar</p>
                <pre className="max-h-48 overflow-auto rounded-lg bg-slate-950 p-3 text-[10px] leading-relaxed text-slate-300">{safeJson(viewTarget.new_values)}</pre>
              </div>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  )
}
