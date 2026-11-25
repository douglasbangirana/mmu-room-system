"""Pure verification rules (no database), so they are easy to unit test (TC1, TC2, TC7).

A swipe-in is AUTHORIZED when the lecturer has a slot in THIS room on THIS date and the swipe falls
between (start - grace) and end. The grace period therefore allows early arrival; a late arrival is
still verified until the slot ends.
"""
from datetime import datetime


def find_matching_slot(slots, now_sec, grace_sec):
    """slots: dicts with id, start_sec, end_sec. Returns the matching slot or None."""
    matches = [s for s in slots if s["start_sec"] - grace_sec <= now_sec <= s["end_sec"]]
    if not matches:
        return None
    return max(matches, key=lambda s: s["start_sec"])   # back-to-back slots: prefer the one in progress


def compute_room_status(last_heartbeat, now: datetime, timeout_sec, session):
    """Never show a false 'Available' when the terminal is silent (FR13)."""
    stale = last_heartbeat is None or (now - last_heartbeat).total_seconds() > timeout_sec
    if stale:
        return "UNVERIFIED"
    if not session:
        return "AVAILABLE"
    return "OCCUPIED_AUTHORIZED" if session["auth_status"] == "AUTHORIZED" else "OCCUPIED_UNAUTHORIZED"
