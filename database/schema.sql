-- MMU Room Verification System: database schema (MySQL 8 / MariaDB 10.5+)
-- Run:  mysql -u root -p < database/schema.sql

CREATE DATABASE IF NOT EXISTS mmu_rooms CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE mmu_rooms;

-- 1. users: H.O.D and lecturer accounts (passwords only as bcrypt hashes)
CREATE TABLE IF NOT EXISTS users (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  name          VARCHAR(120) NOT NULL,
  email         VARCHAR(160) NOT NULL UNIQUE,
  password_hash VARCHAR(100) NOT NULL,
  role          ENUM('HOD','LECTURER') NOT NULL DEFAULT 'LECTURER',
  active        TINYINT(1) NOT NULL DEFAULT 1,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- 2. rfid_cards: a user may hold more than one card over time
CREATE TABLE IF NOT EXISTS rfid_cards (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  card_uid   VARCHAR(20) NOT NULL UNIQUE,          -- upper-case hex, e.g. 04A1B2C3
  user_id    INT NOT NULL,
  status     ENUM('ACTIVE','DEACTIVATED') NOT NULL DEFAULT 'ACTIVE',
  issued_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_cards_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB;

-- 3. rooms: one terminal per room; last_heartbeat drives FR13
CREATE TABLE IF NOT EXISTS rooms (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  code             VARCHAR(30) NOT NULL UNIQUE,    -- e.g. LH-101 (the terminal sends this)
  name             VARCHAR(120) NOT NULL,
  capacity         INT NOT NULL DEFAULT 0,
  has_projector    TINYINT(1) NOT NULL DEFAULT 0,
  active           TINYINT(1) NOT NULL DEFAULT 1,
  device_key_hash  CHAR(64) NOT NULL,              -- sha256 of the terminal's device key
  last_heartbeat   DATETIME NULL,
  offline_logged   TINYINT(1) NOT NULL DEFAULT 0   -- so a missed-heartbeat is logged once
) ENGINE=InnoDB;

-- 4. timetable_slots: the official timetable
CREATE TABLE IF NOT EXISTS timetable_slots (
  id                  INT AUTO_INCREMENT PRIMARY KEY,
  user_id             INT NOT NULL,
  room_id             INT NOT NULL,
  slot_date           DATE NOT NULL,
  start_time          TIME NOT NULL,
  end_time            TIME NOT NULL,
  course_label        VARCHAR(120) NULL,
  verification_status ENUM('PENDING','VERIFIED','UNVERIFIED') NOT NULL DEFAULT 'PENDING',
  CONSTRAINT fk_slot_user FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT fk_slot_room FOREIGN KEY (room_id) REFERENCES rooms(id),
  INDEX idx_slot_room_date (room_id, slot_date),
  INDEX idx_slot_user_date (user_id, slot_date)
) ENGINE=InnoDB;

-- 5. room_sessions: actual occupancy, opened by a swipe-in
CREATE TABLE IF NOT EXISTS room_sessions (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  room_id      INT NOT NULL,
  user_id      INT NOT NULL,
  slot_id      INT NULL,                           -- empty for unauthorized use
  auth_status  ENUM('AUTHORIZED','UNAUTHORIZED') NOT NULL,
  opened_at    DATETIME NOT NULL,
  closed_at    DATETIME NULL,
  close_reason ENUM('SWIPE_OUT','AUTO_CLOSED') NULL,
  no_signout   TINYINT(1) NOT NULL DEFAULT 0,
  -- Database-level guarantee: at most ONE open session per room.
  open_flag    TINYINT GENERATED ALWAYS AS (IF(closed_at IS NULL, 1, NULL)) STORED,
  UNIQUE KEY uq_one_open_session (room_id, open_flag),
  CONSTRAINT fk_sess_room FOREIGN KEY (room_id) REFERENCES rooms(id),
  CONSTRAINT fk_sess_user FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT fk_sess_slot FOREIGN KEY (slot_id) REFERENCES timetable_slots(id)
) ENGINE=InnoDB;

-- 6. event_logs: append-only audit trail
CREATE TABLE IF NOT EXISTS event_logs (
  id          BIGINT AUTO_INCREMENT PRIMARY KEY,
  event_time  DATETIME NOT NULL,                   -- when it happened (terminal time for queued events)
  logged_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  room_id     INT NULL,
  user_id     INT NULL,
  card_uid    VARCHAR(20) NULL,                    -- raw UID kept so unknown cards can be traced
  event_type  VARCHAR(40) NOT NULL,
  result      VARCHAR(20) NOT NULL,
  flagged     TINYINT(1) NOT NULL DEFAULT 0,
  synced_late TINYINT(1) NOT NULL DEFAULT 0,       -- uploaded after an outage
  details     VARCHAR(255) NULL,
  INDEX idx_log_time (event_time),
  INDEX idx_log_room (room_id, event_time)
) ENGINE=InnoDB;

DROP TRIGGER IF EXISTS event_logs_no_update;
DROP TRIGGER IF EXISTS event_logs_no_delete;
DELIMITER $$
CREATE TRIGGER event_logs_no_update BEFORE UPDATE ON event_logs
FOR EACH ROW BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'event_logs is append-only';
END$$
CREATE TRIGGER event_logs_no_delete BEFORE DELETE ON event_logs
FOR EACH ROW BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'event_logs is append-only';
END$$
DELIMITER ;

-- Settings the H.O.D can change without redeploying (NFR7)
CREATE TABLE IF NOT EXISTS settings (
  name  VARCHAR(60) PRIMARY KEY,
  value VARCHAR(100) NOT NULL
) ENGINE=InnoDB;

-- Live hardware health reported by each terminal's heartbeat (shown on the Terminals page)
CREATE TABLE IF NOT EXISTS terminal_status (
  room_id    INT PRIMARY KEY,
  queue_len  INT NOT NULL DEFAULT 0,      -- taps saved on the device, waiting to upload
  rssi       INT NULL,                    -- Wi-Fi signal in dBm
  uptime_s   INT NULL,
  fw         VARCHAR(20) NULL,            -- firmware version
  ip         VARCHAR(45) NULL,
  updated_at DATETIME NOT NULL,
  CONSTRAINT fk_ts_room FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
) ENGINE=InnoDB;

INSERT IGNORE INTO settings (name, value) VALUES
  ('grace_minutes', '15'),               -- how early before the start a swipe-in still counts
  ('heartbeat_timeout_seconds', '90'),   -- silent longer than this => Status unverified
  ('autoclose_delay_minutes', '10'),     -- after slot end, close open sessions (FR12)
  ('unauth_max_minutes', '180'),         -- close unauthorized sessions after this long
  ('timetable_version', '1');            -- bumped on any timetable/card change; terminals compare it
