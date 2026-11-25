import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';

const LABELS = {
  grace_minutes: 'Early-arrival grace period (minutes)',
  heartbeat_timeout_seconds: 'Terminal silent after (seconds)',
  autoclose_delay_minutes: 'Auto-close after slot ends (minutes)',
  unauth_max_minutes: 'Auto-close unauthorized sessions after (minutes)',
};

export default function Setup({ query = '' }) {
  const [rooms, setRooms] = useState([]);
  const [settings, setSettings] = useState(null);
  const [nr, setNr] = useState({ code: '', name: '', capacity: '', has_projector: false });
  const [key, setKey] = useState(null);
  const [msg, setMsg] = useState(null);
  const say = (text, good = false) => setMsg({ text, good });

  const load = useCallback(async () => {
    try { setRooms(await api('/rooms/manage')); setSettings(await api('/settings')); } catch (e) { say(e.message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function addRoom(e) {
    e.preventDefault();
    try {
      const r = await api('/rooms', { method: 'POST', body: nr });
      setKey({ code: r.code, key: r.device_key }); setNr({ code: '', name: '', capacity: '', has_projector: false }); load();
    } catch (err) { say(err.message); }
  }
  async function rotate(r) {
    if (!window.confirm(`Rotate the device key for ${r.code}? The current terminal will stop working until reflashed.`)) return;
    try { const d = await api(`/rooms/${r.id}/rotate-key`, { method: 'POST' }); setKey({ code: r.code, key: d.device_key }); } catch (err) { say(err.message); }
  }
  const patch = async (r, body) => { try { await api(`/rooms/${r.id}`, { method: 'PATCH', body }); load(); } catch (err) { say(err.message); } };
  async function saveSettings(e) {
    e.preventDefault();
    try { await api('/settings', { method: 'PUT', body: settings }); say('Settings saved. They apply immediately.', true); } catch (err) { say(err.message); }
  }

  const needle = query.trim().toLowerCase();
  const shownRooms = needle ? rooms.filter((r) => `${r.code} ${r.name}`.toLowerCase().includes(needle)) : rooms;

  return (
    <>
      {msg && <div className={`msg ${msg.good ? 'good' : 'err'}`} role="status">{msg.text}</div>}
      {key && (
        <div className="panel">
          <h2>Device key for {key.code}</h2>
          <p className="muted">Copy this into the terminal's <code>config.h</code> now. It is shown only once.</p>
          <input readOnly value={key.key} onFocus={(e) => e.target.select()} aria-label="Device key" />
          <button className="btn ghost" onClick={() => setKey(null)}>I have copied it</button>
        </div>
      )}

      <form className="panel" onSubmit={addRoom}>
        <h2>Add a room</h2>
        <div className="row">
          <label>Code<input value={nr.code} onChange={(e) => setNr({ ...nr, code: e.target.value })} placeholder="LH-101" required /></label>
          <label>Name<input value={nr.name} onChange={(e) => setNr({ ...nr, name: e.target.value })} required /></label>
          <label>Seats<input type="number" min="0" value={nr.capacity} onChange={(e) => setNr({ ...nr, capacity: e.target.value })} style={{ width: 90 }} /></label>
          <label style={{ flexDirection: 'row', display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={nr.has_projector} onChange={(e) => setNr({ ...nr, has_projector: e.target.checked })} />Projector</label>
          <button className="btn">Add room</button>
        </div>
      </form>

      <div className="panel">
        <h2>Rooms</h2>
        <div className="tablewrap"><table>
          <thead><tr><th>Code</th><th>Name</th><th>Seats</th><th>Projector</th><th>Last heard</th><th></th></tr></thead>
          <tbody>{shownRooms.map((r) => (
            <tr key={r.id}><td>{r.code}</td><td>{r.name}{!r.active && <span className="pill off" style={{ marginLeft: 8 }}>Retired</span>}</td>
              <td><input type="number" defaultValue={r.capacity} style={{ width: 80 }} aria-label={`Seats in ${r.code}`}
                onBlur={(e) => Number(e.target.value) !== r.capacity && patch(r, { capacity: e.target.value })} /></td>
              <td><input type="checkbox" checked={!!r.has_projector} onChange={(e) => patch(r, { has_projector: e.target.checked })} aria-label={`Projector in ${r.code}`} /></td>
              <td>{r.last_heartbeat ? new Date(r.last_heartbeat).toLocaleString() : 'Never'}</td>
              <td><button className="btn small ghost" onClick={() => rotate(r)}>Rotate key</button>{' '}
                {r.active
                  ? <button className="btn small danger" onClick={() => patch(r, { active: false })}>Retire</button>
                  : <button className="btn small" onClick={() => patch(r, { active: true })}>Reactivate</button>}</td></tr>
          ))}</tbody>
        </table></div>
      </div>

      {settings && (
        <form className="panel" onSubmit={saveSettings}>
          <h2>Rules</h2>
          <div className="row">
            {Object.keys(LABELS).map((k) => (
              <label key={k}>{LABELS[k]}<input type="number" min="0" value={settings[k]} onChange={(e) => setSettings({ ...settings, [k]: e.target.value })} /></label>
            ))}
            <button className="btn">Save rules</button>
          </div>
        </form>
      )}
    </>
  );
}
