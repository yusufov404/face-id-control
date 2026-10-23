import type { ReactNode } from 'react'
import { cn } from '@/lib/format'

export interface TabItem {
  key: string
  label: string
  icon?: ReactNode
  count?: number
}

export function Tabs({ items, value, onChange, className }: { items: TabItem[]; value: string; onChange: (key: string) => void; className?: string }) {
  return (
    <div className={cn('flex gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-white p-1 shadow-sm', className)} role="tablist">
      {items.map((item) => {
        const active = item.key === value
        return (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(item.key)}
            className={cn(
              'inline-flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold transition',
              active ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
            )}
          >
            {item.icon}
            {item.label}
            {typeof item.count === 'number' ? (
              <span className={cn('rounded-md px-1.5 py-0.5 text-[10px]', active ? 'bg-white/15 text-white' : 'bg-slate-100 text-slate-500')}>
                {item.count}
              </span>
            ) : null}
          </button>
        )
      })}
    </div>
  )
}
