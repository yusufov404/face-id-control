import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  RefreshCw,
  User,
  UserPlus,
  WifiOff,
  XCircle,
} from 'lucide-react'
import { monitoringApi, employeesApi } from '@/api/services'
import type { LiveEvent, Employee } from '@/api/types'
import { Badge, Dot } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { DataTable, Pagination, type Column } from '@/components/ui/DataTable'
import { FilterBar, InfoGrid, PageHeader, SearchInput } from '@/components/ui/LayoutBits'
import { Select } from '@/components/ui/Field'
import { Modal } from '@/components/ui/Modal'
import { Input } from '@/components/ui/Field'
import { useDebouncedValue } from '@/lib/hooks'
import { useToast } from '@/components/ui/Toast'
import {
  DEVICE_STATUS_LABELS,
  DEVICE_STATUS_TONES,
  EVENT_TYPE_LABELS,
  formatDateTime,
  VERIFY_MODE_LABELS,
} from '@/lib/format'

export default function MonitoringPage() {
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  const [search, setSearch] = useState('')
  const [deptFilter, setDeptFilter] = useState('')
  const [eventTypeFilter, setEventTypeFilter] = useState('')
  const [processedFilter, setProcessedFilter] = useState('')
  const [hoursFilter, setHoursFilter] = useState(24)
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [unmappedOnly, setUnmappedOnly] = useState(false)
  const [linkEvent, setLinkEvent] = useState<LiveEvent | null>(null)
  const [empSearch, setEmpSearch] = useState('')
  const [selectedEmp, setSelectedEmp] = useState<Employee | null>(null)
  const queryClient = useQueryClient()
  const toast = useToast()

  const debouncedSearch = useDebouncedValue(search, 300)
  const debouncedEmpSearch = useDebouncedValue(empSearch, 300)

  const eventsQuery = useQuery({
    queryKey: ['monitoring-events', page, pageSize, debouncedSearch, deptFilter, eventTypeFilter, processedFilter, hoursFilter, unmappedOnly],
    queryFn: () => monitoringApi.liveEvents({
      page,
      page_size: pageSize,
      search: debouncedSearch || undefined,
      department_id: deptFilter ? Number(deptFilter) : undefined,
      event_type: eventTypeFilter || undefined,
      processed: processedFilter === '' ? undefined : processedFilter === 'true',
      hours: hoursFilter,
      unmapped: unmappedOnly || undefined,
    }),
    refetchInterval: autoRefresh ? 10000 : false,
  })

  const devicesQuery = useQuery({
    queryKey: ['monitoring-devices-status'],
    queryFn: () => monitoringApi.devicesStatus({ department_id: deptFilter ? Number(deptFilter) : undefined }),
    refetchInterval: autoRefresh ? 30000 : false,
  })

  const statsQuery = useQuery({
    queryKey: ['monitoring-today-stats', deptFilter],
    queryFn: () => monitoringApi.todayStats({ department_id: deptFilter ? Number(deptFilter) : undefined }),
    refetchInterval: autoRefresh ? 15000 : false,
  })

  const deptsQuery = useQuery({ queryKey: ['monitoring-depts'], queryFn: () => monitoringApi.departmentsOptions() })

  const employeesSearchQuery = useQuery({
    queryKey: ['employees-search-link', debouncedEmpSearch],
    queryFn: () => employeesApi.list({ page: 1, page_size: 10, search: debouncedEmpSearch || undefined }),
    enabled: linkEvent !== null,
  })

  const handleLink = async () => {
    if (!linkEvent || !selectedEmp || !linkEvent.device_id || !linkEvent.device_user_id) {
      toast.error("Ma'lumotlar to'liq emas")
      return
    }
    try {
      await employeesApi.addDeviceMapping(selectedEmp.id, {
        device_id: linkEvent.device_id,
        device_user_id: String(linkEvent.device_user_id),
      })
      toast.success("Xodim terminalga bog'landi")
      setLinkEvent(null)
      setSelectedEmp(null)
      setEmpSearch('')
      await queryClient.invalidateQueries({ queryKey: ['monitoring-events'] })
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || "Bog'lashda xatolik yuz berdi")
    }
  }

  const eventColumns: Column<LiveEvent>[] = [
    {
      key: 'time',
      header: 'Vaqt',
      cell: (event) => (
        <span className="whitespace-nowrap text-[11px] tabular-nums text-slate-700">
          {formatDateTime(event.event_time)}
        </span>
      ),
    },
    {
      key: 'device',
      header: 'Qurilma / Joylashuv',
      cell: (event) => (
        <div className="text-xs">
          <p className="font-medium text-slate-800">{event.device_name}</p>
          <p className="mt-0.5 font-mono text-[10px] text-slate-400">{event.device_ip}</p>
          {event.location && <p className="mt-0.5 max-w-[180px] truncate text-[10px] text-slate-500">{event.location}</p>}
          {event.department_name && <p className="mt-0.5 text-[10px] text-teal-600">{event.department_name}</p>}
        </div>
      ),
    },
    {
      key: 'employee',
      header: 'Xodim / Qurilma ID',
      cell: (event) => (
        <div className="text-xs">
          <p className="font-medium text-slate-800">
            {event.employee_name ? (
              <>
                <User className="inline h-3 w-3 mr-1 text-slate-400" />
                {event.employee_name}
              </>
            ) : (
              <span className="text-slate-400">Xodim bog‘lanmagan</span>
            )}
          </p>
          <p className="mt-0.5 font-mono text-[10px] text-slate-400">{event.device_user_id || '—'}</p>
        </div>
      ),
    },
    {
      key: 'type',
      header: 'Hodisa turi',
      cell: (event) => (
        <Badge tone={event.event_type === 'check_in' ? 'green' : event.event_type === 'check_out' ? 'blue' : 'slate'}>
          {EVENT_TYPE_LABELS[event.event_type] || event.event_type}
        </Badge>
      ),
    },
    {
      key: 'verify',
      header: 'Tasdiqlash',
      cell: (event) => (
        <span className="text-[11px] text-slate-600">
          {event.verify_mode ? VERIFY_MODE_LABELS[event.verify_mode] || event.verify_mode : '—'}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Holati',
      cell: (event) => (
        <div className="flex items-center gap-1.5">
          {event.is_simulated ? (
            <Badge tone="amber" className="text-[10px]">
              <AlertTriangle className="h-2.5 w-2.5 mr-0.5" /> Simulyatsiya
            </Badge>
          ) : (
            <Badge tone={event.processed ? 'green' : 'amber'}>
              <Dot tone={event.processed ? 'green' : 'amber'} />
              {event.processed ? 'Qayta ishlangan' : 'Kutilmoqda'}
            </Badge>
          )}
        </div>
      ),
    },
    {
      key: 'actions',
      header: 'Amallar',
      cell: (event) => (
        event.employee_id ? null : (
          <Button size="sm" variant="primary" icon={<UserPlus className="h-3.5 w-3.5" />} onClick={() => setLinkEvent(event)}>
            Bog‘lash
          </Button>
        )
      ),
    },
  ]

  const statCards = statsQuery.data ? [
    { label: "Jami xodimlar", value: statsQuery.data.total_employees, icon: User, tone: 'slate' },
    { label: "Keldi", value: statsQuery.data.present, icon: CheckCircle2, tone: 'green' },
    { label: "Kechikdi", value: statsQuery.data.late, icon: AlertTriangle, tone: 'amber' },
    { label: "Kelmadi", value: statsQuery.data.absent, icon: XCircle, tone: 'red' },
    { label: "Ta'tilda", value: statsQuery.data.on_leave, icon: CalendarDays, tone: 'blue' },
    { label: "Rejasiz", value: statsQuery.data.not_scheduled, icon: AlertCircle, tone: 'slate' },
    { label: "Noaniq", value: statsQuery.data.incomplete, icon: AlertTriangle, tone: 'amber' },
    { label: "Hodisalar (bugun)", value: statsQuery.data.events_today, icon: Activity, tone: 'violet' },
    { label: "Onlayn qurilmalar", value: statsQuery.data.devices_online, icon: CheckCircle2, tone: 'green' },
    { label: "Oflayn qurilmalar", value: statsQuery.data.devices_offline, icon: WifiOff, tone: 'red' },
    { label: "Xatolik", value: statsQuery.data.devices_error, icon: AlertCircle, tone: 'red' },
  ] : []

  return (
    <div className="animate-in">
      <PageHeader
        eyebrow="Jonli monitoring"
        title="Face ID hodisalari va qurilma holati"
        description="Real-vaqt davomat kuzatuvi. Avtomatik yangilanish: 10 soniya (hodisalar), 30 soniya (qurilmalar)."
        actions={(
          <div className="flex items-center gap-2">
            <Button
              variant={autoRefresh ? 'primary' : 'secondary'}
              icon={<RefreshCw className={`h-4 w-4 ${autoRefresh ? 'animate-spin' : ''}`} />}
              onClick={() => {
                setAutoRefresh(!autoRefresh)
                if (!autoRefresh) {
                  void eventsQuery.refetch()
                  void devicesQuery.refetch()
                  void statsQuery.refetch()
                }
              }}
            >
              {autoRefresh ? 'Avto yangilash yoqilgan' : 'Avto yangilash o‘chirilgan'}
            </Button>
            <Button variant="secondary" icon={<RefreshCw className="h-4 w-4" />} onClick={() => {
              void eventsQuery.refetch()
              void devicesQuery.refetch()
              void statsQuery.refetch()
            }} loading={eventsQuery.isFetching || devicesQuery.isFetching || statsQuery.isFetching}>
              Yangilash
            </Button>
          </div>
        )}
      />

      {eventsQuery.dataUpdatedAt && (
        <div className="mb-4 text-right text-[11px] text-slate-500">
          Oxirgi yangilanish: {formatDateTime(new Date(eventsQuery.dataUpdatedAt).toISOString())}
        </div>
      )}

      <InfoGrid columns={4} items={statCards} />

      <div className="mb-4 rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm">
        <FilterBar>
          <SearchInput value={search} onChange={(value) => { setSearch(value); setPage(1) }} placeholder="Qidirish: xodim, qurilma, IP…" className="lg:w-64" />
          <Select value={deptFilter} onChange={(event) => { setDeptFilter(event.target.value); setPage(1) }} className="lg:w-40" aria-label="Bo'lim">
            <option value="">Barcha bo'limlar</option>
            {deptsQuery.data?.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </Select>
          <Select value={eventTypeFilter} onChange={(event) => { setEventTypeFilter(event.target.value); setPage(1) }} className="lg:w-40" aria-label="Hodisa turi">
            <option value="">Barcha turlari</option>
            {Object.entries(EVENT_TYPE_LABELS).filter(([v]) => v !== 'unknown').map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </Select>
          <Select value={processedFilter} onChange={(event) => { setProcessedFilter(event.target.value); setPage(1) }} className="lg:w-40" aria-label="Qayta ishlash">
            <option value="">Barchasi</option>
            <option value="true">Qayta ishlangan</option>
            <option value="false">Kutilmoqda</option>
          </Select>
          <Select value={String(hoursFilter)} onChange={(event) => { setHoursFilter(Number(event.target.value)); setPage(1) }} className="lg:w-32" aria-label="Vaqt oralig'i">
            <option value="1">1 soat</option>
            <option value="6">6 soat</option>
            <option value="12">12 soat</option>
            <option value="24" selected>24 soat</option>
            <option value="48">48 soat</option>
            <option value="168">1 hafta</option>
          </Select>
          <Button
            variant={unmappedOnly ? 'primary' : 'secondary'}
            size="sm"
            onClick={() => {
              setUnmappedOnly((prev) => !prev)
              setPage(1)
            }}
          >
            {unmappedOnly ? 'Barcha hodisalar' : 'Faqat bog‘lanmagan hodisalar'}
          </Button>
        </FilterBar>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <DataTable
          columns={eventColumns}
          rows={eventsQuery.data?.items}
          rowKey={(event) => event.id}
          loading={eventsQuery.isLoading}
          error={eventsQuery.error instanceof Error ? eventsQuery.error.message : null}
          onRetry={() => void eventsQuery.refetch()}
          emptyTitle="Hodisalar topilmadi"
          emptyDescription="Tanlangan filtrlar bo'yicha hodisa yo'q."
          emptyIcon={<Activity className="h-6 w-6" />}
          footer={eventsQuery.data ? (
            <Pagination
              page={eventsQuery.data.page}
              pages={eventsQuery.data.pages}
              total={eventsQuery.data.total}
              pageSize={eventsQuery.data.page_size}
              onPageChange={setPage}
              onPageSizeChange={(size) => { setPageSize(size); setPage(1) }}
              loading={eventsQuery.isFetching}
            />
          ) : null}
        />
      </div>

      <div className="mt-6 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-4 py-3">
          <h3 className="text-sm font-semibold text-slate-900">Qurilmalar holati</h3>
        </div>
        <div className="divide-y divide-slate-100">
          {devicesQuery.data?.map((device) => (
            <div key={device.id} className="px-4 py-3 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${device.sync_enabled ? 'bg-teal-500/15' : 'bg-slate-100'}`}>
                  <Activity className={`h-4 w-4 ${device.sync_enabled ? 'text-teal-600' : 'text-slate-400'}`} />
                </div>
                <div className="min-w-0">
                  <p className="max-w-[210px] truncate text-xs font-semibold text-slate-900">{device.name}</p>
                  <p className="mt-0.5 max-w-[210px] truncate font-mono text-[10px] text-slate-400">{device.serial_number}</p>
                  <p className="mt-0.5 max-w-[210px] truncate text-[10px] text-slate-500">{device.ip_address} · {device.location || 'Joylashuv yo‘q'}</p>
                </div>
              </div>
              <div className="flex items-center gap-3 text-right min-w-[200px]">
                <div className="text-[11px] text-slate-500 hidden sm:block">
                  <p>Heartbeat: {device.last_heartbeat ? formatDateTime(device.last_heartbeat) : '—'}</p>
                  <p>Sync: {device.last_sync ? formatDateTime(device.last_sync) : '—'}</p>
                </div>
                <Badge tone={(DEVICE_STATUS_TONES[device.status] as 'green' | 'red' | 'amber' | 'blue' | 'violet' | 'slate') || 'slate'}>
                  <Dot tone={(DEVICE_STATUS_TONES[device.status] as 'green' | 'red' | 'amber' | 'blue' | 'violet' | 'slate') || 'slate'} />
                  <span className="ml-1">{DEVICE_STATUS_LABELS[device.status] || device.status}</span>
                </Badge>
                {device.error_message && (
                  <span className="text-[10px] text-red-500 max-w-[200px] truncate" title={device.error_message}>
                    ⚠ {device.error_message}
                  </span>
                )}
              </div>
            </div>
          ))}
          {!devicesQuery.data?.length && (
            <div className="px-4 py-8 text-center text-slate-500">
              <WifiOff className="mx-auto h-8 w-8 text-slate-300" />
              <p className="mt-2">Qurilmalar topilmadi</p>
            </div>
          )}
        </div>
      </div>

      <Modal
        open={!!linkEvent}
        onClose={() => {
          setLinkEvent(null)
          setSelectedEmp(null)
          setEmpSearch('')
        }}
        title="Xodimga bog‘lash"
        description={linkEvent ? `Qurilma: ${linkEvent.device_name} | Qurilma user ID: ${linkEvent.device_user_id || '—'}` : undefined}
        footer={(
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => {
              setLinkEvent(null)
              setSelectedEmp(null)
              setEmpSearch('')
            }}>Bekor qilish</Button>
            <Button variant="primary" onClick={handleLink} disabled={!selectedEmp || !linkEvent?.device_id || !linkEvent?.device_user_id}>Bog‘lash</Button>
          </div>
        )}
      >
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700">Xodim qidirish</label>
            <Input value={empSearch} onChange={(e) => setEmpSearch(e.target.value)} placeholder="F.I.O, ichki ID, telefon yoki qurilma ID bo‘yicha..." />
          </div>
          <div className="max-h-64 overflow-auto rounded-lg border border-slate-200">
            {(employeesSearchQuery.data?.items || []).map((emp) => (
              <button
                key={emp.id}
                type="button"
                onClick={() => setSelectedEmp(emp)}
                className={`w-full flex items-center justify-between px-3 py-2 text-left text-xs hover:bg-slate-50 ${selectedEmp?.id === emp.id ? 'bg-teal-50' : ''}`}
              >
                <div>
                  <p className="font-medium text-slate-900">{emp.full_name || `${emp.first_name || ''} ${emp.last_name || ''}`.trim()}</p>
                  <p className="text-[10px] text-slate-500">ID: {emp.internal_id || '—'} • {emp.department_name || 'Bo‘lim yo‘q'}</p>
                </div>
                {selectedEmp?.id === emp.id && <Badge tone="green">Tanlangan</Badge>}
              </button>
            ))}
            {!employeesSearchQuery.isLoading && !(employeesSearchQuery.data?.items || []).length && (
              <div className="px-3 py-4 text-center text-xs text-slate-500">Natija topilmadi</div>
            )}
          </div>
          {selectedEmp && (
            <div className="rounded-lg bg-slate-50 p-3 text-xs">
              <p className="font-medium text-slate-900">Tanlangan xodim</p>
              <p className="mt-0.5 text-slate-600">{selectedEmp.full_name || `${selectedEmp.first_name || ''} ${selectedEmp.last_name || ''}`.trim()}</p>
              <p className="mt-0.5 text-[10px] text-slate-500">Qurilma ID: {linkEvent?.device_user_id} → {linkEvent?.device_name}</p>
            </div>
          )}
        </div>
      </Modal>
    </div>
  )
}