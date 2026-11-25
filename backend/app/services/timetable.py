import csv
import io

from ..db import q
from ..util import time_to_sec, tz_offset_sec
from .validators import norm_time, valid_date

REQUIRED_HEADERS = ["lecturer_email", "room_code", "date", "start", "end"]


def parse_csv(text: str):
    """CSV text -> list of row dicts. Raises ValueError with a readable message."""
    reader = csv.DictReader(io.StringIO(text.lstrip("\ufeff")))
    if not reader.fieldnames:
        raise ValueError("The CSV file has no data rows.")
    reader.fieldnames = [(h or "").strip().lower() for h in reader.fieldnames]
    rows = []
    for r in reader:
        clean = {k: (v or "").strip() for k, v in r.items() if k and isinstance(v, (str, type(None)))}
        if any(clean.values()):
            rows.append(clean)
    if not rows:
        raise ValueError("The CSV file has no data rows.")
    missing = [h for h in REQUIRED_HEADERS if h not in reader.fieldnames]
    if missing:
        raise ValueError(f"Missing CSV column(s): {', '.join(missing)}")
    return rows


def _overlaps(a, b):
    return a["start_sec"] < b["end_sec"] and a["end_sec"] > b["start_sec"]


def validate_rows(c, rows, exclude_id=None, first_row_number=2):
    """Validate rows against users, rooms and existing slots (FR1). Returns (valid, invalid)."""
    users = {u["email"].lower(): u["id"] for u in q(c, "SELECT id, email FROM users WHERE role = 'LECTURER' AND active = 1")}
    rooms = {r["code"].lower(): r["id"] for r in q(c, "SELECT id, code FROM rooms WHERE active = 1")}

    dates = sorted({str(r.get("date") or "").strip() for r in rows if valid_date(r.get("date"))})
    existing = []
    if dates:
        existing = q(c, "SELECT id, user_id, room_id, slot_date, start_time, end_time FROM timetable_slots WHERE slot_date IN %s",
                     (tuple(dates),))
    pool = [{"user_id": e["user_id"], "room_id": e["room_id"], "date": str(e["slot_date"]),
             "start_sec": time_to_sec(e["start_time"]), "end_sec": time_to_sec(e["end_time"])}
            for e in existing if e["id"] != exclude_id]

    valid, invalid = [], []
    for i, raw in enumerate(rows):
        errors = []
        date_s = str(raw.get("date") or "").strip()
        start, end = norm_time(raw.get("start")), norm_time(raw.get("end"))
        user_id = users.get(str(raw.get("lecturer_email") or "").strip().lower())
        room_id = rooms.get(str(raw.get("room_code") or "").strip().lower())

        if not user_id: errors.append(f'Lecturer "{raw.get("lecturer_email") or ""}" not found or inactive')
        if not room_id: errors.append(f'Room "{raw.get("room_code") or ""}" not found')
        if not valid_date(date_s): errors.append("Date must be YYYY-MM-DD")
        if not start: errors.append("Start time must be HH:MM")
        if not end: errors.append("End time must be HH:MM")
        if start and end and time_to_sec(end) <= time_to_sec(start): errors.append("End time must be after start time")

        if not errors:
            cand = {"user_id": user_id, "room_id": room_id, "date": date_s,
                    "start_sec": time_to_sec(start), "end_sec": time_to_sec(end)}
            clash = next((p for p in pool if p["date"] == date_s and _overlaps(p, cand)
                          and (p["room_id"] == room_id or p["user_id"] == user_id)), None)
            if clash:
                errors.append("Room is already booked at that time" if clash["room_id"] == room_id
                              else "Lecturer already has a slot at that time")
            else:
                pool.append(cand)    # later rows in the same file are checked against this one

        if errors:
            invalid.append({"row": i + first_row_number, "data": raw, "errors": errors})
        else:
            valid.append({"row": i + first_row_number, "user_id": user_id, "room_id": room_id, "slot_date": date_s,
                          "start_time": start, "end_time": end, "course_label": (str(raw.get("course") or "").strip()[:120] or None)})
    return valid, invalid


def build_terminal_cache(c, room, date_str, settings):
    """Today's slots for one room, shaped for the terminal's offline cache (small, denormalised)."""
    import time as _t
    slots = q(c, """SELECT t.id, t.start_time, t.end_time, t.course_label, u.id AS user_id, u.name
                      FROM timetable_slots t JOIN users u ON u.id = t.user_id AND u.active = 1
                     WHERE t.room_id = %s AND t.slot_date = %s ORDER BY t.start_time""", (room["id"], date_str))
    user_ids = tuple({s["user_id"] for s in slots})
    cards = q(c, "SELECT user_id, card_uid FROM rfid_cards WHERE status = 'ACTIVE' AND user_id IN %s", (user_ids,)) if user_ids else []
    return {
        "version": settings["timetable_version"],
        "date": date_str,
        "server_time": int(_t.time()),
        "tz_offset_sec": tz_offset_sec(),
        "grace_sec": settings["grace_minutes"] * 60,
        "slots": [{"name": s["name"], "course": s["course_label"] or "",
                   "start": time_to_sec(s["start_time"]), "end": time_to_sec(s["end_time"]),
                   "uids": [k["card_uid"] for k in cards if k["user_id"] == s["user_id"]]} for s in slots],
    }
