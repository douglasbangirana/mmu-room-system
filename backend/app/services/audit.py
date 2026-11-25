from ..db import x
from ..util import now_local


def log_event(c, *, when, event_type, result, room_id=None, user_id=None, card_uid=None,
              flagged=False, late=False, details=None):
    """Append one row to the audit log. `when` is the time the event happened."""
    x(c,
      """INSERT INTO event_logs (event_time, logged_at, room_id, user_id, card_uid, event_type, result, flagged, synced_late, details)
         VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
      (when, now_local(), room_id, user_id, card_uid, event_type, result, int(flagged), int(late), details))
