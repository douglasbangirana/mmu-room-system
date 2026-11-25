// Usage:
//   SEED_HOD_EMAIL=hod@mmu.ac.ug SEED_HOD_PASSWORD='StrongPass123' npm run seed
//   npm run seed:demo     (also creates 2 lecturers, 2 rooms, a card and today's slots)
import 'dotenv/config';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { pool } from '../src/db.js';
import { sha256 } from '../src/middleware/auth.js';
import { localDate } from '../src/util.js';

const demo = process.argv.includes('--demo');
const email = (process.env.SEED_HOD_EMAIL || 'hod@mmu.ac.ug').toLowerCase();
const password = process.env.SEED_HOD_PASSWORD || (demo ? 'ChangeMe123!' : '');
if (password.length < 8) {
  console.error('Set SEED_HOD_PASSWORD (min 8 characters).');
  process.exit(1);
}

async function upsertUser(name, mail, pw, role) {
  const hash = await bcrypt.hash(pw, 10);
  await pool.query(
    `INSERT INTO users (name, email, password_hash, role) VALUES (?,?,?,?)
     ON DUPLICATE KEY UPDATE name = VALUES(name), password_hash = VALUES(password_hash)`,
    [name, mail, hash, role]);
  const [[u]] = await pool.query('SELECT id FROM users WHERE email = ?', [mail]);
  return u.id;
}

await upsertUser('Head of Department', email, password, 'HOD');
console.log(`H.O.D account ready: ${email}`);

if (demo) {
  const l1 = await upsertUser('Dr. Demo Lecturer', 'lecturer1@mmu.ac.ug', 'Lecturer123!', 'LECTURER');
  const l2 = await upsertUser('Ms. Second Lecturer', 'lecturer2@mmu.ac.ug', 'Lecturer123!', 'LECTURER');
  const rooms = {};
  for (const [code, name, cap, proj] of [['LH-101', 'Lecture Hall 101', 120, 1], ['LH-102', 'Lecture Hall 102', 60, 0]]) {
    const key = crypto.randomBytes(24).toString('hex');
    const [[exists]] = await pool.query('SELECT id FROM rooms WHERE code = ?', [code]);
    if (exists) { rooms[code] = { id: exists.id, key: '(already created; rotate the key in the dashboard)' }; continue; }
    const [r] = await pool.query('INSERT INTO rooms (code, name, capacity, has_projector, device_key_hash) VALUES (?,?,?,?,?)', [code, name, cap, proj, sha256(key)]);
    rooms[code] = { id: r.insertId, key };
  }
  await pool.query('INSERT IGNORE INTO rfid_cards (card_uid, user_id) VALUES (?, ?)', ['04A1B2C3', l1]);
  // A slot covering the whole day so the simulator always authorizes lecturer1 in LH-101.
  const today = localDate(new Date());
  const [[has]] = await pool.query('SELECT id FROM timetable_slots WHERE user_id=? AND room_id=? AND slot_date=?', [l1, rooms['LH-101'].id, today]);
  if (!has) await pool.query('INSERT INTO timetable_slots (user_id, room_id, slot_date, start_time, end_time, course_label) VALUES (?,?,?,?,?,?)',
    [l1, rooms['LH-101'].id, today, '00:00:00', '23:59:00', 'Demo: SE 301']);
  await pool.query("UPDATE settings SET value = CAST(value AS UNSIGNED) + 1 WHERE name = 'timetable_version'");
  console.log('\nDemo data created. Terminal credentials (save them now; shown once):');
  for (const [code, v] of Object.entries(rooms)) console.log(`  ${code}  device key: ${v.key}`);
  console.log('\nDemo lecturer card UID: 04A1B2C3   (lecturer1@mmu.ac.ug / Lecturer123!)');
}
await pool.end();
