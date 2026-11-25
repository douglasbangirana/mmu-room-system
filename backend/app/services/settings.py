from ..db import q, x

SETTING_KEYS = ["grace_minutes", "heartbeat_timeout_seconds", "autoclose_delay_minutes", "unauth_max_minutes"]


def get_settings(c) -> dict:
    s = {r["name"]: int(r["value"]) for r in q(c, "SELECT name, value FROM settings")}
    return {
        "grace_minutes": s.get("grace_minutes", 15),
        "heartbeat_timeout_seconds": s.get("heartbeat_timeout_seconds", 90),
        "autoclose_delay_minutes": s.get("autoclose_delay_minutes", 10),
        "unauth_max_minutes": s.get("unauth_max_minutes", 180),
        "timetable_version": s.get("timetable_version", 1),
    }


def bump_version(c):
    """Terminals poll this number; when it changes they re-download their cache (FR2)."""
    x(c, "UPDATE settings SET value = CAST(value AS UNSIGNED) + 1 WHERE name = 'timetable_version'")
