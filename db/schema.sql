-- Схема БД создаётся приложением автоматически при первом запуске.
-- Бронирование теперь поместное: бронируются отдельные места (booking_seats),
-- price у стола — цена ЗА ОДНО МЕСТО.

CREATE TABLE IF NOT EXISTS settings (
  id INT PRIMARY KEY,
  concert_title VARCHAR(255),
  concert_date  VARCHAR(255),
  concert_place VARCHAR(255),
  concert_description TEXT,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS tables_layout (
  id INT PRIMARY KEY AUTO_INCREMENT,
  label VARCHAR(80) NOT NULL,
  seats INT NOT NULL DEFAULT 4,          -- количество мест у стола
  price INT NOT NULL DEFAULT 0,          -- цена за ОДНО место
  shape ENUM('circle','square') NOT NULL DEFAULT 'circle',
  pos_x FLOAT NOT NULL DEFAULT 50,
  pos_y FLOAT NOT NULL DEFAULT 50,
  size  FLOAT NOT NULL DEFAULT 12,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  sort_order INT NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

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

CREATE TABLE IF NOT EXISTS booking_seats (
  id INT PRIMARY KEY AUTO_INCREMENT,
  booking_id INT NOT NULL,
  table_id INT NOT NULL,
  seat_index INT NOT NULL,               -- номер места (0..seats-1)
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_bs_booking (booking_id),
  INDEX idx_bs_seat (table_id, seat_index),
  FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE,
  FOREIGN KEY (table_id) REFERENCES tables_layout(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
