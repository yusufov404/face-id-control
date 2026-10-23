import type { ReactNode } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/format'
import { EmptyState, ErrorState } from './Feedback'

export interface Column<T> {
  key: string
  header: ReactNode
  cell: (row: T) => ReactNode
  className?: string
  headerClassName?: string
}

interface DataTableProps<T> {
  columns: Column<T>[]
  rows: T[] | undefined
  rowKey: (row: T) => string | number
  loading?: boolean
  error?: string | null
  onRetry?: () => void
  emptyTitle?: string
  emptyDescription?: string
  emptyAction?: ReactNode
  emptyIcon?: ReactNode
  onRowClick?: (row: T) => void
  footer?: ReactNode
  dense?: boolean
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  loading = false,
  error = null,
  onRetry,
  emptyTitle = "Ma'lumot topilmadi",
  emptyDescription = "Hozircha bu bo'limda yozuvlar yo'q.",
  emptyAction,
  emptyIcon,
  onRowClick,
  footer,
  dense = false,
}: DataTableProps<T>) {
  if (error) return <ErrorState message={error} onRetry={onRetry} />
  if (loading) {
    return (
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50/80">
            <tr>
              {columns.map((column) => (
                <th key={column.key} className={cn('px-4 py-3 text-[11px] font-bold uppercase tracking-wide text-slate-500', column.headerClassName)}>
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {Array.from({ length: 6 }).map((_, rowIndex) => (
              <tr key={rowIndex}>
                {columns.map((column) => (
                  <td key={column.key} className="px-4 py-3.5">
                    <div className="h-3.5 animate-pulse rounded bg-slate-200" style={{ width: `${55 + ((rowIndex + column.key.length) % 4) * 11}%` }} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }
  if (!rows || rows.length === 0) {
    return <EmptyState title={emptyTitle} description={emptyDescription} action={emptyAction} icon={emptyIcon} />
  }
  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50/80">
            <tr>
              {columns.map((column) => (
                <th key={column.key} className={cn('px-4 py-3 text-[11px] font-bold uppercase tracking-wide text-slate-500', column.headerClassName)}>
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((row) => (
              <tr
                key={rowKey(row)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={cn('bg-white transition-colors hover:bg-slate-50/80', onRowClick ? 'cursor-pointer' : '')}
              >
                {columns.map((column) => (
                  <td key={column.key} className={cn('px-4 align-middle text-slate-700', dense ? 'py-2.5' : 'py-3.5', column.className)}>
                    {column.cell(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {footer ? <div className="border-t border-slate-200 px-4 py-3">{footer}</div> : null}
    </>
  )
}

interface PaginationProps {
  page: number
  pages: number
  total: number
  pageSize: number
  onPageChange: (page: number) => void
  onPageSizeChange?: (size: number) => void
  loading?: boolean
}

export function Pagination({ page, pages, total, pageSize, onPageChange, onPageSizeChange, loading }: PaginationProps) {
  const safePages = Math.max(pages || 0, 1)
  const start = total === 0 ? 0 : (page - 1) * pageSize + 1
  const end = Math.min(total, page * pageSize)
  return (
    <div className="flex flex-col gap-3 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-2">
        <span>
          {start}–{end} / {total} ta yozuv
        </span>
        {onPageSizeChange ? (
          <label className="flex items-center gap-1.5">
            <span className="hidden sm:inline">Sahifada:</span>
            <select
              value={pageSize}
              onChange={(event) => onPageSizeChange(Number(event.target.value))}
              disabled={loading}
              className="rounded-md border border-slate-300 bg-white px-1.5 py-1 text-xs focus:border-teal-500 focus:outline-none"
              aria-label="Sahifa hajmi"
            >
              {[10, 20, 50, 100].map((size) => <option key={size} value={size}>{size}</option>)}
            </select>
          </label>
        ) : null}
      </div>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1 || loading}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
          aria-label="Oldingi sahifa"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="min-w-[92px] text-center font-medium text-slate-600">
          {page} / {safePages} sahifa
        </span>
        <button
          type="button"
          onClick={() => onPageChange(page + 1)}
          disabled={page >= safePages || loading}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
          aria-label="Keyingi sahifa"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}
