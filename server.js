'use strict';

require('dotenv').config();
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const mysql = require('mysql2/promise');

const app = express();
const PORT = process.env.PORT || 3000;

// ----------------------------------------------------------------------------
//  Пароль администратора. Токен стабилен между перезапусками (важно, т.к. на
//  Railway приложение «засыпает» и перезапускается — токен не должен слетать).
// ----------------------------------------------------------------------------
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'piraty2019';
const ADMIN_TOKEN = crypto
  .createHash('sha256')
  .update('piraty-salt::' + ADMIN_PASSWORD)
  .digest('hex');

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ----------------------------------------------------------------------------
//  Подключение к MySQL. Поддерживаются и MYSQL_URL (Railway), и отдельные
//  переменные окружения.
// ----------------------------------------------------------------------------
function buildDbConfig() {
  const url = process.env.MYSQL_URL || process.env.DATABASE_URL;
  if (url) {
    const u = new URL(url);
    return {
      host: u.hostname,
      port: u.port ? Number(u.port) : 3306,
      user: decodeURIComponent(u.username),
      password: decodeURIComponent(u.password),
      database: u.pathname.replace(/^\//, ''),
    };
  }
  return {
    host: process.env.MYSQLHOST || process.env.DB_HOST || 'localhost',
    port: Number(process.env.MYSQLPORT || process.env.DB_PORT || 3306),
    user: process.env.MYSQLUSER || process.env.DB_USER || 'root',
    password: process.env.MYSQLPASSWORD || process.env.DB_PASSWORD || '',
    database: process.env.MYSQLDATABASE || process.env.DB_NAME || 'piraty',
  };
}

const pool = mysql.createPool({
  ...buildDbConfig(),
  waitForConnections: true,
  connectionLimit: 5,
  queueLimit: 0,
  // ВАЖНО для Railway Serverless: НЕ держим соединения «живыми» — иначе
  // постоянный исходящий трафик к БД не даст сервису уснуть. Закрываем
  // простаивающие соединения, чтобы при отсутствии посетителей трафик пропал
  // и Railway усыпил приложение.
  enableKeepAlive: false,
  idleTimeout: 60000, // закрыть простаивающее соединение через 60 c
  maxIdle: 1,
  charset: 'utf8mb4',
});

// ----------------------------------------------------------------------------
//  Стартовые столы — расставлены точь-в-точь по схеме зала (координаты в %
//  от ширины/высоты плана; x;y — это центр стола).
// ----------------------------------------------------------------------------
const SEED_TABLES = [
  // label,        seats, price, shape,    x,    y,    size
  ['Стол 1',  3, 500, 'circle', 21.6, 8.7,  12.0],
  ['Стол 2',  3, 400, 'circle', 7.3,  15.0, 12.0],
  ['Стол 3',  3, 500, 'circle', 28.7, 18.7, 12.0],
  ['Стол 4',  5, 400, 'circle', 15.8, 26.8, 12.5],
  ['Стол 5',  3, 500, 'circle', 51.2, 27.5, 12.0],
  ['Стол 6',  5, 400, 'square', 44.9, 42.3, 11.5],
  ['Стол 7',  5, 400, 'square', 58.0, 42.3, 11.5],
  ['Стол 8',  5, 400, 'square', 50.7, 54.6, 11.5],
  ['Стол 9',  5, 400, 'square', 40.5, 65.8, 11.5],
  ['Стол 10', 5, 400, 'square', 62.0, 65.8, 11.5],
  ['Стол 11', 6, 400, 'circle', 43.6, 79.9, 13.5],
  ['Стол 12', 6, 400, 'circle', 58.2, 79.9, 13.5],
  ['Стол 13', 6, 400, 'circle', 52.3, 90.9, 13.5],
];

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS settings (
      id INT PRIMARY KEY,
      concert_title VARCHAR(255),
      concert_date  VARCHAR(255),
      concert_place VARCHAR(255),
      concert_description TEXT,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS tables_layout (
      id INT PRIMARY KEY AUTO_INCREMENT,
      label VARCHAR(80) NOT NULL,
      seats INT NOT NULL DEFAULT 4,
      price INT NOT NULL DEFAULT 0,
      shape ENUM('circle','square') NOT NULL DEFAULT 'circle',
      pos_x FLOAT NOT NULL DEFAULT 50,
      pos_y FLOAT NOT NULL DEFAULT 50,
      size  FLOAT NOT NULL DEFAULT 12,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      sort_order INT NOT NULL DEFAULT 0
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS bookings (
      id INT PRIMARY KEY AUTO_INCREMENT,
      table_id INT NOT NULL,
      first_name VARCHAR(100) NOT NULL,
      last_name  VARCHAR(100) NOT NULL,
      phone      VARCHAR(20)  NOT NULL,
      note       VARCHAR(500) NULL,
      status ENUM('pending','confirmed','cancelled') NOT NULL DEFAULT 'pending',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_table (table_id),
      INDEX idx_status (status),
      FOREIGN KEY (table_id) REFERENCES tables_layout(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  // Миграция: добавить колонку note для уже существующих баз
  // (MySQL 8 не поддерживает ADD COLUMN IF NOT EXISTS, поэтому проверяем вручную)
  const [noteCol] = await pool.query(
    `SELECT COUNT(*) AS c FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = 'bookings' AND column_name = 'note'`
  );
  if (noteCol[0].c === 0) {
    await pool.query(`ALTER TABLE bookings ADD COLUMN note VARCHAR(500) NULL AFTER phone`);
  }

  // Дефолтная информация о концерте
  const [s] = await pool.query('SELECT COUNT(*) AS c FROM settings');
  if (s[0].c === 0) {
    await pool.query(
      `INSERT INTO settings (id, concert_title, concert_date, concert_place, concert_description)
       VALUES (1, ?, ?, ?, ?)`,
      [
        'Концерт ТО «ПИРАТЫ»',
        'Дата уточняется',
        'г. Курск',
        'Мы плохому не научим! Большой сольный концерт команды КВН «Пираты». Бронируйте столики заранее — мест немного.',
      ]
    );
  }

  // Стартовая расстановка столов
  const [t] = await pool.query('SELECT COUNT(*) AS c FROM tables_layout');
  if (t[0].c === 0) {
    let order = 0;
    for (const row of SEED_TABLES) {
      await pool.query(
        `INSERT INTO tables_layout (label, seats, price, shape, pos_x, pos_y, size, is_active, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`,
        [...row, order++]
      );
    }
  }
}

// ----------------------------------------------------------------------------
//  Хелперы
// ----------------------------------------------------------------------------
function normalizePhone(raw) {
  if (!raw) return null;
  let digits = String(raw).replace(/\D/g, '');
  if (digits.length === 11 && (digits[0] === '8' || digits[0] === '7')) {
    digits = '7' + digits.slice(1);
  }
  if (digits.length === 10) digits = '7' + digits; // ввели без кода страны
  if (digits.length !== 11 || digits[0] !== '7') return null;
  return '+' + digits; // +7XXXXXXXXXX
}

function requireAdmin(req, res, next) {
  const token = req.headers['x-admin-token'];
  if (token !== ADMIN_TOKEN) {
    return res.status(401).json({ error: 'Требуется авторизация администратора' });
  }
  next();
}

// Статус стола = активная бронь (confirmed важнее pending)
async function getTablesWithStatus() {
  const [tables] = await pool.query(
    'SELECT * FROM tables_layout ORDER BY sort_order, id'
  );
  const [active] = await pool.query(
    `SELECT table_id, status FROM bookings WHERE status IN ('pending','confirmed')`
  );
  const map = {};
  for (const b of active) {
    if (b.status === 'confirmed') map[b.table_id] = 'confirmed';
    else if (!map[b.table_id]) map[b.table_id] = 'pending';
  }
  return tables.map((t) => ({
    id: t.id,
    label: t.label,
    seats: t.seats,
    price: t.price,
    shape: t.shape,
    x: t.pos_x,
    y: t.pos_y,
    size: t.size,
    is_active: !!t.is_active,
    status: t.is_active ? map[t.id] || 'free' : 'disabled',
  }));
}

// ----------------------------------------------------------------------------
//  ПУБЛИЧНЫЙ API
// ----------------------------------------------------------------------------
app.get('/api/health', (req, res) => res.json({ ok: true }));

app.get('/api/state', async (req, res) => {
  try {
    const [[concert]] = await pool.query('SELECT * FROM settings WHERE id = 1');
    const tables = await getTablesWithStatus();
    res.json({ concert, tables });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

app.post('/api/book', async (req, res) => {
  try {
    const { table_id, first_name, last_name, phone, note } = req.body || {};
    if (!table_id || !first_name || !last_name || !phone) {
      return res.status(400).json({ error: 'Заполните все поля' });
    }
    const fn = String(first_name).trim().slice(0, 100);
    const ln = String(last_name).trim().slice(0, 100);
    const noteText = note ? String(note).trim().slice(0, 500) : null;
    const normPhone = normalizePhone(phone);
    if (!fn || !ln) return res.status(400).json({ error: 'Укажите имя и фамилию' });
    if (!normPhone) {
      return res.status(400).json({ error: 'Неверный номер. Формат: +7 (XXX) XXX-XX-XX' });
    }

    const [[table]] = await pool.query(
      'SELECT * FROM tables_layout WHERE id = ? AND is_active = 1',
      [table_id]
    );
    if (!table) return res.status(404).json({ error: 'Стол недоступен' });

    const [[busy]] = await pool.query(
      `SELECT COUNT(*) AS c FROM bookings
       WHERE table_id = ? AND status IN ('pending','confirmed')`,
      [table_id]
    );
    if (busy.c > 0) {
      return res.status(409).json({ error: 'Этот стол уже занят. Обновите страницу.' });
    }

    await pool.query(
      `INSERT INTO bookings (table_id, first_name, last_name, phone, note, status)
       VALUES (?, ?, ?, ?, ?, 'pending')`,
      [table_id, fn, ln, normPhone, noteText]
    );

    res.json({ ok: true, message: 'Заявка отправлена! Стол зарезервирован, ожидайте подтверждения администратора.' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// ----------------------------------------------------------------------------
//  АДМИН API
// ----------------------------------------------------------------------------
app.post('/api/admin/login', (req, res) => {
  const { password } = req.body || {};
  if (password === ADMIN_PASSWORD) {
    return res.json({ ok: true, token: ADMIN_TOKEN });
  }
  res.status(401).json({ error: 'Неверный пароль' });
});

// Все заявки
app.get('/api/admin/bookings', requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT b.id, b.table_id, b.first_name, b.last_name, b.phone, b.note, b.status,
              b.created_at, t.label, t.seats, t.price
         FROM bookings b
         JOIN tables_layout t ON t.id = b.table_id
        ORDER BY b.created_at DESC`
    );
    res.json({ bookings: rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Подтвердить / отменить / удалить заявку
app.post('/api/admin/bookings/:id/:action', requireAdmin, async (req, res) => {
  try {
    const { id, action } = req.params;
    if (action === 'confirm') {
      await pool.query(`UPDATE bookings SET status='confirmed' WHERE id=?`, [id]);
    } else if (action === 'cancel') {
      await pool.query(`UPDATE bookings SET status='cancelled' WHERE id=?`, [id]);
    } else if (action === 'delete') {
      await pool.query(`DELETE FROM bookings WHERE id=?`, [id]);
    } else {
      return res.status(400).json({ error: 'Неизвестное действие' });
    }
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Информация о концерте
app.put('/api/admin/concert', requireAdmin, async (req, res) => {
  try {
    const { concert_title, concert_date, concert_place, concert_description } = req.body || {};
    await pool.query(
      `UPDATE settings SET concert_title=?, concert_date=?, concert_place=?, concert_description=? WHERE id=1`,
      [concert_title || '', concert_date || '', concert_place || '', concert_description || '']
    );
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Список столов (для редактора схемы)
app.get('/api/admin/tables', requireAdmin, async (req, res) => {
  try {
    const tables = await getTablesWithStatus();
    res.json({ tables });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Создать стол
app.post('/api/admin/tables', requireAdmin, async (req, res) => {
  try {
    const { label, seats, price, shape, x, y, size } = req.body || {};
    const [r] = await pool.query(
      `INSERT INTO tables_layout (label, seats, price, shape, pos_x, pos_y, size, is_active, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`,
      [
        label || 'Новый стол',
        Number(seats) || 4,
        Number(price) || 0,
        shape === 'square' ? 'square' : 'circle',
        Number(x) || 50,
        Number(y) || 50,
        Number(size) || 12,
        Date.now() % 100000,
      ]
    );
    res.json({ ok: true, id: r.insertId });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Обновить стол
app.put('/api/admin/tables/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { label, seats, price, shape, x, y, size, is_active } = req.body || {};
    await pool.query(
      `UPDATE tables_layout
          SET label=?, seats=?, price=?, shape=?, pos_x=?, pos_y=?, size=?, is_active=?
        WHERE id=?`,
      [
        label,
        Number(seats) || 1,
        Number(price) || 0,
        shape === 'square' ? 'square' : 'circle',
        Number(x),
        Number(y),
        Number(size),
        is_active ? 1 : 0,
        id,
      ]
    );
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Массовое сохранение позиций (drag&drop в редакторе)
app.put('/api/admin/tables-positions', requireAdmin, async (req, res) => {
  try {
    const { positions } = req.body || {};
    if (!Array.isArray(positions)) return res.status(400).json({ error: 'Нет данных' });
    for (const p of positions) {
      await pool.query('UPDATE tables_layout SET pos_x=?, pos_y=? WHERE id=?', [
        Number(p.x),
        Number(p.y),
        p.id,
      ]);
    }
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Удалить стол
app.delete('/api/admin/tables/:id', requireAdmin, async (req, res) => {
  try {
    await pool.query('DELETE FROM tables_layout WHERE id=?', [req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// ----------------------------------------------------------------------------
//  Старт
// ----------------------------------------------------------------------------
initDb()
  .then(() => {
    app.listen(PORT, () => console.log(`ПИРАТЫ booking запущен на :${PORT}`));
  })
  .catch((err) => {
    console.error('Не удалось инициализировать БД:', err);
    // Поднимаем сервер всё равно, чтобы отдать health и не падать в цикл
    app.listen(PORT, () => console.log(`Запущен без БД на :${PORT}`));
  });
