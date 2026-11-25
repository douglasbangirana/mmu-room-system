// Small helpers shared across the server. Everything is campus-local time (TZ in config.js).

const pad = (n) => String(n).padStart(2, '0');

export const localDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const localTime = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
export const secondsOfDay = (d) => d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds();

/** 'HH:MM[:SS]' -> seconds since midnight. */
export function timeToSec(t) {
  const [h, m, s] = String(t).split(':').map(Number);
  return h * 3600 + (m || 0) * 60 + (s || 0);
}

/** Combine a 'YYYY-MM-DD' string and 'HH:MM:SS' string into a local Date. */
export function combine(dateStr, timeStr) {
  const [y, mo, d] = dateStr.split('-').map(Number);
  const sec = timeToSec(timeStr);
  return new Date(y, mo - 1, d, Math.floor(sec / 3600), Math.floor((sec % 3600) / 60), sec % 60);
}

export const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}
