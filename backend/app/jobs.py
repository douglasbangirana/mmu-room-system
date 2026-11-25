"""The "System Timer": three small jobs run every 30 seconds."""
import asyncio
from datetime import timedelta

from .db import conn, q, x
from .services.audit import log_event
from .services.settings import get_settings
from .util import combine, local_date, local_time, now_local


def _mark_unverified(c, now):
    """FR6: a slot that ended with no verified swipe becomes UNVERIFIED (a ghost-booking candidate)."""
    x(c, """UPDATE timetable_slots SET verification_status = 'UNVERIFIED'
             WHERE verification_status = 'PENDING' AND (slot_date < %s OR (slot_date = %s AND end_time < %s))""",
      (local_date(now), local_date(now), local_time(now)))


def _auto_close(c, now, cfg):
    """FR12: close sessions left open after the slot ends (plus a delay) and flag them."""
    open_rows = q(c, """SELECT s.id, s.room_id, s.user_id, s.opened_at, t.slot_date, t.end_time
                          FROM room_sessions s LEFT JOIN timetable_slots t ON t.id = s.slot_id WHERE s.closed_at IS NULL""")
    for s in open_rows:
        if s["end_time"] is not None:
            deadline = combine(s["slot_date"], s["end_time"]) + timedelta(minutes=cfg["autoclose_delay_minutes"])
        else:
            deadline = s["opened_at"] + timedelta(minutes=cfg["unauth_max_minutes"])
        if now <= deadline:
            continue
        n, _ = x(c, "UPDATE room_sessions SET closed_at = %s, close_reason = 'AUTO_CLOSED', no_signout = 1 WHERE id = %s AND closed_at IS NULL",
                 (now, s["id"]))
        if n:
            log_event(c, when=now, room_id=s["room_id"], user_id=s["user_id"], event_type="AUTO_CLOSED", result="INFO",
                      flagged=True, details="No sign-out; closed by system")


def _monitor_heartbeats(c, now, cfg):
    """FR13: log once when a terminal goes silent. (The dashboard status itself is computed live.)"""
    cutoff = now - timedelta(seconds=cfg["heartbeat_timeout_seconds"])
    for r in q(c, "SELECT id FROM rooms WHERE active = 1 AND offline_logged = 0 AND last_heartbeat IS NOT NULL AND last_heartbeat < %s", (cutoff,)):
        x(c, "UPDATE rooms SET offline_logged = 1 WHERE id = %s", (r["id"],))
        log_event(c, when=now, room_id=r["id"], event_type="TERMINAL_OFFLINE", result="INFO", flagged=True, details="Missed heartbeats")


def run_jobs():
    try:
        now = now_local()
        with conn() as c:
            cfg = get_settings(c)
            _mark_unverified(c, now)
            _auto_close(c, now, cfg)
            _monitor_heartbeats(c, now, cfg)
    except Exception as e:        # a database hiccup must never kill the timer
        print("[scheduler]", e)


async def scheduler(interval=30):
    while True:
        await asyncio.to_thread(run_jobs)
        await asyncio.sleep(interval)
