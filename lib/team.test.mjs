import test from 'node:test';
import assert from 'node:assert/strict';
import { localParts, toEntries, eventTitle, eventDetail, byWhen } from './team.mjs';

test('times convert to Central time', () => {
  assert.deepEqual(localParts('2026-12-05T15:00:00+00:00'), { date: '2026-12-05', time: '09:00' });
  assert.deepEqual(localParts('2026-11-29T04:30:00+00:00'), { date: '2026-11-28', time: '22:30' });
});

test('titles and details read cleanly', () => {
  assert.equal(eventTitle({ kind: 'game', title: 'OB Broncos vs. Coach Cooper', team_name: 'OB Broncos 8U' }), 'Broncos vs. Coach Cooper');
  assert.equal(eventTitle({ kind: 'practice', title: 'Practice 11/21', team_name: 'OB Broncos 8U' }), 'Broncos practice');
  assert.equal(eventDetail({ location: 'Orange Beach Sportsplex - Field 9', notes: 'LIGHT / AWAY jersey. Check for league updates.' }), 'Sportsplex Field 9 · Light jersey');
  assert.equal(eventDetail({ location: '', notes: '' }), 'Place TBA');
  assert.equal(eventDetail({ location: 'Same as last week unless I send different notes if they text me later', notes: 'Bring flag belt if you grabbed one!' }), 'Place TBA · Bring flag belt if you grabbed one!');
});

test('entries sort by date then time', () => {
  const e = toEntries([{ id: 'a', kind: 'game', title: 'x', team_name: 'OB Broncos 8U', starts_at: '2026-12-05T16:00:00Z', member_ids: ['b'] }]);
  assert.equal(e[0].due_time, '10:00');
  const list = [{ due_on: '2026-12-05', due_time: '10:00' }, { due_on: '2026-12-05', due_time: null }, { due_on: '2026-12-01' }].sort(byWhen);
  assert.deepEqual(list.map((x) => x.due_time ?? 'none'), ['none', null, '10:00'].map((x) => x ?? 'none'));
});
