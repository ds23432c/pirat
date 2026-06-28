'use strict';

const hall = document.getElementById('hall');
const modal = document.getElementById('modal');
const formMsg = document.getElementById('formMsg');
const toast = document.getElementById('toast');
const seatMap = document.getElementById('seatMap');

const fName = document.getElementById('fName');
const fLast = document.getElementById('fLast');
const fPhone = document.getElementById('fPhone');


let selectedTable = null;   // объект стола
let pickedSeats = new Set(); // выбранные индексы мест

// ---------- Загрузка состояния ----------
async function loadState() {
  try {
    const res = await fetch('/api/state');
    const data = await res.json();
    renderConcert(data.concert);
    renderTables(data.tables);
  } catch (e) {
    console.error('Не удалось загрузить данные', e);
  }
}

function renderConcert(c) {
  if (!c) return;
  document.getElementById('cTitle').textContent = c.concert_title || 'Концерт ТО «ПИРАТЫ»';
  document.getElementById('cDate').textContent = c.concert_date || 'Дата уточняется';
  document.getElementById('cPlace').textContent = c.concert_place || '';
  document.getElementById('cDesc').textContent = c.concert_description || '';
  document.title = (c.concert_title || 'ТО «ПИРАТЫ»') + ' — бронирование мест';
}

function renderTables(tables) {
  hall.querySelectorAll('.table, .seat-dot').forEach((el) => el.remove());

  for (const t of tables) {
    if (!t.is_active) continue;

    // сам стол
    const el = document.createElement('div');
    const tableState = t.free_count > 0 ? 'has-free' : 'full';
    el.className = `table ${t.shape} ${tableState}`;
    el.style.left = t.x + '%';
    el.style.top = t.y + '%';
    el.style.width = t.size + '%';
    el.style.aspectRatio = '1 / 1';
    el.dataset.id = t.id;
    el.innerHTML = `
      <span class="t-free">${t.free_count > 0 ? 'Свободно' : 'Занято'}</span>
      <span class="t-count">${t.free_count}/${t.seats_total}</span>
      <span class="t-price">${t.price}₽/место</span>
    `;
    if (t.free_count > 0) {
      el.tabIndex = 0;
      el.setAttribute('role', 'button');
      el.setAttribute('aria-label', `${t.label}: свободно ${t.free_count} из ${t.seats_total} мест, ${t.price} рублей за место`);
      el.addEventListener('click', () => openModal(t));
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openModal(t); }
      });
    } else {
      el.title = 'Все места заняты';
    }
    hall.appendChild(el);
  }
}

// ---------- Модальное окно с выбором мест ----------
function openModal(table) {
  selectedTable = table;
  pickedSeats = new Set();
  document.getElementById('mTableInfo').textContent =
    `${table.label} · ${table.price} ₽ за место · свободно ${table.free_count} из ${table.seats_total}`;
  formMsg.textContent = '';
  formMsg.className = 'form-msg';
  fName.value = '';
  fLast.value = '';
  fPhone.value = '+7 ';
  document.getElementById('fNote').value = '';
  buildSeatMap(table);
  updateSummary();
  modal.classList.add('open');
  setTimeout(() => fName.focus(), 50);
}

function closeModal() {
  modal.classList.remove('open');
  selectedTable = null;
  pickedSeats.clear();
}

// карта мест внутри модалки (кольцо мест вокруг названия стола)
function buildSeatMap(table) {
  seatMap.innerHTML = '';
  const n = table.seats_total;
  const box = document.createElement('div');
  box.className = 'seatmap-ring';
  // центр
  const center = document.createElement('div');
  center.className = 'seatmap-center ' + table.shape;
  center.textContent = table.label;
  box.appendChild(center);

  const R = 42; // % от размера контейнера
  for (let i = 0; i < n; i++) {
    const a = (-90 + i * (360 / n)) * (Math.PI / 180);
    const x = 50 + R * Math.cos(a);
    const y = 50 + R * Math.sin(a);
    const seat = document.createElement('button');
    seat.type = 'button';
    const st = table.seats[i];
    seat.className = 'seat ' + st;
    seat.style.left = x + '%';
    seat.style.top = y + '%';
    seat.textContent = i + 1;
    if (st === 'free') {
      seat.addEventListener('click', () => toggleSeat(i, seat));
    } else {
      seat.disabled = true;
      seat.title = st === 'pending' ? 'Место на брони' : 'Место занято';
    }
    box.appendChild(seat);
  }
  seatMap.appendChild(box);
}

function toggleSeat(i, el) {
  if (pickedSeats.has(i)) { pickedSeats.delete(i); el.classList.remove('picked'); }
  else { pickedSeats.add(i); el.classList.add('picked'); }
  updateSummary();
}

function updateSummary() {
  const count = pickedSeats.size;
  const total = count * (selectedTable ? selectedTable.price : 0);
  document.getElementById('sumCount').textContent = count;
  document.getElementById('sumTotal').textContent = total + ' ₽';
}

document.getElementById('btnCancel').addEventListener('click', closeModal);
modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

// ---------- Маска телефона +7 ----------
fPhone.addEventListener('input', () => {
  let digits = fPhone.value.replace(/\D/g, '');
  if (digits) {
    if (digits[0] === '8') digits = '7' + digits.slice(1);
    if (digits[0] !== '7') digits = '7' + digits;
    digits = digits.slice(0, 11);
  }
  let out = '';
  if (digits) {
    const r = digits.slice(1);
    out = '+7';
    if (r.length >= 1) out += ' (' + r.slice(0, 3);
    if (r.length >= 4) out += ') ' + r.slice(3, 6);
    if (r.length >= 7) out += '-' + r.slice(6, 8);
    if (r.length >= 9) out += '-' + r.slice(8, 10);
  }
  fPhone.value = out;
  const r = digits.slice(1);
  fPhone.classList.toggle('invalid', r.length > 0 && r.length < 10);
});

function getPhoneDigits() { return fPhone.value.replace(/\D/g, ''); }

// ---------- Отправка ----------
document.getElementById('btnSubmit').addEventListener('click', submitBooking);

async function submitBooking() {
  if (!selectedTable) return;
  if (pickedSeats.size === 0) return showFormError('Выберите хотя бы одно место');

  const first = fName.value.trim();
  const last = fLast.value.trim();
  const digits = getPhoneDigits();

  if (!first || !last) return showFormError('Укажите имя и фамилию');
  if (digits.length !== 11 || digits[0] !== '7') {
    fPhone.classList.add('invalid');
    return showFormError('Введите корректный номер: +7 (XXX) XXX-XX-XX');
  }

  const btn = document.getElementById('btnSubmit');
  btn.disabled = true;
  btn.textContent = 'Отправляем…';
  try {
    const res = await fetch('/api/book', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        table_id: selectedTable.id,
        seats: [...pickedSeats],
        first_name: first,
        last_name: last,
        phone: '+' + digits,
        note: document.getElementById('fNote').value.trim(),
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      showFormError(data.error || 'Не удалось забронировать');
      await loadState(); // обновим занятость, если кто-то успел занять
      if (selectedTable) {
        const fresh = (await (await fetch('/api/state')).json()).tables.find((t) => t.id === selectedTable.id);
        if (fresh) { selectedTable = fresh; pickedSeats.clear(); buildSeatMap(fresh); updateSummary(); }
      }
    } else {
      closeModal();
      showToast(data.message || 'Заявка отправлена!');
      await loadState();
    }
  } catch (e) {
    showFormError('Ошибка сети. Попробуйте ещё раз.');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Забронировать';
  }
}

function showFormError(msg) {
  formMsg.textContent = msg;
  formMsg.className = 'form-msg err';
}
function showToast(msg) {
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 6000);
}

// ---------- Старт + автообновление ----------
loadState();
setInterval(() => { if (!modal.classList.contains('open')) loadState(); }, 12000);
