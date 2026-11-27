// Team practices and games read live from the Broncos app (football schema)
// through family.team_events(). Turns each row into a read-only list entry
// in the family's home time zone.
import { HOME_TZ } from './dates.mjs';

export function localParts(iso, tz = HOME_TZ) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(new Date(iso))
      .map((p) => [p.type, p.value]),
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

function shortTeam(name) {
  return (name || 'Team').replace(/^OB\s+/i, '').replace(/\s+\d+U$/i, '');
}

export function eventTitle(row) {
  const team = shortTeam(row.team_name);
  if (row.kind === 'practice') return `${team} practice`;
  const t = (row.title || '').replace(/^OB\s+/i, '').trim();
  return t || `${team} game`;
}

// "LIGHT / AWAY jersey. Check for league updates." -> "Light jersey (away)"
export function eventDetail(row) {
  const bits = [];
  const loc = (row.location || '').trim();
  if (loc && !/^location tba$/i.test(loc) && loc.length <= 60) bits.push(loc.replace(/^Orange Beach Sportsplex\s*-\s*/i, 'Sportsplex '));
  else bits.push('Place TBA');
  const notes = row.notes || '';
  const j = notes.match(/\b(light|dark)\s*\/\s*(away|home)\s+jersey/i);
  if (j) bits.push(`${j[1][0].toUpperCase()}${j[1].slice(1).toLowerCase()} jersey`);
  else if (notes.trim()) bits.push(notes.trim().split(/\n/)[0].slice(0, 80));
  return bits.join(' · ');
}

export function toEntries(rows) {
  return (rows || []).map((r) => {
    const { date, time } = localParts(r.starts_at);
    return {
      id: `team-${r.id}`,
      team: true,
      kind: r.kind === 'game' ? 'game' : 'practice',
      title: eventTitle(r),
      detail: eventDetail(r),
      due_on: date,
      due_time: time,
      member_ids: r.member_ids || [],
      done: false,
    };
  });
}

// Merge items and team entries in date/time order.
export function byWhen(a, b) {
  if (a.due_on !== b.due_on) return a.due_on < b.due_on ? -1 : 1;
  const ta = a.due_time || '';
  const tb = b.due_time || '';
  return ta === tb ? 0 : ta < tb ? -1 : 1;
}
