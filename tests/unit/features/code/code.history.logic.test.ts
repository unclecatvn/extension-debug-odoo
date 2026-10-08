import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  captureRun, createHistory, historyScope, HISTORY_LIMIT, MAX_RESULT_CHARS, restoreMode,
} from '../../../../src/features/code/code.history.logic.ts';
import type { RunResult } from '../../../../src/features/code/code.injected.ts';

const scope = historyScope('https://one.test', 'main', 7);
const run = (code = 'return 1', other = scope) => captureRun({
  scope: other, code, lang: 'js', mode: 'read', screen: { model: 'res.partner', resId: 4, ids: [4] },
  fmt: { origin: 'https://one.test', lang: 'en_US', tz: 'UTC' }, startedAt: 100,
});
const result = (value: unknown = 1): RunResult => ({ ok: true, value, hasValue: true, out: [], calls: [], ms: 12, mode: 'read', uid: 7 });
const completed = (code = 'return 1', other = scope) => ({ ...run(code, other), completedAt: 120, durationMs: 12, outcome: { result: result() }, refreshed: null });

test('history retains only the 20 newest completed runs, newest first', () => {
  const history = createHistory();
  for (let i = 0; i < 25; i++) history.add(completed(`return ${i}`));
  assert.equal(history.list(scope).length, HISTORY_LIMIT);
  assert.equal(history.list(scope)[0]?.code, 'return 24');
  assert.equal(history.list(scope).at(-1)?.code, 'return 5');
});

test('history isolates origins, databases, and user identities without ambiguous keys', () => {
  const scopes = [scope, historyScope('https://two.test', 'main', 7), historyScope('https://one.test', 'other', 7), historyScope('https://one.test', 'main', 8)];
  const history = createHistory();
  for (const [i, key] of scopes.entries()) history.add(completed(`return ${i}`, key));
  for (const [i, key] of scopes.entries()) assert.deepEqual(history.list(key).map((x) => x.code), [`return ${i}`]);
  assert.notEqual(historyScope('a:b', 'c', 7), historyScope('a', 'b:c', 7));
  assert.deepEqual(history.list(historyScope('https://one.test', 'main', 9)), []);
});

test('run context and completed results are immutable snapshots, not editor or response references', () => {
  const input = { ...run(), screen: { model: 'x', resId: 9, ids: [9] }, fmt: { origin: 'https://one.test', lang: 'vi_VN', tz: 'Asia/Ho_Chi_Minh' } };
  const captured = captureRun(input);
  input.code = 'return 2'; input.screen.ids.push(10); input.fmt.tz = 'UTC';
  assert.equal(captured.code, 'return 1');
  assert.deepEqual(captured.screen.ids, [9]);
  assert.equal(captured.fmt.tz, 'Asia/Ho_Chi_Minh');
  const response = result({ rows: [{ name: 'before' }] });
  const history = createHistory();
  history.add({ ...captured, completedAt: 120, durationMs: 12, outcome: { result: response }, refreshed: null });
  (response.value as { rows: { name: string }[] }).rows[0]!.name = 'after';
  const entry = history.list(scope)[0]!;
  assert.equal(entry.outcome.kind, 'result');
  if (entry.outcome.kind === 'result') assert.deepEqual(entry.outcome.result.value, { rows: [{ name: 'before' }] });
  assert.ok(Object.isFrozen(entry));
  assert.ok(Object.isFrozen(entry.screen.ids));
  assert.throws(() => { entry.code = 'mutated'; }, TypeError);
  assert.equal(history.list(scope)[0]?.code, 'return 1');
});

test('history captures returned failures and thrown failures with their traceback', () => {
  const history = createHistory();
  const failed: RunResult = { ...result(), ok: false, error: { message: 'denied', name: 'Error', type: 'AccessError', traceback: 'trace', msgid: '', args: [], server: true, line: 3 } };
  history.add({ ...completed(), outcome: { result: failed } });
  const error = Object.assign(new Error('network failed'), { traceback: 'request trace' });
  history.add({ ...completed(), outcome: { error } });
  error.message = 'changed';
  const [thrown, returned] = history.list(scope);
  assert.deepEqual(thrown?.outcome, { kind: 'error', error: { message: 'network failed', traceback: 'request trace' }, clipped: false });
  assert.equal(returned?.outcome.kind === 'result' && returned.outcome.result.error?.message, 'denied');
});

test('large or unserializable results are honestly omitted; retained error text is bounded', () => {
  const history = createHistory();
  history.add({ ...completed(), outcome: { result: result('x'.repeat(MAX_RESULT_CHARS + 1)) } });
  assert.deepEqual(history.list(scope)[0]?.outcome, { kind: 'omitted', reason: 'size', ok: true });
  const cycle: Record<string, unknown> = {}; cycle.self = cycle;
  history.add({ ...completed(), outcome: { result: result(cycle) } });
  assert.deepEqual(history.list(scope)[0]?.outcome, { kind: 'omitted', reason: 'serialization', ok: true });
  history.add({ ...completed(), outcome: { error: new Error('x'.repeat(MAX_RESULT_CHARS * 2)) } });
  const outcome = history.list(scope)[0]!.outcome;
  assert.equal(outcome.kind, 'error');
  if (outcome.kind === 'error') {
    assert.equal(outcome.clipped, true);
    assert.ok(outcome.error.message.length < MAX_RESULT_CHARS);
  }
});

test('clear removes only that identity and a new panel history has no earlier outputs', () => {
  const history = createHistory();
  const other = historyScope('https://one.test', 'other', 7);
  history.add(completed()); history.add(completed('return 2', other));
  history.clear(scope);
  assert.deepEqual(history.list(scope), []);
  assert.equal(history.list(other).length, 1);
  assert.deepEqual(createHistory().list(other), []);
});

test('restoring never enables writes, even when the old run committed writes', () => {
  assert.equal(restoreMode('js', 'write'), 'read');
  assert.equal(restoreMode('python', 'write'), 'dry');
  assert.equal(restoreMode('js', 'dry'), 'dry');
  assert.equal(restoreMode('js', 'read'), 'read');
  assert.equal(restoreMode('python', 'read'), 'dry');
});

test('a run stays on its original screen across hidden-tab navigation and page reloads', async () => {
  const { sameRunPage } = await import('../../../../src/features/code/code.history.logic.ts');
  const page = { origin: 'https://one.test', url: 'https://one.test/odoo/res.partner/4', loadedAt: 100, model: 'res.partner', resId: 4 };
  assert.equal(sameRunPage(page, { ...page }), true);
  for (const changed of [{ origin: 'https://two.test' }, { loadedAt: 101 }, { model: 'res.users' }, { resId: 5 }, { url: `${page.url}?action=7` }]) {
    assert.equal(sameRunPage(page, { ...page, ...changed }), false);
  }
});
