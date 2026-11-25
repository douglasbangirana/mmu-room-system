/** Append one row to the audit log. `when` is the time the event happened. */
export async function logEvent(conn, { when, roomId = null, userId = null, cardUid = null, type, result, flagged = false, late = false, details = null }) {
  await conn.query(
    `INSERT INTO event_logs (event_time, logged_at, room_id, user_id, card_uid, event_type, result, flagged, synced_late, details)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [when, new Date(), roomId, userId, cardUid, type, result, flagged ? 1 : 0, late ? 1 : 0, details]
  );
}
