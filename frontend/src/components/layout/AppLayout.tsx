import { useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useIsFetching, useQueryClient } from '@tanstack/react-query'
import {
  ChevronRight,
  LogOut,
  Menu,
  RefreshCw,
  ShieldCheck,
  X,
} from 'lucide-react'
import { useAuth } from '@/auth/AuthProvider'
import { authApi } from '@/api/services'
import { cn, formatDate, initials, roleLabel, todayISO } from '@/lib/format'
import { useDocumentTitle } from '@/lib/hooks'
import { minLength, required } from '@/lib/validation'
import { Button } from '@/components/ui/Button'
import { Alert } from '@/components/ui/Feedback'
import { Field, Input } from '@/components/ui/Field'
import { Modal } from '@/components/ui/Modal'
import { useToast } from '@/components/ui/Toast'
import { NAVIGATION, pageTitle } from './navigation'

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-teal-500/15 text-sm font-black tracking-tight text-teal-300 ring-1 ring-teal-400/20">
        FS
      </div>
      {!compact ? (
        <div className="leading-tight">
          <p className="text-sm font-bold tracking-tight text-white">FaceSys</p>
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">Enterprise</p>
        </div>
      ) : null}
    </div>
  )
}

function ProfileModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user } = useAuth()
  const toast = useToast()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')

  function close() {
    setCurrent('')
    setNext('')
    setConfirm('')
    setErrors({})
    setFormError('')
    onClose()
  }

  if (!user) return null

  async function submit() {
    const nextErrors: Record<string, string> = {}
    const currentError = required(current, 'Joriy parol')
    const nextError = required(next, 'Yangi parol') || minLength(next, 8, 'Yangi parol')
    const confirmError = required(confirm, 'Tasdiqlash paroli')
      || (next !== confirm ? 'Yangi parollar bir xil emas' : null)
    if (currentError) nextErrors.current = currentError
    if (nextError) nextErrors.next = nextError
    if (confirmError) nextErrors.confirm = confirmError
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length) return
    setSaving(true)
    setFormError('')
    try {
      await authApi.changePassword({ current_password: current, new_password: next })
      toast.success('Parol muvaffaqiyatli yangilandi')
      close()
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Parolni yangilab bo'lmadi")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title="Profil va xavfsizlik"
      description="Hisob ma'lumotlari va parolni boshqarish"
      size="md"
      footer={(
        <>
          <Button variant="secondary" onClick={close} disabled={saving}>Bekor qilish</Button>
          <Button variant="primary" onClick={submit} loading={saving}>Parolni yangilash</Button>
        </>
      )}
    >
      <div className="space-y-5">
        <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3.5">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-900 text-sm font-bold text-white">
            {initials(user.full_name)}
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-bold text-slate-900">{user.full_name}</p>
            <p className="truncate text-xs text-slate-500">{user.email}</p>
            <p className="mt-1 text-[11px] font-medium text-teal-700">
              {user.roles.map(roleLabel).join(', ') || 'Rol biriktirilmagan'}
            </p>
          </div>
        </div>

        <dl className="grid grid-cols-2 gap-3 rounded-xl border border-slate-200 p-3.5 text-xs">
          <div>
            <dt className="font-semibold uppercase tracking-wide text-slate-400">Login</dt>
            <dd className="mt-0.5 font-mono text-slate-800">{user.username}</dd>
          </div>
          <div>
            <dt className="font-semibold uppercase tracking-wide text-slate-400">Ruxsatlar</dt>
            <dd className="mt-0.5 text-slate-800">{user.is_superuser ? 'Barcha ruxsatlar' : `${user.permissions.length} ta`}</dd>
          </div>
          <div>
            <dt className="font-semibold uppercase tracking-wide text-slate-400">Bo'lim doirasi</dt>
            <dd className="mt-0.5 text-slate-800">{user.department_scope ? `Bo'lim #${user.department_scope}` : "Barcha bo'limlar"}</dd>
          </div>
          <div>
            <dt className="font-semibold uppercase tracking-wide text-slate-400">Hisob turi</dt>
            <dd className="mt-0.5 text-slate-800">{user.is_superuser ? 'Super Admin' : 'Cheklangan'}</dd>
          </div>
        </dl>

        <div className="rounded-xl border border-slate-200 p-4">
          <div className="mb-3 flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-teal-600" />
            <h3 className="text-sm font-bold text-slate-900">Parolni o'zgartirish</h3>
          </div>
          {formError ? <Alert tone="danger" className="mb-3">{formError}</Alert> : null}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Joriy parol" htmlFor="pwd-current" required error={errors.current} className="sm:col-span-2">
              <Input id="pwd-current" type="password" autoComplete="current-password" value={current} onChange={(event) => setCurrent(event.target.value)} invalid={Boolean(errors.current)} />
            </Field>
            <Field label="Yangi parol" htmlFor="pwd-new" required error={errors.next} hint="Kamida 8 belgi">
              <Input id="pwd-new" type="password" autoComplete="new-password" value={next} onChange={(event) => setNext(event.target.value)} invalid={Boolean(errors.next)} />
            </Field>
            <Field label="Yangi parolni takrorlang" htmlFor="pwd-confirm" required error={errors.confirm}>
              <Input id="pwd-confirm" type="password" autoComplete="new-password" value={confirm} onChange={(event) => setConfirm(event.target.value)} invalid={Boolean(errors.confirm)} />
            </Field>
          </div>
        </div>
      </div>
    </Modal>
  )
}

export function AppLayout() {
  const { user, logout, can } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const isFetching = useIsFetching()
  const toast = useToast()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const title = pageTitle(location.pathname)
  useDocumentTitle(title)

  if (!user) return null

  const visibleGroups = NAVIGATION
    .map((group) => ({ ...group, items: group.items.filter((item) => can(item.permission)) }))
    .filter((group) => group.items.length > 0)

  const logoutNow = async () => {
    await logout()
    navigate('/login', { replace: true })
  }

  const weekdays = ['Yakshanba', 'Dushanba', 'Seshanba', 'Chorshanba', 'Payshanba', 'Juma', 'Shanba']
  const todayIso = todayISO()
  const todayDate = new Date(`${todayIso}T12:00:00Z`)
  const today = `${weekdays[todayDate.getUTCDay()]}, ${formatDate(todayIso)}`

  return (
    <div className="min-h-screen bg-slate-100">
      {mobileOpen ? (
        <button
          className="fixed inset-0 z-30 bg-slate-950/50 backdrop-blur-[1px] lg:hidden"
          aria-label="Menyuni yopish"
          onClick={() => setMobileOpen(false)}
        />
      ) : null}

      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-40 flex w-[260px] flex-col bg-slate-950 text-slate-300 transition-transform duration-200 lg:translate-x-0',
          mobileOpen ? 'translate-x-0' : '-translate-x-full',
        )}
        aria-label="Asosiy menyu"
      >
        <div className="flex h-16 items-center justify-between border-b border-white/5 px-4">
          <Brand />
          <button
            type="button"
            className="rounded-lg p-1.5 text-slate-500 hover:bg-white/5 hover:text-white lg:hidden"
            onClick={() => setMobileOpen(false)}
            aria-label="Menyuni yopish"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav className="min-h-0 flex-1 overflow-y-auto px-2.5 py-4">
          {visibleGroups.map((group) => (
            <div key={group.label} className="mb-5">
              <p className="mb-1.5 px-2.5 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-600">{group.label}</p>
              <div className="space-y-0.5">
                {group.items.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.to === '/'}
                    onClick={() => setMobileOpen(false)}
                    className={({ isActive }) => cn(
                      'group flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs font-semibold transition',
                      isActive
                        ? 'bg-teal-500/15 text-teal-200 ring-1 ring-inset ring-teal-400/20'
                        : 'text-slate-400 hover:bg-white/5 hover:text-slate-100',
                    )}
                  >
                    {({ isActive }) => (
                      <>
                        <span className={cn(isActive ? 'text-teal-300' : 'text-slate-500 group-hover:text-slate-300')}>{item.icon}</span>
                        <span className="truncate">{item.label}</span>
                        {isActive ? <ChevronRight className="ml-auto h-3.5 w-3.5 text-teal-400" /> : null}
                      </>
                    )}
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>

        <div className="border-t border-white/5 px-4 py-3">
          <div className="flex items-center gap-2 text-[10px] font-medium text-slate-600">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            Lokal tarmoq · v1.0
          </div>
        </div>
      </aside>

      <div className="lg:pl-[260px]">
        <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur">
          <div className="flex h-16 items-center gap-2 px-4 lg:px-6">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 lg:hidden"
              aria-label="Menyuni ochish"
            >
              <Menu className="h-5 w-5" />
            </button>
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-slate-400">FaceSys Enterprise</p>
              <h1 className="truncate text-sm font-bold text-slate-900">{title}</h1>
            </div>
            <div className="flex-1" />
            <p className="hidden text-[11px] font-medium text-slate-500 xl:block">{today}</p>
            <button
              type="button"
              onClick={() => {
                void queryClient.invalidateQueries()
                toast.info('Ma’lumotlar yangilanmoqda')
              }}
              className="rounded-lg p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
              title="Ma'lumotlarni yangilash"
              aria-label="Ma'lumotlarni yangilash"
            >
              <RefreshCw className={cn('h-4 w-4', isFetching ? 'animate-spin text-teal-600' : '')} />
            </button>
            <button
              type="button"
              onClick={() => setProfileOpen(true)}
              className="flex items-center gap-2 rounded-lg px-1.5 py-1 transition hover:bg-slate-100"
              title="Profil"
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-900 text-[10px] font-bold text-white">
                {initials(user.full_name)}
              </span>
              <span className="hidden text-left sm:block">
                <span className="block max-w-[150px] truncate text-xs font-semibold text-slate-800">{user.full_name}</span>
                <span className="block max-w-[150px] truncate text-[10px] text-slate-500">
                  {user.roles.map(roleLabel).join(', ') || 'Foydalanuvchi'}
                </span>
              </span>
            </button>
            <button
              type="button"
              onClick={() => void logoutNow()}
              className="rounded-lg p-2 text-slate-500 transition hover:bg-red-50 hover:text-red-600"
              title="Tizimdan chiqish"
              aria-label="Tizimdan chiqish"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </header>

        <main className="mx-auto w-full max-w-[1600px] p-4 lg:p-6">
          <Outlet />
        </main>

        <footer className="mx-auto flex w-full max-w-[1600px] flex-col gap-1 px-4 pb-6 text-[10px] text-slate-400 sm:flex-row sm:items-center sm:justify-between lg:px-6">
          <span>FaceSys Enterprise · Klinika HR va Face ID davomat tizimi</span>
          <span>Vaqt zonasi: Asia/Tashkent</span>
        </footer>
      </div>

      <ProfileModal open={profileOpen} onClose={() => setProfileOpen(false)} />
    </div>
  )
}
