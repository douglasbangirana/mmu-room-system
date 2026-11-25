"""Idempotent upgrades so an existing database gains new tables without being rebuilt."""
from .db import conn, x

TERMINAL_STATUS = """CREATE TABLE IF NOT EXISTS terminal_status (
  room_id    INT PRIMARY KEY,
  queue_len  INT NOT NULL DEFAULT 0,
  rssi       INT NULL,
  uptime_s   INT NULL,
  fw         VARCHAR(20) NULL,
  ip         VARCHAR(45) NULL,
  updated_at DATETIME NOT NULL,
  CONSTRAINT fk_ts_room FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
) ENGINE=InnoDB"""


def ensure_schema():
    try:
        with conn() as c:
            x(c, TERMINAL_STATUS)
    except Exception as e:      # the server still starts; the Terminals page just shows less detail
        print("[schema]", e)
