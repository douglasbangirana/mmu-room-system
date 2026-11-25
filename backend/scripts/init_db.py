"""First-run database setup. START.bat runs this on every start; it is safe to repeat.

1. Creates the database and tables if they do not exist (database/schema.sql).
2. Once only (marker 'seed_version' in the settings table): adds the starter accounts, rooms, one
   demo card and the BSSE4 timetable from backend/seed/seed_data.json. Existing rows are kept.
"""
import json
import sys
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import bcrypt  # noqa: E402
import pymysql  # noqa: E402
from pymysql.cursors import DictCursor  # noqa: E402

from app.config import DB  # noqa: E402
from app.security import sha256  # noqa: E402
from app.services.sqlsplit import split_sql  # noqa: E402
from app.util import local_date, now_local, tz_offset_str  # noqa: E402

SCHEMA = ROOT.parent / "database" / "schema.sql"
SEED = ROOT / "seed" / "seed_data.json"
SEED_VERSION = "1"


def connect(with_db):
    kw = dict(DB)
    if not with_db:
        kw.pop("database")
    return pymysql.connect(**kw, charset="utf8mb4", cursorclass=DictCursor, autocommit=True,
                           init_command=f"SET time_zone='{tz_offset_str()}'")


def run(cur, sql, args=None):
    cur.execute(sql, args)
    return cur


def main():
    try:
        server = connect(False)
    except pymysql.err.OperationalError as e:
        print(f"\nCannot reach MySQL: {e}\nStart MySQL in WAMP/XAMPP, check DB_USER / DB_PASSWORD in backend\\.env, then run START.bat again.")
        return 2

    with server.cursor() as cur:
        has_users = run(cur, "SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = %s AND table_name = 'users'",
                        (DB["database"],)).fetchone()["n"]
        if not has_users:
            print("Creating database tables...")
            for stmt in split_sql(SCHEMA.read_text(encoding="utf-8")):
                run(cur, stmt)
    server.close()

    db = connect(True)
    with db.cursor() as cur:
        done = run(cur, "SELECT value FROM settings WHERE name = 'seed_version'").fetchone()
        if done:
            print("Database ready.")
            return 0

        data = json.loads(SEED.read_text(encoding="utf-8"))
        print("First run: loading starter data...")
        for u in data["users"]:
            h = bcrypt.hashpw(u["password"].encode(), bcrypt.gensalt(10)).decode()
            run(cur, "INSERT INTO users (name, email, password_hash, role) VALUES (%s,%s,%s,%s) ON DUPLICATE KEY UPDATE name = name",
                (u["name"], u["email"].lower(), h, u["role"]))
        for r in data["rooms"]:
            run(cur, """INSERT INTO rooms (code, name, capacity, has_projector, device_key_hash) VALUES (%s,%s,%s,%s,%s)
                        ON DUPLICATE KEY UPDATE device_key_hash = VALUES(device_key_hash)""",
                (r["code"], r["name"], r["capacity"], r["projector"], sha256(r["device_key"])))
        for c in data["cards"]:
            run(cur, "INSERT IGNORE INTO rfid_cards (card_uid, user_id) SELECT %s, id FROM users WHERE email = %s", (c["uid"], c["email"]))

        slot_sql = """INSERT INTO timetable_slots (user_id, room_id, slot_date, start_time, end_time, course_label)
                      SELECT u.id, r.id, %s, %s, %s, %s FROM users u JOIN rooms r ON r.code = %s
                       WHERE u.email = %s AND NOT EXISTS (SELECT 1 FROM timetable_slots t
                             WHERE t.user_id = u.id AND t.room_id = r.id AND t.slot_date = %s AND t.start_time = %s)"""
        for s in data["slots"]:
            run(cur, slot_sql, (s["date"], s["start"], s["end"], s["course"], s["room"], s["email"], s["date"], s["start"]))
        d = data["daily_demo"]
        today = date.fromisoformat(local_date(now_local()))
        for i in range(d["days"]):
            day = (today + timedelta(days=i)).isoformat()
            run(cur, slot_sql, (day, d["start"], d["end"], d["course"], d["room"], d["email"], day, d["start"]))

        run(cur, "UPDATE settings SET value = CAST(value AS UNSIGNED) + 1 WHERE name = 'timetable_version'")
        run(cur, "INSERT INTO settings (name, value) VALUES ('seed_version', %s) ON DUPLICATE KEY UPDATE value = VALUES(value)", (SEED_VERSION,))

    print("\nStarter data loaded.")
    print("  H.O.D login:      hod@mmu.ac.ug / ChangeMe123!")
    print("  Lecturer login:   lecturer1@mmu.ac.ug / Lecturer123!   (all lecturers use Lecturer123!)")
    print("  Demo card:        04A1B2C3 (belongs to lecturer1; has an all-day slot in LH-101 for 60 days)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
