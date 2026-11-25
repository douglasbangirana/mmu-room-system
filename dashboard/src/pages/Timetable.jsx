import { useCallback, useEffect, useState } from 'react';
import { api, download } from '../api.js';

const today = () => new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD in local time
const TEMPLATE = 'lecturer_email,room_code,date,start,end,course\nlecturer1@mmu.ac.ug,LH-101,2026-11-02,09:00,11:00,SE 301\n';
const EMPTY = { lecturer_email: '', room_code: '', date: today(), start: '', end: '', course: '' };

export default function Timetable({ query = '' }) {
  const [date, setDate] = useState(today());
  const [slots, setSlots] = useState([]);
  const [lecturers, setLecturers] = useState([]);
  const [rooms, setRooms] = useState([]);
  const [form, setForm] = useState(EMPTY);
  const [editId, setEditId] = useState(null);
  const [msg, setMsg] = useState(null);
  const [preview, setPreview] = useState(null); // { csv, result }

  const say = (text, good = false) => setMsg({ text, good });
  const load = useCallback(async () => {
    try { setSlots(await api(`/timetable?date=${date}`)); } catch (e) { say(e.message); }
  }, [date]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    api('/users').then((u) => setLecturers(u.filter((x) => x.role === 'LECTURER' && x.active))).catch(() => {});
    api('/rooms/manage').then((r) => setRooms(r.filter((x) => x.active))).catch(() => {});
  }, []);

  async function save(e) {
    e.preventDefault();
    try {
      await api(editId ? `/timetable/${editId}` : '/timetable', { method: editId ? 'PUT' : 'POST', body: form });
      say(editId ? 'Slot updated.' : 'Slot added.', true);
      setForm({ ...EMPTY, date: form.date }); setEditId(null); setDate(form.date); load();
    } catch (err) { say(err.message); }
  }

  function edit(s) {
    setEditId(s.id);
    setForm({ lecturer_email: s.lecturer_email, room_code: s.room_code, date: s.slot_date, start: s.start_time.slice(0, 5), end: s.end_time.slice(0, 5), course: s.course_label || '' });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function remove(s) {
    if (!window.confirm(`Delete ${s.room_code} ${s.start_time.slice(0, 5)} for ${s.lecturer}?`)) return;
    try { await api(`/timetable/${s.id}`, { method: 'DELETE' }); say('Slot deleted.', true); load(); } catch (err) { say(err.message); }
  }

  async function pickFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    const csv = await file.text();
    try { setPreview({ csv, result: await api('/timetable/upload?dryRun=1', { method: 'POST', body: { csv } }) }); setMsg(null); }
    catch (err) { setPreview(null); say(err.message); }
    e.target.value = '';
  }

  async function confirmUpload() {
    try {
      const r = await api('/timetable/upload', { method: 'POST', body: { csv: preview.csv } });
      say(`${r.created} slot(s) saved, ${r.invalid.length} skipped.`, true);
      setPreview(null); load();
    } catch (err) { say(err.message); }
  }

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const needle = query.trim().toLowerCase();
  const visible = needle ? slots.filter((s) => `${s.room_code} ${s.lecturer} ${s.lecturer_email} ${s.course_label || ''}`.toLowerCase().includes(needle)) : slots;

  return (
    <>
      {msg && <div className={`msg ${msg.good ? 'good' : 'err'}`} role="status">{msg.text}</div>}

      <form className="panel" onSubmit={save}>
        <h2>{editId ? 'Edit slot' : 'Add a slot'}</h2>
        <div className="row">
          <label>Lecturer<select value={form.lecturer_email} onChange={set('lecturer_email')} required>
            <option value="">Choose…</option>{lecturers.map((l) => <option key={l.id} value={l.email}>{l.name}</option>)}</select></label>
          <label>Room<select value={form.room_code} onChange={set('room_code')} required>
            <option value="">Choose…</option>{rooms.map((r) => <option key={r.id} value={r.code}>{r.code}</option>)}</select></label>
          <label>Date<input type="date" value={form.date} onChange={set('date')} required /></label>
          <label>Start<input type="time" value={form.start} onChange={set('start')} required /></label>
          <label>End<input type="time" value={form.end} onChange={set('end')} required /></label>
          <label>Course<input value={form.course} onChange={set('course')} placeholder="e.g. SE 301" /></label>
          <button className="btn">{editId ? 'Save changes' : 'Add slot'}</button>
          {editId && <button type="button" className="btn ghost" onClick={() => { setEditId(null); setForm(EMPTY); }}>Cancel</button>}
        </div>
      </form>

      <div className="panel">
        <h2>Upload a CSV timetable</h2>
        <div className="row">
          <input type="file" accept=".csv,text/csv" onChange={pickFile} aria-label="Choose CSV file" />
          <a href={`data:text/csv;charset=utf-8,${encodeURIComponent(TEMPLATE)}`} download="timetable-template.csv">Download template</a>
        </div>
        {preview && (
          <>
            <div className="msg good">{preview.result.valid_count} row(s) are valid and ready to save.</div>
            {preview.result.invalid.length > 0 && (
              <div className="tablewrap"><table>
                <thead><tr><th>CSV row</th><th>Problem</th></tr></thead>
                <tbody>{preview.result.invalid.map((r) => <tr key={r.row} className="flag"><td>{r.row}</td><td>{r.errors.join('; ')}</td></tr>)}</tbody>
              </table></div>
            )}
            <div className="row">
              <button className="btn" disabled={!preview.result.valid_count} onClick={confirmUpload}>Save {preview.result.valid_count} valid row(s)</button>
              <button className="btn ghost" onClick={() => setPreview(null)}>Discard</button>
            </div>
          </>
        )}
      </div>

      <div className="panel">
        <div className="row"><h2 style={{ marginRight: 'auto' }}>Slots</h2>
          <button type="button" className="btn ghost small" onClick={() => download(`/timetable/export?from=${date}&to=${date}`, `timetable-${date}.csv`).catch((e) => say(e.message))}>Export CSV</button>
          <label>Date<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label></div>
        {visible.length === 0 ? <div className="empty">{needle ? 'No slots match your search.' : 'No slots on this date. Add one above or upload a CSV.'}</div> : (
          <div className="tablewrap"><table>
            <thead><tr><th>Room</th><th>Time</th><th>Lecturer</th><th>Course</th><th>Verification</th><th></th></tr></thead>
            <tbody>{visible.map((s) => (
              <tr key={s.id}><td>{s.room_code}</td><td>{s.start_time.slice(0, 5)}–{s.end_time.slice(0, 5)}</td><td>{s.lecturer}</td>
                <td>{s.course_label}</td><td>{s.verification_status}</td>
                <td><button className="btn small ghost" onClick={() => edit(s)}>Edit</button>{' '}
                  <button className="btn small danger" onClick={() => remove(s)}>Delete</button></td></tr>
            ))}</tbody>
          </table></div>
        )}
      </div>
    </>
  );
}
