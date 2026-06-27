-- Схема БД создаётся приложением автоматически при первом запуске.
-- Этот файл — для справки / ручного развёртывания.

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
  seats INT NOT NULL DEFAULT 4,
  price INT NOT NULL DEFAULT 0,
  shape ENUM('circle','square') NOT NULL DEFAULT 'circle',
  pos_x FLOAT NOT NULL DEFAULT 50,
  pos_y FLOAT NOT NULL DEFAULT 50,
  size  FLOAT NOT NULL DEFAULT 12,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  sort_order INT NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

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
