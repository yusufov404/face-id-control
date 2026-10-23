import { api } from '../assets/js/api.js';
import {
  esc, loadingBlock, errorBlock, debounce, modal, toast, confirmDialog,
  renderPagination, formData,
} from '../assets/js/ui.js';

const state = { page: 1, page_size: 20, search: '', items: [], departments: [] };

export async function render(root, ctx) {
  const perms = ctx.state;
  root.innerHTML = `
    <div class="content-max">
      <div class="card">
        <div class="toolbar">
          <div class="grow search-box"><input id="q" placeholder="Lavozim nomi yoki kodi…" /></div>
          <div class="topbar-spacer"></div>
          ${perms.can('position:create') ? `<button class="btn btn-primary" id="add">+ Yangi lavozim</button>` : ''}
        </div>
        <div id="table-area">${loadingBlock()}</div>
        <div class="pagination" id="pager"></div>
      </div>
    </div>`;
  const tableArea = root.querySelector('#table-area');
  const pager = root.querySelector('#pager');

  try { state.departments = await api.get('/departments/options'); }
  catch { state.departments = []; }

  async function load() {
    tableArea.innerHTML = loadingBlock();
    try {
      const data = await api.get('/positions', {
        page: state.page, page_size: state.page_size, search: state.search || undefined,
      });
      state.items = data.items;
      if (!data.items.length) {
        tableArea.innerHTML = `<div class="empty"><div class="glyph">◌</div>
          <h3>Lavozimlar topilmadi</h3><p>Yangi lavozim qo'shing.</p></div>`;
      } else {
        tableArea.innerHTML = `<div class="table-wrap"><table class="data">
          <thead><tr><th>Kod</th><th>Nomi</th><th>Bo'lim</th><th>Holat</th><th></th></tr></thead>
          <tbody>${data.items.map((p) => `<tr>
            <td class="mono">${esc(p.code)}</td>
            <td><strong>${esc(p.name)}</strong></td>
            <td>${esc(p.department_name || '—')}</td>
            <td>${p.is_active ? '<span class="pill present">Faol</span>' : '<span class="pill unknown">Nofaol</span>'}</td>
            <td><div class="cell-actions">
              ${perms.can('position:update') ? `<button class="btn btn-secondary btn-sm" data-edit="${p.id}">Tahrir</button>` : ''}
              ${perms.can('position:delete') ? `<button class="btn btn-ghost btn-sm text-danger" data-del="${p.id}">O'chirish</button>` : ''}
            </div></td>
          </tr>`).join('')}</tbody></table></div>`;
        tableArea.querySelectorAll('[data-edit]').forEach((b) => {
          b.onclick = () => openForm(state.items.find((x) => x.id === +b.dataset.edit));
        });
        tableArea.querySelectorAll('[data-del]').forEach((b) => {
          b.onclick = async () => {
            const p = state.items.find((x) => x.id === +b.dataset.del);
            if (!(await confirmDialog(`"${p.name}" lavozimi o'chirilsinmi?`))) return;
            try { await api.del(`/positions/${p.id}`); toast("O'chirildi", 'success'); load(); }
            catch (err) { toast(err.message, 'error', 6000); }
          };
        });
      }
      renderPagination(pager, data, (p) => { state.page = p; load(); });
    } catch (err) { tableArea.innerHTML = errorBlock(err.message); }
  }

  function openForm(pos) {
    const isEdit = !!pos;
    modal({
      title: isEdit ? 'Lavozimni tahrirlash' : 'Yangi lavozim',
      body: `<form id="p-form">
        <div class="field"><label>Nomi *</label><input name="name" required value="${esc(pos?.name || '')}" /></div>
        <div class="field"><label>Kod *</label><input name="code" required value="${esc(pos?.code || '')}" placeholder="DOC" /></div>
        <div class="field"><label>Bo'lim</label>
          <select name="department_id"><option value="">—</option>
            ${state.departments.map((d) => `<option value="${d.id}" ${pos?.department_id === d.id ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}
          </select></div>
        <div class="field"><label>Tartib raqami</label><input type="number" name="sort_order" value="${pos?.sort_order ?? 0}" /></div>
        <div class="field"><label><input type="checkbox" name="is_active" style="width:auto" ${pos?.is_active !== false ? 'checked' : ''} /> Faol</label></div>
        <div id="p-err"></div></form>`,
      footer: `<button class="btn btn-secondary" data-cancel>Bekor</button>
               <button class="btn btn-primary" data-save>Saqlash</button>`,
      onMount(el, close) {
        el.querySelector('[data-cancel]').onclick = close;
        el.querySelector('[data-save]').onclick = async () => {
          const f = el.querySelector('#p-form');
          if (!f.reportValidity()) return;
          const data = formData(f);
          data.sort_order = +(data.sort_order || 0);
          data.is_active = f.is_active.checked;
          if (data.department_id) data.department_id = +data.department_id; else delete data.department_id;
          try {
            if (isEdit) await api.patch(`/positions/${pos.id}`, data);
            else await api.post('/positions', data);
            toast('Saqlandi', 'success'); close(); load();
          } catch (err) {
            el.querySelector('#p-err').innerHTML = `<div class="alert danger">${esc(err.message)}</div>`;
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