'use strict';

const hall = document.getElementById('hall');
const modal = document.getElementById('modal');
const formMsg = document.getElementById('formMsg');
const toast = document.getElementById('toast');

const fName = document.getElementById('fName');
const fLast = document.getElementById('fLast');
const fPhone = document.getElementById('fPhone');

let selectedTable = null;
let tablesCache = [];

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
  document.title = (c.concert_title || 'ТО «ПИРАТЫ»') + ' — бронирование столов';
}

function renderTables(tables) {
  tablesCache = tables;
  // удаляем старые столы (декор оставляем)
  hall.querySelectorAll('.table').forEach((el) => el.remove());

  for (const t of tables) {
    if (t.status === 'disabled') continue;
    const el = document.createElement('div');
    el.className = `table ${t.shape} ${t.status}`;
    el.style.left = t.x + '%';
    el.style.top = t.y + '%';
    el.style.width = t.size + '%';
    // высота квадрата = ширине; круг тоже квадратный бокс
    el.style.aspectRatio = '1 / 1';
    el.dataset.id = t.id;

    el.innerHTML = `
      <span class="t-seats">${t.seats} чел.</span>
      <span class="t-price">${t.price}₽</span>
      <span class="t-label">${escapeHtml(t.label)}</span>
    `;

    if (t.status === 'free') {
      el.tabIndex = 0;
      el.setAttribute('role', 'button');
      el.setAttribute('aria-label', `${t.label}, ${t.seats} человек, ${t.price} рублей — забронировать`);
      el.addEventListener('click', () => openModal(t));
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openModal(t); }
      });
    } else {
      el.title = t.status === 'pending' ? 'Бронь на подтверждении' : 'Стол уже забронирован';
    }
    hall.appendChild(el);
  }
}

// ---------- Модальное окно ----------
function openModal(table) {
  selectedTable = table;
  document.getElementById('mTableInfo').textContent =
    `${table.label} · до ${table.seats} человек · ${table.price} ₽`;
  formMsg.textContent = '';
  formMsg.className = 'form-msg';
  fName.value = '';
  fLast.value = '';
  fPhone.value = '+7 ';
  document.getElementById('fNote').value = '';
  modal.classList.add('open');
  setTimeout(() => fName.focus(), 50);
}

function closeModal() {
  modal.classList.remove('open');
  selectedTable = null;
}

document.getElementById('btnCancel').addEventListener('click', closeModal);
modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

// ---------- Маска и проверка телефона +7 ----------
// Разделители ") " и "-" дописываются только когда за ними реально есть
// цифры. Иначе при удалении они тут же добавлялись обратно и «блокировали»
// стирание у чёрточек.
fPhone.addEventListener('input', () => {
  let digits = fPhone.value.replace(/\D/g, '');
  if (digits) {
    if (digits[0] === '8') digits = '7' + digits.slice(1);
    if (digits[0] !== '7') digits = '7' + digits;
    digits = digits.slice(0, 11); // 7 + 10 цифр
  }

  let out = '';
  if (digits) {
    const r = digits.slice(1); // до 10 цифр номера
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

function getPhoneDigits() {
  return fPhone.value.replace(/\D/g, '');
}

// ---------- Отправка брони ----------
document.getElementById('btnSubmit').addEventListener('click', submitBooking);

async function submitBooking() {
  if (!selectedTable) return;
  const first = fName.value.trim();
  const last = fLast.value.trim();
  const digits = getPhoneDigits(); // должно быть 7XXXXXXXXXX

  if (!first || !last) {
    return showFormError('Укажите имя и фамилию');
  }
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
        first_name: first,
        last_name: last,
        phone: '+' + digits,
        note: document.getElementById('fNote').value.trim(),
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      showFormError(data.error || 'Не удалось забронировать');
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
  setTimeout(() => toast.classList.remove('show'), 5000);
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

// ---------- Старт + автообновление статусов ----------
loadState();
setInterval(loadState, 12000); // подтянет «серый»→«красный», когда админ подтвердит
