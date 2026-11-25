"""Create the H.O.D account (and optionally demo data).  Run from the backend folder:

    python scripts/seed.py --demo
    SEED_HOD_EMAIL / SEED_HOD_PASSWORD (environment) set the H.O.D login for a real deployment.

Your MySQL already holds the demo data if you ran the Node seed earlier, so you do NOT need this again.
"""
import os
import secrets
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import bcrypt  # noqa: E402

from app.db import conn, q1, x  # noqa: E402
from app.security import sha256  # noqa: E402
from app.util import local_date, now_local  # noqa: E402

demo = "--demo" in sys.argv
email = os.getenv("SEED_HOD_EMAIL", "hod@mmu.ac.ug").lower()
password = os.getenv("SEED_HOD_PASSWORD") or ("ChangeMe123!" if demo else "")
if len(password) < 8:
    sys.exit("Set SEED_HOD_PASSWORD (min 8 characters).")


def upsert_user(c, name, mail, pw, role):
    h = bcrypt.hashpw(pw.encode(), bcrypt.gensalt(10)).decode()
    x(c, """INSERT INTO users (name, email, password_hash, role) VALUES (%s,%s,%s,%s)
            ON DUPLICATE KEY UPDATE name = VALUES(name), password_hash = VALUES(password_hash)""", (name, mail, h, role))
    return q1(c, "SELECT id FROM users WHERE email = %s", (mail,))["id"]


with conn() as c:
    upsert_user(c, "Head of Department", email, password, "HOD")
    print(f"H.O.D account ready: {email}")
    if demo:
        l1 = upsert_user(c, "Dr. Demo Lecturer", "lecturer1@mmu.ac.ug", "Lecturer123!", "LECTURER")
        upsert_user(c, "Ms. Second Lecturer", "lecturer2@mmu.ac.ug", "Lecturer123!", "LECTURER")
        rooms = {}
        for code, name, cap, proj in [("LH-101", "Lecture Hall 101", 120, 1), ("LH-102", "Lecture Hall 102", 60, 0)]:
            row = q1(c, "SELECT id FROM rooms WHERE code = %s", (code,))
            if row:
                rooms[code] = (row["id"], "(already created; rotate the key in the dashboard)")
                continue
            key = secrets.token_hex(24)
            _n, rid = x(c, "INSERT INTO rooms (code, name, capacity, has_projector, device_key_hash) VALUES (%s,%s,%s,%s,%s)",
                        (code, name, cap, proj, sha256(key)))
            rooms[code] = (rid, key)
        x(c, "INSERT IGNORE INTO rfid_cards (card_uid, user_id) VALUES (%s, %s)", ("04A1B2C3", l1))
        today = local_date(now_local())
        if not q1(c, "SELECT id FROM timetable_slots WHERE user_id=%s AND room_id=%s AND slot_date=%s", (l1, rooms["LH-101"][0], today)):
            x(c, "INSERT INTO timetable_slots (user_id, room_id, slot_date, start_time, end_time, course_label) VALUES (%s,%s,%s,'00:00:00','23:59:00','Demo: SE 301')",
              (l1, rooms["LH-101"][0], today))
        x(c, "UPDATE settings SET value = CAST(value AS UNSIGNED) + 1 WHERE name = 'timetable_version'")
        print("\nDemo data created. Terminal credentials (save them now; shown once):")
        for code, (_id, key) in rooms.items():
            print(f"  {code}  device key: {key}")
        print("\nDemo lecturer card UID: 04A1B2C3   (lecturer1@mmu.ac.ug / Lecturer123!)")
