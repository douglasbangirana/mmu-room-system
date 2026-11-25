import { useEffect, useMemo, useState } from 'react';
import { api, STATUS } from '../api.js';
import { Icon } from '../icons.jsx';

const POLL_MS = 3000; // keeps the page within the 5 s update target (NFR1)
const iso = (d) => d.toLocaleDateString('en-CA');
const today = () => iso(new Date());
const timeOf = (v) => new Date(v).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
const sec = (t) => { const [h, m] = t.split(':').map(Number); return h * 3600 + m * 60; };
const initials = (n) => (n || '?').split(/[\s.]+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
const PALETTE = ['#f8cfcf', '#d6ecc9', '#d3d9f6', '#fbe3b8', '#cfe9f1'];
const tint = (s) => PALETTE[[...String(s)].reduce((a, c) => a + c.charCodeAt(0), 0) % PALETTE.length];

function lastDays(n) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    out.push({ iso: iso(d), label: d.toLocaleDateString([], { weekday: 'short' }).slice(0, 1), name: d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'short' }), today: i === 0 });
  }
  return out;
}

export function ago(v) {
  if (!v) return 'Never';
  const s = Math.max(0, Math.round((Date.now() - new Date(v)) / 1000));
  if (s < 60) return `${s} s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(v).toLocaleDateString();
}

function describe(e) {
  const room = e.room || 'a room', who = e.lecturer;
  switch (e.event_type) {
    case 'SWIPE_IN_AUTHORIZED': return { who: who || 'Lecturer', line: `Entered ${room}`, pill: ['Authorized', 'ok'] };
    case 'SWIPE_IN_UNAUTHORIZED': return { who: who || 'Lecturer', line: `Entered ${room}, not on the timetable`, pill: ['Unauthorized', 'warn'] };
    case 'SWIPE_OUT': return { who: who || 'Lecturer', line: `Left ${room}, now available`, pill: ['Signed out', 'free'] };
    case 'AUTO_CLOSED': return { who: who || 'System', line: `${room} closed automatically (no sign-out)`, pill: ['Auto-closed', 'warn'] };
    case 'CARD_REJECTED': return { who: 'Unknown card', line: `${e.card_uid || ''} at ${room}`, pill: ['Rejected', 'bad'], icon: 'card' };
    case 'TERMINAL_OFFLINE': return { who: room, line: 'Terminal stopped reporting', pill: ['Offline', 'off'], icon: 'wifioff' };
    case 'TERMINAL_ONLINE': return { who: room, line: 'Terminal back online', pill: ['Online', 'ok'], icon: 'wifi' };
    case 'ANOMALY_TWO_ROOMS': return { who: who || 'A card', line: 'Open in two rooms at once', pill: ['Check', 'bad'], icon: 'alert' };
    default: return { who: 'System', line: e.details || e.event_type.replace(/_/g, ' ').toLowerCase(), pill: ['Info', 'off'], icon: 'clock' };
  }
}

function Kpi({ id, primary, label, value, foot, active, onSelect }) {
  return (
    <button type="button" className={`kpi${primary ? ' primary' : ''}${active ? ' active' : ''}`} onClick={() => onSelect(id)} aria-pressed={active} aria-label={`${label}: ${value}. Show in the rooms table`}>
      <div className="kpi-top"><span>{label}</span><span className="kpi-go"><Icon name="arrow" size={16} /></span></div>
      <div className="kpi-num">{value}</div>
      <div className="kpi-foot"><i className="kdot" />{foot}</div>
    </button>
  );
}

function Analytics({ days, series }) {
  const max = Math.max(1, ...series.map((s) => s.total));
  const any = series.some((s) => s.total > 0);
  return (
    <section className="card a-ana">
      <div className="chead"><h3>Slot verification</h3><span className="muted small">Last 7 days</span></div>
      {!any ? <div className="empty">No booked slots in the last 7 days.</div> : (
        <div className="bars">
          {days.map((d, i) => {
            const s = series[i] || { verified: 0, total: 0 };
            const pct = s.total ? (s.verified / s.total) * 100 : 0;
            return (
              <div key={d.iso} className={`barcol${d.today ? ' today' : ''}`} title={`${d.name}: ${s.verified} of ${s.total} slots verified`}>
                <div className="barwrap">
                  {d.today && s.total > 0 && <span className="bubble">{Math.round(pct)}%</span>}
                  <div className="bar" style={{ height: `${Math.max(28, (s.total / max) * 130)}px` }}><div className="fill" style={{ height: `${pct}%` }} /></div>
                </div>
                <span className="dlabel">{d.label}</span>
              </div>
            );
          })}
        </div>
      )}
      <div className="legend inline"><span><i className="sw solid" />Verified</span><span><i className="sw hatch" />Not verified</span></div>
    </section>
  );
}

function NextUp({ slots, go }) {
  const d = new Date();
  const nowS = d.getHours() * 3600 + d.getMinutes() * 60;
  const next = slots.filter((s) => sec(s.end_time) > nowS).sort((a, b) => sec(a.start_time) - sec(b.start_time))[0];
  const cls = { VERIFIED: 'ok', PENDING: 'off', UNVERIFIED: 'warn' };
  return (
    <section className="card a-next">
      <h3>Next on the timetable</h3>
      {next ? (
        <div className="next">
          <div className="next-t">{next.course_label || 'Booked slot'}</div>
          <div className="muted">{next.lecturer} · {next.room_code}</div>
          <div className="next-time"><Icon name="clock" size={16} />{next.start_time.slice(0, 5)} – {next.end_time.slice(0, 5)}<span className={`pill ${cls[next.verification_status]}`}>{next.verification_status.toLowerCase()}</span></div>
        </div>
      ) : <div className="muted next">No more booked slots today.</div>}
      <button className="btn block" onClick={() => go('timetable')}>Open timetable</button>
    </section>
  );
}

function Attention({ rooms, onView }) {
  const list = rooms.filter((r) => r.status === 'OCCUPIED_UNAUTHORIZED' || r.status === 'UNVERIFIED');
  return (
    <section className="card a-att">
      <div className="chead"><h3>Needs attention</h3><span className="count">{list.length}</span></div>
      {list.length === 0 ? <div className="allgood"><Icon name="check" size={18} />All rooms are healthy.</div> : (
        <ul className="plist">
          {list.slice(0, 4).map((r) => {
            const off = r.status === 'UNVERIFIED';
            return (
              <li key={r.id}>
                <span className={`pico ${off ? 'off' : 'warn'}`}><Icon name={off ? 'wifioff' : 'alert'} size={18} /></span>
                <div><b>{r.code}</b><span className="muted small">{off ? 'Terminal not reporting' : `Unauthorized: ${r.occupant || 'unknown'}`}</span></div>
                <button className="btn ghost small" onClick={() => onView(r)}>View</button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

const ARC = 'M 20 100 A 80 80 0 0 1 180 100';
function Gauge({ c }) {
  const parts = [
    { key: 'auth', n: c.auth, color: 'var(--ok-solid)', label: 'Occupied \u2013 Authorized' },
    { key: 'unauth', n: c.unauth, color: 'var(--warn-solid)', label: 'Occupied \u2013 Unauthorized' },
    { key: 'off', n: c.off, color: 'var(--off-solid)', label: 'Status unverified' },
    { key: 'free', n: c.free, color: 'url(#hatchFree)', label: 'Available' },
  ];
  const pct = c.total ? Math.round(((c.auth + c.unauth) / c.total) * 100) : 0;
  let used = 0;
  return (
    <section className="card a-gau">
      <h3>Room occupancy</h3>
      <svg viewBox="0 0 200 118" className="gauge" role="img" aria-label={`${pct} percent of rooms are occupied`}>
        <defs>
          <pattern id="hatchFree" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="6" height="6" style={{ fill: 'var(--free-bg)' }} /><line x1="0" y1="0" x2="0" y2="6" style={{ stroke: 'var(--free-solid)' }} strokeWidth="2.4" />
          </pattern>
        </defs>
        <path d={ARC} pathLength="100" fill="none" style={{ stroke: 'var(--line)' }} strokeWidth="26" />
        {c.total > 0 && parts.filter((p) => p.n > 0).map((p) => {
          const len = (p.n / c.total) * 100;
          const el = <path key={p.key} d={ARC} pathLength="100" fill="none" style={{ stroke: p.color }} strokeWidth="26" strokeDasharray={`${len} ${100 - len}`} strokeDashoffset={-used} />;
          used += len;
          return el;
        })}
        <text x="100" y="88" textAnchor="middle" className="g-n">{pct}%</text>
        <text x="100" y="106" textAnchor="middle" className="g-l">Rooms occupied</text>
      </svg>
      <ul className="legend">
        {parts.filter((p) => p.n > 0 || p.key !== 'off').map((p) => (
          <li key={p.key}><i className={`sw ${p.key === 'free' ? 'hatchblue' : ''}`} style={p.key === 'free' ? undefined : { background: p.color }} />{p.label} ({p.n})</li>
        ))}
      </ul>
    </section>
  );
}

function Terminals({ rooms }) {
  const online = rooms.filter((r) => r.status !== 'UNVERIFIED').length;
  const list = [...rooms].sort((a, b) => (a.status === 'UNVERIFIED' ? -1 : 0) - (b.status === 'UNVERIFIED' ? -1 : 0)).slice(0, 3);
  return (
    <section className="card dark a-trm">
      <h3>Terminals</h3>
      <div className="trm-n"><b>{online}</b><span>/ {rooms.length}</span></div>
      <div className="trm-l">reporting right now</div>
      <ul className="trm-list">
        {list.map((r) => <li key={r.id}><i className={`pip ${r.status === 'UNVERIFIED' ? 'off' : 'on'}`} />{r.code}<em>{ago(r.last_heartbeat)}</em></li>)}
      </ul>
    </section>
  );
}

export function Activity({ events, go, compact }) {
  return (
    <section className={compact ? '' : 'card a-act'}>
      {!compact && <div className="chead"><h3>Recent activity</h3><button className="linkbtn" onClick={() => go && go('logs')}>View all {'\u2192'}</button></div>}
      {events.length === 0 ? <div className="empty">No activity yet today.</div> : (
        <ul className="acts">
          {events.slice(0, compact ? 5 : 5).map((e) => {
            const d = describe(e);
            return (
              <li key={e.id} className="act">
                <span className="avatar" style={d.icon ? undefined : { background: tint(d.who) }}>{d.icon ? <Icon name={d.icon} size={18} /> : initials(d.who)}</span>
                <div className="act-m"><b>{d.who}</b><span className="muted small">{d.line}</span></div>
                <span className="act-r"><span className={`pill ${d.pill[1]}`}>{d.pill[0]}</span><time>{timeOf(e.event_time)}</time></span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

const DAY_MS = 86400000;
const startOf = (s) => new Date(`${s.slot_date}T${s.start_time}`);
const endOf = (s) => new Date(`${s.slot_date}T${s.end_time}`);
function dayLabel(isoDate) {
  const d = new Date(`${isoDate}T00:00:00`);
  const t0 = new Date(); t0.setHours(0, 0, 0, 0);
  const diff = Math.round((d - t0) / DAY_MS);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  return d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'short' });
}
function until(ms) {
  const m = Math.max(0, Math.round(ms / 60000));
  if (m < 60) return `in ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `in ${h} h${m % 60 ? ` ${m % 60} min` : ''}`;
  return `in ${Math.round(h / 24)} d`;
}
function weekLabel() {
  const t = new Date();
  const mon = new Date(t); mon.setDate(t.getDate() - ((t.getDay() + 6) % 7));
  const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
  const f = (d) => d.toLocaleDateString([], { day: 'numeric', month: 'short' });
  return `${f(mon)} \u2013 ${f(sun)}`;
}

/** A lecturer's own lectures for the rest of this week, grouped by day. */
function MyLectures({ items }) {
  const now = new Date();
  const rows = (items || []).map((s) => ({ ...s, st: startOf(s), en: endOf(s) }));
  const left = rows.filter((s) => s.en > now);              // in progress, or still to come
  const held = rows.length - left.length;
  const next = left.find((s) => s.st > now);
  const groups = [];
  left.forEach((s) => {
    const g = groups[groups.length - 1];
    if (g && g.date === s.slot_date) g.items.push(s); else groups.push({ date: s.slot_date, items: [s] });
  });
  return (
    <section className="card a-mine">
      <div className="chead"><h3>My lectures this week</h3><span className="muted small">{weekLabel()}</span></div>
      {items === null ? <div className="empty">Loading…</div>
        : left.length === 0 ? <div className="empty">{rows.length ? 'No more lectures this week.' : 'No lectures are booked for you this week.'}</div>
        : (
          <div className="mine">
            {groups.map((g) => (
              <div key={g.date} className="mday">
                <div className="mdate">{dayLabel(g.date)}</div>
                {g.items.map((s) => {
                  const live = s.st <= now && s.en > now;
                  return (
                    <div key={s.id} className={`mrow${live ? ' live' : ''}`}>
                      <span className="mtime">{s.start_time.slice(0, 5)}<i>{s.end_time.slice(0, 5)}</i></span>
                      <div className="mmain">
                        <b>{s.course_label || 'Lecture'}</b>
                        <span className="muted small">{s.room_code}{s.room_name && s.room_name !== s.room_code ? ` \u00B7 ${s.room_name}` : ''}</span>
                      </div>
                      <span className="mpills">
                        {live && <span className="pill ok">In progress</span>}
                        {live && (s.verification_status === 'VERIFIED' ? <span className="pill ok">Checked in</span> : <span className="pill warn">Not checked in</span>)}
                        {!live && s === next && <span className="pill free">Next {until(s.st - now)}</span>}
                      </span>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        )}
      {rows.length > 0 && <div className="muted small">{left.length} still to come{held ? ` \u00B7 ${held} already held` : ''}</div>}
    </section>
  );
}

function RoomModal({ room, isHod, onClose }) {
  const [events, setEvents] = useState([]);
  const s = STATUS[room.status];
  useEffect(() => {
    const key = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onClose]);
  useEffect(() => {
    if (!isHod) return;
    api(`/logs?from=${today()}&to=${today()}&room_id=${room.id}&limit=5`).then(setEvents).catch(() => {});
  }, [room.id, isHod]);
  return (
    <div className="overlay" onClick={onClose}>
      <div className="card modal" role="dialog" aria-modal="true" aria-label={`Room ${room.code}`} onClick={(e) => e.stopPropagation()}>
        <div className="chead"><h2>{room.code} <span className="muted">{room.name}</span></h2><button className="btn ghost small" onClick={onClose} autoFocus>Close</button></div>
        <span className={`badge ${s.cls}`} style={{ justifySelf: 'start' }}>{s.label}</span>
        <dl className="dl">
          <dt>Capacity</dt><dd>{room.capacity} seats</dd>
          <dt>Projector</dt><dd>{room.has_projector ? 'Yes' : 'No'}</dd>
          <dt>Terminal last heard</dt><dd>{ago(room.last_heartbeat)}</dd>
          {isHod && room.occupant && (<><dt>Inside now</dt><dd>{room.occupant}</dd></>)}
          {isHod && room.since && (<><dt>Since</dt><dd>{timeOf(room.since)}</dd></>)}
        </dl>
        {isHod && (<><h3>Today in this room</h3><Activity events={events} compact /></>)}
      </div>
    </div>
  );
}

const FILTERS = [['all', 'All'], ['free', 'Available'], ['occ', 'Occupied'], ['alert', 'Alerts']];
const matches = (f, r) => f === 'all' || (f === 'free' && r.status === 'AVAILABLE') || (f === 'occ' && r.status.startsWith('OCCUPIED')) || (f === 'alert' && (r.status === 'OCCUPIED_UNAUTHORIZED' || r.status === 'UNVERIFIED'));

export default function Rooms({ user, go, query = '' }) {
  const isHod = user.role === 'HOD';
  const days = useMemo(() => lastDays(7), []);
  const [rooms, setRooms] = useState(null);
  const [events, setEvents] = useState([]);
  const [slots, setSlots] = useState([]);
  const [series, setSeries] = useState([]);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('all');
  const [needProjector, setNeedProjector] = useState(false);
  const [minCap, setMinCap] = useState('');
  const [updated, setUpdated] = useState(null);
  const [open, setOpen] = useState(null);
  const [mine, setMine] = useState(null);

  useEffect(() => {
    let live = true;
    const load = async () => {
      try {
        const d = await api('/rooms');
        if (!live) return;
        setRooms(d.rooms); setUpdated(new Date()); setError('');
        if (isHod) { const e = await api(`/logs?from=${today()}&to=${today()}&limit=8`); if (live) setEvents(e); }
      } catch (e) { if (live) setError(e.message); }
    };
    load();
    const t = setInterval(load, POLL_MS);
    return () => { live = false; clearInterval(t); };
  }, [isHod]);

  useEffect(() => {
    if (!isHod) return undefined;
    let live = true;
    const load = async () => {
      try {
        const [tt, ...sums] = await Promise.all([api(`/timetable?date=${today()}`), ...days.map((d) => api(`/summary?from=${d.iso}&to=${d.iso}`))]);
        if (!live) return;
        setSlots(tt);
        setSeries(sums.map((s) => ({ verified: s.verified, total: s.verified + s.unverified + s.pending })));
      } catch { /* the cards simply stay empty */ }
    };
    load();
    const t = setInterval(load, 60000);
    return () => { live = false; clearInterval(t); };
  }, [isHod, days]);

  useEffect(() => {
    if (isHod) return undefined;
    let live = true;
    const load = async () => {
      try { const d = await api('/me/lectures'); if (live) setMine(d); }
      catch { if (live) setMine((m) => m || []); }
    };
    load();
    const t = setInterval(load, 60000);
    return () => { live = false; clearInterval(t); };
  }, [isHod]);

  const list = rooms || [];
  const c = useMemo(() => {
    const n = { total: 0, free: 0, auth: 0, unauth: 0, off: 0 };
    list.forEach((r) => {
      n.total++;
      if (r.status === 'AVAILABLE') n.free++;
      else if (r.status === 'OCCUPIED_AUTHORIZED') n.auth++;
      else if (r.status === 'OCCUPIED_UNAUTHORIZED') n.unauth++;
      else n.off++;
    });
    return n;
  }, [rooms]); // eslint-disable-line react-hooks/exhaustive-deps

  const q = query.trim().toLowerCase();
  const shown = list.filter((r) => matches(filter, r) && (!needProjector || r.has_projector) && (!minCap || r.capacity >= Number(minCap))
    && (!q || `${r.code} ${r.name} ${r.occupant || ''}`.toLowerCase().includes(q)));
  const freePct = c.total ? Math.round((c.free / c.total) * 100) : 0;

  return (
    <div className={`dash${isHod ? '' : ' lecturer'}`}>
      {error ? <div className="msg err a-msg" role="alert">{error}</div>
        : isHod && list.length > 0 && list.every((r) => !r.last_heartbeat) ? (
          <div className="msg info a-msg" role="status">No terminal has connected yet, so every room shows as unverified. <button className="linkbtn" onClick={() => go && go('terminals')}>Open Terminals</button> to see the address your ESP32 needs and to watch it come online.</div>
        ) : null}
      <div className="kpis">
        <Kpi id="all" primary label="Total rooms" value={c.total} foot="Across every terminal" active={filter === 'all'} onSelect={setFilter} />
        <Kpi id="free" label="Available" value={c.free} foot={`${freePct}% of all rooms`} active={filter === 'free'} onSelect={setFilter} />
        <Kpi id="occ" label="Occupied" value={c.auth + c.unauth} foot={`${c.auth} authorized \u00B7 ${c.unauth} unauthorized`} active={filter === 'occ'} onSelect={setFilter} />
        <Kpi id="alert" label="Alerts" value={c.unauth + c.off} foot={c.unauth + c.off ? `${c.unauth} unauthorized \u00B7 ${c.off} offline` : 'All clear'} active={filter === 'alert'} onSelect={setFilter} />
      </div>

      {!isHod && <MyLectures items={mine} />}
      {isHod && <Analytics days={days} series={series} />}
      {isHod && <NextUp slots={slots} go={go} />}
      {isHod && <Attention rooms={list} onView={setOpen} />}

      <section className="card a-tbl">
        <div className="chead">
          <h3>Lecture rooms</h3>
          <div className="filters">
            <div className="seg" role="group" aria-label="Filter by status">
              {FILTERS.map(([k, l]) => <button key={k} type="button" aria-pressed={filter === k} onClick={() => setFilter(k)}>{l}</button>)}
            </div>
            <label>Seats <input type="number" min="0" value={minCap} onChange={(e) => setMinCap(e.target.value)} aria-label="Seats needed" /></label>
            <label><input type="checkbox" checked={needProjector} onChange={(e) => setNeedProjector(e.target.checked)} />Projector</label>
          </div>
        </div>
        {rooms && shown.length === 0 ? <div className="empty">No rooms match. Clear a filter or the search to see more.</div> : (
          <div className="tablewrap">
            <table>
              <thead><tr><th>Room</th><th>Status</th><th>Capacity</th><th>Projector</th><th>Action</th></tr></thead>
              <tbody>
                {shown.map((r) => {
                  const s = STATUS[r.status];
                  return (
                    <tr key={r.id}>
                      <td><b>{r.code}</b><div className="muted small">{r.name}</div></td>
                      <td><span className={`badge ${s.cls}`}>{s.label}</span></td>
                      <td>{r.capacity}</td>
                      <td>{r.has_projector ? 'Yes' : 'No'}</td>
                      <td><button className="btn ghost small" onClick={() => setOpen(r)}>View</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <span className="muted small">{updated ? `Updated ${updated.toLocaleTimeString()}` : 'Loading\u2026'}. Grey means the room’s terminal is not reporting, so its status cannot be trusted.</span>
      </section>

      <Gauge c={c} />
      {isHod && <Terminals rooms={list} />}
      {isHod && <Activity events={events} go={go} />}

      {open && <RoomModal room={list.find((r) => r.id === open.id) || open} isHod={isHod} onClose={() => setOpen(null)} />}
    </div>
  );
}
