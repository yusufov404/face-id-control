import { api } from '../assets/js/api.js';
import {
  esc, fmtDate, loadingBlock, errorBlock, toast, todayIso, fmtNum,
} from '../assets/js/ui.js';

const state = {
  date_from: todayIso(), date_to: todayIso(), department_id: '',
  departments: [], rows: [], stats: [],
};

export async function render(root, ctx) {
  const perms = ctx.state;
  root.innerHTML = `
    <div class="content-max">
      <div class="card">
        <div class="toolbar">
          <div><label for="df">Dan</label><input type="date" id="df" value="${state.date_from}" /></div>
          <div><label for="dt">Gacha</label><input type="date" id="dt" value="${state.date_to}" /></div>
          <select id="f-dept" style="max-width:220px;margin-top:18px" aria-label="Bo'lim">
            <option value="">Barcha bo'limlar</option></select>
          <div class="topbar-spacer"></div>
          <div class="flex gap-1" style="margin-top:18px">
            ${perms.can('report:export') ? `
              <button class="btn btn-secondary" id="xls">⤓ Excel</button>
              <button class="btn btn-secondary" id="pdf">⤓ PDF</button>` : ''}
            <button class="btn btn-primary" id="run">Hisoblash</button>
          </div>
        </div>
        <div class="card-pad" id="summary"></div>
      </div>

      <div class="card mt-2">
        <div class="card-head"><h2>Bo'limlar kesimi</h2></div>
        <div id="stats-area" class="table-wrap">${loadingBlock()}</div>
      </div>

      <div class="card mt-2">
        <div class="card-head"><h2>Batafsil davomat</h2>
          <div class="sub" id="detail-sub"></div></div>
        <div id="detail-area" class="table-wrap">${loadingBlock()}</div>
      </div>
    </div>`;

  try {
    state.departments = await api.get('/departments/options');
    root.querySelector('#f-dept').innerHTML =
      `<option value="">Barcha bo'limlar</option>` +
      state.departments.map((d) => `<option value="${d.id}">${esc(d.name)}</option>`).join('');
  } catch { /* ignore */ }

  async function run() {
    const statsArea = root.querySelector('#stats-area');
    const detailArea = root.querySelector('#detail-area');
    statsArea.innerHTML = loadingBlock();
    detailArea.innerHTML = loadingBlock();
    try {
      const [stats, report] = await Promise.all([
        api.get('/reports/departments', {
          date_from: state.date_from, date_to: state.date_to,
        }),
        api.get('/reports/attendance', {
          date_from: state.date_from, date_to: state.date_to,
          department_id: state.department_id || undefined, format: 'json',
        }),
      ]);
      state.stats = stats;
      state.rows = report.items;

      const totalEmp = stats.reduce((a, s) => a + s.employee_count, 0);
      const totalPresent = stats.reduce((a, s) => a + s.present + s.late, 0);
      const totalAbsent = stats.reduce((a, s) => a + s.absent, 0);
      const rate = totalPresent + totalAbsent
        ? Math.round((totalPresent / (totalPresent + totalAbsent)) * 100) : 0;

      root.querySelector('#summary').innerHTML = `
        <div class="stat-grid" style="margin:0">
          <div class="stat"><div class="label">Faol xodim</div><div class="value">${fmtNum(totalEmp)}</div></div>
          <div class="stat"><div class="label">Kelgan (davr)</div><div class="value">${fmtNum(totalPresent)}</div></div>
          <div class="stat tone-absent"><div class="label">Kelmagan</div><div class="value">${fmtNum(totalAbsent)}</div></div>
          <div class="stat tone-device"><div class="label">Davomat darajasi</div><div class="value">${rate}%</div></div>
        </div>`;

      statsArea.innerHTML = stats.length ? `<table class="data">
        <thead><tr><th>Bo'lim</th><th>Xodim</th><th>Kelgan</th><th>Kechikkan</th>
          <th>Kelmagan</th><th>Ta'tilda</th><th>Daraja</th></tr></thead>
        <tbody>${stats.map((s) => `<tr>
          <td><strong>${esc(s.department_name)}</strong></td>
          <td>${s.employee_count}</td><td>${s.present}</td><td>${s.late}</td>
          <td>${s.absent}</td><td>${s.on_leave}</td>
          <td><span class="pill ${s.attendance_rate >= 90 ? 'present' : s.attendance_rate >= 70 ? 'late' : 'absent'}">${s.attendance_rate}%</span></td>
        </tr>`).join('')}</tbody></table>` : `<div class="empty"><div class="glyph">◌</div>
          <h3>Ma'lumot yo'q</h3><p>Tanlangan davrda hisoblangan davomat yo'q.</p></div>`;

      root.querySelector('#detail-sub').textContent = `${report.count} yozuv`;
      detailArea.innerHTML = report.items.length ? `<table class="data">
        <thead><tr><th>Sana</th><th>Xodim</th><th>Bo'lim</th><th>Holat</th>
          <th>Kechikish</th><th>Erta ketish</th><th>Ishlangan</th></tr></thead>
        <tbody>${report.items.slice(0, 200).map((r) => `<tr>
          <td>${fmtDate(r.date)}</td><td>${esc(r.employee || '—')}</td>
          <td>${esc(r.department || '—')}</td>
          <td>${esc(r.status_label || r.status)}</td>
          <td>${r.late_minutes ? r.late_minutes + ' daq' : '—'}</td>
          <td>${r.early_leave_minutes ? r.early_leave_minutes + ' daq' : '—'}</td>
          <td>${r.work_minutes} daq</td>
        </tr>`).join('')}</tbody></table>
        ${report.count > 200 ? `<div class="inline-note" style="padding:10px 14px">Ko'rsatilgan: 200 / ${report.count}. To'liq ro'yxatni Excel orqali yuklab oling.</div>` : ''}`
        : `<div class="empty"><div class="glyph">◌</div><h3>Yozuvlar yo'q</h3></div>`;
    } catch (err) {
      statsArea.innerHTML = errorBlock(err.message);
      detailArea.innerHTML = errorBlock(err.message);
    }
  }

  async function download(format) {
    try {
      await api.download('/reports/attendance', {
        date_from: state.date_from, date_to: state.date_to,
        department_id: state.department_id || undefined, format,
      }, `davomat_${state.date_from}_${state.date_to}.${format === 'excel' ? 'xlsx' : 'pdf'}`);
      toast('Fayl tayyor', 'success');
    } catch (err) { toast(err.message, 'error'); }
  }

  root.querySelector('#df').onchange = (e) => { state.date_from = e.target.value; };
  root.querySelector('#dt').onchange = (e) => { state.date_to = e.target.value; };
  root.querySelector('#f-dept').onchange = (e) => { state.department_id = e.target.value; };
  root.querySelector('#run').onclick = run;
  root.querySelector('#xls')?.addEventListener('click', () => download('excel'));
  root.querySelector('#pdf')?.addEventListener('click', () => download('pdf'));
  run();
}