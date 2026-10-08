import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { setTab } from '../../../../src/extension/run-in-tab.ts';
import type { PageState } from '../../../../src/injected/page-state.ts';
import { pageRecordSelection, type RecordSelection } from '../../../../src/injected/record-selection.ts';
import { screenOf } from '../../../../src/features/code/code.data.ts';
import { pageSoftReload } from '../../../../src/features/code/code.injected.ts';

const page: PageState = { origin: 'https://fixture.test', url: 'https://fixture.test/odoo', loadedAt: 1, odoo: true, debug: '', model: 'res.partner', resId: null, viewType: 'list' };
const actual: RecordSelection = { ...page, model: 'res.partner', resId: null, viewType: 'list', ids: [4, 5], selectionAvailable: true, domainSelected: false };

test('Code reads selection and actual identity together, not the stale panel identity', async () => {
  const previous = globalThis.chrome;
  let reads = 0;
  let current = actual;
  globalThis.chrome = { scripting: { executeScript: async ({ func }: { func: unknown }) => {
    assert.equal(func, pageRecordSelection, 'one actual-page snapshot carries identity and selection');
    reads++;
    return [{ result: current }];
  } } } as unknown as typeof chrome;
  setTab({ id: 1 } as chrome.tabs.Tab);
  try {
    assert.deepEqual(await screenOf(page), { model: 'res.partner', resId: null, ids: [4, 5] });
    assert.equal(reads, 1);
    // The panel has not processed its debounced navigation event: only the actual-page snapshot changes.
    current = { ...actual, model: 'res.users', ids: [9] };
    await assert.rejects(screenOf(page), /screen changed/i);
    current = { ...actual, resId: 7, viewType: 'form', ids: [] };
    await assert.rejects(screenOf(page), /screen changed/i);
    current = { ...actual, loadedAt: 2 };
    await assert.rejects(screenOf(page), /screen changed/i);
  } finally { globalThis.chrome = previous; setTab(undefined); }
});

test('soft reload checks actual page identity atomically before acting, even with stale panel state', async () => {
  let reloaded = 0;
  const context = {
    location: { origin: page.origin, href: page.url, pathname: '/odoo' }, performance: { timeOrigin: page.loadedAt },
    window: { odoo: { __WOWL_DEBUG__: { root: { env: { services: { action: {
      currentController: { props: { resModel: 'res.partner' }, view: { type: 'list' } },
      doAction: async () => { reloaded++; },
    } } } } } } },
  };
  const run = () => runInNewContext(`(${pageSoftReload.toString()})(${JSON.stringify(page)})`, context) as Promise<{ ok?: true; error?: string }>;
  assert.equal((await run()).ok, true);
  assert.equal(reloaded, 1);
  context.window.odoo.__WOWL_DEBUG__.root.env.services.action.currentController.props.resModel = 'res.users';
  assert.match((await run()).error!, /screen changed/i);
  assert.equal(reloaded, 1, 'a different current model is never refreshed');
  context.window.odoo.__WOWL_DEBUG__.root.env.services.action.currentController.props.resModel = 'res.partner';
  context.location.href += '/other';
  assert.match((await run()).error!, /screen changed/i);
  assert.equal(reloaded, 1);
});

test('JavaScript rechecks actual identity inside the execution injection, after selection was read', async () => {
  const { pageRunCode } = await import('../../../../src/features/code/code.injected.ts');
  const context = {
    location: { origin: page.origin, href: page.url, pathname: '/odoo' }, performance: { timeOrigin: page.loadedAt, now: () => 0 },
    window: { fetch: () => {}, odoo: { __WOWL_DEBUG__: { root: { env: { services: { action: {
      currentController: { props: { resModel: 'res.users' }, view: { type: 'list' } },
    } } } } } } },
  };
  const opts = { page, mode: 'write', context: {}, uid: 7, readMethods: [], modelMethods: [], groupMethod: 'read_group', screen: { model: 'res.partner', resId: null, ids: [4, 5] } };
  await assert.rejects(runInNewContext(`(${pageRunCode.toString()})('return 42', ${JSON.stringify(opts)})`, context) as Promise<unknown>, /screen changed/i);
  context.window.odoo.__WOWL_DEBUG__.root.env.services.action.currentController.props.resModel = 'res.partner';
  const result = await runInNewContext(`(${pageRunCode.toString()})('return 42', ${JSON.stringify(opts)})`, context);
  assert.equal(result.ok, true);
  assert.equal(result.value, 42);
});

test('Python rechecks actual identity after async action setup and before executing it', async () => {
  const { runPython } = await import('../../../../src/features/code/code.data.ts');
  const previous = globalThis.chrome;
  const methods: string[] = [];
  globalThis.chrome = { scripting: { executeScript: async ({ func, args }: { func: { name: string }; args: unknown[] }) => {
    if (func.name === 'pageState') return [{ result: { ...page, model: 'res.users' } }];
    const params = args[1] as { method: string };
    methods.push(params.method);
    const result = params.method === 'create' ? 12 : params.method === 'search_read' ? [{ id: 1 }] : [];
    return [{ result: { result } }];
  } } } as unknown as typeof chrome;
  setTab({ id: 1 } as chrome.tabs.Tab);
  try {
    const result = await runPython('return 42', 'write', { model: 'res.partner', resId: null, ids: [4, 5] }, page);
    assert.equal(result.ok, false);
    assert.match(result.error!.message, /screen changed/i);
    assert.equal(methods.includes('run'), false, 'no server action executes on the new page');
    assert.equal(methods.at(-1), 'unlink', 'the temporary action is still cleaned up');
  } finally { globalThis.chrome = previous; setTab(undefined); }
});
