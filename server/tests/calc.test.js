import { test } from 'node:test';
import assert from 'node:assert/strict';
import { achievementPct, weekRange, monthRange } from '../util.js';
import { cleanFields, isValidDate } from '../registers.js';

test('achievement: target 20, achieved 14 -> 70%', () => assert.equal(achievementPct(14, 20), 70));
test('achievement: missing or zero target -> N/A (never 0% or Infinity)', () => {
  assert.equal(achievementPct(5, null), 'N/A');
  assert.equal(achievementPct(5, undefined), 'N/A');
  assert.equal(achievementPct(5, 0), 'N/A');
});
test('weeks run Monday to Sunday', () => assert.deepEqual(weekRange('2026-10-14'), { start: '2026-10-12', end: '2026-10-18' }));
test('month range handles leap years', () => assert.deepEqual(monthRange('2028-02'), { start: '2028-02-01', end: '2028-02-29' }));
test('invalid dates are rejected', () => {
  assert.equal(isValidDate('2026-02-30'), false);
  assert.equal(isValidDate('14/10/2026'), false);
  assert.equal(isValidDate('2026-10-14'), true);
});
test('required fields produce clear messages', () => {
  const { errors } = cleanFields({ name: { required: true, label: 'Name' } }, {});
  assert.match(errors.name, /Name is required/);
});
