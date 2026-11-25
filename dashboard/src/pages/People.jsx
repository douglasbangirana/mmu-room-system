import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';

export default function People({ query = '' }) {
  const [users, setUsers] = useState([]);
  const [cards, setCards] = useState([]);
  const [unknown, setUnknown] = useState([]);
  const [msg, setMsg] = useState(null);
  const [nu, setNu] = useState({ name: '', email: '', password: '' });
  const [nc, setNc] = useState({ card_uid: '', user_id: '' });

  const say = (text, good = false) => setMsg({ text, good });
  const load = useCallback(async () => {
    try {
      const [u, c, k] = await Promise.all([api('/users'), api('/cards'), api('/cards/recent-unknown')]);
      setUsers(u); setCards(c); setUnknown(k);
    } catch (e) { say(e.message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const act = (fn, ok) => async (...a) => { try { await fn(...a); say(ok, true); load(); } catch (e) { say(e.message); } };

  const addUser = act(async (e) => {
    e.preventDefault();
    await api('/users', { method: 'POST', body: nu }); setNu({ name: '', email: '', password: '' });
  }, 'Account created.');
  const addCard = act(async (e) => {
    e.preventDefault();
    await api('/cards', { method: 'POST', body: nc }); setNc({ card_uid: '', user_id: '' });
  }, 'Card registered.');
  const setCardStatus = act((c, status) => api(`/cards/${c.id}`, { method: 'PATCH', body: { status } }), 'Card updated.');
  const reassign = act((c, user_id) => api(`/cards/${c.id}`, { method: 'PATCH', body: { user_id } }), 'Card reassigned.');
  const toggleUser = act((u) => api(`/users/${u.id}`, { method: 'PATCH', body: { active: !u.active } }), 'Account updated.');
  const resetPw = act(async (u) => {
    const pw = window.prompt(`New password for ${u.name} (min 8 characters):`);
    if (pw) await api(`/users/${u.id}`, { method: 'PATCH', body: { password: pw } });
  }, 'Password changed.');

  const lecturers = users.filter((u) => u.role === 'LECTURER' && u.active);

  const needle = query.trim().toLowerCase();
  const shownCards = needle ? cards.filter((c) => `${c.card_uid} ${c.holder} ${c.email}`.toLowerCase().includes(needle)) : cards;
  const shownUsers = needle ? users.filter((u) => `${u.name} ${u.email} ${u.role}`.toLowerCase().includes(needle)) : users;

  return (
    <>
      {msg && <div className={`msg ${msg.good ? 'good' : 'err'}`} role="status">{msg.text}</div>}

      <form className="panel" onSubmit={addCard}>
        <h2>Register a card</h2>
        <p className="muted">Tap the new card on any room terminal. It appears below as "not recognised"; pick it, choose the lecturer, and save.</p>
        {unknown.length > 0 && <div className="row">{unknown.map((k) => (
          <button type="button" key={k.card_uid} className="btn ghost small" onClick={() => setNc({ ...nc, card_uid: k.card_uid })}>{k.card_uid}</button>))}</div>}
        <div className="row">
          <label>Card UID<input value={nc.card_uid} onChange={(e) => setNc({ ...nc, card_uid: e.target.value })} placeholder="04A1B2C3" required /></label>
          <label>Lecturer<select value={nc.user_id} onChange={(e) => setNc({ ...nc, user_id: e.target.value })} required>
            <option value="">Choose…</option>{lecturers.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
          <button className="btn">Register card</button>
        </div>
      </form>

      <div className="panel">
        <h2>Cards</h2>
        {shownCards.length === 0 ? <div className="empty">{needle ? 'No cards match your search.' : 'No cards yet. Register the first one above.'}</div> : (
          <div className="tablewrap"><table>
            <thead><tr><th>UID</th><th>Holder</th><th>Status</th><th>Reassign to</th><th></th></tr></thead>
            <tbody>{shownCards.map((c) => (
              <tr key={c.id}><td>{c.card_uid}</td><td>{c.holder}</td><td>{c.status}</td>
                <td><select value="" onChange={(e) => e.target.value && reassign(c, e.target.value)} aria-label={`Reassign ${c.card_uid}`}>
                  <option value="">Choose…</option>{lecturers.filter((l) => l.id !== c.user_id).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></td>
                <td>{c.status === 'ACTIVE'
                  ? <button className="btn small danger" onClick={() => setCardStatus(c, 'DEACTIVATED')}>Deactivate</button>
                  : <button className="btn small ghost" onClick={() => setCardStatus(c, 'ACTIVE')}>Reactivate</button>}</td></tr>
            ))}</tbody>
          </table></div>
        )}
      </div>

      <form className="panel" onSubmit={addUser}>
        <h2>Add a lecturer account</h2>
        <div className="row">
          <label>Name<input value={nu.name} onChange={(e) => setNu({ ...nu, name: e.target.value })} required /></label>
          <label>Email<input type="email" value={nu.email} onChange={(e) => setNu({ ...nu, email: e.target.value })} required /></label>
          <label>Temporary password<input type="password" minLength={8} value={nu.password} onChange={(e) => setNu({ ...nu, password: e.target.value })} required /></label>
          <button className="btn">Create account</button>
        </div>
      </form>

      <div className="panel">
        <h2>Accounts</h2>
        <div className="tablewrap"><table>
          <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th></th></tr></thead>
          <tbody>{shownUsers.map((u) => (
            <tr key={u.id}><td>{u.name}</td><td>{u.email}</td><td>{u.role}</td><td>{u.active ? 'Active' : 'Disabled'}</td>
              <td><button className="btn small ghost" onClick={() => resetPw(u)}>Reset password</button>{' '}
                <button className={`btn small ${u.active ? 'danger' : 'ghost'}`} onClick={() => toggleUser(u)}>{u.active ? 'Disable' : 'Enable'}</button></td></tr>
          ))}</tbody>
        </table></div>
      </div>
    </>
  );
}
