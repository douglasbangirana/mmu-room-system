import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { pool, tx } from '../db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { bumpVersion } from '../services/settings.js';
import { ah, HttpError } from '../util.js';

export const cards = Router();
export const users = Router();
cards.use(requireAuth, requireRole('HOD'));
users.use(requireAuth, requireRole('HOD'));

// ---------- Cards (FR9) ----------
cards.get('/', ah(async (_req, res) => {
  const [rows] = await pool.query(
    `SELECT c.id, c.card_uid, c.status, c.issued_at, u.id AS user_id, u.name AS holder, u.email
       FROM rfid_cards c JOIN users u ON u.id = c.user_id ORDER BY c.issued_at DESC`);
  res.json(rows);
}));

// Unknown cards tapped recently: lets the H.O.D register a card by tapping it at any terminal.
cards.get('/recent-unknown', ah(async (_req, res) => {
  const [rows] = await pool.query(
    `SELECT card_uid, MAX(event_time) AS last_seen FROM event_logs
      WHERE event_type = 'CARD_REJECTED' AND user_id IS NULL AND card_uid IS NOT NULL
        AND card_uid NOT IN (SELECT card_uid FROM rfid_cards)
      GROUP BY card_uid ORDER BY last_seen DESC LIMIT 10`);
  res.json(rows);
}));

cards.post('/', ah(async (req, res) => {
  const uid = String(req.body?.card_uid ?? '').trim().toUpperCase();
  if (!/^[0-9A-F]{8,20}$/.test(uid)) throw new HttpError(400, 'Card UID must be 8-20 hex characters');
  try {
    await tx(async (c) => {
      await c.query('INSERT INTO rfid_cards (card_uid, user_id) VALUES (?, ?)', [uid, req.body?.user_id]);
      await bumpVersion(c);
    });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') throw new HttpError(409, 'That card is already registered');
    if (e.code === 'ER_NO_REFERENCED_ROW_2') throw new HttpError(400, 'Choose a valid lecturer');
    throw e;
  }
  res.status(201).json({ ok: true });
}));

// PATCH /api/cards/:id  { status?: ACTIVE|DEACTIVATED, user_id? }  (deactivate, reactivate, reassign)
cards.patch('/:id', ah(async (req, res) => {
  const sets = []; const vals = [];
  if (req.body?.status) {
    if (!['ACTIVE', 'DEACTIVATED'].includes(req.body.status)) throw new HttpError(400, 'Invalid status');
    sets.push('status = ?'); vals.push(req.body.status);
  }
  if (req.body?.user_id) { sets.push('user_id = ?'); vals.push(req.body.user_id); }
  if (!sets.length) throw new HttpError(400, 'Nothing to update');
  await tx(async (c) => {
    await c.query(`UPDATE rfid_cards SET ${sets.join(', ')} WHERE id = ?`, [...vals, req.params.id]);
    await bumpVersion(c);
  });
  res.json({ ok: true });
}));

// ---------- Accounts ----------
users.get('/', ah(async (_req, res) => {
  const [rows] = await pool.query('SELECT id, name, email, role, active, created_at FROM users ORDER BY role, name');
  res.json(rows);
}));

users.post('/', ah(async (req, res) => {
  const { name, email, password, role = 'LECTURER' } = req.body || {};
  if (!name || !email || !password) throw new HttpError(400, 'Name, email and password are required');
  if (String(password).length < 8) throw new HttpError(400, 'Password must be at least 8 characters');
  if (!['HOD', 'LECTURER'].includes(role)) throw new HttpError(400, 'Invalid role');
  try {
    const hash = await bcrypt.hash(String(password), 10);
    const [r] = await pool.query('INSERT INTO users (name, email, password_hash, role) VALUES (?,?,?,?)',
      [String(name).trim(), String(email).trim().toLowerCase(), hash, role]);
    res.status(201).json({ id: r.insertId });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') throw new HttpError(409, 'That email is already in use');
    throw e;
  }
}));

users.patch('/:id', ah(async (req, res) => {
  const { name, active, password } = req.body || {};
  const sets = []; const vals = [];
  if (name !== undefined) { sets.push('name = ?'); vals.push(String(name)); }
  if (active !== undefined) {
    if (!active && Number(req.params.id) === req.user.id) throw new HttpError(400, 'You cannot deactivate your own account');
    sets.push('active = ?'); vals.push(active ? 1 : 0);
  }
  if (password !== undefined) {
    if (String(password).length < 8) throw new HttpError(400, 'Password must be at least 8 characters');
    sets.push('password_hash = ?'); vals.push(await bcrypt.hash(String(password), 10));
  }
  if (!sets.length) throw new HttpError(400, 'Nothing to update');
  await tx(async (c) => {
    await c.query(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, [...vals, req.params.id]);
    await bumpVersion(c);
  });
  res.json({ ok: true });
}));
