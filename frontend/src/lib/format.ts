const TZ = 'Asia/Tashkent'

export function cn(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(' ')
}

export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  return new Intl.NumberFormat('uz-UZ').format(value)
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return '—'
  const datePart = value.slice(0, 10)
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(datePart)
  if (!match) return value
  return `${match[3]}.${match[2]}.${match[1]}`
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return new Intl.DateTimeFormat('uz-UZ', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: TZ,
  }).format(parsed)
}

export function formatTime(value: string | null | undefined): string {
  if (!value) return '—'
  if (/^\d{2}:\d{2}(:\d{2})?$/.test(value)) return value.slice(0, 5)
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return new Intl.DateTimeFormat('uz-UZ', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: TZ,
  }).format(parsed)
}

export function formatMinutes(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—'
  const minutes = Math.max(0, Math.round(value))
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (!hours) return `${rest} daq`
  return rest ? `${hours} s ${rest} daq` : `${hours} soat`
}

export function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value < 0) return '—'
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(2)} MB`
  return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

export function initials(name: string | null | undefined): string {
  if (!name) return '—'
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('')
}

export function todayISO(): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())
  const pick = (type: string) => parts.find((part) => part.type === type)?.value ?? ''
  return `${pick('year')}-${pick('month')}-${pick('day')}`
}

export function addDaysISO(days: number): string {
  const date = new Date(`${todayISO()}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

export function formatDateTimeInput(value: string | null | undefined): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)
  const pick = (type: string) => parts.find((part) => part.type === type)?.value ?? ''
  return `${pick('year')}-${pick('month')}-${pick('day')}T${pick('hour')}:${pick('minute')}`
}

export function nowDateTimeInput(): string {
  return formatDateTimeInput(new Date().toISOString())
}

// Asia/Tashkent has been a fixed UTC+5 zone without DST since 1991.
export function parseTashkentDateTime(value: string): string {
  if (!value) throw new Error("Sana va vaqtni kiriting")
  const withSeconds = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value) ? `${value}:00` : value
  const parsed = new Date(`${withSeconds}+05:00`)
  if (Number.isNaN(parsed.getTime())) throw new Error("Sana va vaqt noto'g'ri")
  return parsed.toISOString()
}

export const STATUS_LABELS: Record<string, string> = {
  present: 'Kelgan',
  late: 'Kechikkan',
  early_leave: 'Erta ketgan',
  late_and_early: 'Kechikkan va erta',
  absent: 'Kelmagan',
  on_leave: "Ta'tilda",
  holiday: 'Bayram',
  weekend: 'Dam olish',
  incomplete: "To'liqsiz",
  not_scheduled: "Smena yo'q",
  unknown: "Noma'lum",
}

export const STATUS_TONES: Record<string, string> = {
  present: 'green',
  late: 'amber',
  early_leave: 'amber',
  late_and_early: 'amber',
  absent: 'red',
  on_leave: 'blue',
  holiday: 'violet',
  weekend: 'slate',
  incomplete: 'amber',
  not_scheduled: 'slate',
  unknown: 'slate',
}

export const EMPLOYMENT_STATUS_LABELS: Record<string, string> = {
  active: 'Faol',
  on_leave: "Ta'tilda",
  suspended: "To'xtatilgan",
  terminated: "Ishdan bo'shatilgan",
  probation: 'Sinov muddatida',
}

export const EMPLOYMENT_STATUS_TONES: Record<string, string> = {
  active: 'green',
  on_leave: 'blue',
  suspended: 'amber',
  terminated: 'red',
  probation: 'violet',
}

export const LEAVE_TYPE_LABELS: Record<string, string> = {
  annual: "Yillik ta'til",
  sick: 'Kasallik varaqasi',
  maternity: "Onalik ta'tili",
  paternity: "Otalik ta'tili",
  unpaid: "To'lanmaydigan ta'til",
  study: "O'quv ta'tili",
  marriage: "Nikoh ta'tili",
  bereavement: "Aza ta'tili",
  other: 'Boshqa',
}

export const LEAVE_STATUS_LABELS: Record<string, string> = {
  pending: 'Ko‘rib chiqilmoqda',
  approved: 'Tasdiqlangan',
  rejected: 'Rad etilgan',
  cancelled: 'Bekor qilingan',
}

export const LEAVE_STATUS_TONES: Record<string, string> = {
  pending: 'amber',
  approved: 'green',
  rejected: 'red',
  cancelled: 'slate',
}

export const DEVICE_STATUS_LABELS: Record<string, string> = {
  online: 'Onlayn',
  offline: 'Oflayn',
  error: 'Xatolik',
  maintenance: "Ta'mirlashda",
  unknown: "Noma'lum",
}

export const DEVICE_STATUS_TONES: Record<string, string> = {
  online: 'green',
  offline: 'red',
  error: 'red',
  maintenance: 'amber',
  unknown: 'slate',
}

export const DEVICE_TYPE_LABELS: Record<string, string> = {
  face_id: 'Face ID',
  fingerprint: 'Barmoq izi',
  card_reader: 'Karta o‘quvchi',
  multi_biometric: 'Multibiometrik',
}

export const EVENT_TYPE_LABELS: Record<string, string> = {
  check_in: 'Kirish',
  check_out: 'Chiqish',
  break_start: 'Tanaffus boshlanishi',
  break_end: 'Tanaffus tugashi',
  overtime_start: 'Qo‘shimcha ish boshlanishi',
  overtime_end: 'Qo‘shimcha ish tugashi',
  unknown: "Noma'lum",
}

export const VERIFY_MODE_LABELS: Record<string, string> = {
  face: 'Yuz',
  fingerprint: 'Barmoq izi',
  card: 'Karta',
  password: 'Parol',
  face_fingerprint: 'Yuz + barmoq',
  face_card: 'Yuz + karta',
  multi: 'Multibiometrik',
}

export const SHIFT_TYPE_LABELS: Record<string, string> = {
  fixed: 'Belgilangan',
  rotating: 'Aylanma',
  flexible: 'Moslashuvchan',
  night: 'Tungi',
}

export const WEEKDAYS = [
  { value: 'monday', label: 'Dushanba' },
  { value: 'tuesday', label: 'Seshanba' },
  { value: 'wednesday', label: 'Chorshanba' },
  { value: 'thursday', label: 'Payshanba' },
  { value: 'friday', label: 'Juma' },
  { value: 'saturday', label: 'Shanba' },
  { value: 'sunday', label: 'Yakshanba' },
]

export const CORRECTION_TYPE_LABELS: Record<string, string> = {
  check_in: 'Kirish vaqti',
  check_out: 'Chiqish vaqti',
  status: 'Holat',
  shift: 'Smena',
  full_day: "To'liq kun",
}

export function roleLabel(role: string | null | undefined): string {
  const labels: Record<string, string> = {
    super_admin: 'Super Admin',
    chief_physician: 'Bosh shifokor',
    hr_director: "Kadrlar boshlig'i",
    department_head: "Bo'lim boshlig'i",
    auditor: 'Auditor',
  }
  return role ? labels[role] || role : '—'
}

export function safeJson(value: unknown): string {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}
