import { Router } from 'express';
import { pool, tx } from '../db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { bumpVersion } from '../services/settings.js';
import { logEvent } from '../services/audit.js';
import { parseCsv, validateRows } from '../services/timetableService.js';
import { ah, HttpError, localDate } from '../util.js';

const router = Router();
router.use(requireAuth, requireRole('HOD'));

// GET /api/timetable?date=YYYY-MM-DD
router.get('/', ah(async (req, res) => {
  const date = req.query.date || localDate(new Date());
  const [rows] = await pool.query(
    `SELECT t.id, t.slot_date, t.start_time, t.end_time, t.course_label, t.verification_status,
            u.name AS lecturer, u.email AS lecturer_email, r.code AS room_code
       FROM timetable_slots t JOIN users u ON u.id = t.user_id JOIN rooms r ON r.id = t.room_id
      WHERE t.slot_date = ? ORDER BY r.code, t.start_time`, [date]);
  res.json(rows);
}));

// POST /api/timetable/upload?dryRun=1  body: { csv: "..." }   (FR1, TC10)
router.post('/upload', ah(async (req, res) => {
  let rows;
  try { rows = parseCsv(String(req.body?.csv ?? '')); }
  catch (e) { throw new HttpError(400, e.message); }
  const dryRun = req.query.dryRun === '1';

  const out = await tx(async (c) => {
    const { valid, invalid } = await validateRows(c, rows);
    if (!dryRun && valid.length) {
      for (const v of valid) {
        await c.query(
          'INSERT INTO timetable_slots (user_id, room_id, slot_date, start_time, end_time, course_label) VALUES (?,?,?,?,?,?)',
          [v.user_id, v.room_id, v.slot_date, v.start_time, v.end_time, v.course_label]);
      }
      await bumpVersion(c);
      await logEvent(c, { when: new Date(), userId: req.user.id, type: 'TIMETABLE_UPLOAD', result: 'INFO', details: `${valid.length} slots added, ${invalid.length} rejected` });
    }
    return { valid, invalid };
  });
  res.json({ dryRun, created: dryRun ? 0 : out.valid.length, valid_count: out.valid.length, invalid: out.invalid });
}));

// POST /api/timetable   one slot from the form
router.post('/', ah(async (req, res) => {
  const row = { lecturer_email: req.body?.lecturer_email, room_code: req.body?.room_code, date: req.body?.date, start: req.body?.start, end: req.body?.end, course: req.body?.course };
  const id = await tx(async (c) => {
    const { valid, invalid } = await validateRows(c, [row], { firstRowNumber: 1 });
    if (invalid.length) throw new HttpError(400, invalid[0].errors.join('; '));
    const v = valid[0];
    const [r] = await c.query(
      'INSERT INTO timetable_slots (user_id, room_id, slot_date, start_time, end_time, course_label) VALUES (?,?,?,?,?,?)',
      [v.user_id, v.room_id, v.slot_date, v.start_time, v.end_time, v.course_label]);
    await bumpVersion(c);
    return r.insertId;
  });
  res.status(201).json({ id });
}));

// PUT /api/timetable/:id   edit a slot
router.put('/:id', ah(async (req, res) => {
  const row = { lecturer_email: req.body?.lecturer_email, room_code: req.body?.room_code, date: req.body?.date, start: req.body?.start, end: req.body?.end, course: req.body?.course };
  await tx(async (c) => {
    const { valid, invalid } = await validateRows(c, [row], { excludeId: Number(req.params.id), firstRowNumber: 1 });
    if (invalid.length) throw new HttpError(400, invalid[0].errors.join('; '));
    const v = valid[0];
    const [r] = await c.query(
      `UPDATE timetable_slots SET user_id=?, room_id=?, slot_date=?, start_time=?, end_time=?, course_label=?, verification_status='PENDING' WHERE id=?`,
      [v.user_id, v.room_id, v.slot_date, v.start_time, v.end_time, v.course_label, req.params.id]);
    if (!r.affectedRows) throw new HttpError(404, 'Slot not found');
    await bumpVersion(c);
  });
  res.json({ ok: true });
}));

router.delete('/:id', ah(async (req, res) => {
  try {
    await tx(async (c) => {
      const [r] = await c.query('DELETE FROM timetable_slots WHERE id = ?', [req.params.id]);
      if (!r.affectedRows) throw new HttpError(404, 'Slot not found');
      await bumpVersion(c);
    });
  } catch (e) {
    if (e.code === 'ER_ROW_IS_REFERENCED_2') throw new HttpError(409, 'This slot already has a recorded session and cannot be deleted');
    throw e;
  }
  res.json({ ok: true });
}));

export default router;
