import { Router } from 'express';
import crypto from 'node:crypto';
import { pool } from '../db.js';
import { requireAuth, requireRole, sha256 } from '../middleware/auth.js';
import { getSettings } from '../services/settings.js';
import { computeRoomStatus } from '../services/verification.js';
import { ah, HttpError } from '../util.js';

const router = Router();
router.use(requireAuth);

// GET /api/rooms: live status, capacity, projector (FR6, FR8, FR13). Read-only for lecturers.
router.get('/', ah(async (req, res) => {
  const cfg = await getSettings(pool);
  const [rows] = await pool.query(
    `SELECT r.id, r.code, r.name, r.capacity, r.has_projector, r.last_heartbeat,
            s.auth_status, s.opened_at, u.name AS occupant
       FROM rooms r
       LEFT JOIN room_sessions s ON s.room_id = r.id AND s.closed_at IS NULL
       LEFT JOIN users u ON u.id = s.user_id
      WHERE r.active = 1 ORDER BY r.code`
  );
  const now = new Date();
  const isHod = req.user.role === 'HOD';
  res.json({
    server_time: now.toISOString(),
    rooms: rows.map((r) => ({
      id: r.id,
      code: r.code,
      name: r.name,
      capacity: r.capacity,
      has_projector: !!r.has_projector,
      status: computeRoomStatus({
        lastHeartbeat: r.last_heartbeat, now, timeoutSec: cfg.heartbeat_timeout_seconds,
        session: r.auth_status ? { auth_status: r.auth_status } : null,
      }),
      last_heartbeat: r.last_heartbeat,
      // Who is inside is audit information: H.O.D only.
      ...(isHod && r.auth_status ? { occupant: r.occupant, since: r.opened_at } : {}),
    })),
  });
}));

// ----- H.O.D only below -----
const hod = requireRole('HOD');
const newKey = () => crypto.randomBytes(24).toString('hex');

router.get('/manage', hod, ah(async (_req, res) => {
  const [rows] = await pool.query('SELECT id, code, name, capacity, has_projector, active, last_heartbeat FROM rooms ORDER BY code');
  res.json(rows);
}));

router.post('/', hod, ah(async (req, res) => {
  const { code, name, capacity = 0, has_projector = false } = req.body || {};
  if (!code || !name) throw new HttpError(400, 'Room code and name are required');
  const key = newKey();
  try {
    const [r] = await pool.query(
      'INSERT INTO rooms (code, name, capacity, has_projector, device_key_hash) VALUES (?,?,?,?,?)',
      [String(code).trim(), String(name).trim(), Number(capacity) || 0, has_projector ? 1 : 0, sha256(key)]
    );
    // The device key is shown ONCE; only its hash is stored.
    res.status(201).json({ id: r.insertId, code, device_key: key });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') throw new HttpError(409, 'A room with that code already exists');
    throw e;
  }
}));

router.patch('/:id', hod, ah(async (req, res) => {
  const { name, capacity, has_projector, active } = req.body || {};
  const sets = []; const vals = [];
  if (name !== undefined) { sets.push('name = ?'); vals.push(String(name)); }
  if (capacity !== undefined) { sets.push('capacity = ?'); vals.push(Number(capacity) || 0); }
  if (has_projector !== undefined) { sets.push('has_projector = ?'); vals.push(has_projector ? 1 : 0); }
  if (active !== undefined) { sets.push('active = ?'); vals.push(active ? 1 : 0); }
  if (!sets.length) throw new HttpError(400, 'Nothing to update');
  await pool.query(`UPDATE rooms SET ${sets.join(', ')} WHERE id = ?`, [...vals, req.params.id]);
  res.json({ ok: true });
}));

router.post('/:id/rotate-key', hod, ah(async (req, res) => {
  const key = newKey();
  await pool.query('UPDATE rooms SET device_key_hash = ? WHERE id = ?', [sha256(key), req.params.id]);
  res.json({ device_key: key });
}));

export default router;
