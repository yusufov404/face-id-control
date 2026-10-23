import type { ReactNode } from 'react'
import { cn } from '@/lib/format'

export type BadgeTone = 'green' | 'red' | 'amber' | 'blue' | 'violet' | 'slate' | 'teal'

const tones: Record<BadgeTone, string> = {
  green: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  red: 'border-red-200 bg-red-50 text-red-700',
  amber: 'border-amber-200 bg-amber-50 text-amber-800',
  blue: 'border-sky-200 bg-sky-50 text-sky-700',
  violet: 'border-violet-200 bg-violet-50 text-violet-700',
  slate: 'border-slate-200 bg-slate-100 text-slate-600',
  teal: 'border-teal-200 bg-teal-50 text-teal-700',
}

export function Badge({ children, tone = 'slate', className }: { children: ReactNode; tone?: BadgeTone; className?: string }) {
  return (
    <span className={cn('inline-flex items-center whitespace-nowrap rounded-md border px-2 py-0.5 text-[11px] font-semibold leading-5', tones[tone], className)}>
      {children}
    </span>
  )
}

export function Dot({ tone = 'slate' }: { tone?: BadgeTone }) {
  const colors: Record<BadgeTone, string> = {
    green: 'bg-emerald-500',
    red: 'bg-red-500',
    amber: 'bg-amber-500',
    blue: 'bg-sky-500',
    violet: 'bg-violet-500',
    slate: 'bg-slate-400',
    teal: 'bg-teal-500',
  }
  return <span className={cn('inline-block h-1.5 w-1.5 rounded-full', colors[tone])} aria-hidden="true" />
}
