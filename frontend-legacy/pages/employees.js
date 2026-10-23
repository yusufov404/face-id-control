import { api } from '../assets/js/api.js';
import {
  esc, fmtDate, loadingBlock, errorBlock, statusPill,
  debounce, modal, toast, confirmDialog, renderPagination, formData, todayIso,
} from '../assets/js/ui.js';

const STATUSES = [
  ['active', 'Faol'], ['probation', 'Sinov muddati'], ['on_leave', "Ta'tilda"],
  ['suspended', "To'xtatilgan"], ['terminated', "Ishdan bo'shagan"],
];

const state = {
  page: 1, page_size: 20, search: '', department_id: '', status: '',
  departments: [], positions: [], total: 0, items: [],
};

export async function render(root, ctx) {
  const perms = ctx.state;
  root.innerHTML = loadingBlock('Xodimlar yuklanmoqda…');
  try {
    [state.departments, state.positions] = await Promise.all([
      api.get('/departments/options'),
      api.get('/positions', { page: 1, page_size: 100 }),
    ]).then(([d, p]) => [d, p.items]);
  } catch (err) {
    root.innerHTML = errorBlock(err.message);
    return;
  }

  root.innerHTML = `
    <div class="content-max">
      <div class="card">
        <div class="toolbar">
          <div class="grow search-box">
            <input id="q" placeholder="Ism, ichki ID, telefon bo'yicha qidirish…" aria-label="Qidirish" />
          </div>
          <select id="f-dept" aria-label="Bo'lim" style="max-width:210px">
            <option value="">Barcha bo'limlar</option>
            ${state.departments.map((d) => `<option value="${d.id}">${esc(d.name)}</option>`).join('')}
          </select>
          <select id="f-status" aria-label="Holat" style="max-width:170px">
            <option value="">Barcha holatlar</option>
            ${STATUSES.map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join('')}
          </select>
          <button class="btn btn-secondary" id="reset">Tozalash</button>
          <div class="topbar-spacer"></div>
          ${perms.can('employee:create') ? `<button class="btn btn-primary" id="add">+ Yangi xodim</button>` : ''}
        </div>
        <div id="table-area">${loadingBlock()}</div>
        <div class="pagination" id="pager"></div>
      </div>
    </div>`;

  const tableArea = root.querySelector('#table-area');
  const pager = root.querySelector('#pager');

  async function load() {
    tableArea.innerHTML = loadingBlock();
    try {
      const data = await api.get('/employees', {
        page: state.page, page_size: state.page_size,
        search: state.search || undefined,
        department_id: state.department_id || undefined,
        status: state.status || undefined,
      });
      state.items = data.items;
      state.total = data.total;
      renderTable();
      renderPagination(pager, data, (p) => { state.page = p; load(); });
    } catch (err) {
      tableArea.innerHTML = errorBlock(err.message);
    }
  }

  function renderTable() {
    if (!state.items.length) {
      tableArea.innerHTML = `<div class="empty"><div class="glyph">◌</div>
        <h3>Xodimlar topilmadi</h3><p>Qidiruv yoki filtrlarni o'zgartirib ko'ring.</p></div>`;
      return;
    }
    tableArea.innerHTML = `
      <div class="table-wrap">
        <table class="data">
          <thead><tr>
            <th>Ichki ID</th><th>F.I.Sh.</th><th>Bo'lim</th><th>Lavozim</th>
            <th>Qurilma ID</th><th>Telefon</th><th>Ishga kirgan</th><th>Holat</th><th></th>
          </tr></thead>
          <tbody>
            ${state.items.map((e) => `<tr>
              <td class="mono">${esc(e.internal_id)}</td>
              <td><strong>${esc(e.full_name || `${e.last_name} ${e.first_name}`)}</strong></td>
              <td>${esc(e.department_name || '—')}</td>
              <td>${esc(e.position_name || '—')}</td>
              <td class="mono">${esc(e.device_user_id || '—')}</td>
              <td>${esc(e.phone || '—')}</td>
              <td>${fmtDate(e.hire_date)}</td>
              <td>${statusPill(e.status)}</td>
              <td><div class="cell-actions">
                ${perms.can('employee:update') ? `<button class="btn btn-secondary btn-sm" data-edit="${e.id}">Tahrir</button>` : ''}
                ${perms.can('employee:change_status') ? `<button class="btn btn-ghost btn-sm" data-status="${e.id}">Holat</button>` : ''}
                ${perms.can('employee:delete') ? `<button class="btn btn-ghost btn-sm text-danger" data-del="${e.id}">O'chirish</button>` : ''}
              </div></td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>`;

    tableArea.querySelectorAll('[data-edit]').forEach((b) => {
      b.onclick = () => openForm(state.items.find((x) => x.id === +b.dataset.edit));
    });
    tableArea.querySelectorAll('[data-status]').forEach((b) => {
      b.onclick = () => openStatus(state.items.find((x) => x.id === +b.dataset.status));
    });
    tableArea.querySelectorAll('[data-del]').forEach((b) => {
      b.onclick = async () => {
        const emp = state.items.find((x) => x.id === +b.dataset.del);
        const ok = await confirmDialog(
          `${emp.full_name} o'chirilsinmi? Tarixiy davomat yozuvlari saqlanadi (soft delete).`,
        );
        if (!ok) return;
        try {
          await api.del(`/employees/${emp.id}`);
          toast("Xodim o'chirildi", 'success');
          load();
        } catch (err) { toast(err.message, 'error'); }
      };
    });
  }

  function openForm(emp) {
    const isEdit = !!emp;
    const m = modal({
      title: isEdit ? 'Xodimni tahrirlash' : "Yangi xodim qo'shish",
      wide: true,
      body: `<form id="emp-form" novalidate>
        <div class="form-grid">
          <div class="field"><label>Ichki ID *</label>
            <input name="internal_id" required ${isEdit ? 'disabled' : ''} value="${esc(emp?.internal_id || '')}" placeholder="EMP-0001" /></div>
          <div class="field"><label>Qurilma ID (Hikvision)</label>
            <input name="device_user_id" value="${esc(emp?.device_user_id || '')}" placeholder="ixtiyoriy" /></div>
          <div class="field"><label>Familiya *</label><input name="last_name" required value="${esc(emp?.last_name || '')}" /></div>
          <div class="field"><label>Ism *</label><input name="first_name" required value="${esc(emp?.first_name || '')}" /></div>
          <div class="field"><label>Otasining ismi</label><input name="middle_name" value="${esc(emp?.middle_name || '')}" /></div>
          <div class="field"><label>Jinsi</label>
            <select name="gender"><option value="">—</option>
              <option value="male" ${emp?.gender === 'male' ? 'selected' : ''}>Erkak</option>
              <option value="female" ${emp?.gender === 'female' ? 'selected' : ''}>Ayol</option>
            </select></div>
          <div class="field"><label>Tug'ilgan sana</label><input type="date" name="birth_date" value="${esc(emp?.birth_date || '')}" /></div>
          <div class="field"><label>Telefon</label><input name="phone" value="${esc(emp?.phone || '')}" placeholder="+998..." /></div>
          <div class="field"><label>Email</label><input type="email" name="email" value="${esc(emp?.email || '')}" /></div>
          <div class="field"><label>Bo'lim</label>
            <select name="department_id"><option value="">—</option>
              ${state.departments.map((d) => `<option value="${d.id}" ${emp?.department_id === d.id ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}
            </select></div>
          <div class="field"><label>Lavozim</label>
            <select name="position_id"><option value="">—</option>
              ${state.positions.map((p) => `<option value="${p.id}" ${emp?.position_id === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}
            </select></div>
          <div class="field"><label>Ishga kirgan sana *</label>
            <input type="date" name="hire_date" required value="${esc(emp?.hire_date || todayIso())}" /></div>
          ${isEdit ? `<div class="field"><label>Holat</label>
            <select name="status">${STATUSES.map(([v, l]) => `<option value="${v}" ${emp?.status === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></div>` : ''}
          <div class="field span-2"><label>Izoh</label><textarea name="notes" placeholder="Qo'shimcha ma'lumot">${esc(emp?.notes || '')}</textarea></div>
        </div>
        <div id="form-err"></div>
      </form>`,
      footer: `<button class="btn btn-secondary" data-cancel>Bekor qilish</button>
               <button class="btn btn-primary" data-save>${isEdit ? 'Saqlash' : 'Yaratish'}</button>`,
      onMount(el, close) {
        el.querySelector('[data-cancel]').onclick = close;
        el.querySelector('[data-save]').onclick = async () => {
          const f = el.querySelector('#emp-form');
          if (!f.reportValidity()) return;
          const data = formData(f);
          const btn = el.querySelector('[data-save]');
          btn.disabled = true; btn.textContent = 'Saqlanmoqda…';
          try {
            if (isEdit) {
              delete data.internal_id;
              // convert empty strings to null
              Object.keys(data).forEach((k) => { if (data[k] === '') data[k] = null; });
              if (data.department_id) data.department_id = +data.department_id;
              if (data.position_id) data.position_id = +data.position_id;
              await api.patch(`/employees/${emp.id}`, data);
              toast('Xodim yangilandi', 'success');
            } else {
              ['department_id', 'position_id'].forEach((k) => { if (data[k]) data[k] = +data[k]; });
              ['gender', 'birth_date', 'phone', 'email', 'middle_name', 'notes', 'device_user_id'].forEach((k) => {
                if (data[k] === '' || data[k] === null) delete data[k];
              });
              await api.post('/employees', data);
              toast("Xodim qo'shildi", 'success');
            }
            close(); load();
          } catch (err) {
            el.querySelector('#form-err').innerHTML = `<div class="alert danger">${esc(err.message)}</div>`;
            btn.disabled = false; btn.textContent = isEdit ? 'Saqlash' : 'Yaratish';
          }
        };
      },
    });
    m;
  }

  function openStatus(emp) {
    modal({
      title: `Holatni o'zgartirish — ${emp.full_name}`,
      body: `<form id="st-form">
        <div class="field"><label>Yangi holat</label>
          <select name="status">${STATUSES.map(([v, l]) => `<option value="${v}" ${emp.status === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>
        </div>
        <div class="field"><label>Ishdan bo'shash sanasi</label>
          <input type="date" name="termination_date" value="${esc(emp.termination_date || '')}" /></div>
        <div class="field"><label>Sabab</label><textarea name="reason" placeholder="Majburiy emas"></textarea></div>
        <div id="st-err"></div>
      </form>`,
      footer: `<button class="btn btn-secondary" data-cancel>Bekor qilish</button>
               <button class="btn btn-primary" data-save>Saqlash</button>`,
      onMount(el, close) {
        el.querySelector('[data-cancel]').onclick = close;
        el.querySelector('[data-save]').onclick = async () => {
          const data = formData(el.querySelector('#st-form'));
          if (data.termination_date === null) delete data.termination_date;
          if (data.reason === null) delete data.reason;
          try {
            await api.post(`/employees/${emp.id}/status`, data);
            toast('Holat yangilandi', 'success');
            close(); load();
          } catch (err) {
            el.querySelector('#st-err').innerHTML = `<div class="alert danger">${esc(err.message)}</div>`;
          }
        };
      },
    });
  }

  root.querySelector('#q').addEventListener('input', debounce((e) => {
    state.search = e.target.value.trim(); state.page = 1; load();
  }));
  root.querySelector('#f-dept').addEventListener('change', (e) => {
    state.department_id = e.target.value; state.page = 1; load();
  });
  root.querySelector('#f-status').addEventListener('change', (e) => {
    state.status = e.target.value; state.page = 1; load();
  });
  root.querySelector('#reset').onclick = () => {
    state.search = ''; state.department_id = ''; state.status = ''; state.page = 1;
    root.querySelector('#q').value = '';
    root.querySelector('#f-dept').value = '';
    root.querySelector('#f-status').value = '';
    load();
  };
  const addBtn = root.querySelector('#add');
  if (addBtn) addBtn.onclick = () => openForm(null);

  load();
}