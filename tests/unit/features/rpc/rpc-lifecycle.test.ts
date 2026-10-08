import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { RawRpc } from '../../../../src/contracts/messages.ts';
import { RpcLog, elapsedRpc, matchesRpc, parseRpc } from '../../../../src/features/rpc/rpc.logic.ts';

const raw = (id?: string, phase?: 'pending' | 'complete', extra: Partial<RawRpc> = {}): RawRpc => ({
  id, phase, method: 'POST', url: 'https://example.test/web/dataset/call_kw/res.partner/read',
  body: JSON.stringify({ jsonrpc: '2.0', params: { model: 'res.partner', method: 'read', args: [[7]], kwargs: {} } }),
  status: phase === 'pending' ? 0 : 200, ms: 25, at: '2026-10-08T00:00:00.000Z',
  response: phase === 'pending' ? '' : '{"jsonrpc":"2.0","result":[7]}', ...extra,
});
const entry = (...args: Parameters<typeof raw>) => parseRpc(raw(...args))!;

test('pending requests have parameters and no completed result; legacy calls stay completed', () => {
  const e = entry('doc:1', 'pending');
  assert.equal(e.phase, 'pending');
  assert.deepEqual(e.args, [[7]]);
  assert.equal(e.result, undefined);
  assert.equal(e.error, undefined);
  assert.equal(entry().phase, 'complete');
});

test('start and completion merge in place without moving the row; repeated/out-of-order starts are ignored', () => {
  const log = new RpcLog();
  const first = log.add(entry('doc:1', 'pending'))!;
  log.add(entry('doc:2', 'pending'));
  const complete = log.add(entry('doc:1', 'complete'))!;
  assert.equal(first, complete);
  assert.equal(log.entries.length, 2);
  assert.equal(log.entries[0], first);
  assert.deepEqual(first.result, [7]);
  assert.equal(first.phase, 'complete');
  assert.equal(log.add(entry('doc:1', 'pending')), null);
  assert.equal(log.add(entry('doc:1', 'complete')), null);
});

test('IDs distinguish document loads and legacy entries have independent rows', () => {
  const log = new RpcLog();
  for (const e of [entry('doc-a:1', 'pending'), entry('doc-b:1', 'pending'), entry(), entry()]) log.add(e);
  assert.equal(log.entries.length, 4);
});

test('Clear suppresses old in-flight completions but records new starts and legacy calls', () => {
  const log = new RpcLog();
  log.add(entry('doc:1', 'pending'));
  log.clear();
  assert.equal(log.add(entry('doc:1', 'complete')), null);
  log.add(entry('doc:2', 'pending'));
  assert.equal(log.add(entry('doc:2', 'complete'))?.phase, 'complete');
  log.add(entry());
  assert.equal(log.entries.length, 2);
});

test('bounded log drops oldest entries, including pending ones', () => {
  const log = new RpcLog(2);
  for (let i = 0; i < 3; i++) log.add(entry(`doc:${i}`, 'pending'));
  assert.deepEqual(log.entries.map((e) => e.id), ['doc:1', 'doc:2']);
});

test('elapsed time and All/Pending/Slow/Errors filters include waiting calls without calling them errors', () => {
  const now = Date.parse('2026-10-08T00:00:02.000Z');
  const pending = entry('doc:1', 'pending');
  const failed = entry('doc:2', 'complete', { error: 'XHR abort', status: 0 });
  const slow = entry('doc:3', 'complete', { ms: 1500 });
  assert.equal(elapsedRpc(pending, now), 2000);
  assert.equal(elapsedRpc(slow, now), 1500);
  assert.equal(elapsedRpc({ ...pending, at: 'invalid' }, now), 25);
  assert.equal(elapsedRpc(pending, now - 3000), 0);
  assert.equal(matchesRpc(pending, 'RES.PARTNER', 'all', now), true);
  assert.equal(matchesRpc(pending, 'write', 'all', now), false);
  assert.equal(matchesRpc(pending, '', 'pending', now), true);
  assert.equal(matchesRpc(pending, '', 'slow', now), true);
  assert.equal(matchesRpc(pending, '', 'errors', now), false);
  assert.equal(matchesRpc(failed, '', 'pending', now), false);
  assert.equal(matchesRpc(failed, '', 'errors', now), true);
  assert.equal(matchesRpc(slow, '', 'slow', now), true);
  assert.equal(matchesRpc(entry(), '', 'slow', now), false);
});

test('an older initial snapshot does not evict newer live rows, nor revive an evicted older completion', () => {
  const log = new RpcLog(2);
  log.add(entry('live', 'pending', { at: '2026-10-08T00:00:03.000Z' }));
  log.add(entry('old', 'complete', { at: '2026-10-08T00:00:01.000Z' }));
  log.add(entry('middle', 'pending', { at: '2026-10-08T00:00:02.000Z' }));
  assert.deepEqual(log.entries.map((e) => e.id), ['middle', 'live']);
  assert.equal(log.add(entry('old', 'complete', { at: '2026-10-08T00:00:01.000Z' })), null);
  assert.deepEqual(log.entries.map((e) => e.id), ['middle', 'live']);
});

test('observing a replacement document ends old-page observation, never newer or same-page pending calls', () => {
  const log = new RpcLog();
  const old = log.add(entry('100:nonce:1', 'pending'))!;
  const current = log.add(entry('200:nonce:1', 'pending'))!;
  const future = log.add(entry('300:nonce:1', 'pending', { at: '2026-10-08T00:00:03.000Z' }))!; // event ahead of a debounced/in-flight refresh
  const legacy = log.add(entry())!;
  const now = Date.parse('2026-10-08T00:00:02.000Z');
  const changed = log.observeDocument(200, now);
  assert.deepEqual(changed, [old]);
  assert.equal(old.phase, 'unavailable');
  assert.equal(old.error, undefined, 'document replacement does not claim a request/server failure');
  assert.equal(old.result, undefined);
  assert.equal(old.ms, 2000);
  assert.equal(elapsedRpc(old, now + 5000), 2000, 'observation clock stops');
  assert.equal(matchesRpc(old, '', 'pending'), false);
  assert.equal(current.phase, 'pending');
  assert.equal(future.phase, 'pending');
  assert.equal(legacy.phase, 'complete');
  assert.deepEqual(log.observeDocument(200, now + 300), [], 'same-document SPA navigation has no effect');
  assert.deepEqual(log.observeDocument(100, now - 400), [], 'stale snapshot does not interrupt newer requests');
});

test('skipped document loads and delayed old-page starts cannot leave pending requests behind', () => {
  const log = new RpcLog();
  log.add(entry('100:nonce:1', 'pending'));
  log.add(entry('200:nonce:1', 'pending'));
  log.observeDocument(300);
  assert.equal(log.entries.some((e) => e.phase === 'pending'), false);
  const late = log.add(entry('200:nonce:2', 'pending'))!;
  assert.equal(late.phase, 'unavailable');
  log.clear();
  assert.equal(log.add(entry('200:nonce:3', 'pending')), null, 'Clear also suppresses delayed old-page starts');
  assert.equal(log.add(entry('300:nonce:1', 'pending'))!.phase, 'pending');
});

test('a real late response replaces the local unavailable state in the original row', () => {
  const log = new RpcLog();
  const old = log.add(entry('100:nonce:1', 'pending'))!;
  log.observeDocument(200);
  assert.equal(log.add(entry('100:nonce:1', 'pending')), null);
  assert.equal(log.add(entry('100:nonce:1', 'complete')), old);
  assert.equal(old.phase, 'complete');
  assert.deepEqual(old.result, [7]);
  assert.equal(log.entries.length, 1);
});


test('BFCache restores an older origin without reviving departed calls or interrupting newly started ones', () => {
  const log = new RpcLog();
  const t = Date.parse('2026-10-08T00:00:00.000Z');
  log.observeDocument(100, t);
  const oldA = log.add(entry('100:nonce:1', 'pending', { at: new Date(t + 100).toISOString() }))!;
  const b = log.add(entry('200:nonce:1', 'pending', { at: new Date(t + 200).toISOString() }))!;
  log.observeDocument(200, t + 300);
  assert.equal(oldA.phase, 'unavailable');
  const restoredA = log.add(entry('100:nonce:2', 'pending', { at: new Date(t + 400).toISOString() }))!;
  assert.equal(restoredA.phase, 'pending', 'restored request arrives before its page refresh');
  log.observeDocument(100, t + 500);
  assert.equal(b.phase, 'unavailable');
  assert.equal(restoredA.phase, 'pending');
  assert.equal(oldA.phase, 'unavailable', 'departed observation remains ended');
  assert.equal(log.add(entry('100:nonce:2', 'complete')), restoredA);
  assert.equal(restoredA.phase, 'complete');
});

test('a same-origin snapshot retires a skipped transient document but preserves its own active requests', () => {
  const log = new RpcLog();
  const t = Date.parse('2026-10-08T00:00:00.000Z');
  log.observeDocument(100, t);
  const a = log.add(entry('100:nonce:1', 'pending', { at: new Date(t + 100).toISOString() }))!;
  const transient = log.add(entry('200:nonce:1', 'pending', { at: new Date(t + 200).toISOString() }))!;
  log.observeDocument(100, t + 300); // A→B→Back happened between the panel's observations
  assert.equal(a.phase, 'pending');
  assert.equal(transient.phase, 'unavailable');
});
