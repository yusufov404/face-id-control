/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'
import { AlertCircle, CheckCircle2, Info, TriangleAlert, X } from 'lucide-react'
import { cn } from '@/lib/format'

type ToastTone = 'success' | 'error' | 'info' | 'warning'

interface ToastItem {
  id: number
  tone: ToastTone
  message: string
}

interface ToastApi {
  success: (message: string) => void
  error: (message: string) => void
  info: (message: string) => void
  warning: (message: string) => void
}

const ToastContext = createContext<ToastApi | null>(null)

const toneStyles: Record<ToastTone, { wrap: string; icon: ReactNode }> = {
  success: { wrap: 'border-emerald-200 bg-white text-slate-800', icon: <CheckCircle2 className="h-5 w-5 text-emerald-600" /> },
  error: { wrap: 'border-red-200 bg-white text-slate-800', icon: <AlertCircle className="h-5 w-5 text-red-600" /> },
  info: { wrap: 'border-sky-200 bg-white text-slate-800', icon: <Info className="h-5 w-5 text-sky-600" /> },
  warning: { wrap: 'border-amber-200 bg-white text-slate-800', icon: <TriangleAlert className="h-5 w-5 text-amber-600" /> },
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const nextId = useRef(1)

  const remove = useCallback((id: number) => {
    setItems((current) => current.filter((item) => item.id !== id))
  }, [])

  const push = useCallback((tone: ToastTone, message: string) => {
    const id = nextId.current++
    setItems((current) => [...current.slice(-3), { id, tone, message }])
    window.setTimeout(() => remove(id), tone === 'error' ? 7000 : 4500)
  }, [remove])

  const api = useMemo<ToastApi>(() => ({
    success: (message) => push('success', message),
    error: (message) => push('error', message),
    info: (message) => push('info', message),
    warning: (message) => push('warning', message),
  }), [push])

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[calc(100%-2rem)] max-w-sm flex-col gap-2" aria-live="polite">
        {items.map((item) => {
          const style = toneStyles[item.tone]
          return (
            <div key={item.id} className={cn('pointer-events-auto flex items-start gap-2.5 rounded-xl border p-3 shadow-lg shadow-slate-900/10', style.wrap)}>
              <div className="mt-0.5 shrink-0">{style.icon}</div>
              <p className="min-w-0 flex-1 text-xs font-medium leading-relaxed">{item.message}</p>
              <button type="button" onClick={() => remove(item.id)} className="rounded p-0.5 text-slate-400 hover:text-slate-700" aria-label="Xabarni yopish">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )
        })}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast(): ToastApi {
  const context = useContext(ToastContext)
  if (!context) throw new Error('useToast ToastProvider ichida ishlatilishi kerak')
  return context
}
