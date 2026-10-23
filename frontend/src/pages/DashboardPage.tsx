import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import {
  AlertTriangle,
  ArrowUpRight,
  Building2,
  CalendarDays,
  Clock3,
  Fingerprint,
  RefreshCw,
  UserCheck,
  UserX,
  Users,
} from 'lucide-react'
import { attendanceApi, dashboardApi } from '@/api/services'
import { useAuth } from '@/auth/AuthProvider'
import { Alert, EmptyState, ErrorState, LoadingState } from '@/components/ui/Feedback'
import { Button } from '@/components/ui/Button'
import { Card, PageHeader, StatCard } from '@/components/ui/LayoutBits'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { Badge } from '@/components/ui/Badge'
import {
  formatDate,
  formatDateTime,
  formatNumber,
  formatTime,
  STATUS_LABELS,
  STATUS_TONES,
} from '@/lib/format'
import type { AttendanceRecord } from '@/api/types'
import { useDocumentTitle } from '@/lib/hooks'

export default function DashboardPage() {
  const { can, user } = useAuth()
  useDocumentTitle('Bosh sahifa')

  const statsQuery = useQuery({
    queryKey: ['dashboard', 'stats'],
    queryFn: dashboardApi.stats,
  })
  const dailyQuery = useQuery({
    queryKey: ['dashboard', 'daily'],
    queryFn: () => dashboardApi.daily(),
  })
  const trendQuery = useQuery({
    queryKey: ['dashboard', 'trend', 14],
    queryFn: () => dashboardApi.trend(14),
  })
  const recentQuery = useQuery({
    queryKey: ['dashboard', 'recent-attendance'],
    queryFn: () => attendanceApi.list({ page: 1, page_size: 8 }),
    enabled: can('attendance:read'),
  })

  const stats = statsQuery.data
  const daily = dailyQuery.data
  const trend = trendQuery.data || []
  const loading = statsQuery.isLoading || dailyQuery.isLoading || trendQuery.isLoading
  const error = statsQuery.error || dailyQuery.error || trendQuery.error

  const recentColumns: Column<AttendanceRecord>[] = [
    {
      key: 'date',
      header: 'Sana',
      cell: (row) => <span className="whitespace-nowrap text-xs font-medium">{formatDate(row.record_date)}</span>,
    },
    {
      key: 'employee',
      header: 'Xodim',
      cell: (row) => (
        <div>
          <p className="text-xs font-semibold text-slate-800">{row.employee_name || '—'}</p>
          <p className="text-[11px] text-slate-400">{row.department_name || "Bo'lim belgilanmagan"}</p>
        </div>
      ),
    },
    {
      key: 'in',
      header: 'Kirish',
      cell: (row) => <span className="text-xs tabular-nums">{formatTime(row.actual_check_in)}</span>,
    },
    {
      key: 'out',
      header: 'Chiqish',
      cell: (row) => <span className="text-xs tabular-nums">{formatTime(row.actual_check_out)}</span>,
    },
    {
      key: 'status',
      header: 'Holat',
      cell: (row) => <Badge tone={(STATUS_TONES[row.status] as 'green' | 'red' | 'amber' | 'blue' | 'violet' | 'slate' | 'teal') || 'slate'}>{STATUS_LABELS[row.status] || row.status}</Badge>,
    },
  ]

  const refreshAll = () => {
    void statsQuery.refetch()
    void dailyQuery.refetch()
    void trendQuery.refetch()
    void recentQuery.refetch()
  }

  return (
    <div className="animate-in">
      <PageHeader
        eyebrow="Umumiy ko'rinish"
        title={`Salom, ${user?.full_name || user?.username || 'foydalanuvchi'}`}
        description="Klinikaning bugungi HR va davomat ko'rsatkichlari. Barcha raqamlar faqat ma'lumotlar bazasidagi yozuvlardan olinadi."
        actions={(
          <Button variant="secondary" onClick={refreshAll} loading={statsQuery.isFetching || dailyQuery.isFetching || trendQuery.isFetching} icon={<RefreshCw className="h-4 w-4" />}>
            Yangilash
          </Button>
        )}
      />

      {stats?.is_demo_data ? (
        <Alert tone="warning" title="Diqqat: simulyatsiya hodisalari mavjud" className="mb-4">
          Tizimda qo'lda kiritilgan sinov (simulyatsiya) hodisalari bor. Ular haqiqiy Face ID qurilma
          ma'lumotlari emas va hisobotlarda alohida belgilanadi.
        </Alert>
      ) : null}

      {error ? (
        <Card bodyClassName="p-4"><ErrorState message={error instanceof Error ? error.message : "Ko'rsatkichlarni yuklab bo'lmadi"} onRetry={refreshAll} /></Card>
      ) : loading ? (
        <Card bodyClassName="p-4"><LoadingState label="Ko'rsatkichlar yuklanmoqda…" /></Card>
      ) : stats && daily ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
            <StatCard label="Faol xodimlar" value={stats.total_active_employees} foot="Barcha bo'limlar bo'yicha" icon={<Users className="h-5 w-5" />} tone="teal" />
            <StatCard label="Bugun kelgan" value={stats.today_present} foot={formatDate(daily.date)} icon={<UserCheck className="h-5 w-5" />} tone="blue" />
            <StatCard label="Kechikkanlar" value={stats.today_late} foot="Bugungi smena bo'yicha" icon={<Clock3 className="h-5 w-5" />} tone="amber" />
            <StatCard label="Kelmaganlar" value={stats.today_absent} foot="Tasdiqlanmagan / yo'q" icon={<UserX className="h-5 w-5" />} tone="red" />
            <StatCard label="Ta'tilda" value={stats.today_on_leave} foot="Tasdiqlangan ta'tillar" icon={<CalendarDays className="h-5 w-5" />} tone="violet" />
            <StatCard label="Qurilmalar" value={stats.devices_total ? `${stats.devices_online}/${stats.devices_total}` : '0'} foot={stats.devices_total ? `${stats.devices_offline} oflayn` : "Qurilma qo'shilmagan"} icon={<Fingerprint className="h-5 w-5" />} tone="slate" />
          </div>

          <div className="mt-4 grid gap-4 xl:grid-cols-[1.7fr_1fr]">
            <Card
              title="14 kunlik davomat dinamikasi"
              subtitle="Kelgan, kechikkan va kelmagan xodimlar soni"
              actions={<Badge tone="slate">{formatDate(daily.date)} holatiga</Badge>}
            >
              <div className="h-[300px] px-2 pb-3 pt-4">
                {trendQuery.isError ? (
                  <ErrorState compact message="Grafik yuklanmadi" onRetry={refreshAll} />
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={trend} margin={{ top: 8, right: 12, left: -16, bottom: 0 }}>
                      <defs>
                        <linearGradient id="presentFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#0d9488" stopOpacity={0.28} />
                          <stop offset="95%" stopColor="#0d9488" stopOpacity={0.02} />
                        </linearGradient>
                        <linearGradient id="lateFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.22} />
                          <stop offset="95%" stopColor="#f59e0b" stopOpacity={0.02} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                      <XAxis
                        dataKey="date"
                        tick={{ fontSize: 10, fill: '#94a3b8' }}
                        tickFormatter={(value: string) => formatDate(value).slice(0, 5)}
                        axisLine={false}
                        tickLine={false}
                      />
                      <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} allowDecimals={false} axisLine={false} tickLine={false} />
                      <Tooltip
                        labelFormatter={(value) => formatDate(String(value))}
                        contentStyle={{ borderRadius: 10, border: '1px solid #e2e8f0', fontSize: 12 }}
                      />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Area type="monotone" dataKey="present" name="Kelgan" stroke="#0d9488" strokeWidth={2} fill="url(#presentFill)" />
                      <Area type="monotone" dataKey="late" name="Kechikkan" stroke="#f59e0b" strokeWidth={2} fill="url(#lateFill)" />
                      <Area type="monotone" dataKey="absent" name="Kelmagan" stroke="#ef4444" strokeWidth={2} fill="transparent" />
                    </AreaChart>
                  </ResponsiveContainer>
                )}
              </div>
            </Card>

            <Card title="Bugungi xulosa" subtitle={`${formatDate(daily.date)} · Asia/Tashkent`}>
              <div className="space-y-3 p-4">
                {[
                  { label: 'Jami faol xodim', value: daily.total_active_employees, tone: 'bg-slate-400' },
                  { label: 'Kelgan', value: daily.present, tone: 'bg-emerald-500' },
                  { label: 'Kechikkan', value: daily.late, tone: 'bg-amber-500' },
                  { label: 'Erta ketgan', value: daily.early_leave, tone: 'bg-orange-400' },
                  { label: 'Kelmagan', value: daily.absent, tone: 'bg-red-500' },
                  { label: "Ta'tilda", value: daily.on_leave, tone: 'bg-sky-500' },
                  { label: "To'liqsiz", value: daily.incomplete, tone: 'bg-violet-500' },
                ].map((item) => {
                  const percent = daily.total_active_employees ? Math.min(100, Math.round((item.value / daily.total_active_employees) * 100)) : 0
                  return (
                    <div key={item.label}>
                      <div className="mb-1 flex items-center justify-between text-xs">
                        <span className="text-slate-500">{item.label}</span>
                        <span className="font-bold tabular-nums text-slate-800">{formatNumber(item.value)}</span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                        <div className={`h-full rounded-full ${item.tone}`} style={{ width: `${percent}%` }} />
                      </div>
                    </div>
                  )
                })}
                <p className="pt-1 text-[10px] leading-relaxed text-slate-400">
                  Qurilmalar: {stats.devices_online} onlayn / {stats.devices_total} jami. Oxirgi yangilanish: {formatDateTime(stats.generated_at)}.
                </p>
              </div>
            </Card>
          </div>

          <div className="mt-4 grid gap-4 xl:grid-cols-[1.7fr_1fr]">
            <Card
              title="So'nggi davomat yozuvlari"
              subtitle="Eng yangi 8 ta yozuv"
              actions={<Link to="/attendance" className="inline-flex items-center gap-1 text-xs font-semibold text-teal-700 hover:text-teal-800">Barchasi <ArrowUpRight className="h-3.5 w-3.5" /></Link>}
            >
              {can('attendance:read') ? (
                <DataTable
                  columns={recentColumns}
                  rows={recentQuery.data?.items}
                  rowKey={(row) => row.id}
                  loading={recentQuery.isLoading}
                  error={recentQuery.error instanceof Error ? recentQuery.error.message : null}
                  onRetry={() => void recentQuery.refetch()}
                  emptyTitle="Hozircha yozuvlar yo'q"
                  emptyDescription="Qurilma ulangach yoki davomat hisoblangach yozuvlar shu yerda ko'rinadi."
                  dense
                />
              ) : (
                <EmptyState title="Ruxsat yo'q" description="So'nggi davomat yozuvlarini ko'rish uchun davomat ruxsati kerak." compact />
              )}
            </Card>

            <Card title="Tezkor o'tish" subtitle="Ruxsat berilgan bo'limlar">
              <div className="grid grid-cols-2 gap-2 p-3">
                {[
                  { to: '/employees', label: 'Xodimlar', icon: <Users className="h-4 w-4" />, permission: 'employee:read' },
                  { to: '/departments', label: "Bo'limlar", icon: <Building2 className="h-4 w-4" />, permission: 'department:read' },
                  { to: '/attendance', label: 'Davomat', icon: <Clock3 className="h-4 w-4" />, permission: 'attendance:read' },
                  { to: '/devices', label: 'Qurilmalar', icon: <Fingerprint className="h-4 w-4" />, permission: 'device:read' },
                  { to: '/reports', label: 'Hisobotlar', icon: <CalendarDays className="h-4 w-4" />, permission: 'report:view' },
                  { to: '/leaves', label: "Ta'tillar", icon: <CalendarDays className="h-4 w-4" />, permission: 'leave:read' },
                ].filter((item) => can(item.permission)).map((item) => (
                  <Link
                    key={item.to}
                    to={item.to}
                    className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2.5 text-xs font-semibold text-slate-700 transition hover:border-teal-200 hover:bg-teal-50/50 hover:text-teal-800"
                  >
                    <span className="text-slate-400">{item.icon}</span>
                    {item.label}
                  </Link>
                ))}
              </div>
              <div className="mx-3 mb-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-[10px] leading-relaxed text-amber-800">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>Face ID qurilmalari faqat qo'llab-quvvatlangan ISAPI funksiyalari bo'yicha ishlaydi. Diagnostika natijalariga ishoning.</span>
              </div>
            </Card>
          </div>
        </>
      ) : null}
    </div>
  )
}
