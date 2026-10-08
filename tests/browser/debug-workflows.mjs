// Real built extension + headless Chrome against an isolated, in-memory Odoo-shaped HTTP fixture.
// No real Odoo database, credentials or writes. Run after npm run build: npm run test:browser.
import assert from 'node:assert/strict';
import http from 'node:http';
import puppeteer from 'puppeteer';
import { EXT, isPanel, openPanel, settingsOf } from '../../tools/odoo.mjs';

const session = '2026-10-08 09:00:00 Fixture User';
const fields = {
  id: { type: 'integer', string: 'ID', store: true },
  name: { type: 'char', string: 'Name', store: true },
  active: { type: 'boolean', string: 'Active', store: true },
  amount: { type: 'float', string: 'Amount', store: true },
  tag_ids: { type: 'many2many', string: 'Tags', relation: 'fixture.tag', store: true },
  same: { type: 'char', string: 'Same', store: true },
};
const records = {
  1: { id: 1, name: 'Record A', active: true, amount: 100, tag_ids: [1, 2], same: 'equal' },
  2: { id: 2, name: 'Record B', active: false, amount: 200, tag_ids: [2, 1], same: 'equal' },
};
const profiles = [
  { id: 3, name: '/web/dataset/call_kw/fixture.record/read?x=1', duration: 0.9, sql_count: 8 },
  { id: 2, name: '/web/dataset/call_kw/fixture.record/read?x=2', duration: 0.3, sql_count: 4 },
  { id: 1, name: '/web/dataset/call_kw/fixture.record/search', duration: 0.2, sql_count: 2 },
].map((r) => ({ ...r, session, create_date: '2026-10-08 09:01:00' }));
const requests = [];
const pendingResponses = [];
async function waitForPending(count = 1) {
  const deadline = Date.now() + 5000;
  while (pendingResponses.length < count && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));
  assert.ok(pendingResponses.length >= count, 'pending request reached fixture');
}
async function releaseResponse() {
  await waitForPending();
  pendingResponses.shift()();
}
const html = `<!doctype html><html><head><title>Debug workflow fixture</title></head><body class="o_web_client"><div class="o_form_view">Fixture only</div><script>
const props = {resModel:'fixture.record', resId:1, context:{lang:'en_US'}};
const controller = {props, currentState:{resId:1}, view:{type:'form'}, action:{res_model:'fixture.record',name:'Fixture',views:[[1,'form']]}};
const model = {root:{resModel:'fixture.record',selection:[]}};
window.odoo = {csrf_token:'fixture-only',debug:'1',__WOWL_DEBUG__:{root:{env:{services:{action:{currentController:controller},user:{context:{lang:'en_US'},userId:2}}},__owl__:{component:{props,model},children:{}}}}};
window.fixtureForm = (id) => {controller.view.type='form';controller.currentState.resId=id;props.resId=id;history.pushState({},'', '/odoo/fixture.record/'+id);};
window.fixtureSelect = (ids) => {controller.view.type='list';model.root.selection=ids.map(resId=>({resId}));history.pushState({},'', '/odoo/fixture.record');};
</script></body></html>`;
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://fixture');
  if (req.method !== 'POST') {
    res.setHeader('Content-Type', 'text/html'); res.end(html); return;
  }
  let raw = ''; for await (const c of req) raw += c;
  const p = JSON.parse(raw).params ?? {};
  requests.push({ route: url.pathname, ...p });
  let result;
  if (url.pathname === '/web/session/get_session_info') result = {
    db: 'fixture', uid: 2, name: 'Fixture User', username: 'fixture', is_system: true,
    server_version: '19.0', server_version_info: [19, 0, 0, 'final', 0], user_context: { lang: 'en_US', tz: 'UTC' }, profile_session: null,
  };
  else if (url.pathname === '/fixture/slow') {
    await new Promise((resolve) => pendingResponses.push(resolve)); result = { done: true };
  } else if (url.pathname === '/fixture/error') {
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ jsonrpc: '2.0', error: { message: 'Fixture failure' } })); return;
  } else if (p.method === 'fields_get') result = p.model === 'fixture.record' ? fields
    : Object.fromEntries((p.kwargs?.allfields ?? []).map((f) => [f, { type: 'char' }]));
  else if (p.model === 'ir.config_parameter') result = '2099-01-01 00:00:00';
  else if (p.model === 'ir.profile') {
    if (p.method === 'read_group') result = [{ session, session_count: profiles.length }];
    else if (p.method === 'search_read') result = profiles;
    else if (p.method === 'read') result = p.args[0].map((id) => ({ id, sql: '[]', traces_async: '[]' }));
    else result = [];
  } else if (p.model === 'fixture.record' && p.method === 'get_metadata') result = [{ xmlids: [] }];
  else if (p.model === 'fixture.record' && p.method === 'read') result = p.args[0].flatMap((id) => records[id] ? [records[id]] : []);
  else result = [];
  res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ jsonrpc: '2.0', result }));
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await puppeteer.launch({ enableExtensions: [EXT], pipe: true, defaultViewport: { width: 1440, height: 1000 } });
  const errors = [];
  const page = await browser.newPage();
  page.on('pageerror', (e) => { errors.push(String(e)); console.error('PAGE ERROR', String(e)); });
  page.on('dialog', (d) => d.accept('Fixture snippet'));
  const settings = await settingsOf(browser);
  await settings({ lang: 'en', theme: 'light' });
  await page.goto(`http://127.0.0.1:${server.address().port}/odoo/fixture.record/1`);
  console.log('Fixture loaded', await page.evaluate(() => ({odoo:!!window.odoo, hook:!!window.__odooDebugHook})));
  const panel = await openPanel(page);
  assert.ok(isPanel(panel));
  const click = (selector) => panel.$eval(selector, (n) => n.click());
  const clickText = async (selector, label) => {
    await panel.waitForFunction((selector, label) => [...document.querySelectorAll(selector)].some((n) => n.textContent.trim() === label), {}, selector, label);
    await panel.$$eval(selector, (ns, label) => ns.find((n) => n.textContent.trim() === label).click(), label);
  };
  const includes = (selector, value) => panel.waitForFunction((selector, value) => document.querySelector(selector)?.textContent.includes(value), {}, selector, value);
  await includes('#status', 'fixture.record');
  await click('#full');

  // Aggregates and drilldown use the existing request details, including the baseline action.
  await click('[data-tab="perf"]');
  await clickText('#perf button', 'Group by method');
  await includes('#perf', '2 groups · 3 requests');
  const values = await panel.$eval('#perf tr[data-id="method:fixture.record/read"]', (r) => [...r.cells].slice(1).map((c) => c.textContent));
  assert.deepEqual(values, ['2', '1.20 s', '600 ms', '12']);
  await click('#perf tr[data-id="method:fixture.record/read"]');
  await panel.waitForSelector('#perf tr[data-id="3"]');
  await click('#perf tr[data-id="3"]');
  await clickText('#perf button', 'Set as Baseline');
  await includes('#perf', 'Baseline ✓');
  console.log('PASS Perf: grouped count/sum/median/SQL, drilldown, baseline');

  // A pending request stays one row on completion and preserves the edited body.
  await click('[data-tab="rpc"]');
  await clickText('#rpc button', 'Clear');
  const startRequest = () => page.evaluate(() => {
    void fetch('/fixture/slow', { method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', params: {} }) });
  });
  await startRequest();
  await includes('#rpc .list', 'Pending');
  await click('#rpc .list > li');
  await panel.waitForSelector('#rpc textarea');
  await panel.$eval('#rpc textarea', (n) => { n.value = '{"edited":true}'; });
  await panel.waitForFunction(() => parseInt(document.querySelector('#rpc .ms').textContent) >= 1000);
  await clickText('#rpc .seg button', 'Slow (≥ 1 s)');
  assert.equal(await panel.$$eval('#rpc .list > li:not([hidden])', (ns) => ns.length), 1);
  await releaseResponse();
  await includes('#rpc .answer', 'Recorded at');
  assert.equal(await panel.$$eval('#rpc .list > li', (ns) => ns.length), 1);
  assert.equal(await panel.$eval('#rpc textarea', (n) => n.value), '{"edited":true}');
  await clickText('#rpc .seg button', 'Pending');
  assert.equal(await panel.$$eval('#rpc .list > li:not([hidden])', (ns) => ns.length), 0);
  await startRequest();
  await includes('#rpc .list', 'Pending');
  await clickText('#rpc button', 'Clear');
  await releaseResponse();
  await page.evaluate(() => fetch('/fixture/error', { method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', params: {} }) }).then((r) => r.text()));
  await clickText('#rpc .seg button', 'Errors');
  await panel.waitForSelector('#rpc .list > li.is-err:not([hidden])');
  assert.equal(await panel.$$eval('#rpc .list > li', (ns) => ns.length), 1, 'Clear does not resurrect completed requests');
  console.log('PASS RPC: live pending/elapsed, status filters, completion merge, preserved edits, clear');

  // Saved record comparison, pin across navigation, and order-insensitive many2many values.
  await click('[data-tab="record"]');
  const openCompare = async () => {
    await panel.waitForSelector('#record [data-key="compare"]');
    await panel.$eval('#record [data-key="compare"]', (n) => { n.open = true; n.dispatchEvent(new Event('toggle')); });
    await panel.waitForSelector('#record [data-key="compare"] [data-ref="pin"]');
  };
  await openCompare();
  await clickText('#record button', 'Pin current record');
  await includes('#record [data-key="compare"]', 'Pinned: fixture.record (#1)');
  await page.evaluate(() => window.fixtureForm(2));
  await includes('#status', '#2');
  await openCompare();
  await clickText('#record button', 'Compare with pinned');
  await includes('#record [data-key="compare"] table', 'Record B');
  assert.equal(await panel.$$eval('#record [data-key="compare"] tbody tr[data-status="same"]', (ns) => ns.length), 2);
  await click('#record [data-key="compare"] [data-ref="differences"]');
  assert.equal(await panel.$$eval('#record [data-key="compare"] tbody tr', (ns) => ns.length), 4);
  await page.evaluate(() => window.fixtureSelect([1, 2]));
  await includes('#status', 'list');
  await openCompare();
  await clickText('#record button', 'Compare selected');
  await includes('#record [data-key="compare"] table', 'Record B');
  await page.evaluate(() => window.fixtureSelect([1, 2, 3, 4, 5, 6]));
  await clickText('#record button', 'Compare selected');
  await includes('#record [data-key="compare"]', 'Select 2–5 different saved records');
  console.log('PASS Record: pin/navigation, list selection, differences-only, many2many order, >5 rejected');

  // Run two snippets, inspect the old immutable result, restore without executing, and save it.
  await click('[data-tab="code"]');
  await panel.waitForSelector('#code textarea.code');
  const setCode = (code) => panel.$eval('#code textarea.code', (n, code) => { n.value = code; n.dispatchEvent(new Event('input', {bubbles:true})); }, code);
  await setCode('return 11');
  await clickText('#code button', '▶ Run');
  await includes('#code .output', '11');
  await setCode('return 22');
  await clickText('#code button', '▶ Run');
  await includes('#code .output', '22');
  await clickText('#code button', 'History');
  await panel.waitForSelector('#code [data-ref="pick"]');
  const picks = await panel.$$('#code [data-ref="pick"]');
  assert.equal(picks.length, 2);
  await picks[1].evaluate((n) => n.click());
  await includes('#code [data-ref="detail"]', '11');
  await clickText('#code button', 'Restore code');
  assert.equal(await panel.$eval('#code textarea.code', (n) => n.value), 'return 11');
  await includes('#code .output', '22');
  assert.equal(await panel.$$eval('#code [data-ref="pick"]', (ns) => ns.length), 2, 'Restore does not run code');
  await clickText('#code button', 'Save as snippet…');
  await clickText('#code button', 'Snippets');
  await includes('#code .snippets', 'Fixture snippet');
  await clickText('#code button', 'History');
  await clickText('#code button', 'Clear history');
  await includes('#code', 'No completed runs yet.');
  console.log('PASS Code: snapshots, inspect/restore without rerun, save snippet, clear');

  // Narrow mode still drills into the same grouped request UI.
  await click('#full');
  await click('[data-tab="perf"]');
  await includes('#perf', '2 groups · 3 requests');
  await panel.waitForSelector('#perf tr[data-id="method:fixture.record/search"]');
  await click('#perf tr[data-id="method:fixture.record/search"]');
  await panel.waitForSelector('#perf tr[data-id="1"]');
  await click('#perf tr[data-id="1"]');
  await includes('#perf', 'Set as Baseline');
  if (process.env.SMOKE_SCREENSHOT) await page.screenshot({path: process.env.SMOKE_SCREENSHOT});
  console.log('PASS narrow-panel Perf drilldown');
  // The newly added template labels and dynamic strings also render in Vietnamese.
  await settings({lang:'vi'});
  await panel.waitForFunction(() => document.documentElement.lang === 'vi');
  await clickText('#perf button', 'Nhóm theo phương thức');
  await includes('#perf', '2 nhóm · 3 request');
  await click('[data-tab="code"]');
  await clickText('#code button', 'Lịch sử');
  await includes('#code', '20 lần chạy hoàn tất');
  await includes('#code', 'Chưa có lần chạy nào hoàn tất.');
  console.log('PASS Vietnamese labels and memory-only history after panel reload');
  // The detached panel survives document replacement: old pending calls become unknown/interrupted,
  // while calls from the new document (arriving before the debounced refresh) remain pending.
  await settings({lang:'en'});
  await panel.waitForFunction(() => document.documentElement.lang === 'en');
  const detachedTarget = browser.waitForTarget((t) => t.type() === 'page' && /\/panel\/index.html\?tab=/.test(t.url()));
  await click('#detach');
  const detached = await (await detachedTarget).page();
  detached.on('pageerror', (e) => errors.push(String(e)));
  await detached.waitForSelector('#rpc .seg');
  await detached.$eval('[data-tab="rpc"]', (n) => n.click());
  await detached.$eval('#rpc [data-ref="clear"]', (n) => n.click());
  await startRequest();
  await detached.waitForSelector('#rpc .list > li [data-ref="state"] .pill');
  await waitForPending();
  await page.reload();
  await startRequest();
  await detached.waitForFunction(() => document.querySelector('#rpc .list')?.textContent.includes('Response unavailable'));
  assert.equal(await detached.$$eval('#rpc .list > li', (ns) => ns.length), 2);
  assert.equal(await detached.$$eval('#rpc .list > li [data-ref="state"]', (ns) => ns.filter((n) => n.textContent === 'Pending').length), 1, 'new document pending call is not interrupted');
  assert.equal(await detached.$$eval('#rpc .list > li.is-err', (ns) => ns.length), 0, 'unavailable does not claim a server error');
  await releaseResponse(); // old document: response no longer observed
  await releaseResponse(); // new document: normal completion
  await detached.waitForFunction(() => [...document.querySelectorAll('#rpc .list > li [data-ref="state"]')].every((n) => n.textContent !== 'Pending'));
  console.log('PASS detached RPC document replacement and new-document pending isolation');
  // A Back/Forward Cache restore reuses an older timeOrigin. New requests on the restored page stay live.
  const beforeBack = await page.evaluate(() => performance.timeOrigin);
  await page.goto(`http://127.0.0.1:${server.address().port}/odoo/fixture.record/back`);
  await startRequest();
  await waitForPending();
  await page.goBack();
  const restored = await page.evaluate((before) => performance.timeOrigin === before, beforeBack);
  await startRequest();
  await detached.waitForFunction(() => {
    const states = [...document.querySelectorAll('#rpc .list > li [data-ref="state"]')];
    return states[0]?.textContent === 'Pending' && states.filter((n) => n.textContent === 'Pending').length === 1;
  });
  await releaseResponse();
  await releaseResponse();
  await detached.waitForFunction(() => [...document.querySelectorAll('#rpc .list > li [data-ref="state"]')].every((n) => n.textContent !== 'Pending'));
  console.log(`PASS detached RPC Back navigation (${restored ? 'BFCache restored older document' : 'fresh document; older-origin case covered by unit test'})`);
  assert.deepEqual(errors, [], 'no browser runtime errors');
  assert.equal(requests.some((r) => ['create', 'write', 'unlink'].includes(r.method)), false, 'fixture smoke never writes data');
  console.log('PASS built-extension browser smoke (isolated fixture, not live Odoo)');
} finally {
  await browser?.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
