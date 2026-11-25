import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Icon } from '../icons.jsx';
import { Activity, ago } from './Rooms.jsx';

const POLL_MS = 3000;
const iso = (d) => d.toLocaleDateString('en-CA');
const STATE = {
  ONLINE: { cls: 'ok', label: 'Online' },
  SILENT: { cls: 'warn', label: 'Silent' },
  WAITING: { cls: 'off', label: 'Waiting for first heartbeat' },
};
const SIGNAL = { excellent: 'Excellent', good: 'Good', fair: 'Fair', weak: 'Weak', unknown: 'No data' };

function uptime(s) {
  if (s == null) return '\u2013';
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.floor(s / 60)} min`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min`;
  return `${Math.floor(s / 86400)} d ${Math.floor((s % 86400) / 3600)} h`;
}

function SignalBars({ signal, rssi }) {
  const n = { excellent: 4, good: 3, fair: 2, weak: 1, unknown: 0 }[signal];
  return (
    <span className={`sig ${signal}`} title={rssi == null ? 'No signal data yet' : `${rssi} dBm`}>
      <span className="sigbars" aria-hidden="true">{[1, 2, 3, 4].map((i) => <i key={i} className={i <= n ? 'on' : ''} style={{ height: `${4 + i * 3}px` }} />)}</span>
      {SIGNAL[signal]}{rssi != null && <span className="muted small"> {rssi} dBm</span>}
    </span>
  );
}

export default function Terminals() {
  const [data, setData] = useState(null);
  const [sys, setSys] = useState(null);
  const [events, setEvents] = useState([]);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let live = true;
    const load = async () => {
      try {
        const [t, e] = await Promise.all([api('/terminals'), api(`/logs?from=${iso(new Date())}&to=${iso(new Date())}&limit=8`)]);
        if (live) { setData(t); setEvents(e); setError(''); }
      } catch (err) { if (live) setError(err.message); }
    };
    load();
    const t = setInterval(load, POLL_MS);
    return () => { live = false; clearInterval(t); };
  }, []);
  useEffect(() => {
    let live = true;
    const load = () => api('/system').then((s) => live && setSys(s)).catch(() => {});
    load();
    const t = setInterval(load, 60000);
    return () => { live = false; clearInterval(t); };
  }, []);

  const rows = data ? data.terminals : [];
  const count = (st) => rows.filter((r) => r.state === st).length;
  const queued = rows.reduce((a, r) => a + (r.queue_len || 0), 0);
  const allWaiting = rows.length > 0 && rows.every((r) => r.state === 'WAITING');

  async function copy(text) {
    try { await navigator.clipboard.writeText(text); } catch { /* clipboard may be blocked: the text is still selectable */ }
    setCopied(true); setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="termpage">
      {error && <div className="msg err" role="alert">{error}</div>}

      <section className="card">
        <div className="chead"><h3>Connect a terminal</h3>{sys && <span className="muted small">Server v{sys.version} {'\u00B7'} database {sys.database}</span>}</div>
        {sys && sys.recommended ? (
          <>
            <p className="muted">Give every ESP32 this address. It must be on the same Wi-Fi as this computer.</p>
            <div className="addr"><code>{sys.recommended}</code><button className="btn small" onClick={() => copy(sys.recommended)}><Icon name="copy" size={14} />{copied ? 'Copied' : 'Copy'}</button></div>
            {sys.api_bases.length > 1 && <p className="muted small">Other addresses this computer has: {sys.api_bases.slice(1).join(', ')}. Use one of these only if the first does not work.</p>}
          </>
        ) : <div className="msg err">This computer&rsquo;s Wi-Fi address could not be detected. Run <code>ipconfig</code> and use the IPv4 address in <code>http://ADDRESS:3000/api</code>.</div>}
        <ol className="steps">
          <li>Run <code>configure-firmware.bat</code>. It fills in this address, your Wi-Fi and the room&rsquo;s key for you.</li>
          <li>Upload the firmware to the ESP32 and power it on.</li>
          <li>Within about 30 seconds its row below turns <b>Online</b> and the Dashboard starts showing live data.</li>
        </ol>
      </section>

      {allWaiting && (
        <div className="msg info" role="status">No terminal has connected yet. This page updates by itself, so leave it open while you upload the firmware.</div>
      )}

      <div className="stats">
        <div className="stat"><b>{count('ONLINE')}</b>Online</div>
        <div className="stat"><b>{count('SILENT')}</b>Silent (went quiet)</div>
        <div className="stat"><b>{count('WAITING')}</b>Waiting for first heartbeat</div>
        <div className="stat"><b>{queued}</b>Taps waiting to upload</div>
      </div>

      <section className="card">
        <div className="chead"><h3>Room terminals</h3><span className="muted small">{data ? `Refreshes every 3 seconds. Silent after ${data.heartbeat_timeout_seconds} s without a heartbeat.` : 'Loading\u2026'}</span></div>
        {data && rows.length === 0 ? <div className="empty">No rooms yet. Add one in Rooms setup to get its key.</div> : (
          <div className="tablewrap">
            <table>
              <thead><tr><th>Room</th><th>Connection</th><th>Last heard</th><th>Wi-Fi signal</th><th>Taps waiting</th><th>Last tap</th><th>Taps today</th><th>Uptime</th><th>Firmware</th></tr></thead>
              <tbody>
                {rows.map((r) => {
                  const s = STATE[r.state];
                  return (
                    <tr key={r.id}>
                      <td><b>{r.code}</b><div className="muted small">{r.ip || r.name}</div></td>
                      <td><span className={`badge ${s.cls}`}>{s.label}</span></td>
                      <td>{r.last_heartbeat ? ago(r.last_heartbeat) : 'Never'}</td>
                      <td>{r.state === 'WAITING' ? '\u2013' : <SignalBars signal={r.signal} rssi={r.rssi} />}</td>
                      <td>{r.queue_len > 0 ? <span className="pill warn">{r.queue_len} waiting</span> : '0'}</td>
                      <td>{r.last_tap ? ago(r.last_tap) : '\u2013'}</td>
                      <td>{r.taps_today}</td>
                      <td>{r.state === 'WAITING' ? '\u2013' : uptime(r.uptime_s)}</td>
                      <td>{r.fw || '\u2013'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {rows.some((r) => r.signal === 'weak') && <div className="msg err">A terminal has a weak Wi-Fi signal. Move the router closer or add an access point, or taps may be saved offline more often.</div>}
      </section>

      <section className="card">
        <div className="chead"><h3>Live activity</h3><span className="muted small">Newest first</span></div>
        <Activity events={events} compact />
      </section>
    </div>
  );
}
