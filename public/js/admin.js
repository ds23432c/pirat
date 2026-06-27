'use strict';

const TOKEN_KEY = 'piraty_admin_token';
let token = localStorage.getItem(TOKEN_KEY) || '';
let tablesData = [];
let editingTableId = null;

const $ = (id) => document.getElementById(id);
const toast = $('toast');

function showToast(msg) {
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 4000);
}

async function api(path, opts = {}) {
  opts.headers = Object.assign(
    { 'Content-Type': 'application/json', 'X-Admin-Token': token },
    opts.headers || {}
  );
  const res = await fetch(path, opts);
  if (res.status === 401) {
    logout();
    throw new Error('unauthorized');
  }
  return res;
}

// ---------- Вход ----------
async function login() {
  const pass = $('adminPass').value;
  $('loginMsg').textContent = '';
  try {
    const res = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pass }),
    });
    const data = await res.json();
    if (!res.ok) {
      $('loginMsg').textContent = data.error || 'Ошибка входа';
      return;
    }
    token = data.token;
    localStorage.setItem(TOKEN_KEY, token);
    enterApp();
  } catch (e) {
    $('loginMsg').textContent = 'Ошибка сети';
  }
}

function logout() {
  token = '';
  localStorage.removeItem(TOKEN_KEY);
  $('adminApp').style.display = 'none';
  $('loginScreen').style.display = 'block';
}

function enterApp() {
  $('loginScreen').style.display = 'none';
  $('adminApp').style.display = 'block';
  loadBookings();
  loadConcert();
  loadTables();
}

$('btnLogin').addEventListener('click', login);
$('adminPass').addEventListener('keydown', (e) => { if (e.key === 'Enter') login(); });
$('btnLogout').addEventListener('click', logout);

// ---------- Вкладки ----------
document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
    document.querySelectorAll('.panel').forEach((p) => p.classList.remove('active'));
    tab.classList.add('active');
    $('panel-' + tab.dataset.tab).classList.add('active');
  });
});

// ---------- Заявки ----------
async function loadBookings() {
  try {
    const res = await api('/api/admin/bookings');
    const data = await res.json();
    renderBookings(data.bookings || []);
  } catch (e) { /* logout */ }
}

const statusLabel = { pending: 'На подтверждении', confirmed: 'Подтверждена', cancelled: 'Отменена' };

function renderBookings(list) {
  const filter = $('bookingFilter').value;
  const tbody = $('bookingsTable').querySelector('tbody');
  tbody.innerHTML = '';
  const filtered = list.filter((b) => filter === 'all' || b.status === filter);

  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="muted" style="text-align:center;padding:20px;">Заявок пока нет</td></tr>';
    return;
  }

  for (const b of filtered) {
    const tr = document.createElement('tr');
    const d = new Date(b.created_at);
    const date = isNaN(d) ? '' : d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    tr.innerHTML = `
      <td>${date}</td>
      <td>${esc(b.last_name)} ${esc(b.first_name)}${b.note ? `<div class="note-line">📝 ${esc(b.note)}</div>` : ''}</td>
      <td><a href="tel:${esc(b.phone)}">${esc(b.phone)}</a></td>
      <td>${esc(b.label)} <span class="muted">(${b.seats}ч/${b.price}₽)</span></td>
      <td><span class="badge ${b.status}">${statusLabel[b.status]}</span></td>
      <td class="row-actions"></td>
    `;
    const cell = tr.querySelector('.row-actions');
    if (b.status !== 'confirmed') {
      cell.appendChild(actionBtn('Подтвердить', 'btn-ok', () => bookingAction(b.id, 'confirm')));
    }
    if (b.status !== 'cancelled') {
      cell.appendChild(actionBtn('Отменить', 'btn-warn', () => bookingAction(b.id, 'cancel')));
    }
    cell.appendChild(actionBtn('Удалить', 'btn-mute', () => {
      if (confirm('Удалить заявку безвозвратно?')) bookingAction(b.id, 'delete');
    }));
    tbody.appendChild(tr);
  }
}

function actionBtn(text, cls, fn) {
  const b = document.createElement('button');
  b.className = `btn btn-sm ${cls}`;
  b.textContent = text;
  b.addEventListener('click', fn);
  return b;
}

async function bookingAction(id, action) {
  try {
    await api(`/api/admin/bookings/${id}/${action}`, { method: 'POST' });
    showToast('Готово');
    loadBookings();
  } catch (e) {}
}

$('bookingFilter').addEventListener('change', loadBookings);

// ---------- Концерт ----------
async function loadConcert() {
  try {
    const res = await fetch('/api/state');
    const data = await res.json();
    const c = data.concert || {};
    $('eTitle').value = c.concert_title || '';
    $('eDate').value = c.concert_date || '';
    $('ePlace').value = c.concert_place || '';
    $('eDesc').value = c.concert_description || '';
  } catch (e) {}
}

$('btnSaveConcert').addEventListener('click', async () => {
  try {
    await api('/api/admin/concert', {
      method: 'PUT',
      body: JSON.stringify({
        concert_title: $('eTitle').value,
        concert_date: $('eDate').value,
        concert_place: $('ePlace').value,
        concert_description: $('eDesc').value,
      }),
    });
    $('concertMsg').textContent = 'Сохранено ✓';
    showToast('Информация о концерте обновлена');
    setTimeout(() => ($('concertMsg').textContent = ''), 3000);
  } catch (e) {}
});

// ---------- Столы: таблица + редактор схемы ----------
async function loadTables() {
  try {
    const res = await api('/api/admin/tables');
    const data = await res.json();
    tablesData = data.tables || [];
    renderTablesGrid();
    renderEditorHall();
  } catch (e) {}
}

function renderTablesGrid() {
  const tbody = $('tablesTable').querySelector('tbody');
  tbody.innerHTML = '';
  for (const t of tablesData) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${esc(t.label)}</td>
      <td>${t.seats}</td>
      <td>${t.price} ₽</td>
      <td>${t.shape === 'square' ? 'квадрат' : 'круг'}</td>
      <td>${t.is_active ? '✓' : '—'}</td>
      <td><button class="btn btn-sm btn-mute">Изменить</button></td>
    `;
    tr.querySelector('button').addEventListener('click', () => openTableModal(t));
    tbody.appendChild(tr);
  }
}

const editorHall = $('editorHall');

function renderEditorHall() {
  editorHall.querySelectorAll('.table').forEach((el) => el.remove());
  for (const t of tablesData) {
    const el = document.createElement('div');
    el.className = `table ${t.shape}` + (t.is_active ? '' : ' ');
    el.style.left = t.x + '%';
    el.style.top = t.y + '%';
    el.style.width = t.size + '%';
    el.style.aspectRatio = '1 / 1';
    el.style.opacity = t.is_active ? '1' : '0.4';
    el.dataset.id = t.id;
    el.innerHTML = `<span class="t-seats">${t.seats}ч</span><span class="t-price">${t.price}₽</span><span class="t-label">${esc(t.label)}</span>`;
    makeDraggable(el, t);
    editorHall.appendChild(el);
  }
}

// drag & drop по плану (в процентах)
function makeDraggable(el, t) {
  let dragging = false, moved = false;

  const onDown = (e) => {
    dragging = true; moved = false;
    el.classList.add('dragging');
    e.preventDefault();
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('touchend', onUp);
  };
  const onMove = (e) => {
    if (!dragging) return;
    e.preventDefault();
    const point = e.touches ? e.touches[0] : e;
    const rect = editorHall.getBoundingClientRect();
    let x = ((point.clientX - rect.left) / rect.width) * 100;
    let y = ((point.clientY - rect.top) / rect.height) * 100;
    x = Math.max(2, Math.min(98, x));
    y = Math.max(2, Math.min(98, y));
    el.style.left = x + '%';
    el.style.top = y + '%';
    t.x = x; t.y = y;
    moved = true;
  };
  const onUp = () => {
    dragging = false;
    el.classList.remove('dragging');
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    document.removeEventListener('touchmove', onMove);
    document.removeEventListener('touchend', onUp);
    if (!moved) openTableModal(t); // клик без перетаскивания = редактировать
  };

  el.addEventListener('mousedown', onDown);
  el.addEventListener('touchstart', onDown, { passive: false });
}

$('btnSavePositions').addEventListener('click', async () => {
  try {
    const positions = tablesData.map((t) => ({ id: t.id, x: t.x, y: t.y }));
    await api('/api/admin/tables-positions', {
      method: 'PUT',
      body: JSON.stringify({ positions }),
    });
    $('posMsg').textContent = 'Расположение сохранено ✓';
    showToast('Схема зала обновлена');
    setTimeout(() => ($('posMsg').textContent = ''), 3000);
  } catch (e) {}
});

$('btnAddTable').addEventListener('click', async () => {
  try {
    await api('/api/admin/tables', {
      method: 'POST',
      body: JSON.stringify({ label: 'Новый стол', seats: 4, price: 400, shape: 'circle', x: 50, y: 50, size: 12 }),
    });
    showToast('Стол добавлен — перетащите его на место');
    loadTables();
  } catch (e) {}
});

// ---------- Модалка редактирования стола ----------
const tableModal = $('tableModal');

function openTableModal(t) {
  editingTableId = t.id;
  $('tmLabel').value = t.label;
  $('tmSeats').value = t.seats;
  $('tmPrice').value = t.price;
  $('tmShape').value = t.shape;
  $('tmSize').value = t.size;
  $('tmActive').checked = !!t.is_active;
  tableModal.classList.add('open');
}
function closeTableModal() { tableModal.classList.remove('open'); editingTableId = null; }

$('tmCancel').addEventListener('click', closeTableModal);
tableModal.addEventListener('click', (e) => { if (e.target === tableModal) closeTableModal(); });

$('tmSave').addEventListener('click', async () => {
  const t = tablesData.find((x) => x.id === editingTableId);
  if (!t) return;
  try {
    await api(`/api/admin/tables/${editingTableId}`, {
      method: 'PUT',
      body: JSON.stringify({
        label: $('tmLabel').value,
        seats: $('tmSeats').value,
        price: $('tmPrice').value,
        shape: $('tmShape').value,
        x: t.x, y: t.y,
        size: $('tmSize').value,
        is_active: $('tmActive').checked,
      }),
    });
    closeTableModal();
    showToast('Стол обновлён');
    loadTables();
  } catch (e) {}
});

$('tmDelete').addEventListener('click', async () => {
  if (!confirm('Удалить стол? Все его брони тоже удалятся.')) return;
  try {
    await api(`/api/admin/tables/${editingTableId}`, { method: 'DELETE' });
    closeTableModal();
    showToast('Стол удалён');
    loadTables();
  } catch (e) {}
});

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------- Авто-вход, если токен сохранён ----------
if (token) {
  // проверим токен запросом
  api('/api/admin/bookings').then((res) => {
    if (res.ok) enterApp(); else logout();
  }).catch(() => logout());
}

// автообновление списка заявок
setInterval(() => { if (token && $('adminApp').style.display !== 'none') loadBookings(); }, 15000);
