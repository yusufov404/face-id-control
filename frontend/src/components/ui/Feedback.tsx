import type { ReactNode } from 'react'
import { AlertCircle, CheckCircle2, Info, Loader2, RefreshCw, SearchX, TriangleAlert } from 'lucide-react'
import { cn } from '@/lib/format'
import { Button } from './Button'

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn('h-5 w-5 animate-spin text-teal-600', className)} aria-hidden="true" />
}

export function LoadingState({ label = 'Yuklanmoqda…', compact = false }: { label?: string; compact?: boolean }) {
  return (
    <div className={cn('flex items-center justify-center gap-2 text-sm text-slate-500', compact ? 'py-6' : 'py-14')}>
      <Spinner />
      <span>{label}</span>
    </div>
  )
}

export function ErrorState({ message, onRetry, compact = false }: { message: string; onRetry?: () => void; compact?: boolean }) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-3 text-center', compact ? 'py-8' : 'py-14')}>
      <div className="flex h-11 w-11 items-center justify-center rounded-full bg-red-50 text-red-600">
        <AlertCircle className="h-5 w-5" />
      </div>
      <div>
        <p className="text-sm font-semibold text-slate-800">Ma'lumotni yuklab bo'lmadi</p>
        <p className="mt-1 max-w-lg text-xs leading-relaxed text-slate-500">{message}</p>
      </div>
      {onRetry ? (
        <Button size="sm" variant="secondary" icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={onRetry}>
          Qayta urinish
        </Button>
      ) : null}
    </div>
  )
}

export function EmptyState({
  title,
  description,
  action,
  icon,
  compact = false,
}: {
  title: string
  description?: string
  action?: ReactNode
  icon?: ReactNode
  compact?: boolean
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center text-center', compact ? 'py-8' : 'py-14')}>
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
        {icon || <SearchX className="h-6 w-6" />}
      </div>
      <p className="mt-3 text-sm font-semibold text-slate-800">{title}</p>
      {description ? <p className="mt-1 max-w-lg text-xs leading-relaxed text-slate-500">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  )
}

type AlertTone = 'info' | 'success' | 'warning' | 'danger'

const alertStyles: Record<AlertTone, { wrap: string; icon: ReactNode }> = {
  info: { wrap: 'border-sky-200 bg-sky-50 text-sky-800', icon: <Info className="h-4 w-4 text-sky-600" /> },
  success: { wrap: 'border-emerald-200 bg-emerald-50 text-emerald-800', icon: <CheckCircle2 className="h-4 w-4 text-emerald-600" /> },
  warning: { wrap: 'border-amber-200 bg-amber-50 text-amber-900', icon: <TriangleAlert className="h-4 w-4 text-amber-600" /> },
  danger: { wrap: 'border-red-200 bg-red-50 text-red-800', icon: <AlertCircle className="h-4 w-4 text-red-600" /> },
}

export function Alert({ tone = 'info', title, children, className }: { tone?: AlertTone; title?: string; children: ReactNode; className?: string }) {
  const style = alertStyles[tone]
  return (
    <div className={cn('flex gap-2.5 rounded-xl border p-3.5 text-xs leading-relaxed', style.wrap, className)}>
      <div className="mt-0.5 shrink-0">{style.icon}</div>
      <div>
        {title ? <p className="font-bold">{title}</p> : null}
        <div className={title ? 'mt-0.5' : ''}>{children}</div>
      </div>
    </div>
  )
}
