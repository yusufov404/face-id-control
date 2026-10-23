import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { Loader2, ShieldX } from 'lucide-react'
import { useAuth } from './AuthProvider'
import { Button } from '@/components/ui/Button'
import { useNavigate } from 'react-router-dom'

function FullScreenLoader() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100">
      <div className="flex flex-col items-center gap-3 text-slate-500">
        <Loader2 className="h-7 w-7 animate-spin text-teal-600" />
        <span className="text-sm">Sessiya tekshirilmoqda…</span>
      </div>
    </div>
  )
}

export function RequireAuth({ children }: { children: ReactNode }) {
  const { status } = useAuth()
  const location = useLocation()
  if (status === 'loading') return <FullScreenLoader />
  if (status === 'anonymous') return <Navigate to="/login" replace state={{ from: location.pathname }} />
  return <>{children}</>
}

export function GuestOnly({ children }: { children: ReactNode }) {
  const { status } = useAuth()
  if (status === 'loading') return <FullScreenLoader />
  if (status === 'authenticated') return <Navigate to="/" replace />
  return <>{children}</>
}

export function ForbiddenPage({ permission }: { permission?: string }) {
  const navigate = useNavigate()
  return (
    <div className="flex min-h-[60vh] items-center justify-center p-4">
      <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-red-50 text-red-600">
          <ShieldX className="h-7 w-7" />
        </div>
        <h1 className="mt-4 text-lg font-bold text-slate-900">Ruxsat yo'q</h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-500">
          Bu bo'limni ko'rish uchun sizda yetarli ruxsat mavjud emas.
          {permission ? <span className="mt-2 block font-mono text-[11px] text-slate-400">{permission}</span> : null}
        </p>
        <div className="mt-5 flex justify-center gap-2">
          <Button variant="secondary" onClick={() => navigate(-1)}>Orqaga</Button>
          <Button variant="primary" onClick={() => navigate('/')}>Bosh sahifa</Button>
        </div>
      </div>
    </div>
  )
}

export function RequirePermission({ permission, children }: { permission: string; children: ReactNode }) {
  const { status, can } = useAuth()
  if (status === 'loading') return <FullScreenLoader />
  if (!can(permission)) return <ForbiddenPage permission={permission} />
  return <>{children}</>
}
