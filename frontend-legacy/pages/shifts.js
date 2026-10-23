import { api } from '../assets/js/api.js';
import {
  esc, loadingBlock, errorBlock, debounce, modal, toast, confirmDialog,
  renderPagination, formData, todayIso,
} from '../assets/js/ui.js';

const state = { page: 1, page_size: 20, search: '', items: [], tab: 'shifts' };

const DAYS = [
  ['monday', 'Dush'], ['tuesday', 'Sesh'], ['wednesday', 'Chor'],
  ['thursday', 'Pay'], ['friday', 'Jum'], ['saturday', 'Shan'], ['sunday', 'Yak'],
];

export async function render(root, ctx) {
  const perms = ctx.state;
  root.innerHTML = `
    <div class="content-max">
      <div class="card">
        <div class="tabs">
          <button class="tab active" data-tab="shifts">Smenalar</button>
          <button class="tab" data-tab="assign">Biriktirishlar</button>
        </div>
        <div class="toolbar">
          <div class="grow search-box"><input id="q" placeholder="Smena nomi yoki kodi…" /></div>
          <div class="topbar-spacer"></div>
          <span id="head-actions"></span>
        </div>
        <div id="table-area">${loadingBlock()}</div>
        <div class="pagination" id="pager"></div>
      </div>
    </div>`;

  const tableArea = root.querySelector('#table-area');
  const pager = root.querySelector('#pager');
  const headActions = root.querySelector('#head-actions');

  function setActions() {
    if (state.tab === 'shifts') {
      headActions.innerHTML = perms.can('shift:create')
        ? `<button class="btn btn-primary" id="add">+ Yangi smena</button>` : '';
      headActions.querySelector('#add')?.addEventListener('click', () => openShiftForm(null));
    } else {
      headActions.innerHTML = perms.can('shift:assign')
        ? `<button class="btn btn-primary" id="assign">+ Smena biriktirish</button>` : '';
      headActions.querySelector('#assign')?.addEventListener('click', openAssign);
    }
  }

  async function load() {
    tableArea.innerHTML = loadingBlock();
    try {
      if (state.tab === 'shifts') {
        const data = await api.get('/shifts', {
          page: state.page, page_size: state.page_size, search: state.search || undefined,
        });
        state.items = data.items;
        tableArea.innerHTML = data.items.length ? `<div class="table-wrap"><table class="data">
          <thead><tr><th>Kod</th><th>Nomi</th><th>Boshlanish</th><th>Tugash</th>
            <th>Tun</th><th>Tanaffus</th><th>Kechikish</th><th>Holat</th><th></th></tr></thead>
          <tbody>${data.items.map((s) => `<tr>
            <td class="mono">${esc(s.code)}</td>
            <td><strong>${esc(s.name)}</strong></td>
            <td>${esc((s.start_time || '').slice(0, 5))}</td>
            <td>${esc((s.end_time || '').slice(0, 5))}</td>
            <td>${s.crosses_midnight ? '<span class="pill incomplete">Tungi</span>' : '—'}</td>
            <td>${s.break_duration ? `${s.break_duration} daq` : '—'}</td>
            <td>${s.late_threshold} daq</td>
            <td>${s.is_active ? '<span class="pill present">Faol</span>' : '<span class="pill unknown">Nofaol</span>'}</td>
            <td><div class="cell-actions">
              ${perms.can('shift:update') ? `<button class="btn btn-secondary btn-sm" data-edit="${s.id}">Tahrir</button>` : ''}
              ${perms.can('shift:delete') ? `<button class="btn btn-ghost btn-sm text-danger" data-del="${s.id}">O'chirish</button>` : ''}
            </div></td>
          </tr>`).join('')}</tbody></table></div>` : `<div class="empty">
            <div class="glyph">◌</div><h3>Smenalar yo'q</h3><p>Birinchi smenani yarating.</p></div>`;
        tableArea.querySelectorAll('[data-edit]').forEach((b) => {
          b.onclick = () => openShiftForm(state.items.find((x) => x.id === +b.dataset.edit));
        });
        tableArea.querySelectorAll('[data-del]').forEach((b) => {
          b.onclick = async () => {
            const s = state.items.find((x) => x.id === +b.dataset.del);
            if (!(await confirmDialog(`"${s.name}" smenasi o'chirilsinmi?`))) return;
            try { await api.del(`/shifts/${s.id}`); toast("O'chirildi", 'success'); load(); }
            catch (err) { toast(err.message, 'error', 6000); }
          };
        });
        renderPagination(pager, data, (p) => { state.page = p; load(); });
      } else {
        const data = await api.get('/shift-assignments', { page: state.page, page_size: state.page_size });
        tableArea.innerHTML = data.items.length ? `<div class="table-wrap"><table class="data">
          <thead><tr><th>Xodim</th><th>Smena</th><th>Boshlanish</th><th>Tugash</th><th>Faol</th></tr></thead>
          <tbody>${data.items.map((a) => `<tr>
            <td>${esc(a.employee_name || `#${a.employee_id}`)}</td>
            <td>${esc(a.shift_name || `#${a.shift_id}`)}</td>
            <td>${esc(a.start_date)}</td>
            <td>${esc(a.end_date || '—')}</td>
            <td>${a.is_active ? '<span class="pill present">Ha</span>' : '<span class="pill unknown">Yo\'q</span>'}</td>
          </tr>`).join('')}</tbody></table></div>` : `<div class="empty">
            <div class="glyph">◌</div><h3>Biriktirishlar yo'q</h3><p>Xodimga smena biriktiring.</p></div>`;
        renderPagination(pager, data, (p) => { state.page = p; load(); });
      }
    } catch (err) { tableArea.innerHTML = errorBlock(err.message); }
  }

  function openShiftForm(shift) {
    const isEdit = !!shift;
    modal({
      title: isEdit ? 'Smenani tahrirlash' : 'Yangi smena',
      wide: true,
      body: `<form id="s-form"><div class="form-grid">
        <div class="field"><label>Nomi *</label><input name="name" required value="${esc(shift?.name || '')}" /></div>
        <div class="field"><label>Kod *</label><input name="code" required value="${esc(shift?.code || '')}" /></div>
        <div class="field"><label>Boshlanish *</label><input type="time" name="start_time" required value="${esc((shift?.start_time || '08:00').slice(0,5))}" /></div>
        <div class="field"><label>Tugash *</label><input type="time" name="end_time" required value="${esc((shift?.end_time || '17:00').slice(0,5))}" /></div>
        <div class="field"><label>Tanaffus boshi</label><input type="time" name="break_start" value="${esc((shift?.break_start || '').slice(0,5))}" /></div>
        <div class="field"><label>Tanaffus tugashi</label><input type="time" name="break_end" value="${esc((shift?.break_end || '').slice(0,5))}" /></div>
        <div class="field"><label>Kechikish tolerantligi (daq)</label><input type="number" name="late_threshold" value="${shift?.late_threshold ?? 15}" /></div>
        <div class="field"><label>Erta ketish tolerantligi (daq)</label><input type="number" name="early_leave_threshold" value="${shift?.early_leave_threshold ?? 15}" /></div>
        <div class="field"><label>Minimal ish vaqti (daq)</label><input type="number" name="min_work_minutes" value="${shift?.min_work_minutes ?? 480}" /></div>
        <div class="field"><label>Tanaffus (daq)</label><input type="number" name="break_duration" value="${shift?.break_duration ?? 0}" /></div>
        <div class="field span-2"><label>Qo'llaniladigan kunlar</label>
          <div class="flex wrap gap-2">
            ${DAYS.map(([v, l]) => `<label style="font-weight:500"><input type="checkbox" name="days" value="${v}" style="width:auto"
              ${(shift?.applicable_days || []).includes(v) ? 'checked' : ''}/> ${l}</label>`).join('')}
          </div><div class="hint">Bo'sh qoldirilsa — har kuni.</div></div>
        <div class="field"><label><input type="checkbox" name="overtime_enabled" style="width:auto" ${shift?.overtime_enabled ? 'checked' : ''}/> Qo'shimcha ish vaqti hisoblansin</label></div>
        <div class="field"><label><input type="checkbox" name="is_active" style="width:auto" ${shift?.is_active !== false ? 'checked' : ''}/> Faol</label></div>
      </div><div id="s-err"></div></form>`,
      footer: `<button class="btn btn-secondary" data-cancel>Bekor</button>
               <button class="btn btn-primary" data-save>Saqlash</button>`,
      onMount(el, close) {
        el.querySelector('[data-cancel]').onclick = close;
        el.querySelector('[data-save]').onclick = async () => {
          const f = el.querySelector('#s-form');
          if (!f.reportValidity()) return;
          const data = formData(f);
          data.late_threshold = +(data.late_threshold || 0);
          data.early_leave_threshold = +(data.early_leave_threshold || 0);
          data.min_work_minutes = +(data.min_work_minutes || 480);
          data.break_duration = +(data.break_duration || 0);
          data.is_active = f.is_active.checked;
          data.overtime_enabled = f.overtime_enabled.checked;
          data.applicable_days = [...f.querySelectorAll('input[name=days]:checked')].map((x) => x.value);
          ['break_start', 'break_end'].forEach((k) => { if (!data[k]) delete data[k]; });
          try {
            if (isEdit) await api.patch(`/shifts/${shift.id}`, data);
            else await api.post('/shifts', data);
            toast('Saqlandi', 'success'); close(); load();
          } catch (err) {
            el.querySelector('#s-err').innerHTML = `<div class="alert danger">${esc(err.message)}</div>`;
          }
        };
      },
    });
  }

  async function openAssign() {
    let employees = []; let shifts = [];
    try {
      [employees, shifts] = await Promise.all([
        api.get('/employees', { page: 1, page_size: 100 }).then((r) => r.items),
        api.get('/shifts', { page: 1, page_size: 100 }).then((r) => r.items),
      ]);
    } catch (err) { toast(err.message, 'error'); return; }
    modal({
      title: 'Smena biriktirish',
      body: `<form id="a-form">
        <div class="field"><label>Xodim *</label><select name="employee_id" required>
          <option value="">— tanlang —</option>
          ${employees.map((e) => `<option value="${e.id}">${esc(e.full_name || e.internal_id)}</option>`).join('')}
        </select></div>
        <div class="field"><label>Smena *</label><select name="shift_id" required>
          <option value="">— tanlang —</option>
          ${shifts.map((s) => `<option value="${s.id}">${esc(s.name)} (${esc(s.code)})</option>`).join('')}
        </select></div>
        <div class="form-grid">
          <div class="field"><label>Boshlanish *</label><input type="date" name="start_date" required value="${todayIso()}" /></div>
          <div class="field"><label>Tugash</label><input type="date" name="end_date" /></div>
        </div>
        <div id="a-err"></div></form>`,
      footer: `<button class="btn btn-secondary" data-cancel>Bekor</button>
               <button class="btn btn-primary" data-save>Biriktirish</button>`,
      onMount(el, close) {
        el.querySelector('[data-cancel]').onclick = close;
        el.querySelector('[data-save]').onclick = async () => {
          const f = el.querySelector('#a-form');
          if (!f.reportValidity()) return;
          const data = formData(f);
          data.employee_id = +data.employee_id; data.shift_id = +data.shift_id;
          if (!data.end_date) delete data.end_date;
          try {
            await api.post('/shift-assignments', data);
            toast('Biriktirildi', 'success'); close(); state.tab = 'assign'; syncTabs(); load();
          } catch (err) {
            el.querySelector('#a-err').innerHTML = `<div class="alert danger">${esc(err.message)}</div>`;
          }
        };
      },
    });
  }

  function syncTabs() {
    root.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === state.tab));
    setActions();
  }

  root.querySelectorAll('.tab').forEach((t) => {
    t.onclick = () => { state.tab = t.dataset.tab; state.page = 1; syncTabs(); load(); };
  });
  root.querySelector('#q').addEventListener('input', debounce((e) => {
    state.search = e.target.value.trim(); state.page = 1; load();
  }));
  syncTabs();
  load();
}