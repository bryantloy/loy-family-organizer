import test from 'node:test';
import assert from 'node:assert/strict';
import { houseFor, weekStart, nextChange, upcomingWeeks } from './custody.mjs';
import { todayISO } from './dates.mjs';

// Anchor taken from the calendar: "Kids with Bryant" starts Fri Nov 13, 2026.
const pattern = { anchor_date: '2026-11-13', anchor_house: 'dad' };

test('alternates every Friday', () => {
  assert.equal(houseFor('2026-11-13', pattern).house, 'dad');
  assert.equal(houseFor('2026-11-19', pattern).house, 'dad');
  assert.equal(houseFor('2026-11-20', pattern).house, 'mom');
  assert.equal(houseFor('2026-11-26', pattern).house, 'mom');
  assert.equal(houseFor('2026-11-27', pattern).house, 'dad');
  assert.equal(houseFor('2026-12-04', pattern).house, 'mom');
  assert.equal(houseFor('2027-02-19', pattern).house, 'dad'); // matches calendar
  assert.equal(houseFor('2026-10-30', pattern).house, 'dad'); // before anchor
  assert.equal(houseFor('2026-11-06', pattern).house, 'mom');
});

test('override wins', () => {
  const o = new Map([['2026-11-21', { house: 'travel', note: 'Maui' }]]);
  assert.deepEqual(houseFor('2026-11-21', pattern, o), { house: 'travel', source: 'override', note: 'Maui' });
});

test('week start is the Friday on or before', () => {
  assert.equal(weekStart('2026-11-25', pattern), '2026-11-20');
  assert.equal(weekStart('2026-11-27', pattern), '2026-11-27');
});

test('next change', () => {
  assert.deepEqual(nextChange('2026-11-25', pattern), { date: '2026-11-27', house: 'dad' });
});

test('upcoming weeks', () => {
  const w = upcomingWeeks('2026-11-25', 3, pattern);
  assert.deepEqual(w.map((x) => [x.start, x.house]), [['2026-11-20', 'mom'], ['2026-11-27', 'dad'], ['2026-12-04', 'mom']]);
});

test('today in Chicago', () => {
  assert.equal(todayISO(new Date('2026-11-25T05:00:00Z')), '2026-11-24');
});
