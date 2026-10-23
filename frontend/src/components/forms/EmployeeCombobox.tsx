import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Search, UserRound, X } from 'lucide-react'
import { employeesApi } from '@/api/services'
import { useDebouncedValue } from '@/lib/hooks'
import { cn } from '@/lib/format'
import { Spinner } from '@/components/ui/Feedback'

interface EmployeeComboboxProps {
  value: number | null
  onChange: (employeeId: number | null) => void
  label?: string
  departmentId?: number | null
  disabled?: boolean
  allowClear?: boolean
  placeholder?: string
  invalid?: boolean
  id?: string
}

export function EmployeeCombobox({
  value,
  onChange,
  label,
  departmentId,
  disabled = false,
  allowClear = true,
  placeholder = 'Xodimni qidiring…',
  invalid = false,
  id,
}: EmployeeComboboxProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const debounced = useDebouncedValue(search, 300)
  const wrapperRef = useRef<HTMLDivElement>(null)

  const selectedQuery = useQuery({
    queryKey: ['employee', value],
    queryFn: () => employeesApi.get(value as number),
    enabled: Boolean(value) && !label,
    staleTime: 60_000,
  })

  const listQuery = useQuery({
    queryKey: ['employee-combobox', debounced, departmentId],
    queryFn: () => employeesApi.list({
      page: 1,
      page_size: 20,
      search: debounced || undefined,
      department_id: departmentId || undefined,
    }),
    enabled: open,
    staleTime: 15_000,
  })

  useEffect(() => {
    const handler = (event: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const selectedName = label || selectedQuery.data?.full_name || (value ? `Xodim #${value}` : '')

  return (
    <div ref={wrapperRef} className="relative">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          id={id}
          value={open ? search : selectedName}
          disabled={disabled}
          onFocus={() => {
            setOpen(true)
            setSearch('')
          }}
          onChange={(event) => {
            setSearch(event.target.value)
            setOpen(true)
          }}
          placeholder={placeholder}
          className={cn(
            'h-10 w-full rounded-lg border bg-white pl-9 pr-9 text-sm text-slate-900 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 disabled:bg-slate-100',
            invalid ? 'border-red-400' : 'border-slate-300',
          )}
          autoComplete="off"
        />
        {allowClear && value ? (
          <button
            type="button"
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:text-slate-700"
            onClick={() => {
              onChange(null)
              setSearch('')
              setOpen(false)
            }}
            aria-label="Tanlovni tozalash"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>

      {open ? (
        <div className="absolute left-0 right-0 top-[calc(100%+4px)] z-30 max-h-64 overflow-y-auto rounded-xl border border-slate-200 bg-white py-1 shadow-xl">
          {listQuery.isLoading ? (
            <div className="flex items-center justify-center gap-2 px-3 py-4 text-xs text-slate-500"><Spinner className="h-4 w-4" /> Qidirilmoqda…</div>
          ) : listQuery.isError ? (
            <div className="px-3 py-4 text-xs text-red-600">{listQuery.error instanceof Error ? listQuery.error.message : "Xodimlarni yuklab bo'lmadi"}</div>
          ) : listQuery.data?.items.length ? (
            listQuery.data.items.map((employee) => (
              <button
                key={employee.id}
                type="button"
                className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition hover:bg-slate-50"
                onClick={() => {
                  onChange(employee.id)
                  setSearch('')
                  setOpen(false)
                }}
              >
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-100 text-slate-500">
                  <UserRound className="h-3.5 w-3.5" />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-xs font-semibold text-slate-800">{employee.full_name}</span>
                  <span className="block truncate text-[10px] text-slate-400">
                    {employee.internal_id} · {employee.department_name || "Bo'lim yo'q"}
                  </span>
                </span>
              </button>
            ))
          ) : (
            <p className="px-3 py-4 text-xs text-slate-500">Xodim topilmadi</p>
          )}
        </div>
      ) : null}
    </div>
  )
}
