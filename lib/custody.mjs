// Which house each night. The calendar's "Kids with Bryant" / "Kids with
// Jessalyn" series alternate every Friday at handoff, so one anchor date
// (the first night of a known week) plus overrides gives every night.
import { addDays, daysBetween, weekday } from './dates.mjs';

export const HOUSES = {
  dad: { label: "Dad's", short: 'D' },
  mom: { label: "Mom's", short: 'M' },
  travel: { label: 'Travel', short: 'T' },
};

const other = (h) => (h === 'dad' ? 'mom' : 'dad');

export function patternHouse(night, pattern) {
  if (!pattern) return null;
  const diff = daysBetween(pattern.anchor_date, night);
  const week = Math.floor(diff / 7);
  return ((week % 2) + 2) % 2 === 0 ? pattern.anchor_house : other(pattern.anchor_house);
}

// overrides: Map or object keyed by date -> { house, note }
export function houseFor(night, pattern, overrides) {
  const o = overrides instanceof Map ? overrides.get(night) : overrides?.[night];
  if (o) return { house: o.house, source: 'override', note: o.note || null };
  const house = patternHouse(night, pattern);
  return house ? { house, source: 'pattern', note: null } : null;
}

// First night of the custody week containing `night` (weeks start on the
// anchor's weekday, a Friday for this family).
export function weekStart(night, pattern) {
  const startDow = pattern ? weekday(pattern.anchor_date) : 5;
  const back = (weekday(night) - startDow + 7) % 7;
  return addDays(night, -back);
}

export function nights(start, count, pattern, overrides) {
  return Array.from({ length: count }, (_, i) => {
    const date = addDays(start, i);
    return { date, ...(houseFor(date, pattern, overrides) || { house: null, source: null }) };
  });
}

// Next night (after `from`) where the house changes.
export function nextChange(from, pattern, overrides, limit = 60) {
  const cur = houseFor(from, pattern, overrides)?.house;
  for (let i = 1; i <= limit; i++) {
    const d = addDays(from, i);
    const h = houseFor(d, pattern, overrides)?.house;
    if (h && h !== cur) return { date: d, house: h };
  }
  return null;
}

// Upcoming weeks as ranges, for the Dad tab.
export function upcomingWeeks(from, count, pattern, overrides) {
  const start = weekStart(from, pattern);
  return Array.from({ length: count }, (_, w) => {
    const s = addDays(start, w * 7);
    const list = nights(s, 7, pattern, overrides);
    const houses = new Set(list.map((n) => n.house));
    return { start: s, end: addDays(s, 6), house: houses.size === 1 ? list[0].house : 'mixed', nights: list };
  });
}
