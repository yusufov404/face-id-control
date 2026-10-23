import { api } from '../assets/js/api.js';
import {
  esc, fmtDate, loadingBlock, errorBlock, statusPill, modal, toast,
  confirmDialog, renderPagination, formData, todayIso,
} from '../assets/js/ui.js';

const state = { tab: 'leaves', page: 1, page_size: 20, items: [], employees: [] };

export async function render(root, ctx) {
  const perms = ctx.state;
  root.innerHTML = `
    <div class="content-max">
      <div class="card">
        <div class="tabs">
          <button class="tab active" data-tab="leaves">Ta'til so'rovlari</button>
          <button class="tab" data-tab="holidays">Bayram / dam olish kunlari</button>
        </div>
        <div class="toolbar">
          <span id="head-actions"></span>
          <div class="topbar-spacer"></div>
        </div>
        <div id="table-area">${loadingBlock()}</div>
        <div class="pagination" id="pager"></div>
      </div>
    </div>`;
  const tableArea = root.querySelector('#table-area');
  const pager = root.querySelector('#pager');
  const headActions = root.querySelector('#head-actions');

  try { state.employees = (await api.get('/employees', { page: 1, page_size: 100 })).items; }
  catch { state.employees = []; }

  function setActions() {
    if (state.tab === 'leaves') {
      headActions.innerHTML = perms.can('leave:create')
        ? `<button class="btn btn-primary" id="add">+ Ta'til so'rovi</button>` : '';
      headActions.querySelector('#add')?.addEventListener('click', openLeaveForm);
    } else {
      headActions.innerHTML = perms.can('holiday:create')
        ? `<button class="btn btn-primary" id="add">+ Bayram qo'shish</button>` : '';
      headActions.querySelector('#add')?.addEventListener('click', openHolidayForm);
    }
  }

  async function load() {
    tableArea.innerHTML = loadingBlock();
    try {
      if (state.tab === 'leaves') {
        const data = await api.get('/leaves', { page: state.page, page_size: state.page_size });
        tableArea.innerHTML = data.items.length ? `<div class="table-wrap"><table class="data">
          <thead><tr><th>Xodim</th><th>Turi</th><th>Boshlanish</th><th>Tugash</th><th>Kun</th><th>Holat</th><th>Sabab</th><th></th></tr></thead>
          <tbody>${data.items.map((l) => `<tr>
            <td>${esc(l.employee_name || `#${l.employee_id}`)}</td>
            <td>${esc(l.leave_type)}</td>
            <td>${fmtDate(l.start_date)}</td>
            <td>${fmtDate(l.end_date)}</td>
            <td>${l.total_days}</td>
            <td>${statusPill(l.status)}</td>
            <td class="wrap">${esc(l.reason || '')}</td>
            <td>${(l.status === 'pending' && perms.can('leave:approve')) ? `
              <div class="cell-actions">
                <button class="btn btn-primary btn-sm" data-approve="${l.id}">Tasdiq</button>
                <button class="btn btn-ghost btn-sm text-danger" data-reject="${l.id}">Rad</button>
              </div>` : ''}</td>
          </tr>`).join('')}</tbody></table></div>` : `<div class="empty">
            <div class="glyph">◌</div><h3>Ta'til so'rovlari yo'q</h3><p>Yangi so'rov yarating.</p></div>`;

        tableArea.querySelectorAll('[data-approve]').forEach((b) => {
          b.onclick = () => decide(+b.dataset.approve, true);
        });
        tableArea.querySelectorAll('[data-reject]').forEach((b) => {
          b.onclick = () => decide(+b.dataset.reject, false);
        });
        renderPagination(pager, data, (p) => { state.page = p; load(); });
      } else {
        const data = await api.get('/holidays', { page: state.page, page_size: state.page_size });
        tableArea.innerHTML = data.items.length ? `<div class="table-wrap"><table class="data">
          <thead><tr><th>Sana</th><th>Nomi</th><th>Ish kuni</th><th>Barcha bo'limlar</th><th></th></tr></thead>
          <tbody>${data.items.map((h) => `<tr>
            <td>${fmtDate(h.date)}</td>
            <td><strong>${esc(h.name)}</strong></td>
            <td>${h.is_working_day ? "Ha (qo'shimcha ish)" : "Yo'q"}</td>
            <td>${h.applies_to_all ? 'Ha' : "Yo'q"}</td>
            <td>${perms.can('holiday:delete') ? `<button class="btn btn-ghost btn-sm text-danger" data-del="${h.id}">O'chirish</button>` : ''}</td>
          </tr>`).join('')}</tbody></table></div>` : `<div class="empty">
            <div class="glyph">◌</div><h3>Bayramlar kiritilmagan</h3><p>Dam olish kunlarini qo'shing.</p></div>`;
        tableArea.querySelectorAll('[data-del]').forEach((b) => {
          b.onclick = async () => {
            if (!(await confirmDialog("Bayram o'chirilsinmi?"))) return;
            try { await api.del(`/holidays/${b.dataset.del}`); toast("O'chirildi", 'success'); load(); }
            catch (err) { toast(err.message, 'error'); }
          };
        });
        renderPagination(pager, data, (p) => { state.page = p; load(); });
      }
    } catch (err) { tableArea.innerHTML = errorBlock(err.message); }
  }

  async function decide(id, approve) {
    const body = { approve };
    if (!approve) {
      const reason = prompt('Rad etish sababi:');
      if (reason === null) return;
      body.rejection_reason = reason;
    }
    try {
      await api.post(`/leaves/${id}/decision`, body);
      toast(approve ? 'Tasdiqlandi' : 'Rad etildi', 'success');
      load();
    } catch (err) { toast(err.message, 'error'); }
  }

  function openLeaveForm() {
    modal({
      title: "Yangi ta'til so'rovi",
      body: `<form id="l-form">
        <div class="field"><label>Xodim *</label><select name="employee_id" required>
          <option value="">— tanlang —</option>
          ${state.employees.map((e) => `<option value="${e.id}">${esc(e.full_name)}</option>`).join('')}
        </select></div>
        <div class="field"><label>Turi *</label>
          <select name="leave_type" required>
            <option value="annual">Yillik ta'til</option><option value="sick">Kasallik</option>
            <option value="unpaid">To'lovsiz</option><option value="study">O'qish</option>
            <option value="maternity">Homiladorlik</option><option value="other">Boshqa</option>
          </select></div>
        <div class="form-grid">
          <div class="field"><label>Boshlanish *</label><input type="date" name="start_date" required value="${todayIso()}" /></div>
          <div class="field"><label>Tugash *</label><input type="date" name="end_date" required value="${todayIso()}" /></div>
        </div>
        <div class="field"><label>Sabab *</label><textarea name="reason" required></textarea></div>
        <div id="l-err"></div></form>`,
      footer: `<button class="btn btn-secondary" data-cancel>Bekor</button>
               <button class="btn btn-primary" data-save>Yuborish</button>`,
      onMount(el, close) {
        el.querySelector('[data-cancel]').onclick = close;
        el.querySelector('[data-save]').onclick = async () => {
          const f = el.querySelector('#l-form');
          if (!f.reportValidity()) return;
          const data = formData(f);
          data.employee_id = +data.employee_id;
          try { await api.post('/leaves', data); toast('So\'rov yaratildi', 'success'); close(); load(); }
          catch (err) { el.querySelector('#l-err').innerHTML = `<div class="alert danger">${esc(err.message)}</div>`; }
        };
      },
    });
  }

  function openHolidayForm() {
    modal({
      title: "Bayram / dam olish kuni",
      body: `<form id="h-form">
        <div class="field"><label>Nomi *</label><input name="name" required placeholder="Mustaqillik kuni" /></div>
        <div class="field"><label>Sana *</label><input type="date" name="date" required value="${todayIso()}" /></div>
        <div class="field"><label>Tavsif</label><textarea name="description"></textarea></div>
        <div class="field"><label><input type="checkbox" name="is_working_day" style="width:auto"/> Bu kun ish kuni (bayramga ko'chirilgan)</label></div>
        <div id="h-err"></div></form>`,
      footer: `<button class="btn btn-secondary" data-cancel>Bekor</button>
               <button class="btn btn-primary" data-save>Saqlash</button>`,
      onMount(el, close) {
        el.querySelector('[data-cancel]').onclick = close;
        el.querySelector('[data-save]').onclick = async () => {
          const f = el.querySelector('#h-form');
          if (!f.reportValidity()) return;
          const data = formData(f);
          data.is_working_day = f.is_working_day.checked;
          data.applies_to_all = true;
          if (data.description === null) delete data.description;
          try { await api.post('/holidays', data); toast('Saqlandi', 'success'); close(); load(); }
          catch (err) { el.querySelector('#h-err').innerHTML = `<div class="alert danger">${esc(err.message)}</div>`; }
        };
      },
    });
  }

  root.querySelectorAll('.tab').forEach((t) => {
    t.onclick = () => {
      state.tab = t.dataset.tab; state.page = 1;
      root.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x === t));
      setActions(); load();
    };
  });
  setActions();
  load();
}