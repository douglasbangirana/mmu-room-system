import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { pool } from '../db.js';

/** Dashboard users: verifies the JWT, then confirms the account is still active. */
export async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Authentication required' });

    let payload;
    try {
      payload = jwt.verify(token, config.jwtSecret);
    } catch {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
    const [rows] = await pool.query('SELECT id, name, email, role, active FROM users WHERE id = ?', [payload.sub]);
    const user = rows[0];
    if (!user || !user.active) return res.status(401).json({ error: 'Account disabled' });
    req.user = { id: user.id, name: user.name, email: user.email, role: user.role };
    next();
  } catch (err) {
    next(err);
  }
}

/** Role check enforced on the server (never only in the UI). */
export const requireRole = (...roles) => (req, res, next) =>
  roles.includes(req.user?.role) ? next() : res.status(403).json({ error: 'Not allowed for your role' });

export const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

/** Terminals: headers X-Room-Code + X-Device-Key. Attaches req.room. */
export async function requireDevice(req, res, next) {
  try {
    const code = req.get('X-Room-Code');
    const key = req.get('X-Device-Key');
    if (!code || !key) return res.status(401).json({ error: 'Device credentials required' });

    const [rows] = await pool.query('SELECT * FROM rooms WHERE code = ? AND active = 1', [code]);
    const room = rows[0];
    const given = Buffer.from(sha256(key), 'hex');
    const stored = Buffer.from(room?.device_key_hash || '0'.repeat(64), 'hex');
    if (!room || !crypto.timingSafeEqual(given, stored)) {
      return res.status(401).json({ error: 'Invalid device credentials' });
    }
    req.room = room;
    next();
  } catch (err) {
    next(err);
  }
}
