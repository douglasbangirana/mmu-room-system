// Thin fetch wrapper: adds the JWT, parses JSON, throws readable errors.
const BASE = import.meta.env.VITE_API_URL || '/api';
const KEY = 'mmu_session';

export const session = {
  get() { try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; } },
  set(v) { localStorage.setItem(KEY, JSON.stringify(v)); },
  clear() { localStorage.removeItem(KEY); },
};

export async function api(path, { method = 'GET', body, raw = false } = {}) {
  const s = session.get();
  const res = await fetch(BASE + path, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(s ? { Authorization: `Bearer ${s.token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401 && s) { session.clear(); window.dispatchEvent(new Event('mmu-logout')); }
  if (raw) {
    if (!res.ok) throw new Error('Download failed');
    return res.blob();
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export async function download(path, filename) {
  const blob = await api(path, { raw: true });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

export const STATUS = {
  OCCUPIED_AUTHORIZED: { label: 'Occupied – Authorized', cls: 'ok' },
  OCCUPIED_UNAUTHORIZED: { label: 'Occupied – Unauthorized', cls: 'warn' },
  AVAILABLE: { label: 'Available', cls: 'free' },
  UNVERIFIED: { label: 'Status unverified', cls: 'off' },
};
