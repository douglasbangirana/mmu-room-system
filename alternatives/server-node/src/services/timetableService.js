import { parse } from 'csv-parse/sync';
import { timeToSec } from '../util.js';

import { normTime, validDate } from './validators.js';

export const REQUIRED_HEADERS = ['lecturer_email', 'room_code', 'date', 'start', 'end'];

const overlaps = (a, b) => a.start_sec < b.end_sec && a.end_sec > b.start_sec;

/** Parse CSV text into row objects. Throws a readable error if headers are missing. */
export function parseCsv(text) {
  const rows = parse(text, {
    columns: (h) => h.map((x) => String(x).trim().toLowerCase()),
    skip_empty_lines: true,
    trim: true,
    bom: true,
    relax_column_count: true,
  });
  if (rows.length === 0) throw new Error('The CSV file has no data rows.');
  const missing = REQUIRED_HEADERS.filter((h) => !(h in rows[0]));
  if (missing.length) throw new Error(`Missing CSV column(s): ${missing.join(', ')}`);
  return rows;
}

/**
 * Validate rows against users, rooms and existing slots (FR1: invalid rows are rejected with a message).
 * @param excludeId  slot id being edited, so it does not clash with itself
 * @returns {{valid: object[], invalid: {row:number, data:object, errors:string[]}[]}}
 */
export async function validateRows(conn, rows, { excludeId = null, firstRowNumber = 2 } = {}) {
  const [users] = await conn.query("SELECT id, email FROM users WHERE role = 'LECTURER' AND active = 1");
  const [rooms] = await conn.query('SELECT id, code FROM rooms WHERE active = 1');
  const userByEmail = new Map(users.map((u) => [u.email.toLowerCase(), u.id]));
  const roomByCode = new Map(rooms.map((r) => [r.code.toLowerCase(), r.id]));

  const dates = [...new Set(rows.map((r) => String(r.date ?? '').trim()).filter(validDate))];
  let existing = [];
  if (dates.length) {
    [existing] = await conn.query(
      'SELECT id, user_id, room_id, slot_date, start_time, end_time FROM timetable_slots WHERE slot_date IN (?)',
      [dates]
    );
  }
  const pool = existing
    .filter((e) => e.id !== excludeId)
    .map((e) => ({ user_id: e.user_id, room_id: e.room_id, date: e.slot_date, start_sec: timeToSec(e.start_time), end_sec: timeToSec(e.end_time) }));

  const valid = [];
  const invalid = [];

  rows.forEach((raw, i) => {
    const errors = [];
    const date = String(raw.date ?? '').trim();
    const start = normTime(raw.start);
    const end = normTime(raw.end);
    const userId = userByEmail.get(String(raw.lecturer_email ?? '').trim().toLowerCase());
    const roomId = roomByCode.get(String(raw.room_code ?? '').trim().toLowerCase());

    if (!userId) errors.push(`Lecturer "${raw.lecturer_email ?? ''}" not found or inactive`);
    if (!roomId) errors.push(`Room "${raw.room_code ?? ''}" not found`);
    if (!validDate(date)) errors.push('Date must be YYYY-MM-DD');
    if (!start) errors.push('Start time must be HH:MM');
    if (!end) errors.push('End time must be HH:MM');
    if (start && end && timeToSec(end) <= timeToSec(start)) errors.push('End time must be after start time');

    if (!errors.length) {
      const cand = { user_id: userId, room_id: roomId, date, start_sec: timeToSec(start), end_sec: timeToSec(end) };
      const clash = pool.find((p) => p.date === date && overlaps(p, cand) && (p.room_id === roomId || p.user_id === userId));
      if (clash) errors.push(clash.room_id === roomId ? 'Room is already booked at that time' : 'Lecturer already has a slot at that time');
      else pool.push(cand); // later rows in the same file are checked against this one
    }

    if (errors.length) {
      invalid.push({ row: i + firstRowNumber, data: raw, errors });
    } else {
      valid.push({
        row: i + firstRowNumber,
        user_id: userId,
        room_id: roomId,
        slot_date: date,
        start_time: start,
        end_time: end,
        course_label: String(raw.course ?? '').trim().slice(0, 120) || null,
      });
    }
  });

  return { valid, invalid };
}

/** Today's slots for one room, shaped for the terminal's cache (small, denormalised). */
export async function buildTerminalCache(conn, room, dateStr, settings) {
  const [slots] = await conn.query(
    `SELECT t.id, t.start_time, t.end_time, t.course_label, u.id AS user_id, u.name
       FROM timetable_slots t JOIN users u ON u.id = t.user_id AND u.active = 1
      WHERE t.room_id = ? AND t.slot_date = ? ORDER BY t.start_time`,
    [room.id, dateStr]
  );
  const userIds = [...new Set(slots.map((s) => s.user_id))];
  let cards = [];
  if (userIds.length) {
    [cards] = await conn.query("SELECT user_id, card_uid FROM rfid_cards WHERE status = 'ACTIVE' AND user_id IN (?)", [userIds]);
  }
  return {
    version: settings.timetable_version,
    date: dateStr,
    server_time: Math.floor(Date.now() / 1000),
    tz_offset_sec: -new Date().getTimezoneOffset() * 60,
    grace_sec: settings.grace_minutes * 60,
    slots: slots.map((s) => ({
      name: s.name,
      course: s.course_label || '',
      start: timeToSec(s.start_time),
      end: timeToSec(s.end_time),
      uids: cards.filter((c) => c.user_id === s.user_id).map((c) => c.card_uid),
    })),
  };
}
