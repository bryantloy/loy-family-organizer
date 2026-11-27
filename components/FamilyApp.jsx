'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase, configured } from '@/lib/supabase.mjs';
import { todayISO, addDays, fmt, fmtTime, daysBetween } from '@/lib/dates.mjs';
import { HOUSES, houseFor, weekStart, nights, nextChange, upcomingWeeks } from '@/lib/custody.mjs';
import { toEntries, byWhen } from '@/lib/team.mjs';
import { pushSupported, currentSubscription, turnOnAlerts, dropAlerts, pingOtherParent } from '@/lib/alerts.mjs';

const KINDS = [
  ['test', 'Test'],
  ['quiz', 'Quiz'],
  ['project', 'Project'],
  ['homework', 'Homework'],
  ['meet', 'Meet'],
  ['game', 'Game'],
  ['practice', 'Practice'],
  ['event', 'Event'],
  ['appointment', 'Appointment'],
  ['todo', 'To-do'],
];
const KIND_LABEL = Object.fromEntries(KINDS);

export default function FamilyApp() {
  const [session, setSession] = useState(undefined);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  if (!configured) return <Shell><p className="muted">The app isn't connected to its database yet.</p></Shell>;
  if (session === undefined) return <Shell><p className="muted">Loading…</p></Shell>;
  if (!session) return <SignIn />;
  return <Home session={session} />;
}

function Shell({ children }) {
  return (
    <main className="shell">
      <h1 className="brand">Loy Family</h1>
      {children}
    </main>
  );
}

// Sign-in names. Nobody types an email: each name maps to a login address
// in Supabase. Dad's is the base address (an env var, so it stays out of the
// repo); each boy's is a "+name" version of it, which needs no account of
// its own and would land in Dad's inbox if anything were ever sent.
const BASE = (process.env.NEXT_PUBLIC_LOGIN_BASE || '').trim().toLowerCase();
const plus = (tag) => {
  const at = BASE.indexOf('@');
  return at > 0 ? `${BASE.slice(0, at)}+${tag}${BASE.slice(at)}` : '';
};
const LOGINS = [
  { name: 'Dad', email: BASE, color: '#2563eb' },
  { name: 'Bryson', email: plus('bryson'), color: '#16a34a' },
  { name: 'Bennett', email: plus('bennett'), color: '#ea580c' },
  { name: 'Brooks', email: plus('brooks'), color: '#9333ea' },
  { name: 'Mom', email: plus('mom'), color: '#db2777' },
];

function SignIn() {
  const [who, setWho] = useState(() => {
    try { return localStorage.getItem('loy-family-who') || ''; } catch { return ''; }
  });
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const login = LOGINS.find((l) => l.email === who);

  async function submit(e) {
    e.preventDefault();
    if (!login) return;
    setBusy(true);
    setError('');
    try { localStorage.setItem('loy-family-who', login.email); } catch {}
    const { error } = await supabase.auth.signInWithPassword({ email: login.email, password });
    if (error) setError(error.message === 'Invalid login credentials' ? "That password doesn't match." : error.message);
    setBusy(false);
  }

  return (
    <Shell>
      <form className="card signin" onSubmit={submit}>
        <p className="muted small">Who's signing in?</p>
        <div className="who-grid">
          {LOGINS.map((l) => (
            <button type="button" key={l.email} className={who === l.email ? 'chip on' : 'chip'} style={{ '--c': l.color }} onClick={() => { setWho(l.email); setError(''); }}>
              {l.name}
            </button>
          ))}
        </div>
        {login && (
          <>
            <input type="email" autoComplete="username" value={login.email} readOnly hidden />
            <label>
              Password
              <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required autoFocus />
            </label>
            {error && <p className="error">{error}</p>}
            <button className="primary" disabled={busy}>{busy ? 'Signing in…' : `Sign in as ${login.name}`}</button>
          </>
        )}
      </form>
    </Shell>
  );
}

function useFamilyData(enabled) {
  const [state, setState] = useState({ loading: true, error: '', members: [], pattern: null, overrides: new Map(), items: [], team: [], teamReady: false, changes: [] });

  const load = useCallback(async () => {
    if (!enabled) return;
    const since = addDays(todayISO(), -60);
    const [m, p, o, i, t, c] = await Promise.all([
      supabase.from('members').select('*').order('sort'),
      supabase.from('custody_pattern').select('*').maybeSingle(),
      supabase.from('custody_overrides').select('*'),
      supabase.from('items').select('*').or(`done.eq.false,due_on.gte.${since}`).order('due_on').order('due_time', { nullsFirst: true }),
      // Broncos practices and games, live from the Broncos app. Until the
      // slice 2 SQL is run this function doesn't exist; the app just skips it.
      supabase.rpc('team_events', { since: todayISO() }),
      // What the other parent changed lately (Dad and Mom only). Skipped until
      // the slice 3 SQL is run.
      supabase.rpc('unseen_changes'),
    ]);
    const err = m.error || p.error || o.error || i.error;
    setState({
      loading: false,
      error: err ? err.message : '',
      members: m.data || [],
      pattern: p.data || null,
      overrides: new Map((o.data || []).map((r) => [r.night, r])),
      items: i.data || [],
      team: t.error ? [] : toEntries(t.data),
      teamReady: !t.error,
      changes: c.error ? [] : c.data || [],
    });
  }, [enabled]);

  useEffect(() => {
    load();
    const onFocus = () => document.visibilityState === 'visible' && load();
    document.addEventListener('visibilitychange', onFocus);
    return () => document.removeEventListener('visibilitychange', onFocus);
  }, [load]);

  return [state, load];
}

function Home({ session }) {
  const [data, reload] = useFamilyData(true);
  const [tab, setTab] = useState('family');
  const [editing, setEditing] = useState(null); // item being added/edited
  const [nightEdit, setNightEdit] = useState(null);
  const today = todayISO();

  const email = (session.user.email || '').toLowerCase();
  const me = data.members.find((m) => (m.email || '').toLowerCase() === email);
  const isParent = me?.role === 'parent';
  // Mom ("coparent") has the Family tab and every boy's tab, and can change
  // the boys' items and nights. Dad's own list stays his.
  const isMom = me?.role === 'coparent';
  const seesAll = isParent || isMom;
  // After Dad or Mom changes something, the other one gets an alert.
  const changed = () => { reload(); if (seesAll) pingOtherParent(); };
  const signOut = async () => { await dropAlerts(); supabase.auth.signOut(); };
  const byId = useMemo(() => Object.fromEntries(data.members.map((m) => [m.id, m])), [data.members]);

  if (data.loading) return <Shell><p className="muted">Loading…</p></Shell>;
  if (!me) {
    return (
      <Shell>
        <div className="card">
          <p>This account isn't on the family list.</p>
          {data.error && <p className="muted small">{data.error}</p>}
          <button onClick={() => supabase.auth.signOut()}>Sign out</button>
        </div>
      </Shell>
    );
  }

  const people = data.members.filter((m) => m.role === 'parent' || m.role === 'kid');
  const kids = people.filter((m) => m.role === 'kid');
  const tabs = [{ key: 'family', label: 'Family' }, ...people.filter((m) => isParent || (isMom ? m.role === 'kid' : m.id === me.id)).map((m) => ({ key: m.id, label: m.name, color: m.color }))];
  const current = tab === 'family' ? null : byId[tab];

  return (
    <div className="app">
      <header className="top">
        <div className="top-row">
          <h1 className="brand">Loy Family</h1>
          <button className="link" onClick={signOut}>Sign out</button>
        </div>
        <nav className="tabs" role="tablist">
          {tabs.map((t) => (
            <button key={t.key} role="tab" aria-selected={tab === t.key} className={tab === t.key ? 'tab on' : 'tab'} style={t.color ? { '--c': t.color } : undefined} onClick={() => setTab(t.key)}>
              {t.label}
            </button>
          ))}
        </nav>
      </header>

      <main className="content">
        {data.error && <p className="error">{data.error}</p>}
        {current ? (
          <PersonTab person={current} me={me} isParent={isParent} data={data} today={today} onEdit={setEditing} onNight={setNightEdit} reload={changed} />
        ) : (
          <FamilyTab me={me} isParent={isParent} isMom={isMom} seesAll={seesAll} data={data} byId={byId} today={today} onEdit={setEditing} onNight={setNightEdit} reload={changed} reloadOnly={reload} />
        )}
      </main>

      <button className="fab" aria-label="Quick add" onClick={() => setEditing({ member_id: current?.id || (isMom ? kids[0]?.id : me.id), kind: 'todo', title: '', due_on: today, due_time: '', notes: '' })}>
        +
      </button>

      {editing && <ItemSheet item={editing} me={me} choices={isParent ? people : isMom ? kids : [me]} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); changed(); }} />}
      {nightEdit && <NightSheet night={nightEdit} data={data} onClose={() => setNightEdit(null)} onSaved={() => { setNightEdit(null); changed(); }} />}
    </div>
  );
}

function Tonight({ data, today, who }) {
  const t = houseFor(today, data.pattern, data.overrides);
  const next = nextChange(today, data.pattern, data.overrides);
  if (!t) return <section className="card"><p className="muted">Custody weeks aren't set up yet.</p></section>;
  return (
    <section className={`card tonight h-${t.house}`}>
      <p className="eyebrow">{who ? `${who} tonight` : 'Tonight'}</p>
      <p className="big">{HOUSES[t.house].label}{t.house !== 'travel' ? ' house' : ''}</p>
      {t.note && <p className="small">{t.note}</p>}
      {next && <p className="small">Switches to {HOUSES[next.house].label.toLowerCase()} {fmt(next.date)}{daysBetween(today, next.date) <= 7 ? ` (${daysBetween(today, next.date)} ${daysBetween(today, next.date) === 1 ? 'day' : 'days'})` : ''}</p>}
    </section>
  );
}

function NightStrip({ data, today, isParent, onNight }) {
  const start = weekStart(today, data.pattern);
  const list = nights(start, 14, data.pattern, data.overrides);
  return (
    <section className="card">
      <div className="row-between">
        <h2>Nights</h2>
        <span className="legend"><i className="dot h-dad" />Dad <i className="dot h-mom" />Mom <i className="dot h-travel" />Travel</span>
      </div>
      {[0, 7].map((off) => (
        <div className="strip" key={off}>
          {list.slice(off, off + 7).map((n) => (
            <button
              key={n.date}
              className={`night h-${n.house || 'none'}${n.date === today ? ' today' : ''}${n.source === 'override' ? ' override' : ''}`}
              onClick={() => isParent && onNight(n.date)}
              disabled={!isParent}
              title={n.note || ''}
            >
              <span className="dow">{fmt(n.date, { weekday: 'narrow' })}</span>
              <span className="num">{fmt(n.date, { day: 'numeric' })}</span>
              <span className="who">{n.house ? HOUSES[n.house].short : '·'}</span>
            </button>
          ))}
        </div>
      ))}
      <p className="small muted">Handoff is Friday. {isParent ? 'Tap a night to change it.' : ''}</p>
    </section>
  );
}

function FamilyTab({ me, isParent, isMom, seesAll, data, byId, today, onEdit, onNight, reload, reloadOnly }) {
  const end = addDays(today, 7);
  const soon = [...data.items.filter((i) => !i.done && i.due_on <= end), ...data.team.filter((e) => e.due_on <= end)].sort(byWhen);
  return (
    <>
      {seesAll && <ChangesCard changes={data.changes} reload={reloadOnly} />}
      <Tonight data={data} today={today} />
      <NightStrip data={data} today={today} isParent={seesAll} onNight={onNight} />
      {isMom && <WeeksCard data={data} today={today} />}
      {seesAll && <AlertsCard />}
      <section className="card">
        <h2>Next 7 days</h2>
        <ItemList items={soon} byId={byId} showWho={seesAll} today={today} onEdit={onEdit} reload={reload} empty="Nothing due in the next week." />
      </section>
    </>
  );
}

function PersonTab({ person, me, isParent, data, today, onEdit, onNight, reload }) {
  const [showDone, setShowDone] = useState(false);
  const mine = data.items.filter((i) => i.member_id === person.id);
  const open = mine.filter((i) => !i.done);
  const done = mine.filter((i) => i.done).reverse();
  const isDad = person.role === 'parent';
  return (
    <>
      {isDad ? <WeeksCard data={data} today={today} /> : <Tonight data={data} today={today} who={person.name} />}
      <TeamCard entries={data.team.filter((e) => e.member_ids.includes(person.id))} today={today} showSetup={isParent && isDad && !data.teamReady} />
      <section className="card">
        <h2>{person.id === me.id ? 'Your list' : `${person.name}'s list`}</h2>
        <ItemList items={open} byId={{}} today={today} onEdit={onEdit} reload={reload} empty="Nothing open. Tap + to add something." />
        {done.length > 0 && (
          <button className="link small" onClick={() => setShowDone((v) => !v)}>{showDone ? 'Hide done' : `Show done (${done.length})`}</button>
        )}
        {showDone && <ItemList items={done} byId={{}} today={today} onEdit={onEdit} reload={reload} />}
      </section>
    </>
  );
}

function TeamCard({ entries, today, showSetup }) {
  const [all, setAll] = useState(false);
  if (showSetup) {
    return (
      <section className="card">
        <h2>Broncos</h2>
        <p className="muted small">The Broncos schedule shows here once the slice 2 setup SQL has been run in Supabase.</p>
      </section>
    );
  }
  if (!entries.length) return null;
  const shown = all ? entries : entries.slice(0, 4);
  return (
    <section className="card">
      <div className="row-between">
        <h2>Broncos</h2>
        <span className="muted small">{entries.filter((e) => e.kind === 'game').length} games left</span>
      </div>
      <ItemList items={shown} byId={{}} today={today} />
      {entries.length > 4 && <button className="link small" onClick={() => setAll((v) => !v)}>{all ? 'Show less' : `Show all ${entries.length}`}</button>}
    </section>
  );
}

// What the other parent changed since you last tapped Got it.
function ChangesCard({ changes, reload }) {
  const [busy, setBusy] = useState(false);
  if (!changes.length) return null;
  const who = changes[0].actor_name;
  const shown = changes.slice(0, 6);
  return (
    <section className="card changes">
      <h2>New from {changes.every((c) => c.actor_name === who) ? who : 'the other parent'}</h2>
      <ul className="change-list">
        {shown.map((c) => (
          <li key={c.id}>
            <span>{c.actor_name} {c.summary}</span>
            <span className="muted small">{new Date(c.at).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}</span>
          </li>
        ))}
      </ul>
      {changes.length > shown.length && <p className="muted small">And {changes.length - shown.length} more.</p>}
      <button disabled={busy} onClick={async () => { setBusy(true); await supabase.rpc('mark_changes_seen'); setBusy(false); reload(); }}>Got it</button>
    </section>
  );
}

// Phone alerts for Dad and Mom. Shown until this phone has them on.
function AlertsCard() {
  const [state, setState] = useState('checking');
  const [error, setError] = useState('');
  useEffect(() => {
    if (!pushSupported()) return setState('unsupported');
    currentSubscription().then((s) => setState(s && Notification.permission === 'granted' ? 'on' : 'off')).catch(() => setState('off'));
  }, []);
  if (state === 'checking' || state === 'on') return null;
  return (
    <section className="card">
      <h2>Alerts</h2>
      {state === 'unsupported' ? (
        <p className="muted small">This browser can't show alerts. Open the app in Chrome to get them.</p>
      ) : (
        <>
          <p className="small">Get an alert on this phone when the other parent changes a night or one of the boys' items.</p>
          {error && <p className="error">{error}</p>}
          <button className="primary" onClick={async () => { setError(''); try { await turnOnAlerts(); setState('on'); } catch (e) { setError(e.message); } }}>Turn on alerts</button>
        </>
      )}
    </section>
  );
}

function WeeksCard({ data, today }) {
  const weeks = upcomingWeeks(today, 8, data.pattern, data.overrides);
  return (
    <section className="card">
      <h2>Custody weeks</h2>
      <ul className="weeks">
        {weeks.map((w) => (
          <li key={w.start} className={w.start <= today && today <= w.end ? 'now' : ''}>
            <span>{fmt(w.start, { month: 'short', day: 'numeric' })} – {fmt(w.end, { month: 'short', day: 'numeric' })}</span>
            {w.house === 'mixed' ? (
              <span className="pills">{w.nights.filter((n, i, a) => i === 0 || a[i - 1].house !== n.house).map((n) => <i key={n.date} className={`pill h-${n.house}`}>{HOUSES[n.house]?.short}</i>)}</span>
            ) : (
              <i className={`pill h-${w.house}`}>{HOUSES[w.house]?.label}</i>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function ItemList({ items, byId, showWho, today, onEdit, reload, empty }) {
  if (!items.length) return empty ? <p className="muted small">{empty}</p> : null;
  let lastDate = null;
  return (
    <ul className="items">
      {items.map((it) => {
        const head = it.due_on !== lastDate;
        lastDate = it.due_on;
        const who = byId[it.member_id];
        if (it.team) {
          const names = (it.member_ids || []).map((id) => byId[id]).filter(Boolean);
          return (
            <li key={it.id}>
              {head && <p className="date-head">{it.due_on === today ? 'Today' : it.due_on === addDays(today, 1) ? 'Tomorrow' : fmt(it.due_on)}</p>}
              <div className="item team">
                <span className={`team-dot k-${it.kind}`} aria-hidden="true" />
                <div className="item-body">
                  <span className="title">{it.title}</span>
                  <span className="meta">
                    <span className="kind">{KIND_LABEL[it.kind]}</span>
                    {it.due_time && <span>{fmtTime(it.due_time)}</span>}
                    {it.detail && <span>{it.detail}</span>}
                    {showWho && names.map((w) => <span key={w.id} className="who-chip" style={{ '--c': w.color }}>{w.name}</span>)}
                  </span>
                </div>
              </div>
            </li>
          );
        }
        const late = !it.done && it.due_on < today;
        return (
          <li key={it.id}>
            {head && <p className={`date-head${late ? ' late' : ''}`}>{it.due_on === today ? 'Today' : it.due_on === addDays(today, 1) ? 'Tomorrow' : fmt(it.due_on)}{late ? ' · overdue' : ''}</p>}
            <div className={`item${it.done ? ' done' : ''}`}>
              <input type="checkbox" aria-label="Done" checked={it.done} onChange={async (e) => { await supabase.from('items').update({ done: e.target.checked, updated_at: new Date().toISOString() }).eq('id', it.id); reload(); }} />
              <button className="item-body" onClick={() => onEdit({ ...it, due_time: it.due_time ? it.due_time.slice(0, 5) : '', notes: it.notes || '' })}>
                <span className="title">{it.title}</span>
                <span className="meta">
                  <span className="kind">{KIND_LABEL[it.kind] || it.kind}</span>
                  {it.due_time && <span>{fmtTime(it.due_time)}</span>}
                  {showWho && who && <span className="who-chip" style={{ '--c': who.color }}>{who.name}</span>}
                </span>
              </button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function ItemSheet({ item, me, choices, onClose, onSaved }) {
  const [f, setF] = useState(item);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    const row = {
      member_id: f.member_id,
      kind: f.kind,
      title: f.title.trim(),
      due_on: f.due_on,
      due_time: f.due_time || null,
      notes: f.notes?.trim() || null,
      updated_at: new Date().toISOString(),
    };
    const res = f.id ? await supabase.from('items').update(row).eq('id', f.id) : await supabase.from('items').insert(row);
    setBusy(false);
    if (res.error) return setError(res.error.message);
    onSaved();
  }

  async function remove() {
    if (!confirm('Delete this item?')) return;
    const res = await supabase.from('items').delete().eq('id', f.id);
    if (res.error) return setError(res.error.message);
    onSaved();
  }

  return (
    <Sheet title={f.id ? 'Edit item' : 'Quick add'} onClose={onClose}>
      <form onSubmit={save} className="form">
        {choices.length > 1 && (
          <div className="chips">
            {choices.map((m) => (
              <button type="button" key={m.id} className={f.member_id === m.id ? 'chip on' : 'chip'} style={{ '--c': m.color }} onClick={() => setF((x) => ({ ...x, member_id: m.id }))}>{m.name}</button>
            ))}
          </div>
        )}
        <label>What<input value={f.title} onChange={set('title')} placeholder="Math test, chapter 4" required maxLength={200} autoFocus /></label>
        <div className="two">
          <label>Type
            <select value={f.kind} onChange={set('kind')}>{KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          </label>
          <label>Date<input type="date" value={f.due_on} onChange={set('due_on')} required /></label>
        </div>
        <label>Time (optional)<input type="time" value={f.due_time} onChange={set('due_time')} /></label>
        <label>Notes (optional)<textarea rows={2} value={f.notes} onChange={set('notes')} /></label>
        {error && <p className="error">{error}</p>}
        <div className="row-between">
          {f.id ? <button type="button" className="danger" onClick={remove}>Delete</button> : <span />}
          <button className="primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </form>
    </Sheet>
  );
}

function NightSheet({ night, data, onClose, onSaved }) {
  const cur = houseFor(night, data.pattern, data.overrides);
  const [note, setNote] = useState(cur?.note || '');
  const [error, setError] = useState('');

  async function pick(house) {
    const res = house
      ? await supabase.from('custody_overrides').upsert({ night, house, note: note.trim() || null })
      : await supabase.from('custody_overrides').delete().eq('night', night);
    if (res.error) return setError(res.error.message);
    onSaved();
  }

  return (
    <Sheet title={fmt(night, { weekday: 'long', month: 'short', day: 'numeric' })} onClose={onClose}>
      <p className="small muted">Now: {cur ? HOUSES[cur.house].label : 'unknown'}{cur?.source === 'override' ? ' (changed by hand)' : ' (from the calendar weeks)'}</p>
      <label>Note (optional)<input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Spring break swap" /></label>
      <div className="pick">
        {Object.entries(HOUSES).map(([k, h]) => (
          <button key={k} className={`pill-btn h-${k}`} onClick={() => pick(k)}>{h.label}</button>
        ))}
      </div>
      {cur?.source === 'override' && <button className="link" onClick={() => pick(null)}>Go back to the calendar weeks</button>}
      {error && <p className="error">{error}</p>}
    </Sheet>
  );
}

function Sheet({ title, onClose, children }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="scrim" onClick={onClose}>
      <div className="sheet" role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="row-between">
          <h2>{title}</h2>
          <button className="link" onClick={onClose} aria-label="Close">Close</button>
        </div>
        {children}
      </div>
    </div>
  );
}
