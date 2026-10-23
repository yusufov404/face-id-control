export type ValidationErrors = Record<string, string>

export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function required(value: unknown, label: string): string | null {
  if (value === null || value === undefined) return `${label} majburiy`
  if (typeof value === 'string' && !value.trim()) return `${label} majburiy`
  return null
}

export function emailError(value: string, label = 'Email'): string | null {
  if (!value.trim()) return `${label} majburiy`
  if (!EMAIL_PATTERN.test(value.trim())) return `${label} formati noto'g'ri`
  return null
}

export function minLength(value: string, length: number, label: string): string | null {
  if (value.trim().length < length) return `${label} kamida ${length} belgidan iborat bo'lishi kerak`
  return null
}

export function dateOrderError(start: string, end: string, startLabel = 'Boshlanish sanasi', endLabel = 'Tugash sanasi'): string | null {
  if (!start || !end) return null
  if (end < start) return `${endLabel} ${startLabel.toLowerCase()}dan keyin bo'lishi kerak`
  return null
}

export function collectErrors(entries: Array<[string, string | null]>): ValidationErrors {
  const output: ValidationErrors = {}
  for (const [key, message] of entries) {
    if (message) output[key] = message
  }
  return output
}

export function hasErrors(errors: ValidationErrors): boolean {
  return Object.keys(errors).length > 0
}

export function toNumber(value: string): number | null {
  if (!value.trim()) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

export function cleanText(value: string): string {
  return value.trim()
}

export function nullableText(value: string): string | null {
  const cleaned = value.trim()
  return cleaned || null
}
