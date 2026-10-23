/* App shell, routing and navigation. */
import { api, auth } from './api.js';
import { esc, initials, modal, toast } from './ui.js';

const NAV = [
  { group: 'Asosiy' },
  { key: 'dashboard', label: 'Bosh sahifa', icon: '⌂', perm: 'report:dashboard' },
  { group: 'Kadrlar' },
  { key: 'employees', label: 'Xodimlar', icon: '👥', perm: 'employee:read' },
  { key: 'departments', label: "Bo'limlar", icon: '🏥', perm: 'department:read' },
  { key: 'positions', label: 'Lavozimlar', icon: '🎓', perm: 'position:read' },
  { group: 'Davomat' },
  { key: 'attendance', label: 'Davomat', icon: '🕒', perm: 'attendance:read' },
  { key: 'shifts', label: 'Smenalar', icon: '🔁', perm: 'shift:read' },
  { key: 'leaves', label: "Ta'tillar", icon: '🌴', perm: 'leave:read' },
  { key: 'reports', label: 'Hisobotlar', icon: '📊', perm: 'report:view' },
  { group: 'Tizim' },
  { key: 'devices', label: 'Qurilmalar', icon: '📟', perm: 'device:read' },
  { key: 'users', label: 'Foydalanuvchilar', icon: '🛡', perm: 'user:read' },
  { key: 'audit', label: 'Audit jurnali', icon: '📜', perm: 'audit:read' },
  { key: 'settings', label: 'Sozlamalar', icon: '⚙', perm: 'settings:read' },
];

const PAGES = {
  dashboard: () => import('../../pages/dashboard.js'),
  employees: () => import('../../pages/employees.js'),
  departments: () => import('../../pages/departments.js'),
  positions: () => import('../../pages/positions.js'),
  attendance: () => import('../../pages/attendance.js'),
  shifts: () => import('../../pages/shifts.js'),
  leaves: () => import('../../pages/leaves.js'),
  reports: () => import('../../pages/reports.js'),
  devices: () => import('../../pages/devices.js'),
  users: () => import('../../pages/users.js'),
  audit: () => import('../../pages/audit.js'),
  settings: () => import('../../pages/settings.js'),
};

export const state = {
  me: null,
  can(perm) {
    if (!this.me) return false;
    if (this.me.is_superuser) return true;
    return (this.me.permissions || []).includes(perm);
  },
  isRole(name) {
    return !!(this.me && (this.me.roles || []).includes(name));
  },
};

let current = null;

function menuHtml() {
  let out = '';
  for (const item of NAV) {
    if (item.group) { out += `<div class="nav-group-label">${esc(item.group)}</div>`; continue; }
    if (item.perm && !state.can(item.perm)) continue;
    out += `<button class="nav-link" data-page="${item.key}">
      <span class="ico" aria-hidden="true">${item.icon}</span><span>${esc(item.label)}</span>
    </button>`;
  }
  return out;
}

function renderShell() {
  const root = document.getElementById('app');
  root.innerHTML = `
    <div class="app-shell">
      <aside class="sidebar" id="sidebar" aria-label="Asosiy menyu">
        <div class="brand">
          <div class="brand-mark">FS</div>
          <div class="brand-text"><strong>FaceSys</strong><small>Enterprise</small></div>
        </div>
        <nav class="nav-scroll" id="nav">${menuHtml()}</nav>
        <div class="sidebar-foot"><span class="dot">●</span> Lokal tarmoq · v1.0</div>
      </aside>
      <div class="backdrop" id="backdrop"></div>
      <div class="main-wrap">
        <header class="topbar">
          <button class="icon-btn hamburger" id="hamburger" aria-label="Menyuni ochish">☰</button>
          <div>
            <h1 id="page-title">Bosh sahifa</h1>
            <div class="crumb" id="page-crumb">FaceSys Enterprise</div>
          </div>
          <div class="topbar-spacer"></div>
          <button class="icon-btn" id="refresh-btn" title="Yangilash" aria-label="Sahifani yangilash">⟳</button>
          <button class="icon-btn" id="profile-btn" title="Profil / parol" aria-label="Profil va parolni o'zgartirish">👤</button>
          <div class="user-chip" title="${esc(state.me.full_name)}">
            <div class="avatar">${esc(initials(state.me.full_name))}</div>
            <div class="meta">
              <strong>${esc(state.me.full_name)}</strong>
              <small>${esc((state.me.roles || []).join(', ') || 'foydalanuvchi')}</small>
            </div>
          </div>
          <button class="icon-btn" id="logout-btn" title="Chiqish" aria-label="Tizimdan chiqish">⏻</button>
        </header>
        <main class="content" id="page-root" tabindex="-1"></main>
      </div>
    </div>`;

  document.getElementById('nav').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-page]');
    if (!btn) return;
    location.hash = `#/${btn.dataset.page}`;
    closeSidebar();
  });
  document.getElementById('hamburger').onclick = () => {
    document.getElementById('sidebar').classList.add('open');
    document.getElementById('backdrop').classList.add('show');
  };
  document.getElementById('backdrop').onclick = closeSidebar;
  document.getElementById('logout-btn').onclick = async () => {
    try { await api.post('/auth/logout'); } catch { /* ignore */ }
    auth.clear();
    location.href = 'login.html';
  };
  document.getElementById('refresh-btn').onclick = () => route(true);
  document.getElementById('profile-btn').onclick = openProfile;
}

function openProfile() {
  modal({
    title: 'Profil va parol',
    body: `
      <dl class="kv">
        <dt>Foydalanuvchi</dt><dd>${esc(state.me.username)}</dd>
        <dt>F.I.Sh.</dt><dd>${esc(state.me.full_name)}</dd>
        <dt>Rollar</dt><dd>${esc((state.me.roles || []).join(', ') || '—')}</dd>
      </dl>
      <hr style="border:0;border-top:1px solid var(--line);margin:14px 0" />
      <form id="pwd-form" autocomplete="off">
        <label>Joriy parol
          <input type="password" name="current_password" required
                 autocomplete="current-password" />
        </label>
        <label>Yangi parol (kamida 8 belgi)
          <input type="password" name="new_password" required minlength="8"
                 autocomplete="new-password" />
        </label>
        <label>Yangi parolni takrorlang
          <input type="password" name="confirm_password" required minlength="8"
                 autocomplete="new-password" />
        </label>
        <div class="alert danger" id="pwd-error" style="display:none" role="alert"></div>
      </form>`,
    footer: `<button class="btn btn-secondary" data-act="cancel">Bekor qilish</button>
             <button class="btn btn-primary" data-act="save">Parolni yangilash</button>`,
    onMount(el, close) {
      const form = el.querySelector('#pwd-form');
      const errBox = el.querySelector('#pwd-error');
      const showError = (msg) => { errBox.textContent = msg; errBox.style.display = ''; };
      el.querySelector('[data-act=cancel]').onclick = close;
      el.querySelector('[data-act=save]').onclick = async () => {
        errBox.style.display = 'none';
        if (!form.reportValidity()) return;
        const data = Object.fromEntries(new FormData(form).entries());
        if (data.new_password !== data.confirm_password) {
          showError('Yangi parollar bir xil emas');
          return;
        }
        const btn = el.querySelector('[data-act=save]');
        btn.disabled = true;
        try {
          await api.post('/auth/change-password', {
            current_password: data.current_password,
            new_password: data.new_password,
          });
          toast('Parol yangilandi');
          close();
        } catch (e) {
          showError(e.message || "Parolni yangilab bo'lmadi");
        } finally {
          btn.disabled = false;
        }
      };
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        el.querySelector('[data-act=save]').click();
      });
    },
  });
}

function closeSidebar() {
  document.getElementById('sidebar')?.classList.remove('open');
  document.getElementById('backdrop')?.classList.remove('show');
}

function setActive(page) {
  document.querySelectorAll('.nav-link').forEach((el) => {
    el.classList.toggle('active', el.dataset.page === page);
    if (el.dataset.page === page) el.setAttribute('aria-current', 'page');
    else el.removeAttribute('aria-current');
  });
  const item = NAV.find((n) => n.key === page);
  document.getElementById('page-title').textContent = item ? item.label : 'FaceSys';
  document.getElementById('page-crumb').textContent =
    `FaceSys Enterprise / ${item ? item.label : ''}`;
  document.title = `${item ? item.label : 'FaceSys'} — FaceSys Enterprise`;
}

async function route(force = false) {
  const hash = (location.hash || '#/dashboard').replace(/^#\/?/, '');
  const [page, ...rest] = hash.split('/');
  const target = PAGES[page] ? page : 'dashboard';

  if (!state.can(NAV.find((n) => n.key === target)?.perm || 'report:dashboard')) {
    document.getElementById('page-root').innerHTML =
      `<div class="card card-pad"><div class="alert danger">Bu bo'limga ruxsatingiz yo'q.</div></div>`;
    setActive(target);
    return;
  }

  if (!force && current && current.page === target && location.hash === current.hash) return;
  current = { page: target, hash: location.hash };
  setActive(target);
  closeSidebar();

  const root = document.getElementById('page-root');
  root.innerHTML = `<div class="loading"><div class="spinner"></div><span>Yuklanmoqda…</span></div>`;
  try {
    const mod = await PAGES[target]();
    await mod.render(root, { params: rest, state });
    root.focus({ preventScroll: true });
  } catch (err) {
    console.error(err);
    root.innerHTML = `<div class="card card-pad">
      <div class="alert danger">Sahifani yuklashda xatolik: ${esc(err.message || err)}</div>
      <button class="btn btn-secondary" data-reload>Qayta yuklash</button>
    </div>`;
    root.querySelector('[data-reload]').addEventListener('click', () => location.reload());
  }
}

export async function boot() {
  if (!auth.isLoggedIn) {
    location.href = 'login.html';
    return;
  }
  try {
    state.me = await api.get('/auth/me');
  } catch (err) {
    if (err.status === 401) { auth.clear(); location.href = 'login.html'; return; }
    document.getElementById('app').innerHTML =
      `<div class="card card-pad" style="margin:40px auto;max-width:520px">
        <div class="alert danger">${esc(err.message)}</div>
        <button class="btn btn-primary" data-reload>Qayta urinish</button>
      </div>`;
    document.querySelector('[data-reload]').addEventListener('click', () => location.reload());
    return;
  }
  renderShell();
  window.addEventListener('hashchange', () => route());
  route();
  // Session heartbeat: verify token every 5 minutes
  setInterval(async () => {
    try { await api.get('/auth/me'); }
    catch (e) { if (e.status === 401) { auth.clear(); location.href = 'login.html'; } }
  }, 5 * 60 * 1000);
}

boot().catch((e) => {
  console.error(e);
  toast('Ilovani ishga tushirishda xatolik', 'error');
});
