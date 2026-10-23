/* Login page controller (external file so the strict CSP can forbid inline JS). */
import { api, auth } from './api.js';
import { esc } from './ui.js';

const params = new URLSearchParams(location.search);
if (params.get('expired')) {
  document.getElementById('login-alert').innerHTML =
    `<div class="alert warn">Sessiya muddati tugagan. Qayta kiring.</div>`;
}
if (auth.isLoggedIn) {
  // Verify the stored token, then redirect.
  api.get('/auth/me').then(() => location.replace('index.html')).catch(() => auth.clear());
}

document.getElementById('toggle-pass').onclick = (e) => {
  const p = document.getElementById('password');
  const show = p.type === 'password';
  p.type = show ? 'text' : 'password';
  e.currentTarget.textContent = show ? '🙈' : '👁';
  e.currentTarget.setAttribute('aria-label', show ? "Parolni yashirish" : "Parolni ko'rsatish");
};

const form = document.getElementById('login-form');
const btn = document.getElementById('submit-btn');
const alertBox = document.getElementById('login-alert');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  alertBox.innerHTML = '';
  const username = form.username.value.trim();
  const password = form.password.value;
  if (!username || !password) {
    alertBox.innerHTML = `<div class="alert danger">Login va parolni kiriting.</div>`;
    return;
  }
  btn.disabled = true;
  btn.textContent = 'Tekshirilmoqda…';
  try {
    const tokens = await api.post('/auth/login', { username, password });
    auth.set(tokens);
    location.replace('index.html');
  } catch (err) {
    let msg = err.message || 'Kirish amalga oshmadi';
    if (err.status === 423) msg = "Hisob vaqtincha bloklangan. 15 daqiqadan keyin urinib ko'ring.";
    alertBox.innerHTML = `<div class="alert danger">${esc(msg)}</div>`;
    form.password.value = '';
    form.password.focus();
  } finally {
    btn.disabled = false;
    btn.textContent = 'Kirish';
  }
});
