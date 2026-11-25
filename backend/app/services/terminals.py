"""Pure helpers for the Terminals page and the heartbeat (no database access, easy to test)."""
from datetime import datetime

TAP_TYPES = ("SWIPE_IN_AUTHORIZED", "SWIPE_IN_UNAUTHORIZED", "SWIPE_OUT", "CARD_REJECTED")
_TAPS_IN = ", ".join(f"'{t}'" for t in TAP_TYPES)

UPSERT_SQL = """INSERT INTO terminal_status (room_id, queue_len, rssi, uptime_s, fw, ip, updated_at)
VALUES (%s, %s, %s, %s, %s, %s, %s)
ON DUPLICATE KEY UPDATE queue_len = VALUES(queue_len), rssi = VALUES(rssi), uptime_s = VALUES(uptime_s),
                        fw = VALUES(fw), ip = VALUES(ip), updated_at = VALUES(updated_at)"""

LIST_SQL = f"""SELECT r.id, r.code, r.name, r.last_heartbeat,
       s.queue_len, s.rssi, s.uptime_s, s.fw, s.ip,
       (SELECT MAX(e.event_time) FROM event_logs e
         WHERE e.room_id = r.id AND e.event_type IN ({_TAPS_IN})) AS last_tap,
       (SELECT COUNT(*) FROM event_logs e
         WHERE e.room_id = r.id AND e.event_type IN ({_TAPS_IN}) AND DATE(e.event_time) = %s) AS taps_today
  FROM rooms r LEFT JOIN terminal_status s ON s.room_id = r.id
 WHERE r.active = 1 ORDER BY r.code"""


def signal_quality(rssi):
    """Wi-Fi strength label from the ESP32's RSSI (dBm, closer to 0 is stronger)."""
    if rssi is None:
        return "unknown"
    if rssi >= -60:
        return "excellent"
    if rssi >= -70:
        return "good"
    if rssi >= -80:
        return "fair"
    return "weak"


def connection_state(last_heartbeat, now: datetime, timeout_sec: int):
    """WAITING = never heard, ONLINE = reporting, SILENT = reported before but went quiet (FR13)."""
    if last_heartbeat is None:
        return "WAITING"
    return "SILENT" if (now - last_heartbeat).total_seconds() > timeout_sec else "ONLINE"


def clean_int(value, lo, hi):
    """int(value) when it is a number inside [lo, hi], otherwise None. Terminal input is never trusted."""
    try:
        n = int(float(value))
    except (TypeError, ValueError):
        return None
    return n if lo <= n <= hi else None


def heartbeat_params(room_id, body: dict, ip, now):
    fw = str(body.get("fw") or "").strip()[:20] or None
    return (room_id, clean_int(body.get("queue"), 0, 100000) or 0, clean_int(body.get("rssi"), -127, 0),
            clean_int(body.get("uptime"), 0, 2**31 - 1), fw, str(ip)[:45] if ip else None, now)


def shape_rows(rows, now: datetime, timeout_sec: int):
    out = []
    for r in rows:
        out.append({
            "id": r["id"], "code": r["code"], "name": r["name"],
            "state": connection_state(r["last_heartbeat"], now, timeout_sec),
            "last_heartbeat": r["last_heartbeat"],
            "rssi": r["rssi"], "signal": signal_quality(r["rssi"]),
            "uptime_s": r["uptime_s"], "queue_len": r["queue_len"] or 0,
            "fw": r["fw"], "ip": r["ip"],
            "last_tap": r["last_tap"], "taps_today": int(r["taps_today"] or 0),
        })
    return out
