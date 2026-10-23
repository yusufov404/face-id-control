import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle,
  ArchiveRestore,
  CheckCircle2,
  Database,
  HardDrive,
  Plus,
  RefreshCw,
  ShieldAlert,
} from 'lucide-react'
import { backupsApi } from '@/api/services'
import type { BackupInfo } from '@/api/types'
import { useAuth } from '@/auth/AuthProvider'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { Input } from '@/components/ui/Field'
import { Alert } from '@/components/ui/Feedback'
import { InfoGrid, PageHeader } from '@/components/ui/LayoutBits'
import { useToast } from '@/components/ui/Toast'
import { useDocumentTitle } from '@/lib/hooks'
import { formatBytes, formatDateTime, formatNumber } from '@/lib/format'

export default function BackupsPage() {
  const { can } = useAuth()
  const toast = useToast()
  const queryClient = useQueryClient()
  useDocumentTitle('Zaxira nusxalari')

  const [restoreTarget, setRestoreTarget] = useState<BackupInfo | null>(null)
  const [confirmText, setConfirmText] = useState('')
  const [restoreError, setRestoreError] = useState('')
  const [restoreResult, setRestoreResult] = useState('')

  const backupsQuery = useQuery({
    queryKey: ['backups'],
    queryFn: backupsApi.list,
  })

  const createMutation = useMutation({
    mutationFn: backupsApi.create,
    onSuccess: (backup) => {
      toast.success(`Zaxira nusxa yaratildi: ${backup.filename}`)
      void queryClient.invalidateQueries({ queryKey: ['backups'] })
      void queryClient.invalidateQueries({ queryKey: ['audit'] })
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Zaxira nusxasini yaratib bo'lmadi"),
  })

  const restoreMutation = useMutation({
    mutationFn: (backup: BackupInfo) => backupsApi.restore(backup.filename),
    onSuccess: (response) => {
      setRestoreTarget(null)
      setConfirmText('')
      setRestoreError('')
      setRestoreResult(response.detail)
      toast.warning('Tiklash bajarildi. Xizmatni qayta ishga tushiring.')
    },
    onError: (error) => setRestoreError(error instanceof Error ? error.message : "Zaxira nusxasini tiklab bo'lmadi"),
  })

  const totals = useMemo(() => {
    const items = backupsQuery.data || []
    return {
      count: items.length,
      size: items.reduce((sum, item) => sum + item.size_bytes, 0),
    }
  }, [backupsQuery.data])

  function openRestore(backup: BackupInfo) {
    setRestoreTarget(backup)
    setConfirmText('')
    setRestoreError('')
    setRestoreResult('')
  }

  const columns: Column<BackupInfo>[] = [
    {
      key: 'file',
      header: 'Fayl',
      cell: (backup) => (
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100"><Database className="h-4 w-4" /></span>
          <div className="min-w-0">
            <p className="max-w-[260px] truncate font-mono text-[11px] font-semibold text-slate-800">{backup.filename}</p>
            <p className="mt-0.5 text-[10px] text-slate-400">{formatBytes(backup.size_bytes)}</p>
          </div>
        </div>
      ),
    },
    {
      key: 'created',
      header: 'Yaratilgan',
      cell: (backup) => <span className="whitespace-nowrap text-xs tabular-nums text-slate-600">{formatDateTime(backup.created_at)}</span>,
    },
    {
      key: 'location',
      header: 'Joylashuv',
      cell: (backup) => (
        <div className="flex items-start gap-1.5">
          <HardDrive className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
          <span className="max-w-[260px] break-all font-mono text-[10px] text-slate-500">{backup.location}</span>
        </div>
      ),
    },
    {
      key: 'checksum',
      header: 'Checksum',
      cell: (backup) => backup.checksum ? <span className="font-mono text-[10px] text-slate-500">{backup.checksum.slice(0, 16)}…</span> : <span className="text-[10px] text-slate-400">—</span>,
    },
    {
      key: 'actions',
      header: '',
      headerClassName: 'text-right',
      className: 'text-right',
      cell: (backup) => can('settings:restore') ? (
        <Button variant="secondary" size="sm" icon={<ArchiveRestore className="h-3.5 w-3.5" />} onClick={() => openRestore(backup)}>Tiklash</Button>
      ) : <span className="text-[10px] text-slate-400">—</span>,
    },
  ]

  return (
    <div className="animate-in">
      <PageHeader
        eyebrow="Tizim"
        title="Zaxira nusxalari"
        description="PostgreSQL zaxira nusxalarini yaratish va tiklash. Backup fayllari serverning SSD diskida, HDD mount qilingan bo'lsa qo'shimcha nusxa ko'chiriladi."
        actions={(
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" icon={<RefreshCw className="h-4 w-4" />} onClick={() => void backupsQuery.refetch()} loading={backupsQuery.isFetching}>Yangilash</Button>
            {can('settings:backup') ? <Button variant="primary" icon={<Plus className="h-4 w-4" />} loading={createMutation.isPending} onClick={() => createMutation.mutate()}>Yangi backup</Button> : null}
          </div>
        )}
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm">
          <div className="flex items-center gap-2 text-slate-500"><ArchiveRestore className="h-4 w-4" /><span className="text-[11px] font-semibold uppercase tracking-wide">Backup fayllar</span></div>
          <p className="mt-1 text-xl font-black tabular-nums text-slate-900">{backupsQuery.data ? formatNumber(totals.count) : '—'}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm">
          <div className="flex items-center gap-2 text-slate-500"><HardDrive className="h-4 w-4" /><span className="text-[11px] font-semibold uppercase tracking-wide">Jami hajm</span></div>
          <p className="mt-1 text-xl font-black tabular-nums text-slate-900">{backupsQuery.data ? formatBytes(totals.size) : '—'}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm">
          <div className="flex items-center gap-2 text-slate-500"><ShieldAlert className="h-4 w-4" /><span className="text-[11px] font-semibold uppercase tracking-wide">Xavfsizlik</span></div>
          <p className="mt-1 text-[11px] leading-relaxed text-slate-600">Fayllar shifrlanmagan. Disk ruxsatlarini cheklang va tashqi nusxani xavfsiz saqlang.</p>
        </div>
      </div>

      <Alert tone="warning" className="mb-4">
        <b>Tiklash ogohlantirishi:</b> restore amali joriy ma'lumotlar bazasini almashtiradi. Tiklashdan keyin xizmatni qayta
        ishga tushirish kerak. Amaliyotdan oldin yangi backup yaratib oling.
      </Alert>

      {restoreResult ? (
        <Alert tone="success" className="mb-4" title="Tiklash bajarildi">
          <p>{restoreResult}</p>
          <p className="mt-1 text-[11px]">Sahifani yangilashdan oldin xizmatning qayta ishga tushganini tekshiring.</p>
        </Alert>
      ) : null}

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <DataTable
          columns={columns}
          rows={backupsQuery.data}
          rowKey={(backup) => `${backup.location}/${backup.filename}`}
          loading={backupsQuery.isLoading}
          error={backupsQuery.error instanceof Error ? backupsQuery.error.message : null}
          onRetry={() => void backupsQuery.refetch()}
          emptyTitle="Zaxira nusxalari yo'q"
          emptyDescription="Hozircha backup fayllari mavjud emas. 'Yangi backup' tugmasi orqali yarating."
          emptyIcon={<ArchiveRestore className="h-6 w-6" />}
          emptyAction={can('settings:backup') ? <Button variant="primary" size="sm" icon={<Plus className="h-3.5 w-3.5" />} loading={createMutation.isPending} onClick={() => createMutation.mutate()}>Backup yaratish</Button> : undefined}
          dense
          footer={backupsQuery.data?.length ? (
            <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
              <span>Jami: <b className="text-slate-800">{backupsQuery.data.length}</b> fayl</span>
              <span>Ro'yxat SSD va mount qilingan HDDdagi oxirgi 50 faylni ko'rsatadi.</span>
            </div>
          ) : null}
        />
      </div>

      <Modal
        open={Boolean(restoreTarget)}
        onClose={() => { if (!restoreMutation.isPending) setRestoreTarget(null) }}
        title="Zaxira nusxasini tiklash"
        description={restoreTarget ? restoreTarget.filename : undefined}
        size="md"
        footer={(
          <>
            <Button variant="secondary" onClick={() => setRestoreTarget(null)} disabled={restoreMutation.isPending}>Bekor qilish</Button>
            <Button variant="danger" icon={<ArchiveRestore className="h-4 w-4" />} loading={restoreMutation.isPending} disabled={confirmText !== 'TIKLASH'} onClick={() => restoreTarget && restoreMutation.mutate(restoreTarget)}>Tiklash</Button>
          </>
        )}
      >
        {restoreTarget ? (
          <div className="space-y-4">
            <Alert tone="danger" title="Bu amal qaytarilmaydi">
              Joriy ma'lumotlar bazasi backup fayli bilan almashtiriladi. Restore davomida foydalanuvchilar ishlashi mumkin emas.
            </Alert>
            <InfoGrid
              columns={2}
              items={[
                { label: 'Fayl', value: <span className="font-mono text-[11px]">{restoreTarget.filename}</span> },
                { label: 'Hajm', value: formatBytes(restoreTarget.size_bytes) },
                { label: 'Yaratilgan', value: formatDateTime(restoreTarget.created_at) },
                { label: 'Joylashuv', value: <span className="break-all font-mono text-[10px]">{restoreTarget.location}</span> },
              ]}
            />
            <div className="rounded-xl border border-red-200 bg-red-50/60 p-3">
              <p className="flex items-center gap-1.5 text-xs font-bold text-red-800"><AlertTriangle className="h-4 w-4" />Tasdiqlash uchun <span className="font-mono">TIKLASH</span> so'zini kiriting</p>
              <Input value={confirmText} onChange={(event) => setConfirmText(event.target.value)} className="mt-2" placeholder="TIKLASH" autoComplete="off" />
            </div>
            {restoreError ? <Alert tone="danger">{restoreError}</Alert> : null}
            <div className="rounded-lg border border-slate-200 p-3 text-[11px] leading-relaxed text-slate-600">
              <p className="flex items-center gap-1.5 font-semibold text-slate-700"><CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />Tiklash tugagach:</p>
              <ol className="mt-1 list-decimal space-y-0.5 pl-4">
                <li>Backend xizmatini qayta ishga tushiring.</li>
                <li>Foydalanuvchilar va rollarni tekshiring.</li>
                <li>Yangi backup yaratib, tiklash natijasini tasdiqlang.</li>
              </ol>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  )
}
