'use client';
import { useState } from 'react';
import { supabase } from '@/lib/supabase.mjs';
import { pingOtherParent } from '@/lib/alerts.mjs';

// The boys' private "Want to talk?" button. Asks live in family.talk_requests,
// which the app only reaches through the talk_* functions: a boy sees only
// his own ask, and each parent sees only asks sent to them.

export const TOPICS = [
  ['talk', 'Just want to talk'],
  ['school', 'School'],
  ['friends', 'Friends'],
  ['bugging', "Something's bugging me"],
];
const TOPIC_LABEL = Object.fromEntries(TOPICS);

// Brooks gets the big-button version.
const SIMPLE = ['brooks'];
const KID_TOPICS = [
  ['talk', '💬', 'Just talk'],
  ['friends', '🤝', 'Friends'],
  ['bugging', '😟', 'Bugging me'],
];

const sentTo = (a) => (a.to_dad && a.to_mom ? 'Dad and Mom' : a.to_dad ? 'Dad' : 'Mom');
const ago = (ts) => new Date(ts).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' });

export function KidTalkCard({ me, ask, reload }) {
  const simple = SIMPLE.includes(me.slug);
  const [to, setTo] = useState('');
  const [topic, setTopic] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [justSent, setJustSent] = useState(false);

  async function send(t = topic) {
    setBusy(true);
    setError('');
    const { error } = await supabase.rpc('talk_ask', { p_to: to, p_topic: t || null, p_note: simple ? null : note.trim() || null });
    setBusy(false);
    if (error) return setError("That didn't send. Try again, or come find us.");
    setJustSent(true);
    setTo(''); setTopic(''); setNote('');
    pingOtherParent();
    reload();
  }

  async function cancel() {
    setBusy(true);
    await supabase.rpc('talk_cancel');
    setBusy(false);
    setJustSent(false);
    reload();
  }

  if (ask) {
    const who = [];
    if (ask.to_dad) who.push(['Dad', ask.dad_seen, ask.dad_done]);
    if (ask.to_mom) who.push(['Mom', ask.mom_seen, ask.mom_done]);
    return (
      <section className={`card talk sent${simple ? ' simple' : ''}`}>
        {simple && justSent && <p className="talk-sent-big">Sent!</p>}
        <h2>{simple ? `${sentTo(ask)} will come find you` : `You asked ${sentTo(ask)} to talk`}</h2>
        {!simple && ask.topic && <p className="small">{TOPIC_LABEL[ask.topic]}</p>}
        <ul className="talk-status">
          {who.map(([name, seen, done]) => (
            <li key={name}>{name}: {done ? 'you talked' : seen ? 'saw it' : 'not seen yet'}</li>
          ))}
        </ul>
        <button disabled={busy} onClick={cancel}>Never mind</button>
        <p className="muted small">If it can't wait, come find us or call.</p>
      </section>
    );
  }

  if (simple) {
    return (
      <section className="card talk simple">
        <h2>Want to talk?</h2>
        {!to ? (
          <div className="talk-faces">
            <button onClick={() => setTo('dad')}><span aria-hidden="true">🧔</span>Dad</button>
            <button onClick={() => setTo('mom')}><span aria-hidden="true">👩</span>Mom</button>
          </div>
        ) : (
          <>
            <p className="small">What about?</p>
            <div className="talk-emoji">
              {KID_TOPICS.map(([k, e, l]) => (
                <button key={k} disabled={busy} onClick={() => send(k)}><span aria-hidden="true">{e}</span>{l}</button>
              ))}
            </div>
            <button className="link" onClick={() => setTo('')}>Back</button>
          </>
        )}
        {error && <p className="error">{error}</p>}
        <p className="muted small">If it can't wait, come find us or call.</p>
      </section>
    );
  }

  return (
    <section className="card talk">
      <h2>Want to talk?</h2>
      <p className="small muted">Only who you pick sees this. Your brothers never do.</p>
      <div className="pick">
        {[['dad', 'Dad'], ['mom', 'Mom'], ['both', 'Both']].map(([k, l]) => (
          <button key={k} className={to === k ? 'pill-btn talk-on' : 'pill-btn'} onClick={() => setTo(k)}>{l}</button>
        ))}
      </div>
      {to && (
        <>
          <p className="small muted">About (optional)</p>
          <div className="chips">
            {TOPICS.map(([k, l]) => (
              <button key={k} className={topic === k ? 'chip on' : 'chip'} style={{ '--c': 'var(--accent)' }} onClick={() => setTopic(topic === k ? '' : k)}>{l}</button>
            ))}
          </div>
          <label>Short note (optional)
            <textarea rows={2} maxLength={280} value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          {error && <p className="error">{error}</p>}
          <button className="primary" disabled={busy} onClick={() => send()}>{busy ? 'Sending…' : `Send to ${to === 'both' ? 'Dad and Mom' : to === 'dad' ? 'Dad' : 'Mom'}`}</button>
        </>
      )}
      <p className="muted small">If it can't wait, come find us or call.</p>
    </section>
  );
}

// Dad's or Mom's Family tab: the asks sent to them.
export function ParentTalkCards({ asks, isMom, reload }) {
  const [busy, setBusy] = useState('');
  if (!asks.length) return null;
  const other = isMom ? 'Dad' : 'Mom';
  async function act(fn, id) {
    setBusy(id + fn);
    await supabase.rpc(fn, { p_id: id });
    setBusy('');
    reload();
  }
  return asks.map((a) => (
    <section key={a.id} className="card talk ask" style={{ '--c': a.kid_color }}>
      <h2>{a.kid_name} would like to talk</h2>
      {a.topic && <p className="small"><strong>{TOPIC_LABEL[a.topic]}</strong></p>}
      {a.note && <p className="talk-note">{a.note}</p>}
      <p className="muted small">
        Sent {ago(a.created_at)}
        {a.also_other ? ` · also sent to ${other}${a.other_done ? `, who already talked with ${a.kid_name}` : ''}` : ''}
      </p>
      <div className="row-between">
        {a.seen ? <span className="muted small">{a.kid_name} can see you saw it.</span> : <button disabled={!!busy} onClick={() => act('talk_seen', a.id)}>Seen</button>}
        <button className="primary" disabled={!!busy} onClick={() => act('talk_done', a.id)}>We talked</button>
      </div>
    </section>
  ));
}
