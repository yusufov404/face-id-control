import { api } from '../assets/js/api.js';
import {
  esc, fmtDate, fmtTime, loadingBlock, errorBlock, statusPill, debounce,
  modal, toast, renderPagination, formData, todayIso, minutesToHm, toLocalInputValue,
} from '../assets/js/ui.js';

const state = {
  page: 1, page_size: 20, date_from: todayIso(), date_to: todayIso(),
  status: '', department_id: '', search: '', items: [], departments: [],
};

const STATUS_LIST = [
  ['present', 'Kelgan'], ['late', 'Kechikkan'], ['early_leave', 'Erta ketgan'],
  ['late_and_early', 'Kechikkan / erta'], ['absent', 'Kelmagan'], ['on_leave', "Ta'tilda"],
  ['incomplete', "To'liqsiz"], ['holiday', 'Bayram'], ['weekend', 'Dam olish'],
  ['not_scheduled', "Smena yo'q"],
];

export async function render(root, ctx) {
  const perms = ctx.state;
  root.innerHTML = `
    <div class="content-max">
      <div class="card">
        <div class="toolbar">
          <div><label for="df">Dan</label><input type="date" id="df" value="${state.date_from}" /></div>
          <div><label for="dt">Gacha</label><input type="date" id="dt" value="${state.date_to}" /></div>
          <select id="f-status" aria-label="Holat" style="max-width:180px;margin-top:18px">
            <option value="">Barcha holatlar</option>
            ${STATUS_LIST.map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join('')}
          </select>
          <select id="f-dept" aria-label="Bo'lim" style="max-width:200px;margin-top:18px">
            <option value="">Barcha bo'limlar</option>
          </select>
          <div class="grow search-box" style="margin-top:18px">
            <input id="q" placeholder="Xodim ismi / ID…" />
          </div>
          <div class="topbar-spacer"></div>
          ${perms.can('report:export') ? `<button class="btn btn-secondary" id="export" style="margin-top:18px">⤓ Excel</button>` : ''}
        </div>
        <div id="table-area">${loadingBlock()}</div>
        <div class="pagination" id="pager"></div>
      </div>
    </div>`;

  const tableArea = root.querySelector('#table-area');
  const pager = root.querySelector('#pager');

  try {
    state.departments = await api.get('/departments/options');
    root.querySelector('#f-dept').innerHTML =
      `<option value="">Barcha bo'limlar</option>` +
      state.departments.map((d) => `<option value="${d.id}">${esc(d.name)}</option>`).join('');
  } catch { /* ignore */ }

  async function load() {
    tableArea.innerHTML = loadingBlock();
    try {
      const data = await api.get('/attendance', {
        page: state.page, page_size: state.page_size,
        date_from: state.date_from || undefined,
        date_to: state.date_to || undefined,
        status: state.status || undefined,
        department_id: state.department_id || undefined,
        search: state.search || undefined,
      });
      state.items = data.items;
      if (!data.items.length) {
        tableArea.innerHTML = `<div class="empty"><div class="glyph">◌</div>
          <h3>Davomat yozuvlari topilmadi</h3>
          <p>Tanlangan davr uchun yozuv yo'q. Qurilma ulanganini va smena biriktirilganini tekshiring.</p></div>`;
      } else {
        tableArea.innerHTML = `<div class="table-wrap"><table class="data">
          <thead><tr>
            <th>Sana</th><th>Xodim</th><th>Bo'lim</th><th>Smena</th>
            <th>Kirish</th><th>Chiqish</th><th>Kechikish</th><th>Erta ketish</th>
            <th>Ishlangan</th><th>Holat</th><th></th>
          </tr></thead>
          <tbody>${data.items.map((r) => `<tr>
            <td>${fmtDate(r.record_date)}</td>
            <td><strong>${esc(r.employee_name || '—')}</strong></td>
            <td>${esc(r.department_name || '—')}</td>
            <td>${esc(r.shift_name || '—')}</td>
            <td>${fmtTime(r.actual_check_in)}</td>
            <td>${fmtTime(r.actual_check_out)}</td>
            <td>${r.late_minutes ? `<span class="text-warn">${r.late_minutes} daq</span>` : '—'}</td>
            <td>${r.early_leave_minutes ? `<span class="text-warn">${r.early_leave_minutes} daq</span>` : '—'}</td>
            <td>${minutesToHm(r.work_minutes)}</td>
            <td>${statusPill(r.status)}${r.is_manual ? ' <span class="pill incomplete" title="Qo\'lda tuzatilgan">qo\'lda</span>' : ''}</td>
            <td>${perms.can('attendance:correct') ? `<button class="btn btn-secondary btn-sm" data-corr="${r.id}">Tuzatish</button>` : ''}</td>
          </tr>`).join('')}</tbody></table></div>`;
        tableArea.querySelectorAll('[data-corr]').forEach((b) => {
          b.onclick = () => openCorrection(state.items.find((x) => x.id === +b.dataset.corr));
        });
      }
      renderPagination(pager, data, (p) => { state.page = p; load(); });
    } catch (err) {
      tableArea.innerHTML = errorBlock(err.message);
    }
  }

  function openCorrection(rec) {
    modal({
      title: `Davomatni tuzatish — ${rec.employee_name || ''} (${fmtDate(rec.record_date)})`,
      body: `
        <div class="alert warn">
          <span>Asl qurilma hodisalari o'chirilmaydi. Har bir tuzatish sababi, eski va yangi qiymati
          bilan audit jurnaliga yoziladi.</span>
        </div>
        <form id="c-form">
          <div class="field"><label>Tuzatish turi *</label>
            <select name="correction_type" id="ctype" required>
              <option value="check_in">Kirish vaqti</option>
              <option value="check_out">Chiqish vaqti</option>
              <option value="full_day">To'liq kun</option>
              <option value="status">Holat</option>
            </select></div>
          <div id="dyn"></div>
          <div class="field"><label>Sabab * (kamida 3 belgi)</label>
            <textarea name="reason" required placeholder="Masalan: qurilma xatosi, xodim ruxsat bilan erta ketdi…"></textarea></div>
          <div id="c-err"></div>
        </form>
        <div class="kv mt-2">
          <dt>Hozirgi kirish</dt><dd>${fmtTime(rec.actual_check_in)}</dd>
          <dt>Hozirgi chiqish</dt><dd>${fmtTime(rec.actual_check_out)}</dd>
          <dt>Hozirgi holat</dt><dd>${statusPill(rec.status)}</dd>
        </div>`,
      footer: `<button class="btn btn-secondary" data-cancel>Bekor</button>
               <button class="btn btn-primary" data-save>Tuzatishni saqlash</button>`,
      onMount(el, close) {
        const dyn = el.querySelector('#dyn');
        const ctype = el.querySelector('#ctype');
        const renderDyn = () => {
          const v = ctype.value;
          if (v === 'check_in') {
            dyn.innerHTML = `<div class="field"><label>Yangi kirish vaqti *</label>
              <input type="datetime-local" name="new_check_in" required value="${toLocalInputValue(rec.actual_check_in) || ''}" /></div>`;
          } else if (v === 'check_out') {
            dyn.innerHTML = `<div class="field"><label>Yangi chiqish vaqti *</label>
              <input type="datetime-local" name="new_check_out" required value="${toLocalInputValue(rec.actual_check_out) || ''}" /></div>`;
          } else if (v === 'full_day') {
            dyn.innerHTML = `
              <div class="field"><label>Yangi kirish</label><input type="datetime-local" name="new_check_in" value="${toLocalInputValue(rec.actual_check_in) || ''}" /></div>
              <div class="field"><label>Yangi chiqish</label><input type="datetime-local" name="new_check_out" value="${toLocalInputValue(rec.actual_check_out) || ''}" /></div>`;
          } else {
            dyn.innerHTML = `<div class="field"><label>Yangi holat *</label>
              <select name="new_value">${STATUS_LIST.map(([v2, l]) => `<option value="${v2}" ${rec.status === v2 ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></div>`;
          }
        };
        renderDyn();
        ctype.onchange = renderDyn;

        el.querySelector('[data-cancel]').onclick = close;
        el.querySelector('[data-save]').onclick = async () => {
          const f = el.querySelector('#c-form');
          if (!f.reportValidity()) return;
          const data = formData(f);
          const payload = {
            attendance_record_id: rec.id,
            correction_type: data.correction_type,
            field_name: data.correction_type === 'status' ? 'status'
              : data.correction_type === 'check_in' ? 'actual_check_in'
              : data.correction_type === 'check_out' ? 'actual_check_out' : 'work_minutes',
            reason: data.reason,
          };
          if (data.new_check_in) payload.new_check_in = new Date(data.new_check_in).toISOString();
          if (data.new_check_out) payload.new_check_out = new Date(data.new_check_out).toISOString();
          if (data.new_value) payload.new_value = data.new_value;
          try {
            await api.post('/attendance/corrections', payload);
            toast('Tuzatish saqlandi va auditga yozildi', 'success');
            close(); load();
          } catch (err) {
            el.querySelector('#c-err').innerHTML = `<div class="alert danger">${esc(err.message)}</div>`;
          }
        };
      },
    });
  }

  root.querySelector('#df').onchange = (e) => { state.date_from = e.target.value; state.page = 1; load(); };
  root.querySelector('#dt').onchange = (e) => { state.date_to = e.target.value; state.page = 1; load(); };
  root.querySelector('#f-status').onchange = (e) => { state.status = e.target.value; state.page = 1; load(); };
  root.querySelector('#f-dept').onchange = (e) => { state.department_id = e.target.value; state.page = 1; load(); };
  root.querySelector('#q').addEventListener('input', debounce((e) => {
    state.search = e.target.value.trim(); state.page = 1; load();
  }));
  const exp = root.querySelector('#export');
  if (exp) {
    exp.onclick = async () => {
      try {
        await api.download('/reports/attendance', {
          date_from: state.date_from || undefined,
          date_to: state.date_to || undefined,
          department_id: state.department_id || undefined,
          status: state.status || undefined,
          format: 'excel',
        }, `davomat_${state.date_from}_${state.date_to}.xlsx`);
        toast('Eksport tayyor', 'success');
      } catch (err) { toast(err.message, 'error'); }
    };
  }
  load();
}