import { api } from '../assets/js/api.js';
import {
  esc, loadingBlock, errorBlock, fmtDateTime, modal, toast, confirmDialog,
  renderPagination, formData, debounce,
} from '../assets/js/ui.js';

const state = { page: 1, page_size: 20, search: '', items: [], roles: [], departments: [] };

export async function render(root, ctx) {
  const perms = ctx.state;
  root.innerHTML = `
    <div class="content-max">
      <div class="card">
        <div class="toolbar">
          <div class="grow search-box"><input id="q" placeholder="Login, email yoki F.I.Sh.…" /></div>
          <div class="topbar-spacer"></div>
          ${perms.can('user:create') ? `<button class="btn btn-primary" id="add">+ Foydalanuvchi</button>` : ''}
        </div>
        <div id="table-area">${loadingBlock()}</div>
        <div class="pagination" id="pager"></div>
      </div>
      ${perms.can('role:read') ? `<div class="card mt-2">
        <div class="card-head"><h2>Rollar va ruxsatlar</h2>
          <div class="sub">Server tomonda majburlanadigan rol cheklovlari</div></div>
        <div id="roles-area" class="table-wrap">${loadingBlock()}</div>
      </div>` : ''}
    </div>`;
  const tableArea = root.querySelector('#table-area');
  const pager = root.querySelector('#pager');

  try {
    [state.roles, state.departments] = await Promise.all([
      api.get('/roles'),
      api.get('/departments/options').catch(() => []),
    ]);
  } catch (err) {
    state.roles = []; state.departments = [];
  }

  async function load() {
    tableArea.innerHTML = loadingBlock();
    try {
      const data = await api.get('/users', {
        page: state.page, page_size: state.page_size, search: state.search || undefined,
      });
      state.items = data.items;
      tableArea.innerHTML = data.items.length ? `<div class="table-wrap"><table class="data">
        <thead><tr><th>F.I.Sh.</th><th>Login</th><th>Email</th><th>Rollar</th>
          <th>Bo'lim</th><th>Holat</th><th>Oxirgi kirish</th><th></th></tr></thead>
        <tbody>${data.items.map((u) => `<tr>
          <td><strong>${esc(u.full_name)}</strong>${u.is_superuser ? ' <span class="pill incomplete">super</span>' : ''}</td>
          <td class="mono">${esc(u.username)}</td>
          <td>${esc(u.email)}</td>
          <td>${(u.roles || []).map((r) => `<span class="pill">${esc(r.display_name || r.name)}</span>`).join(' ') || '—'}</td>
          <td>${esc(u.department_name || '—')}</td>
          <td>${u.is_active ? '<span class="pill present">Faol</span>' : '<span class="pill absent">Bloklangan</span>'}</td>
          <td>${fmtDateTime(u.last_login)}</td>
          <td><div class="cell-actions">
            ${perms.can('user:active') ? '' : ''}
            ${perms.can('user:update') ? `<button class="btn btn-secondary btn-sm" data-edit="${u.id}">Tahrir</button>` : ''}
            ${perms.can('user:assign_role') ? `<button class="btn btn-ghost btn-sm" data-roles="${u.id}">Rollar</button>` : ''}
            ${perms.can('user:delete') ? `<button class="btn btn-ghost btn-sm text-danger" data-del="${u.id}">O'chirish</button>` : ''}
          </div></td>
        </tr>`).join('')}</tbody></table></div>` : `<div class="empty"><div class="glyph">◌</div>
          <h3>Foydalanuvchilar yo'q</h3></div>`;

      tableArea.querySelectorAll('[data-edit]').forEach((b) => {
        b.onclick = () => openForm(state.items.find((x) => x.id === +b.dataset.edit));
      });
      tableArea.querySelectorAll('[data-roles]').forEach((b) => {
        b.onclick = () => openRoles(state.items.find((x) => x.id === +b.dataset.roles));
      });
      tableArea.querySelectorAll('[data-del]').forEach((b) => {
        b.onclick = async () => {
          const u = state.items.find((x) => x.id === +b.dataset.del);
          if (!(await confirmDialog(`"${u.username}" foydalanuvchisi o'chirilsinmi?`))) return;
          try { await api.del(`/users/${u.id}`); toast("O'chirildi", 'success'); load(); }
          catch (err) { toast(err.message, 'error'); }
        };
      });
      renderPagination(pager, data, (p) => { state.page = p; load(); });
    } catch (err) { tableArea.innerHTML = errorBlock(err.message); }
  }

  if (perms.can('role:read')) {
    const rolesArea = root.querySelector('#roles-area');
    rolesArea.innerHTML = `<table class="data">
      <thead><tr><th>Rol</th><th>Tavsif</th><th>Foydalanuvchi boshqaruvi</th>
        <th>Barcha bo'limlar</th><th>Davomat tuzatish</th><th>Tizim sozlamalari</th></tr></thead>
      <tbody>${state.roles.map((r) => `<tr>
        <td><strong>${esc(r.display_name)}</strong><div class="inline-note mono">${esc(r.name)}</div></td>
        <td class="wrap">${esc(r.description || '—')}</td>
        <td>${r.can_manage_users ? '✓' : '—'}</td>
        <td>${r.can_access_all_departments ? '✓' : '—'}</td>
        <td>${r.can_modify_attendance ? '✓' : '—'}</td>
        <td>${r.can_access_system_settings ? '✓' : '—'}</td>
      </tr>`).join('')}</tbody></table>`;
  }

  function openForm(user) {
    const isEdit = !!user;
    modal({
      title: isEdit ? 'Foydalanuvchini tahrirlash' : 'Yangi foydalanuvchi',
      wide: true,
      body: `<form id="u-form"><div class="form-grid">
        <div class="field"><label>F.I.Sh. *</label><input name="full_name" required value="${esc(user?.full_name || '')}" /></div>
        <div class="field"><label>Login *</label>
          <input name="username" required ${isEdit ? 'disabled' : ''} value="${esc(user?.username || '')}" /></div>
        <div class="field"><label>Email *</label><input type="email" name="email" required value="${esc(user?.email || '')}" /></div>
        <div class="field"><label>Telefon</label><input name="phone" value="${esc(user?.phone || '')}" /></div>
        ${isEdit ? '' : `<div class="field"><label>Parol *</label>
          <input type="password" name="password" required minlength="8" autocomplete="new-password" />
          <div class="hint">Kamida 8 belgi.</div></div>`}
        <div class="field"><label>Bo'lim</label>
          <select name="department_id"><option value="">—</option>
            ${state.departments.map((d) => `<option value="${d.id}" ${user?.department_id === d.id ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}
          </select></div>
        ${isEdit ? '' : `<div class="field span-2"><label>Rollar</label>
          <div class="flex wrap gap-2">
            ${state.roles.map((r) => `<label style="font-weight:500"><input type="checkbox" name="role" value="${r.id}" style="width:auto"/> ${esc(r.display_name)}</label>`).join('')}
          </div></div>`}
        <div class="field"><label><input type="checkbox" name="is_active" style="width:auto" ${user?.is_active !== false ? 'checked' : ''}/> Faol</label></div>
      </div><div id="u-err"></div></form>`,
      footer: `<button class="btn btn-secondary" data-cancel>Bekor</button>
               <button class="btn btn-primary" data-save>Saqlash</button>`,
      onMount(el, close) {
        el.querySelector('[data-cancel]').onclick = close;
        el.querySelector('[data-save]').onclick = async () => {
          const f = el.querySelector('#u-form');
          if (!f.reportValidity()) return;
          const data = formData(f);
          data.is_active = f.is_active.checked;
          if (data.department_id) data.department_id = +data.department_id; else delete data.department_id;
          try {
            if (isEdit) {
              delete data.username; delete data.password;
              await api.patch(`/users/${user.id}`, data);
            } else {
              data.role_ids = [...f.querySelectorAll('input[name=role]:checked')].map((x) => +x.value);
              await api.post('/users', data);
            }
            toast('Saqlandi', 'success'); close(); load();
          } catch (err) {
            el.querySelector('#u-err').innerHTML = `<div class="alert danger">${esc(err.message)}</div>`;
          }
        };
      },
    });
  }

  function openRoles(user) {
    const current = new Set((user.roles || []).map((r) => r.id));
    modal({
      title: `Rollar — ${user.full_name}`,
      body: `<form id="r-form">
        <div class="flex wrap gap-2">
          ${state.roles.map((r) => `<label style="font-weight:500">
            <input type="checkbox" name="role" value="${r.id}" style="width:auto" ${current.has(r.id) ? 'checked' : ''}/>
            ${esc(r.display_name)}</label>`).join('')}
        </div>
        <div class="alert info mt-2"><span>Kadrlar bo'limi boshlig'i Super Admin rolini bera olmaydi —
          bu server tomonda bloklangan.</span></div>
        <div id="r-err"></div></form>`,
      footer: `<button class="btn btn-secondary" data-cancel>Bekor</button>
               <button class="btn btn-primary" data-save>Saqlash</button>`,
      onMount(el, close) {
        el.querySelector('[data-cancel]').onclick = close;
        el.querySelector('[data-save]').onclick = async () => {
          const ids = [...el.querySelectorAll('input[name=role]:checked')].map((x) => +x.value);
          try {
            await api.put(`/users/${user.id}/roles`, { role_ids: ids });
            toast('Rollar yangilandi', 'success'); close(); load();
          } catch (err) {
            el.querySelector('#r-err').innerHTML = `<div class="alert danger">${esc(err.message)}</div>`;
          }
        };
      },
    });
  }

  root.querySelector('#q').addEventListener('input', debounce((e) => {
    state.search = e.target.value.trim(); state.page = 1; load();
  }));
  root.querySelector('#add')?.addEventListener('click', () => openForm(null));
  load();
}