// Pure input validators (no dependencies) so they can be unit tested.
const TIME_RE = /^([01]?\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function normTime(t) {
  const m = TIME_RE.exec(String(t ?? '').trim());
  if (!m) return null;
  return `${m[1].padStart(2, '0')}:${m[2]}:${m[3] || '00'}`;
}

export function validDate(s) {
  const m = DATE_RE.exec(String(s ?? '').trim());
  if (!m) return false;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.getFullYear() === +m[1] && d.getMonth() === +m[2] - 1 && d.getDate() === +m[3];
}

