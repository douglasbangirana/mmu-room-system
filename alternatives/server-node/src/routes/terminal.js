import { Router } from 'express';
import { pool } from '../db.js';
import { requireDevice } from '../middleware/auth.js';
import { getSettings } from '../services/settings.js';
import { logEvent } from '../services/audit.js';
import { processSwipe } from '../services/swipeService.js';
import { buildTerminalCache } from '../services/timetableService.js';
import { ah, HttpError, localDate } from '../util.js';

const router = Router();

// POST /api/swipe: { card_uid, queued?, timestamp? } -> verified result (FR3, FR4, FR5)
router.post('/swipe', requireDevice, ah(async (req, res) => {
  const uid = String(req.body?.card_uid ?? '').toUpperCase();
  if (!/^[0-9A-F]{8,20}$/.test(uid)) throw new HttpError(400, 'card_uid must be 8-20 hex characters');

  const queued = req.body?.queued === true;
  let when = new Date();
  if (queued) {
    const ts = Number(req.body?.timestamp);
    const d = new Date(ts * 1000);
    const age = Date.now() - d.getTime();
    if (!Number.isFinite(ts) || age < -5 * 60 * 1000 || age > 7 * 24 * 3600 * 1000) {
      throw new HttpError(400, 'Queued timestamp is missing or out of range');
    }
    when = d;
  } else {
    await pool.query('UPDATE rooms SET last_heartbeat = ? WHERE id = ?', [when, req.room.id]);
  }
  res.json(await processSwipe({ room: req.room, cardUid: uid, when, late: queued }));
}));

// POST /api/heartbeat: terminal says it is alive; reply tells it whether to re-sync (FR2, FR13)
router.post('/heartbeat', requireDevice, ah(async (req, res) => {
  const now = new Date();
  await pool.query('UPDATE rooms SET last_heartbeat = ? WHERE id = ?', [now, req.room.id]);
  if (req.room.offline_logged) {
    await pool.query('UPDATE rooms SET offline_logged = 0 WHERE id = ?', [req.room.id]);
    await logEvent(pool, { when: now, roomId: req.room.id, type: 'TERMINAL_ONLINE', result: 'INFO' });
  }
  const cfg = await getSettings(pool);
  res.json({
    server_time: Math.floor(now.getTime() / 1000),
    version: cfg.timetable_version,
    date: localDate(now),
  });
}));

// GET /api/timetable/sync: today's slots + active card UIDs for this room (offline cache)
router.get('/timetable/sync', requireDevice, ah(async (req, res) => {
  const cfg = await getSettings(pool);
  res.json(await buildTerminalCache(pool, req.room, localDate(new Date()), cfg));
}));

export default router;
