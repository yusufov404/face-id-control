import { api } from '../assets/js/api.js';
import {
  esc, loadingBlock, errorBlock, debounce, modal, toast, confirmDialog,
  renderPagination, formData,
} from '../assets/js/ui.js';

const state = { page: 1, page_size: 20, search: '', items: [] };

export async function render(root, ctx) {
  const perms = ctx.state;
  root.innerHTML = `
    <div class="content-max">
      <div class="card">
        <div class="toolbar">
          <div class="grow search-box"><input id="q" placeholder="Bo'lim nomi yoki kodi…" aria-label="Qidirish" /></div>
          <button class="btn btn-secondary" id="reset">Tozalash</button>
          <div class="topbar-spacer"></div>
          ${perms.can('department:create') ? `<button class="btn btn-primary" id="add">+ Yangi bo'lim</button>` : ''}
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
      const data = await api.get('/departments', {
        page: state.page, page_size: state.page_size, search: state.search || undefined,
      });
      state.items = data.items;
      if (!data.items.length) {
        tableArea.innerHTML = `<div class="empty"><div class="glyph">◌</div>
          <h3>Bo'limlar topilmadi</h3><p>Yangi bo'lim qo'shing yoki qidiruvni o'zgartiring.</p></div>`;
      } else {
        tableArea.innerHTML = `
          <div class="table-wrap"><table class="data">
            <thead><tr><th>Kod</th><th>Nomi</th><th>Ota bo'lim</th><th>Xodimlar</th><th>Holat</th><th></th></tr></thead>
            <tbody>
              ${data.items.map((d) => `<tr>
                <td class="mono">${esc(d.code)}</td>
                <td><strong>${esc(d.name)}</strong></td>
                <td>${esc(d.parent_name || '—')}</td>
                <td>${d.employee_count}</td>
                <td>${d.is_active ? '<span class="pill present">Faol</span>' : '<span class="pill unknown">Nofaol</span>'}</td>
                <td><div class="cell-actions">
                  ${perms.can('department:update') ? `<button class="btn btn-secondary btn-sm" data-edit="${d.id}">Tahrir</button>` : ''}
                  ${perms.can('department:delete') ? `<button class="btn btn-ghost btn-sm text-danger" data-del="${d.id}">O'chirish</button>` : ''}
                </div></td>
              </tr>`).join('')}
            </tbody></table></div>`;
        tableArea.querySelectorAll('[data-edit]').forEach((b) => {
          b.onclick = () => openForm(state.items.find((x) => x.id === +b.dataset.edit));
        });
        tableArea.querySelectorAll('[data-del]').forEach((b) => {
          b.onclick = async () => {
            const d = state.items.find((x) => x.id === +b.dataset.del);
            if (!(await confirmDialog(`"${d.name}" bo'limi o'chirilsinmi?`))) return;
            try { await api.del(`/departments/${d.id}`); toast("Bo'lim o'chirildi", 'success'); load(); }
            catch (err) { toast(err.message, 'error', 6000); }
          };
        });
      }
      renderPagination(pager, data, (p) => { state.page = p; load(); });
    } catch (err) {
      tableArea.innerHTML = errorBlock(err.message);
    }
  }

  function openForm(dept) {
    const isEdit = !!dept;
    modal({
      title: isEdit ? "Bo'limni tahrirlash" : "Yangi bo'lim",
      body: `<form id="d-form">
        <div class="field"><label>Nomi *</label><input name="name" required value="${esc(dept?.name || '')}" /></div>
        <div class="field"><label>Kod *</label><input name="code" required value="${esc(dept?.code || '')}" placeholder="CARD" /></div>
        <div class="field"><label>Tavsif</label><textarea name="description">${esc(dept?.description || '')}</textarea></div>
        <div class="field"><label>Tartib raqami</label><input type="number" name="sort_order" value="${dept?.sort_order ?? 0}" /></div>
        <div class="field"><label><input type="checkbox" name="is_active" style="width:auto" ${dept?.is_active !== false ? 'checked' : ''} /> Faol</label></div>
        <div id="d-err"></div>
      </form>`,
      footer: `<button class="btn btn-secondary" data-cancel>Bekor</button>
               <button class="btn btn-primary" data-save>Saqlash</button>`,
      onMount(el, close) {
        el.querySelector('[data-cancel]').onclick = close;
        el.querySelector('[data-save]').onclick = async () => {
          const f = el.querySelector('#d-form');
          if (!f.reportValidity()) return;
          const data = formData(f);
          data.sort_order = +(data.sort_order || 0);
          data.is_active = f.is_active.checked;
          if (data.description === null) delete data.description;
          try {
            if (isEdit) await api.patch(`/departments/${dept.id}`, data);
            else await api.post('/departments', data);
            toast('Saqlandi', 'success'); close(); load();
          } catch (err) {
            el.querySelector('#d-err').innerHTML = `<div class="alert danger">${esc(err.message)}</div>`;
          }
        };
      },
    });
  }

  root.querySelector('#q').addEventListener('input', debounce((e) => {
    state.search = e.target.value.trim(); state.page = 1; load();
  }));
  root.querySelector('#reset').onclick = () => {
    state.search = ''; state.page = 1; root.querySelector('#q').value = ''; load();
  };
  root.querySelector('#add')?.addEventListener('click', () => openForm(null));
  load();
}