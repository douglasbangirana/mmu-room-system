import { useEffect, useRef, useState } from 'react';
import { session } from './api.js';
import { Icon } from './icons.jsx';
import GlobalSearch from './GlobalSearch.jsx';
import Profile from './Profile.jsx';
import Terminals from './pages/Terminals.jsx';
import Login from './pages/Login.jsx';
import Rooms from './pages/Rooms.jsx';
import Timetable from './pages/Timetable.jsx';
import People from './pages/People.jsx';
import Logs from './pages/Logs.jsx';
import Setup from './pages/Setup.jsx';

const NAV = [
  { id: 'rooms', label: 'Dashboard', icon: 'grid', group: 'MENU', Page: Rooms, hod: false },
  { id: 'terminals', label: 'Terminals', icon: 'wifi', group: 'MENU', Page: Terminals, hod: true },
  { id: 'timetable', label: 'Timetable', icon: 'calendar', group: 'MENU', Page: Timetable, hod: true },
  { id: 'people', label: 'Cards and accounts', icon: 'card', group: 'MENU', Page: People, hod: true },
  { id: 'logs', label: 'Logs and summary', icon: 'chart', group: 'MENU', Page: Logs, hod: true },
  { id: 'setup', label: 'Rooms setup', icon: 'sliders', group: 'GENERAL', Page: Setup, hod: true },
];
const TITLES = {
  rooms: ['Dashboard', 'Live room status, checked against the timetable.'],
  terminals: ['Terminals', 'Live connection, Wi-Fi signal and taps from every room terminal.'],
  timetable: ['Timetable', 'Add, edit or import the booked slots.'],
  people: ['Cards and accounts', 'Register staff cards and manage who can log in.'],
  logs: ['Logs and summary', 'Every tap, flagged events and ghost-booking figures.'],
  setup: ['Rooms setup', 'Terminals, device keys and the rules the system applies.'],
};

export default function App() {
  const [auth, setAuth] = useState(session.get());
  const [tab, setTab] = useState('rooms');
  const [query, setQuery] = useState('');
  const [profile, setProfile] = useState(false);
  const [theme, setTheme] = useState(document.documentElement.dataset.theme || 'light');
  const search = useRef(null);

  useEffect(() => {
    const out = () => setAuth(null);
    window.addEventListener('mmu-logout', out);
    return () => window.removeEventListener('mmu-logout', out);
  }, []);
  useEffect(() => {
    const key = (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); search.current && search.current.focus(); } };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);

  if (!auth) return <Login onLogin={(s) => { session.set(s); setAuth(s); setTab('rooms'); }} />;

  const isHod = auth.user.role === 'HOD';
  const items = NAV.filter((n) => isHod || !n.hod);
  const current = items.find((n) => n.id === tab) || items[0];
  const Page = current.Page;
  const [title, sub] = TITLES[current.id];
  const logout = () => { session.clear(); setAuth(null); };
  function toggleTheme() {
    const next = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('mmu_theme2', next); } catch { /* ignore */ }
    setTheme(next);
  }
  const navBtn = (n) => (
    <button key={n.id} className="navbtn" aria-current={current.id === n.id ? 'page' : undefined} onClick={() => { setTab(n.id); setQuery(''); }}>
      <Icon name={n.icon} />{n.label}
    </button>
  );
  const general = items.filter((n) => n.group === 'GENERAL');
  const ini = auth.user.name.split(/[\s.]+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="logo"><span className="mark" />MMU Rooms</div>
        <nav aria-label="Sections" className="nav">
          <div className="navlabel">Menu</div>
          {items.filter((n) => n.group === 'MENU').map(navBtn)}
          <div className="navlabel">General</div>
          {general.map(navBtn)}
          <button className="navbtn" onClick={logout}><Icon name="logout" />Logout</button>
        </nav>
        {isHod && (
          <div className="sidecard">
            <b>New card?</b>
            <span>Tap it on any terminal, then register it here.</span>
            <button className="btn light small" onClick={() => setTab('people')}>Register a card</button>
          </div>
        )}
      </aside>

      <div className="workspace">
        <header className="topbar">
          <GlobalSearch inputRef={search} nav={items} isHod={isHod} query={query} setQuery={setQuery} go={setTab} />
          <div className="topright">
            <button className="iconbtn" onClick={toggleTheme} aria-label="Switch between light and dark theme"><Icon name={theme === 'dark' ? 'sun' : 'moon'} /></button>
            <button type="button" className="userchip" onClick={() => setProfile(true)} aria-label="My account and password">
              <span className="avatar solid">{ini}</span>
              <span className="uc"><b>{auth.user.name}</b><span>{auth.user.email}</span></span>
            </button>
          </div>
        </header>

        <div className="pagehead">
          <div><h1>{title}</h1><p>{isHod ? sub : 'Find a free room right now.'}</p></div>
          {isHod && current.id === 'rooms' && (
            <div className="actions">
              <button className="btn" onClick={() => setTab('people')}>Register card</button>
              <button className="btn ghost" onClick={() => setTab('timetable')}>Import timetable</button>
            </div>
          )}
        </div>

        <main className="content"><Page user={auth.user} go={setTab} query={query} /></main>
      </div>
      {profile && <Profile user={auth.user} onClose={() => setProfile(false)} onLogout={logout} />}
    </div>
  );
}
