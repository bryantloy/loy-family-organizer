// Date helpers. All custody and due dates are plain YYYY-MM-DD strings in the
// family's home time zone (Orange Beach, AL = America/Chicago).
export const HOME_TZ = 'America/Chicago';
const DAY = 86400000;

export function todayISO(now = new Date(), tz = HOME_TZ) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

function toUTC(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

function fromUTC(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(iso, n) {
  return fromUTC(toUTC(iso) + n * DAY);
}

export function daysBetween(a, b) {
  return Math.round((toUTC(b) - toUTC(a)) / DAY);
}

// 0 = Sunday ... 5 = Friday
export function weekday(iso) {
  return new Date(toUTC(iso)).getUTCDay();
}

export function fmt(iso, opts = { weekday: 'short', month: 'short', day: 'numeric' }) {
  return new Intl.DateTimeFormat('en-US', { ...opts, timeZone: 'UTC' }).format(new Date(toUTC(iso)));
}

export function fmtTime(t) {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  const ap = h >= 12 ? 'PM' : 'AM';
  const hh = h % 12 === 0 ? 12 : h % 12;
  return m ? `${hh}:${String(m).padStart(2, '0')} ${ap}` : `${hh} ${ap}`;
}
