import { api } from '../assets/js/api.js';
import {
  esc, fmtDateTime, loadingBlock, errorBlock, debounce, renderPagination,
  modal, toast, todayIso,
} from '../assets/js/ui.js';

const state = {
  page: 1, page_size: 50, search: '', action: '', resource_type: '',
  date_from: '', date_to: '', items: [],
};

const RESOURCES = [
  ['user', 'Foydalanuvchi'], ['role', 'Rol'], ['permission', 'Ruxsat'],
  ['department', "Bo'lim"], ['position', 'Lavozim'], ['employee', 'Xodim'],
  ['device', 'Qurilma'], ['device_event', 'Qurilma hodisasi'],
  ['attendance_record', 'Davomat yozuvi'], ['attendance_correction', 'Tuzatish'],
  ['shift', 'Smena'], ['employee_shift_assignment', 'Smena biriktirish'],
  ['leave_request', "Ta'til"], ['holiday', 'Bayram'],
  ['system_setting', 'Sozlama'], ['backup', 'Zaxira nusxa'],
];

export async function render(root) {
  root.innerHTML = `
    <div class="content-max">
      <div class="alert info">
        <span>Audit jurnali faqat qo'shiladi (append-only). Yozuvlar tahrirlanmaydi yoki o'chirilmaydi.
        Har bir muhim amal foydalanuvchi, IP va o'zgargan qiymatlar bilan qayd etiladi.</span>
      </div>
      <div class="card">
        <div class="toolbar">
          <div class="grow search-box">
            <input id="q" placeholder="Amal, tavsif yoki resurs ID…" aria-label="Qidirish" />
          </div>
          <select id="f-action" aria-label="Amal" style="max-width:200px">
            <option value="">Barcha amallar</option>
            <option value="auth.login">Kirish</option>
            <option value="auth.login.failed">Muvaffaqiyatsiz kirish</option>
            <option value="employee">Xodim amallari</option>
            <option value="attendance.correct">Davomat tuzatish</option>
            <option value="attendance">Davomat amallari</option>
            <option value="user">Foydalanuvchi amallari</option>
            <option value="role">Rol amallari</option>
            <option value="device">Qurilma amallari</option>
            <option value="backup">Zaxira nusxa</option>
          </select>
          <select id="f-resource" aria-label="Resurs" style="max-width:200px">
            <option value="">Barcha resurslar</option>
            ${RESOURCES.map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join('')}
          </select>
          <div><label for="df">Dan</label><input type="date" id="df" /></div>
          <div><label for="dt">Gacha</label><input type="date" id="dt" /></div>
          <button class="btn btn-secondary" id="today" style="margin-top:18px">Bugun</button>
          <button class="btn btn-secondary" id="reset" style="margin-top:18px">Tozalash</button>
          <div class="topbar-spacer"></div>
          <button class="btn btn-primary" id="export" style="margin-top:18px">⤓ Excel</button>
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
      const data = await api.get('/audit', {
        page: state.page,
        page_size: state.page_size,
        search: state.search || undefined,
        action: state.action || undefined,
        resource_type: state.resource_type || undefined,
        date_from: state.date_from || undefined,
        date_to: state.date_to || undefined,
      });
      state.items = data.items;
      if (!data.items.length) {
        tableArea.innerHTML = `<div class="empty"><div class="glyph">◌</div>
          <h3>Audit yozuvlari topilmadi</h3>
          <p>Tanlangan filtrlar bo'yicha yozuv yo'q.</p></div>`;
      } else {
        tableArea.innerHTML = `<div class="table-wrap"><table class="data">
          <thead><tr>
            <th>Vaqt</th><th>Foydalanuvchi</th><th>Amal</th><th>Resurs</th>
            <th>Tavsif</th><th>IP</th><th>Holat</th><th></th>
          </tr></thead>
          <tbody>${data.items.map((l) => `<tr>
            <td class="mono">${fmtDateTime(l.timestamp)}</td>
            <td>${esc(l.user_name || 'tizim')}</td>
            <td class="mono">${esc(l.action)}</td>
            <td>${esc(l.resource_type)}${l.resource_id ? ` <span class="inline-note">#${esc(l.resource_id)}</span>` : ''}</td>
            <td class="wrap">${esc((l.description || '').slice(0, 140))}</td>
            <td class="mono">${esc(l.user_ip || '—')}</td>
            <td>${l.success ? '<span class="pill present">OK</span>' : '<span class="pill absent">Xato</span>'}</td>
            <td>${(l.old_values || l.new_values) ? `<button class="btn btn-ghost btn-sm" data-view="${l.id}">Batafsil</button>` : ''}</td>
          </tr>`).join('')}</tbody></table></div>`;

        tableArea.querySelectorAll('[data-view]').forEach((b) => {
          b.onclick = () => showDetail(state.items.find((x) => x.id === +b.dataset.view));
        });
      }
      renderPagination(pager, data, (p) => { state.page = p; load(); });
    } catch (err) {
      tableArea.innerHTML = errorBlock(err.message);
    }
  }

  function showDetail(log) {
    const block = (title, obj) => (obj && Object.keys(obj).length)
      ? `<h4 style="margin:14px 0 6px;font-size:12.5px;color:#46586b">${esc(title)}</h4>
         <pre class="mono" style="background:#f4f7fb;border:1px solid #e2e9f1;border-radius:8px;
           padding:10px;overflow:auto;max-height:220px;margin:0">${esc(JSON.stringify(obj, null, 2))}</pre>`
      : '';
    modal({
      title: `Audit yozuvi #${log.id}`,
      wide: true,
      body: `
        <dl class="kv">
          <dt>Vaqt</dt><dd>${fmtDateTime(log.timestamp)}</dd>
          <dt>Foydalanuvchi</dt><dd>${esc(log.user_name || 'tizim')}</dd>
          <dt>Amal</dt><dd class="mono">${esc(log.action)}</dd>
          <dt>Resurs</dt><dd>${esc(log.resource_type)} #${esc(log.resource_id || '—')}</dd>
          <dt>IP manzil</dt><dd class="mono">${esc(log.user_ip || '—')}</dd>
          <dt>Holat</dt><dd>${log.success ? 'Muvaffaqiyatli' : `Xato: ${esc(log.error_message || '')}`}</dd>
          <dt>Tavsif</dt><dd class="wrap">${esc(log.description || '—')}</dd>
        </dl>
        ${block('Eski qiymatlar', log.old_values)}
        ${block('Yangi qiymatlar', log.new_values)}
        ${log.changed_fields?.length
          ? `<div class="inline-note mt-1">O'zgargan maydonlar: ${log.changed_fields.map(esc).join(', ')}</div>`
          : ''}`,
    });
  }

  root.querySelector('#q').addEventListener('input', debounce((e) => {
    state.search = e.target.value.trim(); state.page = 1; load();
  }));
  root.querySelector('#f-action').onchange = (e) => {
    state.action = e.target.value; state.page = 1; load();
  };
  root.querySelector('#f-resource').onchange = (e) => {
    state.resource_type = e.target.value; state.page = 1; load();
  };
  root.querySelector('#df').onchange = (e) => {
    state.date_from = e.target.value; state.page = 1; load();
  };
  root.querySelector('#dt').onchange = (e) => {
    state.date_to = e.target.value; state.page = 1; load();
  };
  root.querySelector('#today').onclick = () => {
    state.date_from = todayIso(); state.date_to = todayIso(); state.page = 1;
    root.querySelector('#df').value = state.date_from;
    root.querySelector('#dt').value = state.date_to;
    load();
  };
  root.querySelector('#reset').onclick = () => {
    state.search = ''; state.action = ''; state.resource_type = '';
    state.date_from = ''; state.date_to = ''; state.page = 1;
    root.querySelector('#q').value = '';
    root.querySelector('#f-action').value = '';
    root.querySelector('#f-resource').value = '';
    root.querySelector('#df').value = '';
    root.querySelector('#dt').value = '';
    load();
  };
  root.querySelector('#export').onclick = async () => {
    try {
      await api.download('/audit/export', {
        date_from: state.date_from || undefined,
        date_to: state.date_to || undefined,
      }, `audit_${todayIso()}.xlsx`);
      toast('Eksport tayyor', 'success');
    } catch (err) { toast(err.message, 'error'); }
  };

  load();
}
