import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Check,
  Eye,
  EyeOff,
  Info,
  Lock,
  RefreshCw,
  RotateCcw,
  Save,
  Settings2,
  SlidersHorizontal,
} from 'lucide-react'
import { settingsApi } from '@/api/services'
import type { SystemSetting } from '@/api/types'
import { useAuth } from '@/auth/AuthProvider'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Field'
import { Alert, EmptyState, ErrorState, LoadingState } from '@/components/ui/Feedback'
import { PageHeader, SearchInput } from '@/components/ui/LayoutBits'
import { useToast } from '@/components/ui/Toast'
import { useDocumentTitle } from '@/lib/hooks'
import { formatNumber, safeJson } from '@/lib/format'

const CATEGORY_LABELS: Record<string, string> = {
  organization: 'Tashkilot',
  attendance: 'Davomat',
  integration: 'Integratsiya',
  backup: 'Zaxira',
  system: 'Tizim',
  security: 'Xavfsizlik',
  notification: 'Bildirishnomalar',
}

function formatDraft(setting: SystemSetting): string | boolean {
  if (setting.value_type === 'boolean') return Boolean(setting.value)
  if (setting.value_type === 'json') return safeJson(setting.value)
  return setting.value === null || setting.value === undefined ? '' : String(setting.value)
}

function isSensitive(key: string): boolean {
  return /password|secret|token|api[_-]?key|private[_-]?key/i.test(key)
}

function SettingEditor({ setting, canUpdate }: { setting: SystemSetting; canUpdate: boolean }) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState<string | boolean>(() => formatDraft(setting))
  const [error, setError] = useState('')
  const [revealed, setRevealed] = useState(false)

  const mutation = useMutation({
    mutationFn: (value: unknown) => settingsApi.update(setting.key, value),
    onSuccess: (updated) => {
      toast.success(`${setting.key} saqlandi`)
      setDraft(formatDraft(updated))
      setError('')
      void queryClient.invalidateQueries({ queryKey: ['settings'] })
    },
    onError: (mutationError) => setError(mutationError instanceof Error ? mutationError.message : "Sozlamani saqlab bo'lmadi"),
  })

  function parseValue(): { ok: true; value: unknown } | { ok: false; message: string } {
    if (setting.value_type === 'boolean') return { ok: true, value: Boolean(draft) }
    const raw = String(draft)
    if (setting.value_type === 'integer') {
      const parsed = Number(raw)
      if (!raw.trim() || !Number.isFinite(parsed) || !Number.isInteger(parsed)) {
        return { ok: false, message: "Butun son kiriting" }
      }
      return { ok: true, value: parsed }
    }
    if (setting.value_type === 'float') {
      const parsed = Number(raw)
      if (!raw.trim() || !Number.isFinite(parsed)) return { ok: false, message: 'Son kiriting' }
      return { ok: true, value: parsed }
    }
    if (setting.value_type === 'json') {
      try {
        return { ok: true, value: JSON.parse(raw) }
      } catch {
        return { ok: false, message: "JSON formati noto'g'ri" }
      }
    }
    if (!raw.trim()) return { ok: false, message: "Qiymat bo'sh bo'lishi mumkin emas" }
    return { ok: true, value: raw }
  }

  function save() {
    const parsed = parseValue()
    if (!parsed.ok) {
      setError(parsed.message)
      return
    }
    setError('')
    mutation.mutate(parsed.value)
  }

  const original = formatDraft(setting)
  const dirty = setting.value_type === 'boolean' ? draft !== original : String(draft) !== String(original)
  const sensitive = isSensitive(setting.key)
  const disabled = !canUpdate || setting.is_readonly
  const isOn = draft === true

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <h3 className="text-xs font-bold text-slate-900">{setting.description || setting.key}</h3>
            {setting.is_readonly ? <Badge tone="slate"><Lock className="mr-0.5 h-3 w-3" />Faqat o'qish</Badge> : null}
            {setting.is_public ? <Badge tone="teal">Ommaviy</Badge> : null}
            <Badge tone="blue">{setting.value_type}</Badge>
          </div>
          <p className="mt-1 break-all font-mono text-[10px] text-slate-400">{setting.key}</p>
        </div>
        {dirty && canUpdate && !setting.is_readonly ? (
          <div className="flex gap-1">
            <Button size="sm" variant="ghost" icon={<RotateCcw className="h-3.5 w-3.5" />} onClick={() => { setDraft(original); setError('') }}>Qaytarish</Button>
            <Button size="sm" variant="primary" icon={<Save className="h-3.5 w-3.5" />} loading={mutation.isPending} onClick={save}>Saqlash</Button>
          </div>
        ) : null}
      </div>

      <div className="mt-3">
        {setting.value_type === 'boolean' && !setting.is_readonly ? (
          <button
            type="button"
            role="switch"
            aria-checked={isOn}
            disabled={disabled}
            onClick={() => setDraft(!isOn)}
            className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold transition ${isOn ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-slate-200 bg-slate-50 text-slate-600'} disabled:cursor-not-allowed disabled:opacity-60`}
          >
            <span className={`relative h-5 w-9 rounded-full transition ${isOn ? 'bg-emerald-500' : 'bg-slate-300'}`}>
              <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition ${isOn ? 'left-[18px]' : 'left-0.5'}`} />
            </span>
            {isOn ? 'Yoqilgan' : "O'chirilgan"}
          </button>
        ) : setting.is_readonly ? (
          <div className="rounded-lg bg-slate-50 px-3 py-2">
            <pre className="overflow-x-auto whitespace-pre-wrap text-[11px] text-slate-700">{safeJson(setting.value)}</pre>
          </div>
        ) : setting.value_type === 'json' ? (
          <textarea
            value={String(draft)}
            onChange={(event) => setDraft(event.target.value)}
            rows={6}
            disabled={disabled}
            spellCheck={false}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-[11px] text-slate-900 shadow-sm outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 disabled:bg-slate-100"
          />
        ) : (
          <div className="relative">
            <input
              type={sensitive && !revealed ? 'password' : setting.value_type === 'integer' || setting.value_type === 'float' ? 'number' : 'text'}
              value={String(draft)}
              onChange={(event) => setDraft(event.target.value)}
              disabled={disabled}
              step={setting.value_type === 'float' ? '0.1' : undefined}
              className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 pr-10 text-sm text-slate-900 shadow-sm outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 disabled:bg-slate-100"
            />
            {sensitive ? (
              <button type="button" onClick={() => setRevealed((value) => !value)} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:text-slate-700" aria-label={revealed ? 'Yashirish' : "Ko'rsatish"}>
                {revealed ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            ) : null}
          </div>
        )}
      </div>
      {error ? <p className="mt-2 text-xs font-medium text-red-600">{error}</p> : null}
      {!setting.is_readonly && !canUpdate ? <p className="mt-2 text-[10px] text-slate-400">Tahrirlash uchun settings:update ruxsati kerak.</p> : null}
    </div>
  )
}

export default function SettingsPage() {
  const { can } = useAuth()
  useDocumentTitle('Sozlamalar')

  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('')

  const settingsQuery = useQuery({
    queryKey: ['settings'],
    queryFn: () => settingsApi.list(),
  })

  const categories = useMemo(() => {
    const set = new Set((settingsQuery.data || []).map((setting) => setting.category))
    return Array.from(set).sort()
  }, [settingsQuery.data])

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase()
    return (settingsQuery.data || []).filter((setting) => {
      if (category && setting.category !== category) return false
      if (!query) return true
      return setting.key.toLowerCase().includes(query)
        || (setting.description || '').toLowerCase().includes(query)
        || setting.category.toLowerCase().includes(query)
    })
  }, [settingsQuery.data, search, category])

  const grouped = useMemo(() => {
    const map = new Map<string, SystemSetting[]>()
    for (const setting of filtered) {
      const list = map.get(setting.category) || []
      list.push(setting)
      map.set(setting.category, list)
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]))
  }, [filtered])

  const editableCount = (settingsQuery.data || []).filter((setting) => !setting.is_readonly).length

  return (
    <div className="animate-in">
      <PageHeader
        eyebrow="Tizim"
        title="Sozlamalar"
        description="Tizim kalitlari, qiymatlari va ularning turlari. Har bir o'zgarish audit jurnaliga yoziladi. Ba'zi kalitlar server tomonidan avtomatik qo'llanilmasligi mumkin."
        actions={<Button variant="secondary" icon={<RefreshCw className="h-4 w-4" />} onClick={() => void settingsQuery.refetch()} loading={settingsQuery.isFetching}>Yangilash</Button>}
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm">
          <div className="flex items-center gap-2 text-slate-500"><Settings2 className="h-4 w-4" /><span className="text-[11px] font-semibold uppercase tracking-wide">Jami sozlamalar</span></div>
          <p className="mt-1 text-xl font-black tabular-nums text-slate-900">{settingsQuery.data ? formatNumber(settingsQuery.data.length) : '—'}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm">
          <div className="flex items-center gap-2 text-slate-500"><SlidersHorizontal className="h-4 w-4" /><span className="text-[11px] font-semibold uppercase tracking-wide">Kategoriyalar</span></div>
          <p className="mt-1 text-xl font-black tabular-nums text-slate-900">{settingsQuery.data ? formatNumber(categories.length) : '—'}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm">
          <div className="flex items-center gap-2 text-slate-500"><Check className="h-4 w-4" /><span className="text-[11px] font-semibold uppercase tracking-wide">Tahrirlanadigan</span></div>
          <p className="mt-1 text-xl font-black tabular-nums text-slate-900">{settingsQuery.data ? formatNumber(editableCount) : '—'}</p>
        </div>
      </div>

      <Alert tone="warning" className="mb-4">
        <div className="flex gap-2">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <b>Muhim:</b> ushbu sahifa qiymatlarni ma'lumotlar bazasida saqlaydi va audit qiladi. Hozirgi backend versiyasida
            davomat qoidalari asosan <b>smena sozlamalari</b>dan olinadi; shu sababli bu yerdagi ba'zi kalitlar hali avtomatik
            qo'llanilmaydi. Ishlab chiqarishdan oldin har bir kalitning qo'llanilishini tekshiring.
          </div>
        </div>
      </Alert>

      <div className="mb-4 flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-3 shadow-sm sm:flex-row sm:items-center">
        <SearchInput value={search} onChange={setSearch} placeholder="Kalit yoki tavsif bo'yicha qidirish…" className="sm:w-80" />
        <Select value={category} onChange={(event) => setCategory(event.target.value)} className="sm:w-56" aria-label="Kategoriya">
          <option value="">Barcha kategoriyalar</option>
          {categories.map((value) => <option key={value} value={value}>{CATEGORY_LABELS[value] || value}</option>)}
        </Select>
        <div className="flex-1" />
        <span className="text-[11px] text-slate-400">{filtered.length} ta sozlama</span>
      </div>

      {settingsQuery.isLoading ? (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm"><LoadingState label="Sozlamalar yuklanmoqda…" /></div>
      ) : settingsQuery.isError ? (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <ErrorState message={settingsQuery.error instanceof Error ? settingsQuery.error.message : "Sozlamalarni yuklab bo'lmadi"} onRetry={() => void settingsQuery.refetch()} />
        </div>
      ) : !grouped.length ? (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <EmptyState title="Sozlamalar topilmadi" description={settingsQuery.data?.length ? "Qidiruv yoki kategoriya filtrini o'zgartiring." : "Bazada sozlamalar mavjud emas. Seed skriptini ishga tushiring."} icon={<Settings2 className="h-6 w-6" />} />
        </div>
      ) : (
        <div className="space-y-5">
          {grouped.map(([group, settings]) => (
            <section key={group}>
              <div className="mb-2 flex items-center gap-2">
                <h2 className="text-sm font-bold text-slate-900">{CATEGORY_LABELS[group] || group}</h2>
                <Badge tone="slate">{settings.length}</Badge>
              </div>
              <div className="grid gap-3 xl:grid-cols-2">
                {settings.map((setting) => <SettingEditor key={setting.id} setting={setting} canUpdate={can('settings:update')} />)}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
