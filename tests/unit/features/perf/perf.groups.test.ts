import assert from 'node:assert/strict';
import { test } from 'node:test';
import { groupProfiles, profileGroupKey, type ProfileRow } from '../../../../src/features/perf/perf.logic.ts';

const profile = (id: number, name: string, duration: number, sql_count = 1): ProfileRow =>
  ({ id, name, duration, sql_count, session: 'test', create_date: false });

test('profile groups identify model/method across call routes, with route fallback', () => {
  const call = '/web/dataset/call_kw/sale.order/web_read';
  assert.equal(profileGroupKey(`${call}?x=1`), profileGroupKey(`${call}?x=2`));
  assert.equal(profileGroupKey('/web/dataset/call_button/sale.order/web_read'), profileGroupKey(call));
  assert.notEqual(profileGroupKey(call), profileGroupKey('/web/dataset/call_kw/res.partner/web_read'));
  assert.equal(profileGroupKey('/web/action/load?x=1'), profileGroupKey('/web/action/load?x=2'));
  assert.notEqual(profileGroupKey('/web/action/load'), profileGroupKey('/web/dataset/call_button'));
});

test('profile groups sum counts/SQL/durations and compute odd/even medians', () => {
  const a = '/web/dataset/call_kw/sale.order/web_read';
  const b = '/web/action/load';
  const rows = [profile(1, a, .1, 2), profile(2, b, 1, 3), profile(3, a, .5, 5), profile(4, b, 3, 4), profile(5, a, .3, 7)];
  const groups = groupProfiles(rows);
  assert.equal(groups.length, 2);
  assert.equal(groups[0]!.key, profileGroupKey(b), 'highest cumulative time first');
  assert.equal(groups[0]!.count, 2);
  assert.equal(groups[0]!.duration, 4);
  assert.equal(groups[0]!.median, 2);
  assert.equal(groups[0]!.sql, 7);
  assert.equal(groups[1]!.count, 3);
  assert.ok(Math.abs(groups[1]!.duration - .9) < 1e-9);
  assert.equal(groups[1]!.median, .3);
  assert.equal(groups[1]!.sql, 14);
  assert.deepEqual(groups[1]!.rows.map((r) => r.id), [3, 5, 1], 'members slowest first');
  assert.deepEqual(rows.map((r) => r.id), [1, 2, 3, 4, 5], 'input order untouched');
});

test('profile groups have deterministic ties, singletons and empty input', () => {
  assert.deepEqual(groupProfiles([]), []);
  const rows = [profile(3, '/z', 1), profile(1, '/a', .5), profile(2, '/a', .5)];
  const groups = groupProfiles(rows);
  assert.equal(groups[0]!.count, 2, 'equal time: repeated group first');
  assert.deepEqual(groups[0]!.rows.map((r) => r.id), [1, 2]);
  assert.equal(groups[1]!.median, 1);
  assert.deepEqual(groupProfiles([profile(1, '/z', 1), profile(2, '/a', 1)]).map((g) => g.name), ['/a', '/z']);
});

test('non-finite/negative measurements do not poison all group totals', () => {
  const groups = groupProfiles([profile(1, '/x', NaN, Infinity), profile(2, '/x', -1, -5), profile(3, '/x', 3, 2)]);
  assert.equal(groups[0]!.duration, 3);
  assert.equal(groups[0]!.median, 0);
  assert.equal(groups[0]!.sql, 2);
});
