import { tx } from '../db.js';
import { getSettings } from './settings.js';
import { logEvent } from './audit.js';
import { findMatchingSlot } from './verification.js';
import { localDate, secondsOfDay, timeToSec, combine } from '../util.js';

/**
 * Process one card tap. The server is the authority (Section 3.13).
 * `late` is true when a terminal uploads an event it queued during an outage; `when` is then the
 * terminal's recorded time. The room row is locked so two taps cannot race.
 *
 * Returns { result: AUTHORIZED | UNAUTHORIZED | SIGNED_OUT | REJECTED, name, message }
 */
export async function processSwipe({ room, cardUid, when, late }) {
  return tx(async (c) => {
    await c.query('SELECT id FROM rooms WHERE id = ? FOR UPDATE', [room.id]);
    const cfg = await getSettings(c);
    const base = { when, roomId: room.id, cardUid, late };

    // 1. Who owns this card?
    const [cards] = await c.query(
      `SELECT c.status, u.id AS user_id, u.name, u.active
         FROM rfid_cards c JOIN users u ON u.id = c.user_id WHERE c.card_uid = ?`,
      [cardUid]
    );
    const card = cards[0];
    if (!card || card.status !== 'ACTIVE' || !card.active) {
      await logEvent(c, {
        ...base,
        userId: card?.user_id ?? null,
        type: 'CARD_REJECTED',
        result: 'REJECTED',
        flagged: true,
        details: !card ? 'Unknown card' : 'Card or account deactivated',
      });
      return { result: 'REJECTED', name: null, message: 'Card not recognised' };
    }

    // 2. Is someone already in the room?
    const [open] = await c.query('SELECT * FROM room_sessions WHERE room_id = ? AND closed_at IS NULL', [room.id]);
    const current = open[0];

    // 2a. Same person again => swipe-out (FR5)
    if (current && current.user_id === card.user_id) {
      await c.query("UPDATE room_sessions SET closed_at = ?, close_reason = 'SWIPE_OUT' WHERE id = ?", [when, current.id]);
      await logEvent(c, { ...base, userId: card.user_id, type: 'SWIPE_OUT', result: 'SIGNED_OUT' });
      return { result: 'SIGNED_OUT', name: card.name, message: 'Room now available' };
    }

    // 2b. A different lecturer arrives while the previous one forgot to sign out: close the old session
    if (current) {
      await c.query(
        "UPDATE room_sessions SET closed_at = ?, close_reason = 'AUTO_CLOSED', no_signout = 1 WHERE id = ?",
        [when, current.id]
      );
      await logEvent(c, {
        ...base,
        userId: current.user_id,
        type: 'AUTO_CLOSED',
        result: 'INFO',
        flagged: true,
        details: 'Closed because another lecturer swiped in (no sign-out)',
      });
    }

    // 3. Swipe-in: find a matching timetable slot (FR4)
    const [slots] = await c.query(
      'SELECT id, start_time, end_time, course_label FROM timetable_slots WHERE user_id = ? AND room_id = ? AND slot_date = ?',
      [card.user_id, room.id, localDate(when)]
    );
    const slot = findMatchingSlot(
      slots.map((s) => ({ ...s, start_sec: timeToSec(s.start_time), end_sec: timeToSec(s.end_time) })),
      secondsOfDay(when),
      cfg.grace_minutes * 60
    );
    const authorized = !!slot;

    // 4. Card seen in two rooms at overlapping times => anomaly flag (possible cloned or shared card)
    const [elsewhere] = await c.query(
      `SELECT s.id, r.code, t.slot_date, t.end_time
         FROM room_sessions s
         JOIN rooms r ON r.id = s.room_id
         LEFT JOIN timetable_slots t ON t.id = s.slot_id
        WHERE s.user_id = ? AND s.closed_at IS NULL AND s.room_id <> ?`,
      [card.user_id, room.id]
    );
    const overlapping = elsewhere.find((o) => !o.end_time || combine(o.slot_date, o.end_time) > when);
    if (overlapping) {
      await logEvent(c, {
        ...base,
        userId: card.user_id,
        type: 'ANOMALY_TWO_ROOMS',
        result: 'INFO',
        flagged: true,
        details: `Card also has an open session in ${overlapping.code}`,
      });
    }

    // 5. Open the session and mark the slot verified
    await c.query(
      `INSERT INTO room_sessions (room_id, user_id, slot_id, auth_status, opened_at) VALUES (?, ?, ?, ?, ?)`,
      [room.id, card.user_id, slot?.id ?? null, authorized ? 'AUTHORIZED' : 'UNAUTHORIZED', when]
    );
    if (authorized) {
      await c.query("UPDATE timetable_slots SET verification_status = 'VERIFIED' WHERE id = ?", [slot.id]);
    }
    await logEvent(c, {
      ...base,
      userId: card.user_id,
      type: authorized ? 'SWIPE_IN_AUTHORIZED' : 'SWIPE_IN_UNAUTHORIZED',
      result: authorized ? 'AUTHORIZED' : 'UNAUTHORIZED',
      flagged: !authorized,
      details: authorized ? slot.course_label : 'No matching timetable slot',
    });

    return authorized
      ? { result: 'AUTHORIZED', name: card.name, message: slot.course_label || 'Welcome' }
      : { result: 'UNAUTHORIZED', name: card.name, message: 'Not on timetable' };
  });
}
