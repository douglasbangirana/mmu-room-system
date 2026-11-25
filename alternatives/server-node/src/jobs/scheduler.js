import { pool } from '../db.js';
import { getSettings } from '../services/settings.js';
import { logEvent } from '../services/audit.js';
import { combine, localDate, localTime } from '../util.js';

// The "System Timer" actor: three small jobs run every 30 seconds.

/** FR6: a slot that ended with no verified swipe becomes UNVERIFIED (a ghost-booking candidate). */
async function markUnverified(now) {
  await pool.query(
    `UPDATE timetable_slots SET verification_status = 'UNVERIFIED'
      WHERE verification_status = 'PENDING' AND (slot_date < ? OR (slot_date = ? AND end_time < ?))`,
    [localDate(now), localDate(now), localTime(now)]);
}

/** FR12: close sessions left open after the slot ends (plus a delay) and flag them. */
async function autoCloseSessions(now, cfg) {
  const [open] = await pool.query(
    `SELECT s.id, s.room_id, s.user_id, s.opened_at, t.slot_date, t.end_time
       FROM room_sessions s LEFT JOIN timetable_slots t ON t.id = s.slot_id WHERE s.closed_at IS NULL`);
  for (const s of open) {
    const deadline = s.end_time
      ? new Date(combine(s.slot_date, s.end_time).getTime() + cfg.autoclose_delay_minutes * 60000)
      : new Date(new Date(s.opened_at).getTime() + cfg.unauth_max_minutes * 60000);
    if (now <= deadline) continue;
    const [r] = await pool.query(
      "UPDATE room_sessions SET closed_at = ?, close_reason = 'AUTO_CLOSED', no_signout = 1 WHERE id = ? AND closed_at IS NULL",
      [now, s.id]);
    if (r.affectedRows) {
      await logEvent(pool, { when: now, roomId: s.room_id, userId: s.user_id, type: 'AUTO_CLOSED', result: 'INFO', flagged: true, details: 'No sign-out; closed by system' });
    }
  }
}

/** FR13: log once when a terminal goes silent. (The dashboard status itself is computed live.) */
async function monitorHeartbeats(now, cfg) {
  const cutoff = new Date(now.getTime() - cfg.heartbeat_timeout_seconds * 1000);
  const [silent] = await pool.query(
    'SELECT id FROM rooms WHERE active = 1 AND offline_logged = 0 AND last_heartbeat IS NOT NULL AND last_heartbeat < ?', [cutoff]);
  for (const r of silent) {
    await pool.query('UPDATE rooms SET offline_logged = 1 WHERE id = ?', [r.id]);
    await logEvent(pool, { when: now, roomId: r.id, type: 'TERMINAL_OFFLINE', result: 'INFO', flagged: true, details: 'Missed heartbeats' });
  }
}

let running = false;
export async function runJobs() {
  if (running) return;
  running = true;
  try {
    const now = new Date();
    const cfg = await getSettings(pool);
    await markUnverified(now);
    await autoCloseSessions(now, cfg);
    await monitorHeartbeats(now, cfg);
  } catch (err) {
    console.error('[scheduler]', err.message);
  } finally {
    running = false;
  }
}

export function startScheduler(intervalMs = 30000) {
  runJobs();
  return setInterval(runJobs, intervalMs);
}
