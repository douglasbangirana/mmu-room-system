export const SETTING_KEYS = [
  'grace_minutes',
  'heartbeat_timeout_seconds',
  'autoclose_delay_minutes',
  'unauth_max_minutes',
];

export async function getSettings(conn) {
  const [rows] = await conn.query('SELECT name, value FROM settings');
  const s = {};
  for (const r of rows) s[r.name] = Number(r.value);
  return {
    grace_minutes: s.grace_minutes ?? 15,
    heartbeat_timeout_seconds: s.heartbeat_timeout_seconds ?? 90,
    autoclose_delay_minutes: s.autoclose_delay_minutes ?? 10,
    unauth_max_minutes: s.unauth_max_minutes ?? 180,
    timetable_version: s.timetable_version ?? 1,
  };
}

/** Terminals poll this number; when it changes they re-download their cache (FR2). */
export async function bumpVersion(conn) {
  await conn.query("UPDATE settings SET value = CAST(value AS UNSIGNED) + 1 WHERE name = 'timetable_version'");
}
