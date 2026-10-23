/* FaceSys Enterprise — API client
   Handles access/refresh tokens, automatic refresh, and Uzbek error messages. */
const API_BASE = (window.FACESYS_API_BASE || '/api/v1');
const TOKEN_KEY = 'facesys.access';
const REFRESH_KEY = 'facesys.refresh';

export const auth = {
  get access() { return localStorage.getItem(TOKEN_KEY); },
  get refresh() { return localStorage.getItem(REFRESH_KEY); },
  set(tokens) {
    localStorage.setItem(TOKEN_KEY, tokens.access_token);
    localStorage.setItem(REFRESH_KEY, tokens.refresh_token);
  },
  clear() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(REFRESH_KEY);
  },
  get isLoggedIn() { return !!this.access; },
};

let refreshing = null;

async function refreshTokens() {
  if (!auth.refresh) throw new Error('Sessiya tugagan');
  if (!refreshing) {
    refreshing = fetch(`${API_BASE}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: auth.refresh }),
    }).then(async (r) => {
      if (!r.ok) throw new Error('Sessiya tugagan');
      const data = await r.json();
      auth.set(data);
      return data;
    }).finally(() => { refreshing = null; });
  }
  return refreshing;
}

export class ApiError extends Error {
  constructor(message, status, payload) {
    super(message);
    this.status = status;
    this.payload = payload;
  }
}

function describe(payload, status) {
  if (payload && typeof payload === 'object') {
    if (Array.isArray(payload.errors) && payload.errors.length) {
      return `${payload.detail || 'Xatolik'}: ${payload.errors.slice(0, 3).join('; ')}`;
    }
    if (payload.detail) {
      return typeof payload.detail === 'string' ? payload.detail : JSON.stringify(payload.detail);
    }
  }
  const fallback = {
    400: "So'rov noto'g'ri",
    401: 'Avtorizatsiya talab qilinadi',
    403: "Bu amal uchun ruxsat yo'q",
    404: "Ma'lumot topilmadi",
    409: "Ma'lumot allaqachon mavjud yoki amal bajarilmaydi",
    422: "Ma'lumotlar validatsiyadan o'tmadi",
    429: "Juda ko'p urinish. Biroz kuting",
    500: 'Server xatosi',
    502: 'Qurilma bilan aloqa xatosi',
  };
  return fallback[status] || `Xatolik (${status})`;
}

async function request(path, { method = 'GET', body, params, retry = true, raw = false } = {}) {
  const url = new URL(`${API_BASE}${path}`, window.location.origin);
  if (params) {
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
    });
  }
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (auth.access) headers['Authorization'] = `Bearer ${auth.access}`;

  let resp;
  try {
    resp = await fetch(url.toString(), {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError("Serverga ulanib bo'lmadi. Tarmoqni tekshiring.", 0, null);
  }

  if (resp.status === 401 && retry && auth.refresh) {
    try {
      await refreshTokens();
      return request(path, { method, body, params, retry: false, raw });
    } catch {
      auth.clear();
      if (!location.pathname.endsWith('login.html') && location.pathname !== '/') {
        location.href = 'login.html?expired=1';
      }
      throw new ApiError('Sessiya tugagan. Qayta kiring.', 401, null);
    }
  }

  if (resp.status === 204) return null;

  if (raw) {
    if (!resp.ok) {
      let payload = null;
      try { payload = await resp.json(); } catch { /* ignore */ }
      throw new ApiError(describe(payload, resp.status), resp.status, payload);
    }
    return resp;
  }

  let payload = null;
  const text = await resp.text();
  if (text) {
    try { payload = JSON.parse(text); } catch { payload = text; }
  }

  if (!resp.ok) {
    if (resp.status === 401) {
      auth.clear();
      if (!location.pathname.endsWith('login.html')) location.href = 'login.html?expired=1';
    }
    throw new ApiError(describe(payload, resp.status), resp.status, payload);
  }
  return payload;
}

export const api = {
  get: (p, params) => request(p, { params }),
  post: (p, body) => request(p, { method: 'POST', body }),
  put: (p, body) => request(p, { method: 'PUT', body }),
  patch: (p, body) => request(p, { method: 'PATCH', body }),
  del: (p) => request(p, { method: 'DELETE' }),
  async download(path, params, filename) {
    const resp = await request(path, { params, raw: true });
    const blob = await resp.blob();
    const cd = resp.headers.get('Content-Disposition') || '';
    const match = cd.match(/filename\*=UTF-8''([^;]+)/);
    const name = filename || (match ? decodeURIComponent(match[1]) : 'export');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  },
};
