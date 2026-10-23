import type { QueryParams, TokenResponse } from './types'

const RAW_BASE = (import.meta.env.VITE_API_BASE_URL || '/api/v1').trim()
export const API_BASE = RAW_BASE.replace(/\/+$/, '') || '/api/v1'

const ACCESS_KEY = 'facesys.access'
const REFRESH_KEY = 'facesys.refresh'
export const SESSION_EXPIRED_EVENT = 'facesys:session-expired'

export const tokenStore = {
  get access() {
    return localStorage.getItem(ACCESS_KEY)
  },
  get refresh() {
    return localStorage.getItem(REFRESH_KEY)
  },
  set(tokens: Pick<TokenResponse, 'access_token' | 'refresh_token'>) {
    localStorage.setItem(ACCESS_KEY, tokens.access_token)
    localStorage.setItem(REFRESH_KEY, tokens.refresh_token)
  },
  clear() {
    localStorage.removeItem(ACCESS_KEY)
    localStorage.removeItem(REFRESH_KEY)
  },
}

export class ApiError extends Error {
  status: number
  payload: unknown

  constructor(message: string, status = 0, payload: unknown = null) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.payload = payload
  }
}

type RequestOptions = {
  method?: string
  body?: unknown
  params?: QueryParams
  auth?: boolean
  retry?: boolean
}

function buildUrl(path: string, params?: QueryParams): string {
  const base = API_BASE.replace(/\/+$/, '')
  const suffix = path.startsWith('/') ? path : `/${path}`
  const raw = `${base}${suffix}`
  const url = new URL(raw, window.location.origin)
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null || value === '') continue
      if (Array.isArray(value)) {
        for (const item of value) {
          if (item !== undefined && item !== null && item !== '') url.searchParams.append(key, String(item))
        }
      } else {
        url.searchParams.set(key, String(value))
      }
    }
  }
  return /^https?:\/\//i.test(raw) ? url.toString() : `${url.pathname}${url.search}`
}

function fallbackMessage(status: number): string {
  const messages: Record<number, string> = {
    0: "Serverga ulanib bo'lmadi. Tarmoqni tekshiring.",
    400: "So'rov noto'g'ri.",
    401: 'Avtorizatsiya talab qilinadi.',
    403: "Bu amal uchun ruxsat yo'q.",
    404: "Ma'lumot topilmadi.",
    409: "Ma'lumot allaqachon mavjud yoki amalni bajarib bo'lmaydi.",
    422: "Kiritilgan ma'lumotlar validatsiyadan o'tmadi.",
    423: 'Hisob vaqtincha bloklangan.',
    429: "Juda ko'p urinish. Biroz kuting.",
    500: 'Server xatosi.',
    502: 'Qurilma bilan aloqa xatosi.',
    503: 'Xizmat vaqtincha mavjud emas.',
  }
  return messages[status] || `Xatolik (${status}).`
}

function messageFromPayload(payload: unknown, status: number): string {
  if (payload && typeof payload === 'object') {
    const detail = (payload as { detail?: unknown }).detail
    if (typeof detail === 'string' && detail.trim()) return detail
    if (Array.isArray(detail) && detail.length) {
      const parts = detail.slice(0, 4).map((item) => {
        if (item && typeof item === 'object') {
          const entry = item as { msg?: unknown; loc?: unknown }
          const location = Array.isArray(entry.loc) ? entry.loc.filter((x) => x !== 'body').join('.') : ''
          const msg = typeof entry.msg === 'string' ? entry.msg : 'xato'
          return location ? `${location}: ${msg}` : msg
        }
        return String(item)
      })
      return parts.join('; ')
    }
  }
  return fallbackMessage(status)
}

async function parsePayload(response: Response): Promise<unknown> {
  const text = await response.text()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

let refreshing: Promise<TokenResponse> | null = null

async function refreshTokens(): Promise<TokenResponse> {
  if (!tokenStore.refresh) throw new ApiError('Sessiya tugagan. Qayta kiring.', 401)
  if (refreshing) return refreshing

  refreshing = (async () => {
    let response: Response
    try {
      response = await fetch(buildUrl('/auth/refresh'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: tokenStore.refresh }),
      })
    } catch {
      throw new ApiError("Serverga ulanib bo'lmadi. Tarmoqni tekshiring.", 0)
    }
    const payload = await parsePayload(response)
    if (!response.ok) {
      throw new ApiError(messageFromPayload(payload, response.status), response.status, payload)
    }
    const tokens = payload as TokenResponse
    tokenStore.set(tokens)
    return tokens
  })()

  try {
    return await refreshing
  } finally {
    refreshing = null
  }
}

function expireSession() {
  tokenStore.clear()
  sessionStorage.setItem('facesys.session-expired', '1')
  window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT))
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, params, auth = true, retry = true } = options
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (auth && tokenStore.access) headers.Authorization = `Bearer ${tokenStore.access}`

  let response: Response
  try {
    response = await fetch(buildUrl(path, params), {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
    })
  } catch {
    throw new ApiError("Serverga ulanib bo'lmadi. Tarmoqni tekshiring.", 0)
  }

  if (response.status === 401 && auth && retry && tokenStore.refresh) {
    try {
      await refreshTokens()
      return request<T>(path, { ...options, retry: false })
    } catch {
      expireSession()
      throw new ApiError('Sessiya tugagan. Qayta kiring.', 401)
    }
  }

  if (response.status === 204) return null as T

  const payload = await parsePayload(response)
  if (!response.ok) {
    if (response.status === 401 && auth) expireSession()
    throw new ApiError(messageFromPayload(payload, response.status), response.status, payload)
  }
  return payload as T
}

export const http = {
  get<T>(path: string, params?: QueryParams) {
    return request<T>(path, { params })
  },
  post<T>(path: string, body?: unknown, params?: QueryParams) {
    return request<T>(path, { method: 'POST', body, params })
  },
  put<T>(path: string, body?: unknown, params?: QueryParams) {
    return request<T>(path, { method: 'PUT', body, params })
  },
  patch<T>(path: string, body?: unknown, params?: QueryParams) {
    return request<T>(path, { method: 'PATCH', body, params })
  },
  delete<T>(path: string, params?: QueryParams) {
    return request<T>(path, { method: 'DELETE', params })
  },
  async download(path: string, params: QueryParams | undefined, fallbackName: string): Promise<string> {
    let response: Response
    try {
      response = await fetch(buildUrl(path, params), {
        headers: tokenStore.access ? { Authorization: `Bearer ${tokenStore.access}` } : {},
        credentials: 'same-origin',
      })
    } catch {
      throw new ApiError("Serverga ulanib bo'lmadi. Tarmoqni tekshiring.", 0)
    }
    if (response.status === 401 && tokenStore.refresh) {
      try {
        await refreshTokens()
        return http.download(path, params, fallbackName)
      } catch {
        expireSession()
        throw new ApiError('Sessiya tugagan. Qayta kiring.', 401)
      }
    }
    if (!response.ok) {
      const payload = await parsePayload(response)
      throw new ApiError(messageFromPayload(payload, response.status), response.status, payload)
    }
    const blob = await response.blob()
    const disposition = response.headers.get('Content-Disposition') || ''
    const match = disposition.match(/filename\*=UTF-8''([^;]+)/i)
      || disposition.match(/filename="?([^";]+)"?/i)
    const filename = match ? decodeURIComponent(match[1]) : fallbackName
    const href = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = href
    link.download = filename
    document.body.appendChild(link)
    link.click()
    link.remove()
    window.setTimeout(() => URL.revokeObjectURL(href), 4000)
    return filename
  },
}

export { request }
