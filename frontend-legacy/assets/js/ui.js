/* Shared UI helpers: escaping, formatting, toasts, modals, tables, pagination. */

export const esc = (v) => String(v ?? '')
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&#39;');

export const fmtNum = (n) => new Intl.NumberFormat('uz-UZ').format(Number(n || 0));

export function fmtDate(v) {
  if (!v) return '—';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return esc(v);
  return d.toLocaleDateString('uz-UZ', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

export function fmtDateTime(v) {
  if (!v) return '—';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return esc(v);
  return d.toLocaleString('uz-UZ', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}

export function fmtTime(v) {
  if (!v) return '—';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return esc(v);
  return d.toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit' });
}

export function minutesToHm(m) {
  const n = Number(m || 0);
  const h = Math.floor(n / 60);
  const mm = n % 60;
  return h ? `${h}s ${mm}d` : `${mm} daq`;
}

const STATUS_MAP = {
  present: ['present', 'Kelgan'],
  late: ['late', 'Kechikkan'],
  early_leave: ['late', 'Erta ketgan'],
  late_and_early: ['late', 'Kechikkan / erta'],
  absent: ['absent', 'Kelmagan'],
  on_leave: ['leave', "Ta'tilda"],
  holiday: ['holiday', 'Bayram'],
  weekend: ['unknown', 'Dam olish'],
  incomplete: ['incomplete', "To'liqsiz"],
  not_scheduled: ['unknown', "Smena yo'q"],
  unknown: ['unknown', "Noma'lum"],
  online: ['online', 'Onlayn'],
  offline: ['offline', 'Oflayn'],
  error: ['offline', 'Xato'],
  maintenance: ['late', "Ta'mirda"],
  active: ['present', 'Faol'],
  suspended: ['late', "To'xtatilgan"],
  terminated: ['absent', "Ishdan bo'shagan"],
  probation: ['incomplete', 'Sinov muddati'],
  approved: ['present', 'Tasdiqlangan'],
  pending: ['late', 'Kutilmoqda'],
  rejected: ['absent', 'Rad etilgan'],
  cancelled: ['unknown', 'Bekor qilingan'],
};

export function statusPill(status) {
  const [cls, label] = STATUS_MAP[status] || ['unknown', status || "Noma'lum"];
  return `<span class="pill ${cls}">${esc(label)}</span>`;
}

export function toast(message, type = 'info', ms = 4200) {
  let stack = document.querySelector('.toast-stack');
  if (!stack) {
    stack = document.createElement('div');
    stack.className = 'toast-stack';
    stack.setAttribute('aria-live', 'polite');
    document.body.appendChild(stack);
  }
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<span>${esc(message)}</span><button class="close" aria-label="Yopish">×</button>`;
  el.querySelector('.close').onclick = () => el.remove();
  stack.appendChild(el);
  setTimeout(() => el.remove(), ms);
  return el;
}

export function modal({ title, body, footer, wide = false, onMount, onClose }) {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <header><h3>${esc(title)}</h3><button class="icon-btn x" aria-label="Yopish">×</button></header>
      <div class="body">${body}</div>
      ${footer ? `<footer>${footer}</footer>` : ''}
    </div>`;
  document.body.appendChild(backdrop);
  const close = () => {
    backdrop.remove();
    document.removeEventListener('keydown', onKey);
    onClose && onClose();
  };
  const onKey = (e) => {
    if (e.key === 'Escape') close();
    if (e.key === 'Tab') {
      const focusables = backdrop.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  };
  document.addEventListener('keydown', onKey);
  backdrop.querySelector('.x').onclick = close;
  backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) close(); });
  onMount && onMount(backdrop, close);
  setTimeout(() => {
    const firstInput = backdrop.querySelector('input, select, textarea, button');
    firstInput && firstInput.focus();
  }, 30);
  return { close, el: backdrop };
}

export function confirmDialog(message, { title = 'Tasdiqlang', danger = true, confirmText = 'Tasdiqlash' } = {}) {
  return new Promise((resolve) => {
    const m = modal({
      title,
      body: `<p style="margin:0;font-size:13.5px">${esc(message)}</p>`,
      footer: `
        <button class="btn btn-secondary" data-act="cancel">Bekor qilish</button>
        <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-act="ok">${esc(confirmText)}</button>`,
      onMount(el, close) {
        el.querySelector('[data-act=cancel]').onclick = () => { close(); resolve(false); };
        el.querySelector('[data-act=ok]').onclick = () => { close(); resolve(true); };
      },
      onClose: () => resolve(false),
    });
    m; // keep reference
  });
}

export function loadingBlock(text = "Yuklanmoqda…") {
  return `<div class="loading"><div class="spinner" role="status" aria-label="${esc(text)}"></div><span>${esc(text)}</span></div>`;
}

export function emptyBlock(title, text = '', action = '') {
  return `<div class="empty"><div class="glyph">◌</div><h3>${esc(title)}</h3>${text ? `<p>${esc(text)}</p>` : ''}${action}</div>`;
}

export function errorBlock(message, retryId = '') {
  return `<div class="empty"><div class="glyph text-danger">⚠</div>
    <h3>Xatolik</h3><p>${esc(message)}</p>
    ${retryId ? `<button class="btn btn-secondary mt-2" id="${retryId}">Qayta urinish</button>` : ''}
  </div>`;
}

export function pageButtons(page, pages, onGo) {
  const wrap = document.createElement('div');
  wrap.className = 'page-btns';
  const add = (label, p, opts = {}) => {
    const b = document.createElement('button');
    b.textContent = label;
    if (opts.active) b.classList.add('active');
    if (opts.disabled) b.disabled = true;
    if (opts.label) b.setAttribute('aria-label', opts.label);
    b.onclick = () => onGo(p);
    wrap.appendChild(b);
  };
  add('‹', Math.max(1, page - 1), { disabled: page <= 1, label: 'Oldingi sahifa' });
  const windowSize = 5;
  let start = Math.max(1, page - Math.floor(windowSize / 2));
  let end = Math.min(pages, start + windowSize - 1);
  start = Math.max(1, end - windowSize + 1);
  if (start > 1) { add('1', 1); if (start > 2) wrap.insertAdjacentHTML('beforeend', '<span style="padding:0 4px;color:#888">…</span>'); }
  for (let p = start; p <= end; p++) add(String(p), p, { active: p === page });
  if (end < pages) { if (end < pages - 1) wrap.insertAdjacentHTML('beforeend', '<span style="padding:0 4px;color:#888">…</span>'); add(String(pages), pages); }
  add('›', Math.min(pages, page + 1), { disabled: page >= pages, label: 'Keyingi sahifa' });
  return wrap;
}

export function renderPagination(container, { page, pages, total, pageSize, page_size }, onGo) {
  container.innerHTML = '';
  const size = pageSize || page_size || 20;
  const info = document.createElement('div');
  info.className = 'info';
  const from = total === 0 ? 0 : (page - 1) * size + 1;
  const to = Math.min(page * size, total);
  info.textContent = `${from}–${to} / ${fmtNum(total)} yozuv`;
  container.appendChild(info);
  container.appendChild(pageButtons(page, Math.max(pages, 1), onGo));
}

export function debounce(fn, ms = 320) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

export function formData(form) {
  const out = {};
  new FormData(form).forEach((v, k) => {
    if (typeof v === 'string') v = v.trim();
    if (v === '') v = null;
    out[k] = v;
  });
  return out;
}

export function toLocalInputValue(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function todayIso() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function initials(name = '') {
  return name.trim().split(/\s+/).slice(0, 2).map((p) => p[0] || '').join('').toUpperCase() || 'FS';
}