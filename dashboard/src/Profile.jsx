import { useEffect, useState } from 'react';
import { api } from './api.js';

/** "My account": who am I, and change my own password. Opened from the user chip in the top bar. */
export default function Profile({ user, onClose, onLogout }) {
  const [cur, setCur] = useState('');
  const [nw, setNw] = useState('');
  const [again, setAgain] = useState('');
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const key = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onClose]);

  async function submit(e) {
    e.preventDefault();
    if (nw !== again) { setMsg({ text: 'The two new passwords do not match.' }); return; }
    setBusy(true); setMsg(null);
    try {
      await api('/auth/change-password', { method: 'POST', body: { current_password: cur, new_password: nw } });
      setMsg({ text: 'Password changed. Use the new one next time you log in.', good: true });
      setCur(''); setNw(''); setAgain('');
    } catch (err) { setMsg({ text: err.message }); }
    finally { setBusy(false); }
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="card modal" role="dialog" aria-modal="true" aria-label="My account" onClick={(e) => e.stopPropagation()}>
        <div className="chead"><h2>My account</h2><button className="btn ghost small" onClick={onClose}>Close</button></div>
        <dl className="dl">
          <dt>Name</dt><dd>{user.name}</dd>
          <dt>Email</dt><dd>{user.email}</dd>
          <dt>Role</dt><dd>{user.role === 'HOD' ? 'Head of Department' : 'Lecturer'}</dd>
        </dl>
        <h3>Change password</h3>
        <form className="panelform" onSubmit={submit}>
          <label className="field">Current password<input type="password" value={cur} onChange={(e) => setCur(e.target.value)} required autoComplete="current-password" /></label>
          <label className="field">New password (8 or more characters)<input type="password" value={nw} onChange={(e) => setNw(e.target.value)} required minLength={8} autoComplete="new-password" /></label>
          <label className="field">Repeat the new password<input type="password" value={again} onChange={(e) => setAgain(e.target.value)} required minLength={8} autoComplete="new-password" /></label>
          {msg && <div className={`msg ${msg.good ? 'good' : 'err'}`} role="status">{msg.text}</div>}
          <div className="row"><button className="btn" disabled={busy}>{busy ? 'Saving\u2026' : 'Change password'}</button><button type="button" className="btn ghost" onClick={onLogout}>Log out</button></div>
        </form>
      </div>
    </div>
  );
}
