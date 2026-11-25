import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api.js';
import { Icon } from './icons.jsx';

const today = () => new Date().toLocaleDateString('en-CA');
const has = (q, ...fields) => fields.some((f) => String(f || '').toLowerCase().includes(q));

/**
 * The top-bar search. While you type it offers matches from the whole system (pages, rooms, lecturers,
 * cards, today's timetable). Choosing one opens the right page and leaves the text in the box, so that
 * page shows only the matching rows. Every page receives the text as its `query` prop (see App.jsx).
 */
export default function GlobalSearch({ inputRef, nav, isHod, query, setQuery, go }) {
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const [data, setData] = useState({ rooms: [], users: [], cards: [], slots: [], at: 0 });
  const box = useRef(null);

  async function ensureData() {
    if (Date.now() - data.at < 30000) return; // reuse what we loaded in the last 30 s
    try {
      const rooms = (await api('/rooms')).rooms;
      let users = [], cards = [], slots = [];
      if (isHod) [users, cards, slots] = await Promise.all([api('/users'), api('/cards'), api(`/timetable?date=${today()}`)]);
      setData({ rooms, users, cards, slots, at: Date.now() });
    } catch { /* the list simply stays empty */ }
  }

  useEffect(() => {
    const away = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, []);

  const q = query.trim().toLowerCase();
  const groups = useMemo(() => {
    if (!q) return [];
    const g = [
      ['Pages', nav.filter((n) => has(q, n.label)).slice(0, 3).map((n) => ({ key: `p${n.id}`, icon: n.icon, label: n.label, sub: 'Open page', tab: n.id, q: '' }))],
      ['Rooms', data.rooms.filter((r) => has(q, r.code, r.name, r.occupant)).slice(0, 4)
        .map((r) => ({ key: `r${r.id}`, icon: 'building', label: r.code, sub: `${r.name}${r.occupant ? ` \u00B7 ${r.occupant} inside` : ''}`, tab: 'rooms', q: r.code }))],
      ['Lecturers and accounts', data.users.filter((u) => has(q, u.name, u.email)).slice(0, 4)
        .map((u) => ({ key: `u${u.id}`, icon: 'users', label: u.name, sub: `${u.role === 'HOD' ? 'H.O.D' : 'Lecturer'} \u00B7 ${u.email}`, tab: 'people', q: u.name }))],
      ['Cards', data.cards.filter((c) => has(q, c.card_uid, c.holder)).slice(0, 3)
        .map((c) => ({ key: `c${c.id}`, icon: 'card', label: c.card_uid, sub: `${c.holder} \u00B7 ${c.status.toLowerCase()}`, tab: 'people', q: c.card_uid }))],
      ['Today\u2019s timetable', data.slots.filter((s) => has(q, s.course_label, s.lecturer, s.room_code)).slice(0, 3)
        .map((s) => ({ key: `s${s.id}`, icon: 'calendar', label: `${s.course_label || 'Booked slot'} \u00B7 ${s.room_code}`, sub: `${s.lecturer} \u00B7 ${s.start_time.slice(0, 5)}\u2013${s.end_time.slice(0, 5)}`, tab: 'timetable', q: s.course_label || s.room_code }))],
    ];
    // Pages stay first; the other groups are ordered by whether a result starts with what was typed.
    const starts = (items) => items.some((it) => it.label.toLowerCase().split(/[\s.\-:\u00B7]+/).some((w) => w && w.startsWith(q)));
    const rank = (title, items) => (title === 'Pages' ? -1 : starts(items) ? 0 : 1);
    return g.filter(([, items]) => items.length).sort((a, b) => rank(a[0], a[1]) - rank(b[0], b[1]));
  }, [q, data, nav]);
  const flat = groups.flatMap(([, items]) => items);

  function pick(item) {
    setQuery(item.q);
    go(item.tab);
    setOpen(false);
    setHi(0);
  }
  function onKey(e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setHi((h) => Math.min(h + 1, Math.max(flat.length - 1, 0))); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
    else if (e.key === 'Enter') { if (open && flat[hi]) { e.preventDefault(); pick(flat[hi]); } else setOpen(false); }
    else if (e.key === 'Escape') setOpen(false);
  }

  return (
    <div className="searchwrap" ref={box}>
      <label className="search">
        <Icon name="search" size={16} />
        <input
          ref={inputRef} value={query} autoComplete="off" role="combobox" aria-expanded={open && flat.length > 0} aria-controls="search-results"
          placeholder="Search rooms, lecturers, cards, slots…" aria-label="Search the whole system"
          onChange={(e) => { setQuery(e.target.value); setOpen(true); setHi(0); }}
          onFocus={() => { setOpen(true); ensureData(); }} onKeyDown={onKey}
        />
        {query
          ? <button type="button" className="clearbtn" aria-label="Clear search" onClick={() => { setQuery(''); inputRef.current && inputRef.current.focus(); }}><Icon name="x" size={14} /></button>
          : <kbd>Ctrl K</kbd>}
      </label>
      {open && q && (
        <div className="sresults" id="search-results" role="listbox">
          {flat.length === 0 ? (
            <div className="sempty">No matches for {'\u201C'}{query}{'\u201D'}. Press Enter to filter the page you are on.</div>
          ) : groups.map(([title, items]) => (
            <div key={title}>
              <div className="sgroup">{title}</div>
              {items.map((it) => {
                const idx = flat.indexOf(it);
                return (
                  <button type="button" key={it.key} role="option" aria-selected={idx === hi} className={`sitem${idx === hi ? ' on' : ''}`}
                    onMouseEnter={() => setHi(idx)} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(it)}>
                    <span className="sico"><Icon name={it.icon} size={14} /></span>
                    <span className="stxt"><b>{it.label}</b><span>{it.sub}</span></span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
