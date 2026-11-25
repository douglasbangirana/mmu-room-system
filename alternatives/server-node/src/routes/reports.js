import { Router } from 'express';
import { pool } from '../db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { getSettings, SETTING_KEYS } from '../services/settings.js';
import { ah, HttpError, localDate } from '../util.js';

export const logs = Router();
export const settings = Router();
logs.use(requireAuth, requireRole('HOD'));
settings.use(requireAuth, requireRole('HOD'));

const csvCell = (v) => {
  const s = v instanceof Date ? v.toISOString() : String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

function range(q) {
  const today = localDate(new Date());
  return { from: q.from || today, to: q.to || today };
}

// GET /api/logs?from&to&room_id&type&flagged=1&format=csv  (FR10, FR11)
logs.get('/logs', ah(async (req, res) => {
  const { from, to } = range(req.query);
  const where = ['DATE(e.event_time) BETWEEN ? AND ?']; const vals = [from, to];
  if (req.query.room_id) { where.push('e.room_id = ?'); vals.push(req.query.room_id); }
  if (req.query.type) { where.push('e.event_type = ?'); vals.push(req.query.type); }
  if (req.query.flagged === '1') where.push('e.flagged = 1');
  const limit = req.query.format === 'csv' ? 50000 : Math.min(Number(req.query.limit) || 200, 1000);
  const [rows] = await pool.query(
    `SELECT e.id, e.event_time, r.code AS room, u.name AS lecturer, e.card_uid, e.event_type, e.result,
            e.flagged, e.synced_late, e.details
       FROM event_logs e LEFT JOIN rooms r ON r.id = e.room_id LEFT JOIN users u ON u.id = e.user_id
      WHERE ${where.join(' AND ')} ORDER BY e.event_time DESC, e.id DESC LIMIT ${limit}`, vals);

  if (req.query.format === 'csv') {
    const cols = ['id', 'event_time', 'room', 'lecturer', 'card_uid', 'event_type', 'result', 'flagged', 'synced_late', 'details'];
    const body = [cols.join(','), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(','))].join('\n');
    res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="event-log-${from}_${to}.csv"` });
    return res.send(body);
  }
  res.json(rows);
}));

// GET /api/summary?from&to: verified vs unverified slots, ghost-booking frequency and exposure
logs.get('/summary', ah(async (req, res) => {
  const { from, to } = range(req.query);
  const [perRoom] = await pool.query(
    `SELECT r.code AS room,
            SUM(t.verification_status = 'VERIFIED')   AS verified,
            SUM(t.verification_status = 'UNVERIFIED') AS unverified,
            SUM(t.verification_status = 'PENDING')    AS pending,
            COALESCE(SUM(CASE WHEN t.verification_status = 'UNVERIFIED'
                         THEN TIME_TO_SEC(t.end_time) - TIME_TO_SEC(t.start_time) END), 0) / 60 AS exposure_minutes
       FROM timetable_slots t JOIN rooms r ON r.id = t.room_id
      WHERE t.slot_date BETWEEN ? AND ? GROUP BY r.id, r.code ORDER BY r.code`, [from, to]);
  const [[sess]] = await pool.query(
    `SELECT SUM(auth_status = 'UNAUTHORIZED') AS unauthorized, SUM(no_signout = 1) AS no_signout, COUNT(*) AS sessions
       FROM room_sessions WHERE DATE(opened_at) BETWEEN ? AND ?`, [from, to]);

  const rooms = perRoom.map((r) => ({ room: r.room, verified: +r.verified, unverified: +r.unverified, pending: +r.pending, exposure_minutes: Math.round(+r.exposure_minutes) }));
  const verified = rooms.reduce((a, r) => a + r.verified, 0);
  const unverified = rooms.reduce((a, r) => a + r.unverified, 0);
  const finished = verified + unverified;
  res.json({
    from, to, verified, unverified,
    pending: rooms.reduce((a, r) => a + r.pending, 0),
    ghost_booking_pct: finished ? Math.round((unverified / finished) * 1000) / 10 : null,
    exposure_minutes: rooms.reduce((a, r) => a + r.exposure_minutes, 0),
    unauthorized_sessions: +(sess.unauthorized || 0),
    sessions_without_signout: +(sess.no_signout || 0),
    per_room: rooms,
  });
}));

// GET/PUT /api/settings: grace period etc. without redeploying (NFR7)
settings.get('/', ah(async (_req, res) => {
  const s = await getSettings(pool);
  delete s.timetable_version;
  res.json(s);
}));

settings.put('/', ah(async (req, res) => {
  for (const k of SETTING_KEYS) {
    if (req.body?.[k] === undefined) continue;
    const n = Number(req.body[k]);
    if (!Number.isInteger(n) || n < 0 || n > 1440) throw new HttpError(400, `${k} must be a whole number between 0 and 1440`);
    await pool.query('UPDATE settings SET value = ? WHERE name = ?', [String(n), k]);
  }
  res.json({ ok: true });
}));
