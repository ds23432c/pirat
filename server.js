'use strict';

require('dotenv').config();
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const mysql = require('mysql2/promise');

const app = express();
const PORT = process.env.PORT || 3000;

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'piraty2019';
const ADMIN_TOKEN = crypto
  .createHash('sha256')
  .update('piraty-salt::' + ADMIN_PASSWORD)
  .digest('hex');

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---------------------------------------------------------------------------
//  MySQL
// ---------------------------------------------------------------------------
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
  enableKeepAlive: false,
  idleTimeout: 60000,
  maxIdle: 1,
  charset: 'utf8mb4',
});

// ---------------------------------------------------------------------------
//  Стартовая расстановка столов.
//  ВАЖНО: price теперь — цена ЗА ОДНО МЕСТО, seats — количество мест у стола.
// ---------------------------------------------------------------------------
const SEED_TABLES = [
  // label,    seats, price(за место), shape,   x,    y,    size
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

async function columnExists(table, column) {
  const [r] = await pool.query(
    `SELECT COUNT(*) AS c FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?`,
    [table, column]
  );
  return r[0].c > 0;
}

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

  // Бронь (заявка). Места хранятся в booking_seats.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS bookings (
      id INT PRIMARY KEY AUTO_INCREMENT,
      first_name VARCHAR(100) NOT NULL,
      last_name  VARCHAR(100) NOT NULL,
      phone      VARCHAR(20)  NOT NULL,
      note       VARCHAR(500) NULL,
      total_price INT NOT NULL DEFAULT 0,
      status ENUM('pending','confirmed','cancelled') NOT NULL DEFAULT 'pending',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_status (status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  // Миграции для уже существующей базы (с прошлой версии)
  if (!(await columnExists('bookings', 'note'))) {
    await pool.query(`ALTER TABLE bookings ADD COLUMN note VARCHAR(500) NULL`);
  }
  if (!(await columnExists('bookings', 'total_price'))) {
    await pool.query(`ALTER TABLE bookings ADD COLUMN total_price INT NOT NULL DEFAULT 0`);
  }
  // старое поле table_id больше не обязательно
  if (await columnExists('bookings', 'table_id')) {
    try { await pool.query(`ALTER TABLE bookings MODIFY table_id INT NULL`); } catch (e) {}
  }

  // Места брони
  await pool.query(`
    CREATE TABLE IF NOT EXISTS booking_seats (
      id INT PRIMARY KEY AUTO_INCREMENT,
      booking_id INT NOT NULL,
      table_id INT NOT NULL,
      seat_index INT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_bs_booking (booking_id),
      INDEX idx_bs_seat (table_id, seat_index),
      FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE,
      FOREIGN KEY (table_id) REFERENCES tables_layout(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  const [s] = await pool.query('SELECT COUNT(*) AS c FROM settings');
  if (s[0].c === 0) {
    await pool.query(
      `INSERT INTO settings (id, concert_title, concert_date, concert_place, concert_description)
       VALUES (1, ?, ?, ?, ?)`,
      [
        'Концерт ТО «ПИРАТЫ»',
        'Дата уточняется',
        'г. Курск',
        'Мы плохому не научим! Большой сольный концерт команды КВН «Пираты». Бронируйте места заранее — их немного.',
      ]
    );
  }

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

// ---------------------------------------------------------------------------
//  Хелперы
// ---------------------------------------------------------------------------
function normalizePhone(raw) {
  if (!raw) return null;
  let digits = String(raw).replace(/\D/g, '');
  if (digits.length === 11 && (digits[0] === '8' || digits[0] === '7')) {
    digits = '7' + digits.slice(1);
  }
  if (digits.length === 10) digits = '7' + digits;
  if (digits.length !== 11 || digits[0] !== '7') return null;
  return '+' + digits;
}

function requireAdmin(req, res, next) {
  const token = req.headers['x-admin-token'];
  if (token !== ADMIN_TOKEN) {
    return res.status(401).json({ error: 'Требуется авторизация администратора' });
  }
  next();
}

// Карта занятых мест: { table_id: { seat_index: 'pending'|'confirmed' } }
async function getSeatStatusMap() {
  const [rows] = await pool.query(
    `SELECT bs.table_id, bs.seat_index, b.status
       FROM booking_seats bs
       JOIN bookings b ON b.id = bs.booking_id
      WHERE b.status IN ('pending','confirmed')`
  );
  const map = {};
  for (const r of rows) {
    if (!map[r.table_id]) map[r.table_id] = {};
    // confirmed важнее pending
    if (r.status === 'confirmed' || !map[r.table_id][r.seat_index]) {
      map[r.table_id][r.seat_index] = r.status;
    }
  }
  return map;
}

async function getTablesState() {
  const [tables] = await pool.query('SELECT * FROM tables_layout ORDER BY sort_order, id');
  const map = await getSeatStatusMap();
  return tables.map((t) => {
    const seatMap = map[t.id] || {};
    const seats = [];
    let free = 0;
    for (let i = 0; i < t.seats; i++) {
      const st = t.is_active ? seatMap[i] || 'free' : 'disabled';
      if (st === 'free') free++;
      seats.push(st);
    }
    return {
      id: t.id,
      label: t.label,
      seats_total: t.seats,
      price: t.price, // за одно место
      shape: t.shape,
      x: t.pos_x,
      y: t.pos_y,
      size: t.size,
      is_active: !!t.is_active,
      seats, // массив статусов по местам
      free_count: t.is_active ? free : 0,
    };
  });
}

// ---------------------------------------------------------------------------
//  ПУБЛИЧНЫЙ API
// ---------------------------------------------------------------------------
app.get('/api/health', (req, res) => res.json({ ok: true }));

app.get('/api/state', async (req, res) => {
  try {
    const [[concert]] = await pool.query('SELECT * FROM settings WHERE id = 1');
    const tables = await getTablesState();
    res.json({ concert, tables });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

app.post('/api/book', async (req, res) => {
  let conn;
  try {
    const { table_id, seats, first_name, last_name, phone, note } = req.body || {};
    const fn = String(first_name || '').trim().slice(0, 100);
    const ln = String(last_name || '').trim().slice(0, 100);
    const noteText = note ? String(note).trim().slice(0, 500) : null;
    const normPhone = normalizePhone(phone);

    if (!table_id || !Array.isArray(seats) || seats.length === 0) {
      return res.status(400).json({ error: 'Выберите хотя бы одно место' });
    }
    if (!fn || !ln) return res.status(400).json({ error: 'Укажите имя и фамилию' });
    if (!normPhone) {
      return res.status(400).json({ error: 'Неверный номер. Формат: +7 (XXX) XXX-XX-XX' });
    }

    // уникальные целые индексы
    const wantSeats = [...new Set(seats.map((n) => parseInt(n, 10)))].filter((n) => Number.isInteger(n) && n >= 0);
    if (wantSeats.length === 0) return res.status(400).json({ error: 'Некорректные места' });

    conn = await pool.getConnection();
    await conn.beginTransaction();

    const [[table]] = await conn.query(
      'SELECT * FROM tables_layout WHERE id = ? AND is_active = 1 FOR UPDATE',
      [table_id]
    );
    if (!table) {
      await conn.rollback();
      return res.status(404).json({ error: 'Стол недоступен' });
    }
    if (wantSeats.some((i) => i >= table.seats)) {
      await conn.rollback();
      return res.status(400).json({ error: 'Такого места нет за этим столом' });
    }

    // проверка занятости
    const [busy] = await conn.query(
      `SELECT bs.seat_index FROM booking_seats bs
         JOIN bookings b ON b.id = bs.booking_id
        WHERE bs.table_id = ? AND b.status IN ('pending','confirmed')
          AND bs.seat_index IN (?)`,
      [table_id, wantSeats]
    );
    if (busy.length > 0) {
      await conn.rollback();
      return res.status(409).json({ error: 'Некоторые места уже заняты. Обновите страницу.' });
    }

    const total = wantSeats.length * table.price;

    const [r] = await conn.query(
      `INSERT INTO bookings (first_name, last_name, phone, note, total_price, status)
       VALUES (?, ?, ?, ?, ?, 'pending')`,
      [fn, ln, normPhone, noteText, total]
    );
    const bookingId = r.insertId;

    const values = wantSeats.map((i) => [bookingId, table_id, i]);
    await conn.query(
      `INSERT INTO booking_seats (booking_id, table_id, seat_index) VALUES ?`,
      [values]
    );

    await conn.commit();
    res.json({
      ok: true,
      total,
      message: `Заявка отправлена! Забронировано мест: ${wantSeats.length} на сумму ${total} ₽. Ожидайте подтверждения администратора.`,
    });
  } catch (e) {
    if (conn) { try { await conn.rollback(); } catch (_) {} }
    console.error(e);
    res.status(500).json({ error: 'Ошибка сервера' });
  } finally {
    if (conn) conn.release();
  }
});

// ---------------------------------------------------------------------------
//  АДМИН API
// ---------------------------------------------------------------------------
app.post('/api/admin/login', (req, res) => {
  const { password } = req.body || {};
  if (password === ADMIN_PASSWORD) return res.json({ ok: true, token: ADMIN_TOKEN });
  res.status(401).json({ error: 'Неверный пароль' });
});

app.get('/api/admin/bookings', requireAdmin, async (req, res) => {
  try {
    const [bookings] = await pool.query(
      `SELECT id, first_name, last_name, phone, note, total_price, status, created_at
         FROM bookings ORDER BY created_at DESC`
    );
    if (bookings.length) {
      const ids = bookings.map((b) => b.id);
      const [seats] = await pool.query(
        `SELECT bs.booking_id, bs.table_id, bs.seat_index, t.label
           FROM booking_seats bs JOIN tables_layout t ON t.id = bs.table_id
          WHERE bs.booking_id IN (?)
          ORDER BY t.label, bs.seat_index`,
        [ids]
      );
      const byBooking = {};
      for (const s of seats) {
        (byBooking[s.booking_id] = byBooking[s.booking_id] || []).push(s);
      }
      for (const b of bookings) b.seats = byBooking[b.id] || [];
    }
    res.json({ bookings });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

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

app.get('/api/admin/tables', requireAdmin, async (req, res) => {
  try {
    const tables = await getTablesState();
    res.json({ tables });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

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

app.put('/api/admin/tables-positions', requireAdmin, async (req, res) => {
  try {
    const { positions } = req.body || {};
    if (!Array.isArray(positions)) return res.status(400).json({ error: 'Нет данных' });
    for (const p of positions) {
      await pool.query('UPDATE tables_layout SET pos_x=?, pos_y=? WHERE id=?', [
        Number(p.x), Number(p.y), p.id,
      ]);
    }
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

app.delete('/api/admin/tables/:id', requireAdmin, async (req, res) => {
  try {
    await pool.query('DELETE FROM tables_layout WHERE id=?', [req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

initDb()
  .then(() => app.listen(PORT, () => console.log(`ПИРАТЫ booking запущен на :${PORT}`)))
  .catch((err) => {
    console.error('Не удалось инициализировать БД:', err);
    app.listen(PORT, () => console.log(`Запущен без БД на :${PORT}`));
  });
