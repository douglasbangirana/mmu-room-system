import { useCallback, useEffect, useState } from 'react';
import { api, download } from '../api.js';

const today = () => new Date().toLocaleDateString('en-CA');
const TYPES = ['SWIPE_IN_AUTHORIZED', 'SWIPE_IN_UNAUTHORIZED', 'SWIPE_OUT', 'CARD_REJECTED', 'AUTO_CLOSED', 'ANOMALY_TWO_ROOMS', 'TERMINAL_OFFLINE', 'TERMINAL_ONLINE', 'TIMETABLE_UPLOAD'];

export default function Logs({ query = '' }) {
  const [f, setF] = useState({ from: today(), to: today(), room_id: '', type: '', flagged: false });
  const [rows, setRows] = useState([]);
  const [sum, setSum] = useState(null);
  const [rooms, setRooms] = useState([]);
  const [err, setErr] = useState('');

  const qs = useCallback(() => {
    const p = new URLSearchParams({ from: f.from, to: f.to });
    if (f.room_id) p.set('room_id', f.room_id);
    if (f.type) p.set('type', f.type);
    if (f.flagged) p.set('flagged', '1');
    return p.toString();
  }, [f]);

  const load = useCallback(async () => {
    try {
      const [l, s] = await Promise.all([api(`/logs?${qs()}`), api(`/summary?from=${f.from}&to=${f.to}`)]);
      setRows(l); setSum(s); setErr('');
    } catch (e) { setErr(e.message); }
  }, [qs, f.from, f.to]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { api('/rooms/manage').then(setRooms).catch(() => {}); }, []);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  const needle = query.trim().toLowerCase();
  const shownRows = needle ? rows.filter((r) => `${r.room || ''} ${r.lecturer || ''} ${r.card_uid || ''} ${r.event_type} ${r.result} ${r.details || ''}`.toLowerCase().includes(needle)) : rows;

  return (
    <>
      <div className="panel">
        <h2>Filters</h2>
        <div className="row">
          <label>From<input type="date" value={f.from} onChange={set('from')} /></label>
          <label>To<input type="date" value={f.to} onChange={set('to')} /></label>
          <label>Room<select value={f.room_id} onChange={set('room_id')}><option value="">All</option>{rooms.map((r) => <option key={r.id} value={r.id}>{r.code}</option>)}</select></label>
          <label>Event<select value={f.type} onChange={set('type')}><option value="">All</option>{TYPES.map((t) => <option key={t}>{t}</option>)}</select></label>
          <label style={{ flexDirection: 'row', display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={f.flagged} onChange={set('flagged')} />Flagged only</label>
          <button className="btn" onClick={() => download(`/logs?${qs()}&format=csv`, `event-log-${f.from}_${f.to}.csv`).catch((e) => setErr(e.message))}>Export CSV</button>
        </div>
        {err && <div className="msg err" role="alert">{err}</div>}
      </div>

      {sum && (
        <div className="panel">
          <h2>Summary</h2>
          <div className="stats">
            <div className="stat"><b>{sum.verified}</b>Verified slots</div>
            <div className="stat"><b>{sum.unverified}</b>Unverified slots</div>
            <div className="stat"><b>{sum.ghost_booking_pct ?? '–'}{sum.ghost_booking_pct != null && '%'}</b>Ghost-booking frequency</div>
            <div className="stat"><b>{sum.exposure_minutes}</b>Minutes shown occupied but vacant</div>
            <div className="stat"><b>{sum.unauthorized_sessions}</b>Unauthorized sessions</div>
            <div className="stat"><b>{sum.sessions_without_signout}</b>Sessions without sign-out</div>
          </div>
          {sum.per_room.length > 0 && (
            <div className="tablewrap"><table>
              <thead><tr><th>Room</th><th>Verified</th><th>Unverified</th><th>Pending</th><th>Exposure (min)</th></tr></thead>
              <tbody>{sum.per_room.map((r) => <tr key={r.room}><td>{r.room}</td><td>{r.verified}</td><td>{r.unverified}</td><td>{r.pending}</td><td>{r.exposure_minutes}</td></tr>)}</tbody>
            </table></div>
          )}
        </div>
      )}

      <div className="panel">
        <h2>Event log</h2>
        {shownRows.length === 0 ? <div className="empty">{needle ? 'No events match your search.' : 'No events in this range.'}</div> : (
          <div className="tablewrap"><table>
            <thead><tr><th>Time</th><th>Room</th><th>Lecturer</th><th>Card</th><th>Event</th><th>Result</th><th>Notes</th></tr></thead>
            <tbody>{shownRows.map((r) => (
              <tr key={r.id} className={r.flagged ? 'flag' : ''}>
                <td>{new Date(r.event_time).toLocaleString()}{r.synced_late ? ' (late sync)' : ''}</td>
                <td>{r.room}</td><td>{r.lecturer}</td><td>{r.card_uid}</td><td>{r.event_type}</td><td>{r.result}</td><td>{r.details}</td></tr>
            ))}</tbody>
          </table></div>
        )}
      </div>
    </>
  );
}
