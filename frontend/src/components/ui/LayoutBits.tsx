import type { ReactNode } from 'react'
import { Search } from 'lucide-react'
import { cn, formatNumber } from '@/lib/format'

export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
}: {
  title: string
  description?: string
  actions?: ReactNode
  eyebrow?: string
}) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow ? <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.16em] text-teal-600">{eyebrow}</p> : null}
        <h1 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">{title}</h1>
        {description ? <p className="mt-1 max-w-3xl text-xs leading-relaxed text-slate-500 sm:text-sm">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  )
}

export function Card({
  children,
  title,
  subtitle,
  actions,
  className,
  bodyClassName,
}: {
  children: ReactNode
  title?: string
  subtitle?: string
  actions?: ReactNode
  className?: string
  bodyClassName?: string
}) {
  return (
    <section className={cn('overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm', className)}>
      {title ? (
        <div className="flex flex-col gap-2 border-b border-slate-200 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-sm font-bold text-slate-900">{title}</h2>
            {subtitle ? <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p> : null}
          </div>
          {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
        </div>
      ) : null}
      <div className={bodyClassName}>{children}</div>
    </section>
  )
}

export function SectionTitle({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h2 className="text-sm font-bold text-slate-900">{title}</h2>
        {subtitle ? <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p> : null}
      </div>
      {actions}
    </div>
  )
}

export function StatCard({
  label,
  value,
  foot,
  icon,
  tone = 'teal',
}: {
  label: string
  value: number | string
  foot?: string
  icon: ReactNode
  tone?: 'teal' | 'blue' | 'amber' | 'red' | 'violet' | 'slate'
}) {
  const tones = {
    teal: 'bg-teal-50 text-teal-700 ring-teal-100',
    blue: 'bg-sky-50 text-sky-700 ring-sky-100',
    amber: 'bg-amber-50 text-amber-700 ring-amber-100',
    red: 'bg-red-50 text-red-700 ring-red-100',
    violet: 'bg-violet-50 text-violet-700 ring-violet-100',
    slate: 'bg-slate-100 text-slate-700 ring-slate-200',
  }
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
          <p className="mt-1.5 text-2xl font-bold tabular-nums tracking-tight text-slate-900">
            {typeof value === 'number' ? formatNumber(value) : value}
          </p>
        </div>
        <div className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ring-1', tones[tone])}>{icon}</div>
      </div>
      {foot ? <p className="mt-2 text-[11px] leading-relaxed text-slate-500">{foot}</p> : null}
    </div>
  )
}

export function SearchInput({ value, onChange, placeholder = 'Qidirish…', className }: { value: string; onChange: (value: string) => void; placeholder?: string; className?: string }) {
  return (
    <div className={cn('relative', className)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="h-9 w-full rounded-lg border border-slate-300 bg-white pl-9 pr-3 text-sm text-slate-900 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20"
        aria-label={placeholder}
      />
    </div>
  )
}

export function FilterBar({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('flex flex-col gap-2 border-b border-slate-200 bg-slate-50/50 px-4 py-3 lg:flex-row lg:flex-wrap lg:items-center', className)}>{children}</div>
}

export function InfoGrid({ items, columns = 2 }: { items: Array<{ label: string; value: ReactNode }>; columns?: 1 | 2 | 3 | 4 }) {
  const colClass = columns === 1 ? 'grid-cols-1' : columns === 3 ? 'sm:grid-cols-3' : columns === 4 ? 'sm:grid-cols-2 lg:grid-cols-4' : 'sm:grid-cols-2'
  return (
    <dl className={cn('grid grid-cols-1 gap-x-6 gap-y-3 text-sm', colClass)}>
      {items.map((item) => (
        <div key={item.label}>
          <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{item.label}</dt>
          <dd className="mt-0.5 break-words text-slate-800">{item.value ?? '—'}</dd>
        </div>
      ))}
    </dl>
  )
}
