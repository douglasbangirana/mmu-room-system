import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import { pool } from '../db.js';
import { config } from '../config.js';
import { ah } from '../util.js';

const router = Router();
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many login attempts. Try again in 15 minutes.' } });

// POST /api/auth/login  (FR8, UC1)
router.post('/login', limiter, ah(async (req, res) => {
  const email = String(req.body?.email ?? '').trim().toLowerCase();
  const password = String(req.body?.password ?? '');
  const [rows] = await pool.query('SELECT * FROM users WHERE email = ?', [email]);
  const user = rows[0];
  // Always run bcrypt so response time does not reveal whether the email exists.
  const ok = await bcrypt.compare(password, user?.password_hash || '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvali');
  if (!user || !user.active || !ok) return res.status(401).json({ error: 'Wrong email or password' });
  const token = jwt.sign({ sub: user.id, role: user.role }, config.jwtSecret, { expiresIn: config.jwtExpires });
  res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
}));

export default router;
