import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { isExtMessage, type ExtMessage, type RawRpc } from '../../../../src/contracts/messages.ts';
import { parseRpc, RpcLog } from '../../../../src/features/rpc/rpc.logic.ts';

/** Execute the real startup/message-wiring block with browser services stubbed, not a copied wiring algorithm. */
const source = readFileSync(new URL('../../../../src/entrypoints/panel/index.ts', import.meta.url), 'utf8');
const startup = stripTypeScriptTypes(source.slice(source.indexOf('const panel: PanelContext'), source.indexOf('// ---------- minimize:')));
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>((yes) => { resolve = yes; }); return { promise, resolve }; };

test('runtime completion received while initial RPC snapshot is pending is merged before stale snapshot returns', async () => {
  const snapshot = deferred();
  const started = deferred();
  const listeners: ((msg: ExtMessage, sender: { tab: { id: number } }) => void)[] = [];
  const log = new RpcLog();
  let initialized = false;
  let otherCalls = 0;
  const raw: RawRpc = { id: 'document:1', phase: 'pending', method: 'POST', url: 'https://example.test/web/dataset/call_kw',
    body: '{"jsonrpc":"2.0","params":{"model":"res.partner","method":"read"}}', response: '', status: 0, ms: 0, at: '2026-10-08T00:00:00.000Z' };
  const noOp = () => {};
  const el = { addEventListener: noOp };
  const tabs = {
    record: { mount: noOp },
    rpc: {
      async mount() { initialized = true; started.resolve(); await snapshot.promise; log.add(parseRpc(raw)!); },
      onMessage(msg: ExtMessage) { assert.equal(initialized, true); if (msg.type === 'odoo-rpc') log.add(parseRpc(JSON.parse(msg.raw))!); },
    },
    view: { onMessage() { otherCalls++; } },
  };
  const running = runInNewContext(`(async () => { ${startup} })()`, {
    state: {}, ctx: null, showTab: noOp, rendered: new Set(), ownWindowOf: null, tabId: 7,
    TABS: tabs, TAB_NAMES: Object.keys(tabs), section: () => el, setTab: noOp,
    chrome: { tabs: { getCurrent: async () => ({ id: 7 }), onUpdated: { addListener: noOp } }, runtime: { onMessage: { addListener: (f: (typeof listeners)[number]) => listeners.push(f) } } },
    sessionStorage: { getItem: () => null }, TAB_KEY: 'tab', isTabName: () => false,
    document: { querySelectorAll: () => [] }, $: () => el, clearCache: noOp, clearForms: noOp, refresh: noOp,
    setTimeout, clearTimeout, isExtMessage,
  }) as Promise<void>;
  await started.promise;
  assert.equal(listeners.length, 1, 'listener must be installed before waiting for RPC hydration');
  listeners[0]!({ type: 'odoo-rpc', raw: JSON.stringify({ ...raw, phase: 'complete', status: 200, ms: 250, response: '{"jsonrpc":"2.0","result":7}' }) }, { tab: { id: 7 } });
  assert.equal(log.entries[0]!.phase, 'complete');
  assert.equal(otherCalls, 0, 'other tabs do not receive messages during hydration');
  listeners[0]!({ type: 'odoo-pick', name: 'name' }, { tab: { id: 7 } });
  assert.equal(otherCalls, 0);
  snapshot.resolve();
  await running;
  assert.equal(log.entries.length, 1);
  assert.equal(log.entries[0]!.result, 7);
  listeners[0]!({ type: 'odoo-pick', name: 'name' }, { tab: { id: 7 } });
  assert.equal(otherCalls, 1);
});

const refreshSource = stripTypeScriptTypes(source.slice(source.indexOf('let seq = 0;'), source.indexOf('// ---------- tabs ----------')));

test('document hooks survive BFCache during slow detection, ignore stale refreshes, and preserve SPA navigation', async () => {
  const wait = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>((yes) => { resolve = yes; }); return { promise, resolve }; };
  const oldRefresh = wait<{ loadedAt: number; odoo: boolean }>();
  const latestRefresh = wait<{ loadedAt: number; odoo: boolean }>();
  const detection = wait<object>();
  const pageReads = [oldRefresh, latestRefresh];
  const changes: [number, number][] = [];
  const notified = deferred();
  const noOp = () => {};
  const el = { classList: { add: noOp, remove: noOp }, replaceChildren: noOp };
  const context = {
    state: { loadedAt: 100, odoo: false }, ctx: null, ctxError: null,
    exec: () => pageReads.shift()!.promise, pageState: noOp, isExecError: () => false,
    $: () => el, clearCache: noOp, odoo: () => detection.promise,
    TAB_NAMES: ['rpc'], TABS: { rpc: { pageObserved: (old: { loadedAt: number }, next: { loadedAt: number }) => { changes.push([old.loadedAt, next.loadedAt]); notified.resolve(); } } },
    ownWindowOf: null, document: {}, statusParts: () => [], showVersion: noOp,
    rendered: new Set(), restoreScroll: noOp, active: 'rpc', renderActive: noOp,
    refresh: undefined as undefined | (() => Promise<void>),
  };
  runInNewContext(refreshSource, context);
  const older = context.refresh!();
  const latest = context.refresh!();
  latestRefresh.resolve({ loadedAt: 300, odoo: true });
  await notified.promise;
  assert.deepEqual(changes, [[100, 300]], 'document observation does not wait for Odoo context reads');
  const backSnapshot = wait<{ loadedAt: number; odoo: boolean }>();
  pageReads.push(backSnapshot);
  const back = context.refresh!();
  backSnapshot.resolve({ loadedAt: 100, odoo: false });
  await back;
  assert.deepEqual(changes, [[100, 300], [300, 100]], 'restoration notifies even while rendered state still has origin 100');
  detection.resolve({});
  await latest;
  oldRefresh.resolve({ loadedAt: 200, odoo: false });
  await older;
  assert.deepEqual(changes, [[100, 300], [300, 100]], 'stale page snapshot never notifies the hook');
  assert.equal(context.state.loadedAt, 100);
  const samePage = wait<{ loadedAt: number; odoo: boolean }>();
  pageReads.push(samePage);
  const spa = context.refresh!();
  samePage.resolve({ loadedAt: 100, odoo: false });
  await spa;
  assert.deepEqual(changes, [[100, 300], [300, 100], [100, 100]], 'same-page snapshots are observed without claiming a replacement');
});
