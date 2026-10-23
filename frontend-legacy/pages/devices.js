import { api } from '../assets/js/api.js';
import {
  esc, fmtDateTime, loadingBlock, errorBlock, statusPill, modal, toast,
  confirmDialog, renderPagination, formData,
} from '../assets/js/ui.js';

const state = { page: 1, page_size: 20, items: [] };

export async function render(root, ctx) {
  const perms = ctx.state;
  root.innerHTML = `
    <div class="content-max">
      <div class="alert info">
        <span>Integratsiya <strong>diagnostika</strong> rejimida ishlaydi: qurilma imkoniyatlari
        (alertStream / AcsEvent search / vaqt sinxroni) haqiqiy ISAPI so'rovlari bilan tekshiriladi.
        Qo'llab-quvvatlanmagan funksiya "ishlaydi" deb ko'rsatilmaydi.</span>
      </div>
      <div class="card">
        <div class="toolbar">
          <div class="grow search-box"><input id="q" placeholder="Qurilma nomi, seriya yoki IP…" /></div>
          <div class="topbar-spacer"></div>
          ${perms.can('device:create') ? `<button class="btn btn-primary" id="add">+ Qurilma qo'shish</button>` : ''}
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
      const data = await api.get('/devices', {
        page: state.page, page_size: state.page_size,
        search: root.querySelector('#q').value.trim() || undefined,
      });
      state.items = data.items;
      if (!data.items.length) {
        tableArea.innerHTML = `<div class="empty"><div class="glyph">◌</div>
          <h3>Qurilmalar qo'shilmagan</h3>
          <p>Hikvision terminalini qo'shing. Real qurilma tekshirilmaguncha demo hodisalar haqiqiy deb ko'rsatilmaydi.</p></div>`;
      } else {
        tableArea.innerHTML = `<div class="table-wrap"><table class="data">
          <thead><tr><th>Nomi</th><th>Model</th><th>IP:Port</th><th>Seriya</th>
            <th>Bo'lim</th><th>Holat</th><th>Oxirgi sinxron</th><th></th></tr></thead>
          <tbody>${data.items.map((d) => `<tr>
            <td><strong>${esc(d.name)}</strong></td>
            <td>${esc(d.model || '—')}</td>
            <td class="mono">${esc(d.ip_address)}:${d.port}</td>
            <td class="mono">${esc(d.serial_number)}</td>
            <td>${esc(d.department_name || '—')}</td>
            <td title="${esc(d.error_message || '')}">${statusPill(d.status)}</td>
            <td>${fmtDateTime(d.last_sync)}</td>
            <td><div class="cell-actions">
              <button class="btn btn-secondary btn-sm" data-diag="${d.id}">Diagnostika</button>
              ${perms.can('device:sync') ? `<button class="btn btn-secondary btn-sm" data-sync="${d.id}">Sinxron</button>` : ''}
              <button class="btn btn-ghost btn-sm" data-events="${d.id}">Hodisalar</button>
              ${perms.can('device:update') ? `<button class="btn btn-ghost btn-sm" data-edit="${d.id}">Tahrir</button>` : ''}
              ${perms.can('device:delete') ? `<button class="btn btn-ghost btn-sm text-danger" data-del="${d.id}">O'chirish</button>` : ''}
            </div></td>
          </tr>`).join('')}</tbody></table></div>`;

        tableArea.querySelectorAll('[data-diag]').forEach((b) => {
          b.onclick = () => diagnose(state.items.find((x) => x.id === +b.dataset.diag));
        });
        tableArea.querySelectorAll('[data-sync]').forEach((b) => {
          b.onclick = async () => {
            const d = state.items.find((x) => x.id === +b.dataset.sync);
            b.disabled = true; b.textContent = 'Sinxron…';
            try {
              const r = await api.post(`/devices/${d.id}/sync`);
              toast(r.detail, 'success'); load();
            } catch (err) { toast(err.message, 'error', 7000); b.disabled = false; b.textContent = 'Sinxron'; }
          };
        });
        tableArea.querySelectorAll('[data-events]').forEach((b) => {
          b.onclick = () => showEvents(state.items.find((x) => x.id === +b.dataset.events));
        });
        tableArea.querySelectorAll('[data-edit]').forEach((b) => {
          b.onclick = () => openForm(state.items.find((x) => x.id === +b.dataset.edit));
        });
        tableArea.querySelectorAll('[data-del]').forEach((b) => {
          b.onclick = async () => {
            const d = state.items.find((x) => x.id === +b.dataset.del);
            if (!(await confirmDialog(`"${d.name}" qurilmasi o'chirilsinmi?`))) return;
            try { await api.del(`/devices/${d.id}`); toast("O'chirildi", 'success'); load(); }
            catch (err) { toast(err.message, 'error'); }
          };
        });
      }
      renderPagination(pager, data, (p) => { state.page = p; load(); });
    } catch (err) { tableArea.innerHTML = errorBlock(err.message); }
  }

  function openForm(device) {
    const isEdit = !!device;
    modal({
      title: isEdit ? 'Qurilmani tahrirlash' : "Hikvision qurilmasini qo'shish",
      wide: true,
      body: `<form id="dev-form"><div class="form-grid">
        <div class="field"><label>Nomi *</label><input name="name" required value="${esc(device?.name || '')}" /></div>
        <div class="field"><label>Seriya raqami *</label>
          <input name="serial_number" required ${isEdit ? 'disabled' : ''} value="${esc(device?.serial_number || '')}" /></div>
        <div class="field"><label>IP manzil *</label><input name="ip_address" required value="${esc(device?.ip_address || '')}" placeholder="192.168.1.64" /></div>
        <div class="field"><label>Port *</label><input type="number" name="port" required value="${device?.port ?? 80}" /></div>
        <div class="field"><label>Protokol</label>
          <select name="connection_type"><option value="http" ${device?.connection_type !== 'https' ? 'selected' : ''}>HTTP</option>
            <option value="https" ${device?.connection_type === 'https' ? 'selected' : ''}>HTTPS</option></select></div>
        <div class="field"><label>Turi</label>
          <select name="device_type"><option value="face_id">Face ID</option>
            <option value="multi_biometric">Multi-biometrik</option>
            <option value="card_reader">Karta</option></select></div>
        <div class="field"><label>Login *</label><input name="username" required value="${esc(device?.username || 'admin')}" autocomplete="off" /></div>
        <div class="field"><label>Parol ${isEdit ? '(o\'zgartirmaslik uchun bo\'sh qoldiring)' : '*'}</label>
          <input type="password" name="password" ${isEdit ? '' : 'required'} autocomplete="new-password" /></div>
        <div class="field"><label>Sinxron oralig'i (sek)</label><input type="number" name="sync_interval" value="${device?.sync_interval ?? 300}" /></div>
        <div class="field"><label>Timeout (sek)</label><input type="number" name="timeout" value="${device?.timeout ?? 10}" /></div>
        <div class="field span-2"><label>Joylashuvi</label><input name="location" value="${esc(device?.location || '')}" /></div>
        <div class="field span-2"><label>Izoh</label><textarea name="notes">${esc(device?.notes || '')}</textarea></div>
      </div>
      <div class="alert warn"><span>Parol shifrlangan holda saqlanadi va hech qachon API javobida yoki logda ko'rinmaydi.</span></div>
      <div id="dev-err"></div></form>`,
      footer: `<button class="btn btn-secondary" data-cancel>Bekor</button>
               <button class="btn btn-primary" data-save>Saqlash</button>`,
      onMount(el, close) {
        el.querySelector('[data-cancel]').onclick = close;
        el.querySelector('[data-save]').onclick = async () => {
          const f = el.querySelector('#dev-form');
          if (!f.reportValidity()) return;
          const data = formData(f);
          ['port', 'sync_interval', 'timeout'].forEach((k) => { data[k] = +data[k]; });
          if (isEdit) {
            delete data.serial_number;
            if (!data.password) delete data.password;
            try { await api.patch(`/devices/${device.id}`, data); toast('Yangilandi', 'success'); close(); load(); }
            catch (err) { el.querySelector('#dev-err').innerHTML = `<div class="alert danger">${esc(err.message)}</div>`; }
          } else {
            try { await api.post('/devices', data); toast("Qo'shildi", 'success'); close(); load(); }
            catch (err) { el.querySelector('#dev-err').innerHTML = `<div class="alert danger">${esc(err.message)}</div>`; }
          }
        };
      },
    });
  }

  async function diagnose(d) {
    const m = modal({
      title: `Diagnostika — ${d.name}`,
      wide: true,
      body: loadingBlock('Qurilma tekshirilmoqda…'),
      footer: `<button class="btn btn-secondary" data-close>Yopish</button>`,
      onMount(el, close) { el.querySelector('[data-close]').onclick = close; },
    });
    try {
      const r = await api.post(`/devices/${d.id}/diagnose`);
      const yn = (v) => v === true ? '<span class="pill present">Ha</span>'
        : v === false ? '<span class="pill absent">Yo\'q</span>' : '<span class="pill unknown">Aniqlanmadi</span>';
      m.el.querySelector('.body').innerHTML = `
        <div class="alert ${r.reachable ? 'success' : 'danger'}">
          ${r.reachable ? 'Qurilma tarmoqda javob berdi.' : "Qurilma javob bermadi. IP/port va tarmoqni tekshiring."}
        </div>
        <dl class="kv">
          <dt>Model</dt><dd>${esc(r.model || '—')}</dd>
          <dt>Firmware</dt><dd>${esc(r.firmware || '—')}</dd>
          <dt>Seriya raqami</dt><dd class="mono">${esc(r.serial_number || '—')}</dd>
          <dt>Qurilma vaqti</dt><dd>${esc(r.device_time || '—')}</dd>
          <dt>Server vaqti</dt><dd>${esc(r.server_time || '—')}</dd>
          <dt>Vaqt farqi</dt><dd>${r.time_drift_seconds == null ? '—'
            : `${r.time_drift_seconds} soniya ${Math.abs(r.time_drift_seconds) > 120 ? '<span class="text-danger">(xavfli)</span>' : ''}`}</dd>
          <dt>alertStream</dt><dd>${yn(r.alert_stream_supported)}</dd>
          <dt>AcsEvent search</dt><dd>${yn(r.event_search_supported)}</dd>
          <dt>Vaqt sinxroni</dt><dd>${yn(r.time_sync_supported)}</dd>
        </dl>
        ${r.errors && r.errors.length ? `<div class="alert warn mt-2"><div>
          <strong>Ogohlantirishlar:</strong><ul style="margin:6px 0 0 16px">
          ${r.errors.map((e) => `<li>${esc(e)}</li>`).join('')}</ul></div></div>` : ''}
        <div class="inline-note mt-2">
          Bu natijalar haqiqiy ISAPI so'rovlaridan olingan. "Yo'q" — firmware bu funksiyani qo'llab-quvvatlamaydi.
        </div>`;
      load();
    } catch (err) {
      m.el.querySelector('.body').innerHTML = `<div class="alert danger">${esc(err.message)}</div>`;
    }
  }

  async function showEvents(d) {
    const m = modal({
      title: `Hodisalar — ${d.name}`,
      wide: true,
      body: loadingBlock('Hodisalar yuklanmoqda…'),
      footer: `<button class="btn btn-secondary" data-close>Yopish</button>`,
      onMount(el, close) { el.querySelector('[data-close]').onclick = close; },
    });
    try {
      const data = await api.get(`/devices/${d.id}/events`, { page: 1, page_size: 50 });
      m.el.querySelector('.body').innerHTML = data.items.length ? `
        <table class="data"><thead><tr><th>Vaqt</th><th>Xodim</th><th>Turi</th>
          <th>Usul</th><th>Qayta ishlandi</th></tr></thead>
        <tbody>${data.items.map((e) => `<tr>
          <td>${fmtDateTime(e.event_time)}</td>
          <td>${esc(e.employee_name || e.device_user_id || '—')}</td>
          <td>${esc(e.event_type)}</td>
          <td>${esc(e.verify_mode || '—')}</td>
          <td>${e.processed ? '<span class="pill present">Ha</span>' : '<span class="pill late">Kutilmoqda</span>'}</td>
        </tr>`).join('')}</tbody></table>
        <div class="inline-note mt-1">Jami: ${data.total}. Xom hodisalar o'chirilmaydi (idempotent saqlash).</div>`
        : `<div class="empty"><div class="glyph">◌</div><h3>Hodisalar yo'q</h3>
           <p>Qurilma hali hodisa yubormagan yoki sinxron qilinmagan.</p></div>`;
    } catch (err) {
      m.el.querySelector('.body').innerHTML = `<div class="alert danger">${esc(err.message)}</div>`;
    }
  }

  root.querySelector('#q').addEventListener('input', () => { state.page = 1; });
  root.querySelector('#q').addEventListener('change', load);
  root.querySelector('#add')?.addEventListener('click', () => openForm(null));
  load();
}