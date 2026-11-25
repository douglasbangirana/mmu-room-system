import { useState } from 'react';
import { api } from '../api.js';

export default function Login({ onLogin }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setError('');
    try { onLogin(await api('/auth/login', { method: 'POST', body: { email, password } })); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  return (
    <div className="login">
      <div className="login-card">
        <div className="logo big"><span className="mark" />MMU Rooms</div>
        <div>
          <h1>Welcome back</h1>
          <p className="muted">Log in to see which lecture rooms are free right now.</p>
        </div>
        <form onSubmit={submit} className="login-form">
          <label className="field">Email
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="username" placeholder="name@mmu.ac.ug" />
          </label>
          <label className="field">Password
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" />
          </label>
          {error && <div className="msg err" role="alert">{error}</div>}
          <button className="btn block" disabled={busy}>{busy ? 'Logging in\u2026' : 'Log in'}</button>
        </form>
      </div>
    </div>
  );
}
