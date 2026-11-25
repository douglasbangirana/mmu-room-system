from ..db import tx, q, q1, x
from ..util import local_date, seconds_of_day, time_to_sec, combine
from .settings import get_settings
from .audit import log_event
from .verification import find_matching_slot


def process_swipe(room: dict, card_uid: str, when, late: bool) -> dict:
    """Process one card tap. The server is the authority (proposal Section 3.13).

    `late` is True when a terminal uploads an event it queued during an outage; `when` is then the
    terminal's recorded time. The room row is locked so two taps cannot race.
    Returns {result: AUTHORIZED | UNAUTHORIZED | SIGNED_OUT | REJECTED, name, message}.
    """
    with tx() as c:
        q(c, "SELECT id FROM rooms WHERE id = %s FOR UPDATE", (room["id"],))
        cfg = get_settings(c)
        base = dict(when=when, room_id=room["id"], card_uid=card_uid, late=late)

        # 1. Who owns this card?
        card = q1(c, """SELECT c.status, u.id AS user_id, u.name, u.active
                          FROM rfid_cards c JOIN users u ON u.id = c.user_id WHERE c.card_uid = %s""", (card_uid,))
        if not card or card["status"] != "ACTIVE" or not card["active"]:
            log_event(c, **base, user_id=card["user_id"] if card else None, event_type="CARD_REJECTED",
                      result="REJECTED", flagged=True,
                      details="Unknown card" if not card else "Card or account deactivated")
            return {"result": "REJECTED", "name": None, "message": "Card not recognised"}

        # 2. Is someone already in the room?
        current = q1(c, "SELECT * FROM room_sessions WHERE room_id = %s AND closed_at IS NULL", (room["id"],))

        # 2a. Same person again => swipe-out (FR5)
        if current and current["user_id"] == card["user_id"]:
            x(c, "UPDATE room_sessions SET closed_at = %s, close_reason = 'SWIPE_OUT' WHERE id = %s", (when, current["id"]))
            log_event(c, **base, user_id=card["user_id"], event_type="SWIPE_OUT", result="SIGNED_OUT")
            return {"result": "SIGNED_OUT", "name": card["name"], "message": "Room now available"}

        # 2b. A different lecturer arrives while the previous one forgot to sign out
        if current:
            x(c, "UPDATE room_sessions SET closed_at = %s, close_reason = 'AUTO_CLOSED', no_signout = 1 WHERE id = %s",
              (when, current["id"]))
            log_event(c, **base, user_id=current["user_id"], event_type="AUTO_CLOSED", result="INFO", flagged=True,
                      details="Closed because another lecturer swiped in (no sign-out)")

        # 3. Swipe-in: find a matching timetable slot (FR4)
        rows = q(c, """SELECT id, start_time, end_time, course_label FROM timetable_slots
                        WHERE user_id = %s AND room_id = %s AND slot_date = %s""",
                 (card["user_id"], room["id"], local_date(when)))
        slot = find_matching_slot(
            [{**r, "start_sec": time_to_sec(r["start_time"]), "end_sec": time_to_sec(r["end_time"])} for r in rows],
            seconds_of_day(when), cfg["grace_minutes"] * 60)
        authorized = slot is not None

        # 4. Card open in two rooms at overlapping times => anomaly flag (possible cloned or shared card)
        elsewhere = q(c, """SELECT s.id, r.code, t.slot_date, t.end_time
                              FROM room_sessions s JOIN rooms r ON r.id = s.room_id
                              LEFT JOIN timetable_slots t ON t.id = s.slot_id
                             WHERE s.user_id = %s AND s.closed_at IS NULL AND s.room_id <> %s""",
                      (card["user_id"], room["id"]))
        overlap = next((o for o in elsewhere if o["end_time"] is None or combine(o["slot_date"], o["end_time"]) > when), None)
        if overlap:
            log_event(c, **base, user_id=card["user_id"], event_type="ANOMALY_TWO_ROOMS", result="INFO", flagged=True,
                      details=f"Card also has an open session in {overlap['code']}")

        # 5. Open the session and mark the slot verified
        x(c, """INSERT INTO room_sessions (room_id, user_id, slot_id, auth_status, opened_at) VALUES (%s,%s,%s,%s,%s)""",
          (room["id"], card["user_id"], slot["id"] if slot else None, "AUTHORIZED" if authorized else "UNAUTHORIZED", when))
        if authorized:
            x(c, "UPDATE timetable_slots SET verification_status = 'VERIFIED' WHERE id = %s", (slot["id"],))
        log_event(c, **base, user_id=card["user_id"],
                  event_type="SWIPE_IN_AUTHORIZED" if authorized else "SWIPE_IN_UNAUTHORIZED",
                  result="AUTHORIZED" if authorized else "UNAUTHORIZED", flagged=not authorized,
                  details=slot["course_label"] if authorized else "No matching timetable slot")

        if authorized:
            return {"result": "AUTHORIZED", "name": card["name"], "message": slot["course_label"] or "Welcome"}
        return {"result": "UNAUTHORIZED", "name": card["name"], "message": "Not on timetable"}
