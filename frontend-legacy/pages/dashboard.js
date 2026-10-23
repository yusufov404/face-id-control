import { api } from '../assets/js/api.js';
import {
  esc, fmtNum, loadingBlock, errorBlock, statusPill, fmtTime, fmtDate,
} from '../assets/js/ui.js';

let chart = null;

function statCard(label, value, foot, tone = '') {
  const display = typeof value === 'number' ? fmtNum(value) : esc(value);
  return `<div class="stat ${tone}">
    <div class="label">${esc(label)}</div>
    <div class="value">${display}</div>
    <div class="foot">${esc(foot)}</div>
  </div>`;
}

function fallbackBars(rows) {
  const max = Math.max(1, ...rows.map((r) => r.present + r.late + r.absent));
  return `<div style="display:flex;align-items:flex-end;gap:6px;height:230px;padding:12px 16px">
    ${rows.map((r) => {
      const total = r.present + r.late + r.absent;
      const h = Math.round((total / max) * 190);
      return `<div style="flex:1;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;gap:2px"
        title="${esc(r.date)} — kelgan:${r.present}, kechikkan:${r.late}, kelmagan:${r.absent}">
        <div style="width:100%;max-width:26px;height:${h}px;background:#2e7dd1;border-radius:4px 4px 0 0;position:relative;overflow:hidden">
          <div style="position:absolute;bottom:0;left:0;right:0;height:${total ? Math.round((r.present / total) * 100) : 0}%;background:#2e9e5b"></div>
          <div style="position:absolute;bottom:${total ? Math.round((r.present / total) * 100) : 0}%;left:0;right:0;height:${total ? Math.round((r.late / total) * 100) : 0}%;background:#d98b1f"></div>
        </div>
        <span style="font-size:9px;color:#7b8a99">${esc(r.date.slice(5))}</span>
      </div>`;
    }).join('')}
  </div>
  <div class="inline-note" style="padding:0 16px 12px">
    Chart.js topilmadi — soddalashtirilgan grafik. To'liq grafik uchun
    <span class="mono">assets/vendor/chart.umd.min.js</span> faylini joylashtiring.
  </div>`;
}

export async function render(root, { state }) {
  root.innerHTML = loadingBlock('Dashboard yuklanmoqda…');
  try {
    const [stats, trend, daily, recent] = await Promise.all([
      api.get('/dashboard/stats'),
      api.get('/dashboard/trend', { days: 14 }),
      api.get('/dashboard/daily'),
      api.get('/attendance', { page: 1, page_size: 8 }),
    ]);

    const deviceFoot = stats.devices_total
      ? `${stats.devices_online} onlayn · ${stats.devices_offline} oflayn`
      : "Qurilma qo'shilmagan";

    root.innerHTML = `
      <div class="content-max">
        ${stats.is_demo_data ? `<div class="alert warn">
          <strong>Diqqat:</strong> tizimda simulyatsiya (demo) hodisalari mavjud.
          Ular haqiqiy qurilma ma'lumotlari emas va shunday belgilangan.
        </div>` : ''}

        <div class="stat-grid">
          ${statCard('Faol xodimlar', stats.total_active_employees, "Barcha bo'limlar bo'yicha", 'tone-dept')}
          ${statCard("Bo'limlar", stats.total_departments, "Faol bo'limlar", '')}
          ${statCard('Bugun kelganlar', stats.today_present, fmtDate(daily.date), '')}
          ${statCard('Kechikkanlar', stats.today_late, 'Bugungi smena bo\'yicha', 'tone-late')}
          ${statCard('Kelmaganlar', stats.today_absent, "Tasdiqlanmagan / yo'q", 'tone-absent')}
          ${statCard('Qurilmalar', `${stats.devices_online}/${stats.devices_total}`, deviceFoot, 'tone-device')}
        </div>

        <div class="grid-2">
          <div class="card">
            <div class="card-head">
              <div><h2>14 kunlik davomat dinamikasi</h2>
                <div class="sub">Kelgan / kechikkan / kelmagan</div></div>
            </div>
            <div class="chart-wrap" id="trend-chart"></div>
          </div>

          <div class="card">
            <div class="card-head"><h2>Bugungi xulosa</h2></div>
            <div class="card-pad">
              <dl class="kv">
                <dt>Jami faol xodim</dt><dd>${fmtNum(daily.total_active_employees)}</dd>
                <dt>Kelgan</dt><dd class="text-success">${fmtNum(daily.present)}</dd>
                <dt>Kechikkan</dt><dd class="text-warn">${fmtNum(daily.late)}</dd>
                <dt>Erta ketgan</dt><dd class="text-warn">${fmtNum(daily.early_leave)}</dd>
                <dt>Kelmagan</dt><dd class="text-danger">${fmtNum(daily.absent)}</dd>
                <dt>Ta'tilda</dt><dd>${fmtNum(daily.on_leave)}</dd>
                <dt>To'liqsiz</dt><dd>${fmtNum(daily.incomplete)}</dd>
              </dl>
              <div class="inline-note mt-2">
                Ko'rsatkichlar faqat bazadagi haqiqiy yozuvlardan hisoblanadi.
              </div>
            </div>
          </div>
        </div>

        <div class="card mt-2">
          <div class="card-head">
            <h2>So'nggi davomat yozuvlari</h2>
            <div class="topbar-spacer"></div>
            <a class="btn btn-secondary btn-sm" href="#/attendance">Barchasi</a>
          </div>
          <div class="table-wrap">
            ${recent.items.length ? `
            <table class="data">
              <thead><tr>
                <th>Sana</th><th>Xodim</th><th>Bo'lim</th><th>Kirish</th><th>Chiqish</th><th>Holat</th>
              </tr></thead>
              <tbody>
                ${recent.items.map((r) => `<tr>
                  <td>${fmtDate(r.record_date)}</td>
                  <td>${esc(r.employee_name || '—')}</td>
                  <td>${esc(r.department_name || '—')}</td>
                  <td>${fmtTime(r.actual_check_in)}</td>
                  <td>${fmtTime(r.actual_check_out)}</td>
                  <td>${statusPill(r.status)}</td>
                </tr>`).join('')}
              </tbody>
            </table>` : `<div class="empty"><div class="glyph">◌</div>
              <h3>Hozircha yozuvlar yo'q</h3>
              <p>Qurilma ulangach yoki davomat hisoblangach yozuvlar shu yerda ko'rinadi.</p></div>`}
          </div>
        </div>
      </div>`;

    const chartEl = root.querySelector('#trend-chart');
    if (window.Chart) {
      const ctx = document.createElement('canvas');
      chartEl.appendChild(ctx);
      chart?.destroy();
      chart = new window.Chart(ctx, {
        type: 'line',
        data: {
          labels: trend.map((r) => r.date.slice(5)),
          datasets: [
            { label: 'Kelgan', data: trend.map((r) => r.present), borderColor: '#2e9e5b', backgroundColor: 'rgba(46,158,91,.12)', tension: .32, fill: true },
            { label: 'Kechikkan', data: trend.map((r) => r.late), borderColor: '#d98b1f', backgroundColor: 'rgba(217,139,31,.10)', tension: .32 },
            { label: 'Kelmagan', data: trend.map((r) => r.absent), borderColor: '#c94b4b', backgroundColor: 'rgba(201,75,75,.08)', tension: .32 },
          ],
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 11 } } } },
          scales: {
            y: { beginAtZero: true, ticks: { precision: 0, font: { size: 10 } }, grid: { color: '#eef3f8' } },
            x: { grid: { display: false }, ticks: { font: { size: 10 } } },
          },
        },
      });
    } else {
      chartEl.outerHTML = fallbackBars(trend);
    }
  } catch (err) {
    root.innerHTML = errorBlock(err.message || 'Dashboard yuklanmadi');
    const retry = root.querySelector('button');
    if (retry) retry.onclick = () => render(root, { state });
  }
}
