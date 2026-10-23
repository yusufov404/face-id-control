import { api } from '../assets/js/api.js';
import {
  esc, loadingBlock, errorBlock, fmtDateTime, modal, toast, confirmDialog,
} from '../assets/js/ui.js';

const CATEGORY_LABELS = {
  organization: 'Tashkilot',
  attendance: 'Davomat qoidalari',
  integration: 'Integratsiya',
  backup: 'Zaxira nusxa',
  security: 'Xavfsizlik',
  general: 'Umumiy',
};

const state = { settings: [], backups: [], activeCategory: 'all' };

function renderValue(s) {
  const v = s.value;
  if (s.is_readonly) {
    return `<span class="mono">${esc(typeof v === 'object' ? JSON.stringify(v) : String(v))}</span>`;
  }
  if (s.value_type === 'boolean') {
    return `<label style="margin:0;font-weight:500"><input type="checkbox" data-setting="${s.id}"
      style="width:auto" ${v === true ? 'checked' : ''}/> ${v === true ? 'Yoqilgan' : "O'chirilgan"}</label>`;
  }
  if (s.value_type === 'integer' || s.value_type === 'number') {
    return `<input type="number" data-setting="${s.id}" value="${esc(v)}" style="max-width:180px" />`;
  }
  if (typeof v === 'object' && v !== null) {
    return `<textarea data-setting="${s.id}" class="mono" style="min-height:64px">${esc(JSON.stringify(v, null, 2))}</textarea>`;
  }
  return `<input data-setting="${s.id}" value="${esc(v ?? '')}" />`;
}

export async function render(root, ctx) {
  const perms = ctx.state;
  root.innerHTML = `
    <div class="content-max">
      <div class="card">
        <div class="card-head">
          <div><h2>Tizim sozlamalari</h2>
            <div class="sub">O'zgartirishlar audit jurnaliga yoziladi</div></div>
          <div class="topbar-spacer"></div>
          <select id="f-cat" aria-label="Kategoriya" style="max-width:210px">
            <option value="all">Barcha kategoriyalar</option>
            ${Object.entries(CATEGORY_LABELS).map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join('')}
          </select>
        </div>
        <div id="settings-area">${loadingBlock()}</div>
      </div>

      ${perms.can('settings:backup') ? `
      <div class="card mt-2">
        <div class="card-head">
          <div><h2>Zaxira nusxalar</h2>
            <div class="sub">SSD (tez) va HDD (uzoq muddatli) nusxalar</div></div>
          <div class="topbar-spacer"></div>
          <button class="btn btn-primary btn-sm" id="backup-now">+ Zaxira nusxa yaratish</button>
        </div>
        <div id="backups-area">${loadingBlock()}</div>
      </div>` : ''}

      <div class="card mt-2">
        <div class="card-head"><h2>Tizim ma'lumotlari</h2></div>
        <div class="card-pad">
          <dl class="kv">
            <dt>Ilova</dt><dd>FaceSys Enterprise v1.0</dd>
            <dt>Vaqt zonasi</dt><dd>Asia/Tashkent</dd>
            <dt>Sessiya</dt><dd>${esc(ctx.state.me?.username || '')} ·
              ${(ctx.state.me?.roles || []).map(esc).join(', ') || '—'}</dd>
            <dt>Bo'lim doirasi</dt><dd>${ctx.state.me?.department_scope
              ? `Faqat bo'lim #${ctx.state.me.department_scope}`
              : "Barcha bo'limlar"}</dd>
          </dl>
          <div class="inline-note mt-2">
            Hikvision integratsiyasi faqat qurilma haqiqatan qo'llab-quvvatlaydigan
            funksiyalar bilan ishlaydi. Diagnostika natijalari "Qurilmalar" bo'limida ko'rinadi.
          </div>
        </div>
      </div>
    </div>`;

  const settingsArea = root.querySelector('#settings-area');

  async function loadSettings() {
    settingsArea.innerHTML = loadingBlock();
    try {
      const rows = await api.get('/settings', {
        category: state.activeCategory === 'all' ? undefined : state.activeCategory,
      });
      state.settings = rows;
      if (!rows.length) {
        settingsArea.innerHTML = `<div class="empty"><div class="glyph">◌</div>
          <h3>Sozlamalar yo'q</h3><p>Seed skriptini ishga tushiring.</p></div>`;
        return;
      }
      const groups = {};
      rows.forEach((s) => { (groups[s.category] ||= []).push(s); });

      settingsArea.innerHTML = Object.entries(groups).map(([cat, items]) => `
        <div style="padding:16px 18px;border-bottom:1px solid #e2e9f1">
          <h3 style="margin:0 0 10px;font-size:13px;color:#1e3a5f;text-transform:uppercase;letter-spacing:.5px">
            ${esc(CATEGORY_LABELS[cat] || cat)}
          </h3>
          ${items.map((s) => `<div class="field" style="margin-bottom:12px">
            <label style="display:flex;align-items:center;gap:6px">
              <span class="mono">${esc(s.key)}</span>
              ${s.is_readonly ? '<span class="pill unknown">faqat o\'qish</span>' : ''}
            </label>
            <div class="flex items-center gap-1">
              <div style="flex:1">${renderValue(s)}</div>
              ${s.is_readonly ? '' : `<button class="btn btn-secondary btn-sm" data-save="${s.id}">Saqlash</button>`}
            </div>
            ${s.description ? `<div class="hint">${esc(s.description)}</div>` : ''}
          </div>`).join('')}
        </div>`).join('');

      settingsArea.querySelectorAll('[data-save]').forEach((b) => {
        b.onclick = () => saveSetting(+b.dataset.save, b);
      });
    } catch (err) {
      settingsArea.innerHTML = errorBlock(err.message);
    }
  }

  async function saveSetting(id, btn) {
    const s = state.settings.find((x) => x.id === id);
    if (!s) return;
    const input = settingsArea.querySelector(`[data-setting="${id}"]`);
    if (!input) return;

    let value;
    if (s.value_type === 'boolean') value = input.checked;
    else if (s.value_type === 'integer') {
      value = parseInt(input.value, 10);
      if (Number.isNaN(value)) { toast("Butun son kiriting", 'error'); return; }
    } else if (s.value_type === 'number') {
      value = Number(input.value);
      if (Number.isNaN(value)) { toast("Son kiriting", 'error'); return; }
    } else if (typeof s.value === 'object' && s.value !== null) {
      try { value = JSON.parse(input.value); }
      catch { toast('JSON formati xato', 'error'); return; }
    } else {
      value = input.value;
    }

    btn.disabled = true; btn.textContent = '…';
    try {
      await api.patch(`/settings/${encodeURIComponent(s.key)}`, { value });
      s.value = value;
      toast(`${s.key} yangilandi`, 'success');
    } catch (err) {
      toast(err.message, 'error', 6000);
    } finally {
      btn.disabled = false; btn.textContent = 'Saqlash';
    }
  }

  async function loadBackups() {
    const area = root.querySelector('#backups-area');
    if (!area) return;
    area.innerHTML = loadingBlock();
    try {
      const rows = await api.get('/backups');
      state.backups = rows;
      if (!rows.length) {
        area.innerHTML = `<div class="empty"><div class="glyph">◌</div>
          <h3>Zaxira nusxalar yo'q</h3>
          <p>Birinchi nusxani yaratish uchun yuqoridagi tugmani bosing.</p></div>`;
        return;
      }
      area.innerHTML = `<div class="table-wrap"><table class="data">
        <thead><tr><th>Fayl</th><th>Hajm</th><th>Yaratilgan</th><th>Joylashuv</th><th></th></tr></thead>
        <tbody>${rows.map((b) => `<tr>
          <td class="mono">${esc(b.filename)}</td>
          <td>${(b.size_bytes / 1048576).toFixed(2)} MB</td>
          <td>${fmtDateTime(b.created_at)}</td>
          <td class="mono">${esc(b.location)}</td>
          <td>${perms.can('settings:restore') ? `<button class="btn btn-ghost btn-sm text-danger"
            data-restore="${esc(b.filename)}">Tiklash</button>` : ''}</td>
        </tr>`).join('')}</tbody></table></div>`;

      area.querySelectorAll('[data-restore]').forEach((b) => {
        b.onclick = () => restoreBackup(b.dataset.restore);
      });
    } catch (err) {
      area.innerHTML = errorBlock(err.message);
    }
  }

  function restoreBackup(filename) {
    modal({
      title: 'Zaxiradan tiklash',
      body: `
        <div class="alert danger">
          <div><strong>Diqqat!</strong> Bu amal joriy ma'lumotlar bazasini
          <span class="mono">${esc(filename)}</span> nusxasi bilan almashtiradi.
          Barcha joriy o'zgarishlar yo'qoladi. Tiklashdan oldin yangi zaxira nusxa olish tavsiya etiladi.</div>
        </div>
        <div class="field">
          <label>Tasdiqlash uchun <span class="mono">RESTORE</span> deb yozing</label>
          <input id="confirm-text" autocomplete="off" placeholder="RESTORE" />
        </div>
        <div id="restore-err"></div>`,
      footer: `<button class="btn btn-secondary" data-cancel>Bekor qilish</button>
               <button class="btn btn-danger" data-ok disabled>Tiklash</button>`,
      onMount(el, close) {
        const input = el.querySelector('#confirm-text');
        const ok = el.querySelector('[data-ok]');
        input.oninput = () => { ok.disabled = input.value.trim() !== 'RESTORE'; };
        el.querySelector('[data-cancel]').onclick = close;
        ok.onclick = async () => {
          ok.disabled = true; ok.textContent = 'Tiklanmoqda…';
          try {
            const r = await api.post(
              `/backups/${encodeURIComponent(filename)}/restore?confirm=true`,
            );
            toast(r.detail || 'Tiklandi', 'success');
            close();
            loadBackups();
          } catch (err) {
            el.querySelector('#restore-err').innerHTML =
              `<div class="alert danger">${esc(err.message)}</div>`;
            ok.disabled = false; ok.textContent = 'Tiklash';
          }
        };
      },
    });
  }

  root.querySelector('#f-cat').onchange = (e) => {
    state.activeCategory = e.target.value;
    loadSettings();
  };

  const backupBtn = root.querySelector('#backup-now');
  if (backupBtn) {
    backupBtn.onclick = async () => {
      backupBtn.disabled = true; backupBtn.textContent = 'Yaratilmoqda…';
      try {
        const b = await api.post('/backups');
        toast(`Zaxira yaratildi: ${b.filename}`, 'success');
        loadBackups();
      } catch (err) {
        toast(err.message, 'error', 7000);
      } finally {
        backupBtn.disabled = false; backupBtn.textContent = '+ Zaxira nusxa yaratish';
      }
    };
  }

  await loadSettings();
  await loadBackups();
}
