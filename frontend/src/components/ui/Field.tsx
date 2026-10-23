import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react'
import { cn } from '@/lib/format'

interface FieldProps {
  label: string
  htmlFor?: string
  error?: string
  hint?: string
  required?: boolean
  children: ReactNode
  className?: string
}

export function Field({ label, htmlFor, error, hint, required: isRequired, children, className }: FieldProps) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <label htmlFor={htmlFor} className="flex items-center gap-1 text-xs font-semibold text-slate-700">
        {label}
        {isRequired ? <span className="text-red-500" aria-hidden="true">*</span> : null}
      </label>
      {children}
      {error ? <p className="text-xs font-medium text-red-600">{error}</p> : hint ? <p className="text-xs text-slate-500">{hint}</p> : null}
    </div>
  )
}

const controlClass =
  'w-full rounded-lg border bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 disabled:bg-slate-100 disabled:text-slate-500'

export function Input({ className, invalid, ...props }: InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }) {
  return <input className={cn(controlClass, invalid ? 'border-red-400 focus:border-red-500' : 'border-slate-300', className)} {...props} />
}

export function Select({ className, invalid, children, ...props }: SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }) {
  return (
    <select className={cn(controlClass, invalid ? 'border-red-400 focus:border-red-500' : 'border-slate-300', className)} {...props}>
      {children}
    </select>
  )
}

export function Textarea({ className, invalid, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }) {
  return (
    <textarea
      className={cn(controlClass, 'min-h-[88px] resize-y', invalid ? 'border-red-400 focus:border-red-500' : 'border-slate-300', className)}
      {...props}
    />
  )
}

interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label: ReactNode
  description?: string
}

export function Checkbox({ label, description, className, ...props }: CheckboxProps) {
  return (
    <label className={cn('flex cursor-pointer items-start gap-2.5 rounded-lg border border-slate-200 p-3 transition hover:bg-slate-50', className)}>
      <input
        type="checkbox"
        className="mt-0.5 h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
        {...props}
      />
      <span>
        <span className="block text-sm font-medium text-slate-800">{label}</span>
        {description ? <span className="mt-0.5 block text-xs text-slate-500">{description}</span> : null}
      </span>
    </label>
  )
}
