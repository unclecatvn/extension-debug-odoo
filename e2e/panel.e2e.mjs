// End-to-end: the unpacked extension in Chrome (Puppeteer) against a real Odoo (e2e/compose.yml).
//   ODOO_VERSION=19 docker compose -f e2e/compose.yml up -d --wait && npm run e2e
import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';
import puppeteer from 'puppeteer';
import { EXT, rpc, openForm, openPanel } from './odoo.mjs';

const ext = (s) => String(s).includes('chrome-extension://');
// element.click(), not a mouse click: Puppeteer misplaces those in an iframe inside a closed shadow root
const click = (sel) => panel.$eval(sel, (n) => n.click());

let browser, page, panel;
const errors = []; // uncaught errors, console.error and failed loads of the extension (the Odoo page's own ones are not ours)

/** Listens to an extension target (panel iframe, service worker): Puppeteer's page events don't cover them.
 * Log.enable replays what was logged before, e.g. a module that failed to load. */
const watched = new Set();
async function watch(target) {
  const url = target.url();
  if (!url.startsWith('chrome-extension://') || watched.has(target)) return;
  watched.add(target);
  const s = await target.createCDPSession();
  s.on('Runtime.exceptionThrown', ({ exceptionDetails: d }) => errors.push(`${url}: ${d.exception?.description || d.text}`));
  s.on('Runtime.consoleAPICalled', (e) => e.type === 'error' && errors.push(`${url}: ${e.args.map((a) => a.value ?? a.description).join(' ')}`));
  s.on('Log.entryAdded', ({ entry: e }) => e.level === 'error' && errors.push(`${url}: ${e.text} ${e.url || ''}`));
  await Promise.all([s.send('Runtime.enable'), s.send('Log.enable')]);
}

before(async () => {
  browser = await puppeteer.launch({ enableExtensions: [EXT], pipe: true, args: ['--window-size=1400,900'] });
  browser.on('targetcreated', watch);
  browser.on('targetchanged', watch); // an iframe target gets its URL after it is created
  await Promise.all(browser.targets().map(watch));
  page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 900 });
  page.on('pageerror', (e) => ext(e.stack) && errors.push(`page: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && ext(m.location()?.url) && errors.push(`console: ${m.text()}`));

  await openForm(browser, page, 'action-base.action_res_users/2'); // Administrator's user form
});

after(() => browser?.close());

test('the button appears on the Odoo page and opens the panel', async () => {
  panel = await openPanel(page);
  await Promise.all(browser.targets().map(watch));
  await panel.waitForFunction(() => document.querySelector('#status')?.textContent.includes('res.users'), { timeout: 15_000 });
});

test('every tab opens its cards without an error', async () => {
  const tabs = await panel.$$eval('.tabs button', (bs) => bs.map((b) => b.dataset.tab));
  assert.ok(tabs.length >= 8, `tabs: ${tabs}`);
  for (const tab of tabs) {
    await click(`.tabs [data-tab="${tab}"]`);
    assert.equal(await panel.$eval(`#${tab}`, (s) => s.classList.contains('active')), true, `${tab} tab shown`);
    await panel.$$eval(`#${tab} details.card`, (cards) => cards.forEach((c) => { c.open = true; }));
    await panel.waitForFunction((t) => [...document.querySelectorAll(`#${t} .card-body`)] // opened cards fill in async
      .every((b) => b.childElementCount && !b.querySelector(':scope > .loading')), { timeout: 30_000 }, tab);
    const failed = await panel.$$eval(`#${tab} .card-body > .error, #${tab} > .empty`, (ns) => ns.filter((n) => !n.hidden).map((n) => n.textContent));
    assert.deepEqual(failed, [], `${tab} tab`);
  }
});

test('Security tab: another user is found by login and picked, then back to mine', async () => {
  const kw = (model, method, args) => rpc(page, '/web/dataset/call_kw', { model, method, args, kwargs: {} });
  if (!(await kw('res.users', 'search_count', [[['login', '=', 'e2e_demo']]]))) await kw('res.users', 'create', [{ name: 'E2E Demo', login: 'e2e_demo' }]); // a rerun on the same database
  await click('#refresh'); // the user list is cached
  await click('.tabs [data-tab="security"]');
  const search = '#security .user-search input';
  await panel.waitForSelector(search);
  await panel.$eval(search, (i) => { i.focus(); i.value = 'e2e_d'; i.dispatchEvent(new Event('input')); });
  assert.deepEqual(await panel.$$eval('#security .user-search li .muted', (ns) => ns.map((n) => n.textContent)), ['e2e_demo']);
  await panel.$eval(search, (i) => i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })));
  await panel.waitForFunction(() => document.querySelector('#security .user-line b')?.textContent === 'E2E Demo', { timeout: 15_000 });
  await panel.$eval('#security .picker .chip', (b) => b.click()); // My User
  await panel.waitForFunction(() => document.querySelector('#security .user-line b')?.textContent !== 'E2E Demo' && !document.querySelector('#security .picker .chip'), { timeout: 15_000 });
});

test('Security tab: a group is tried, applied to the user, then removed', async () => {
  await click('.tabs [data-tab="security"]');
  await panel.evaluate(() => { window.confirm = () => true; });
  await panel.$$eval('#security details.card', (cs) => { cs.find((c) => c.querySelector('h3').textContent === 'Groups').open = true; });
  // the button of the row `name` among `sel` rows, once it shows (the card re-renders after each write)
  const press = (sel, name) => panel.waitForFunction((sel, n) => {
    const li = [...document.querySelectorAll(`#security .groups > li${sel}`)].find((l) => !l.hidden && l.querySelector('.grow').textContent === n);
    return li && (li.querySelector('button').click(), true);
  }, { timeout: 15_000 }, sel, name);
  await panel.waitForSelector('#security .groups');
  const name = await panel.$eval('#security .groups > li.addable .grow', (n) => n.textContent); // a group the user doesn't have
  await panel.$eval('#security .toolbar:has(+ .groups) input', (i, n) => { i.value = n; i.dispatchEvent(new Event('input')); }, name); // groups to add show while filtering
  await press('.addable', name); // Try: simulated, nothing written yet
  await panel.waitForSelector('#security .trybar');
  await panel.$eval('#security .trybar .chip', (b) => b.click()); // Apply
  await press(':not(.addable):not(.trying)', name); // added: the user's now, and nothing else implies it
  await panel.waitForFunction((n) => [...document.querySelectorAll('#security .groups > li.addable .grow')].some((g) => g.textContent === n), { timeout: 15_000 }, name);
});

test('RPC tab: the calls the webclient made to load the form are listed', async () => {
  await click('.tabs [data-tab="rpc"]');
  const methods = await panel.$$eval('#rpc .list .name', (ns) => ns.map((n) => n.textContent));
  assert.ok(methods.includes('web_read'), `methods: ${methods}`);
});

test('RPC tab: a call is edited and sent again, a new request is sent, the answers show below', async () => {
  await click('.tabs [data-tab="rpc"]');
  const send = async (form, body) => {
    await panel.$eval(`${form} textarea`, (t, v) => { t.value = v; }, body);
    await panel.$eval(`${form} button[type=submit]`, (b) => b.click());
    await panel.waitForFunction((f) => document.querySelector(`${f} .pill`), { timeout: 15_000 }, form);
    return panel.$eval(form, (f) => ({ pill: f.querySelector('.pill').textContent, out: f.querySelector('pre')?.textContent, error: f.querySelector('.error')?.textContent }));
  };
  await panel.$$eval('#rpc .list > li', (lis) => lis.find((li) => li.querySelector('.name').textContent === 'web_read').click());
  await panel.waitForSelector('#rpc .detail .btn');
  await panel.$eval('#rpc .detail .btn', (b) => b.click()); // Edit & Resend
  const body = JSON.parse(await panel.$eval('#rpc .detail .composer textarea', (t) => t.value));
  assert.equal(body.params.method, 'web_read', 'the body as sent');
  assert.equal(await panel.$eval('#rpc .detail .composer textarea', (t) => t.spellcheck), false, 'no spelling squiggles under JSON');
  assert.equal(await panel.$eval('#rpc .list > li:has(.composer)', (li) => li.classList.contains('open')), true, 'the row stays open');
  assert.deepEqual(await panel.$$eval('#rpc .detail:has(.composer) summary', (ss) => ss.map((n) => n.textContent)), ['Result'], 'the editor replaces the parameters');
  body.params.kwargs.specification = { login: {} };
  const resent = await send('#rpc .detail .composer', JSON.stringify(body));
  assert.equal(resent.pill, 'ok', resent.error);
  assert.match(resent.out, /"login": "admin"/);
  await panel.$eval('#rpc .detail .composer textarea', (t) => { t.value = '{ bad'; });
  await panel.$eval('#rpc .detail .composer button[type=submit]', (b) => b.click());
  assert.match(await panel.$eval('#rpc .detail .composer .error', (n) => n.textContent), /^Invalid JSON/, 'checked before sending');

  // Copy as cURL, of what is typed: a call_kw becomes the external API's execute_kw
  await panel.evaluate(() => { navigator.clipboard.writeText = async (t) => { window.copied = t; }; });
  await panel.$eval('#rpc .detail .composer textarea', (t, v) => { t.value = v; }, JSON.stringify(body));
  await panel.$$eval('#rpc .detail .composer .btn', (bs) => bs.find((b) => b.textContent === 'Copy as cURL').click());
  const curl = await panel.waitForFunction(() => window.copied, { timeout: 5_000 }).then((h) => h.jsonValue());
  assert.match(curl, /^curl 'http:\/\/localhost:8069\/jsonrpc'/);
  assert.match(curl, /"execute_kw","args":\["e2e",2,"'"\$ODOO_API_KEY"'","res.users","web_read",\[\[2\]\]/);

  await panel.$$eval('#rpc .toolbar .chip', (bs) => bs.find((b) => b.textContent === 'New Request').click());
  const fresh = await send('#rpc .rpc-draft .composer', JSON.stringify({ jsonrpc: '2.0', params: { model: 'res.users', method: 'nope', args: [], kwargs: {} } }));
  assert.equal(fresh.pill, 'AttributeError');
});

test('Code tab: a search runs as the logged-in user, writes are blocked by default', async () => {
  const run = async (code) => {
    await click('.tabs [data-tab="code"]');
    await panel.waitForSelector('#code textarea.code');
    await panel.$eval('#code textarea.code', (t, v) => { t.value = v; t.dispatchEvent(new Event('input')); }, code);
    await click('#code .console .btn');
    await panel.waitForFunction(() => {
      const o = document.querySelector('#code .output');
      return o.childElementCount && !o.querySelector('.loading');
    }, { timeout: 15_000 });
    return panel.$eval('#code .output', (o) => ({
      status: o.querySelector('.pill')?.textContent, // ok / error
      value: o.querySelector(':scope > pre.mt')?.textContent, // a single value
      cells: [...o.querySelectorAll(':scope > div.mt td')].map((td) => td.textContent), // a list of records: a table
      error: o.querySelector(':scope > .error')?.textContent,
    }));
  };

  const read = await run("const u = await env['res.users'].search([['id', '=', env.uid]]);\nreturn u.read(['login']);");
  assert.equal(read.status, 'ok', read.error);
  assert.ok(read.cells.includes('admin'), `cells: ${read.cells}`);

  const field = await run("const u = await env['res.users'].search([['id', '=', env.uid]]);\nreturn u.login;"); // read like in Python
  assert.equal(field.status, 'ok', field.error);
  assert.match(field.value, /^"?admin"?$/);

  const write = await run("return env['res.partner'].create({ name: 'e2e' });");
  assert.equal(write.status, 'error');
  const count = await run("return env['res.partner'].search_count([['name', '=', 'e2e']]);");
  assert.deepEqual([count.status, count.value], ['ok', '0'], 'the blocked create never reached the server');
});

test('Code tab: the editor colours the code and types smartly (pairs, indent, one undo step)', async () => {
  await click('.tabs [data-tab="code"]');
  await panel.$eval('#code textarea.code', (t) => { t.value = ''; t.dispatchEvent(new Event('input')); t.focus(); });
  await page.keyboard.type("x = env['res.users'].search([['login', '=', 'admin']])");
  await page.keyboard.press('Enter');
  await page.keyboard.type('if (x) {');
  await page.keyboard.press('Enter');
  await page.keyboard.type('print(x)');
  const editor = () => panel.$eval('#code', (s) => ({
    value: s.querySelector('textarea.code').value,
    strings: [...s.querySelectorAll('.tok-string')].map((n) => n.textContent),
    builtins: [...s.querySelectorAll('.tok-builtin')].map((n) => n.textContent),
    lines: s.querySelectorAll('pre.hl > div').length, // one numbered block per line
  }));
  const e = await editor();
  assert.equal(e.value, "x = env['res.users'].search([['login', '=', 'admin']])\nif (x) {\n  print(x)\n}", 'pairs closed once, the } on its own line, indented');
  assert.deepEqual(e.strings, ["'res.users'", "'login'", "'='", "'admin'"]);
  assert.deepEqual(e.builtins, ['env', 'print']);
  assert.equal(e.lines, 4);
});

test('Code tab: suggestions offer the installed models, their fields and the recordset methods', async () => {
  const hints = async (code) => {
    await panel.$eval('#code textarea.code', (t, v) => {
      document.querySelector('#code .suggest').hidden = true; // not the list of the previous call
      t.focus();
      t.value = v;
      t.setSelectionRange(v.length, v.length);
      t.dispatchEvent(new Event('input'));
    }, code);
    await panel.waitForFunction(() => !document.querySelector('#code .suggest').hidden, { timeout: 10_000 });
    return panel.$$eval('#code .suggest li .name', (ns) => ns.map((n) => n.textContent));
  };
  assert.equal((await hints("env['res.us"))[0], 'res.users');
  assert.ok((await hints("env['res.users'].search([['log")).includes('login'));
  const members = await hints("u = env['res.users'];\nu.partner_id.");
  assert.ok(members.includes('read') && members.includes('email'), `members: ${members}`); // email: a res.partner field

  await hints("env['res.us");
  await panel.$eval('#code textarea.code', (t) => t.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
  assert.equal(await panel.$eval('#code textarea.code', (t) => t.value), "env['res.users", 'Enter inserts the first one');
});

test('Code tab: a pick replaces the word, also after a skipped closer and under an IME (Vietnamese Telex)', async () => {
  await click('.tabs [data-tab="code"]');
  const value = () => panel.$eval('#code textarea.code', (t) => t.value);
  const open = () => panel.waitForFunction(() => !document.querySelector('#code .suggest').hidden, { timeout: 10_000 });
  const reset = () => panel.$eval('#code textarea.code', (t) => { t.value = ''; t.dispatchEvent(new Event('input')); t.focus(); });

  // typing ' then ] skips the closers the editor put in: the list of models must not stay open for Enter to pick from
  await reset();
  await page.keyboard.type("x = env['res.users']");
  await page.keyboard.press('Enter');
  assert.equal(await value(), "x = env['res.users']\n");

  // Telex composes "search" (s is a tone key): Tab arrives while it composes, the IME commits the word after it
  await reset();
  await page.keyboard.type("env['res.users'].");
  await panel.$eval('#code textarea.code', (t) => {
    t.dispatchEvent(new CompositionEvent('compositionstart'));
    t.setRangeText('search', t.selectionStart, t.selectionEnd, 'end');
    t.dispatchEvent(new InputEvent('input', { isComposing: true }));
  });
  await open();
  await panel.$eval('#code textarea.code', (t) => {
    t.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', code: 'Tab', keyCode: 229, isComposing: true, bubbles: true, cancelable: true }));
    t.dispatchEvent(new CompositionEvent('compositionend', { data: 'search' }));
  });
  await panel.waitForFunction(() => document.querySelector('#code textarea.code').value.endsWith('_read'), { timeout: 5_000 }).catch(() => {});
  assert.equal(await value(), "env['res.users'].search_read");
});

test('Translations tab: one input searches the installed modules and holds the ticked ones', async () => {
  await click('.tabs [data-tab="translations"]');
  await panel.waitForSelector('#translations .module-picker li');
  const EXPORT = '#translations > div.card'; // the untitled export card, not the Languages card above it
  const state = () => panel.$eval(EXPORT, (s) => ({
    apps: s.querySelector('form input[type=text]').value,
    shown: [...s.querySelectorAll('.module-picker li:not([hidden])')].map((li) => li.dataset.name),
    ticked: [...s.querySelectorAll('.module-picker li input:checked')].map((b) => b.closest('li').dataset.name),
  }));
  const type = (v) => panel.$eval(`${EXPORT} form input[type=text]`, (i, v) => { i.value = v; i.dispatchEvent(new Event('input')); }, v);
  const key = (k) => panel.$eval(`${EXPORT} form input[type=text]`, (i, k) => i.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })), k);
  const tick = (name) => panel.$eval(`#translations .module-picker li[data-name="${name}"] input`, (b) => b.click());

  await type('web; base_imp');
  const { shown, ticked } = await state();
  assert.ok(shown.includes('base_import') && shown.every((n) => n.includes('base_imp')), `the word being typed searches: ${shown}`);
  assert.deepEqual(ticked, ['web']);
  await tick('base_import');
  assert.equal((await state()).apps, 'web; base_import; ', 'a tick replaces the word being typed');
  assert.ok((await state()).shown.length > 2, 'then the whole list again');

  await type('web; base_import; base_setu');
  await key('Enter');
  assert.equal((await state()).apps, 'web; base_import; base_setup; ', 'Enter picks the match, no export');
  assert.equal(await panel.$eval(`${EXPORT} .steps`, (u) => u.childElementCount), 0);

  await tick('web');
  assert.equal((await state()).apps, 'base_import; base_setup; ', 'unticking removes it');

  // languages are toggles; the button says how many files it will download (template + one .po per language, per app)
  const button = () => panel.$eval(`${EXPORT} button[type=submit]`, (b) => b.textContent);
  assert.equal(await button(), 'Export & Download · 2 files');
  await panel.$eval(`${EXPORT} .langs .chip:not(:disabled)`, (c) => c.click());
  assert.equal(await panel.$eval(`${EXPORT} .langs .chip:not(:disabled)`, (c) => c.getAttribute('aria-pressed')), 'true');
  assert.equal(await button(), 'Export & Download · 4 files');
  await panel.$eval(`${EXPORT} .langs .chip:not(:disabled)`, (c) => c.click()); // back off
});

test('Translations tab: Languages card, the active languages as chips that toggle their code in the field', async () => {
  const CARD = '#translations details.card[data-key="add-langs"]';
  await panel.$eval(CARD, (d) => { d.open = true; }); // opened by an earlier test, and remembered: open it anyway
  await panel.waitForSelector(`${CARD} form input[type=text]`);
  const field = () => panel.$eval(`${CARD} form input[type=text]`, (i) => i.value);
  const chip = () => panel.$eval(`${CARD} .chip`, (c) => { c.click(); return [c.textContent, c.getAttribute('aria-pressed')]; });
  await panel.$eval(`${CARD} form input[type=text]`, (i) => { i.value = ''; i.dispatchEvent(new Event('input')); });
  const [code, pressed] = await chip();
  assert.equal(pressed, 'true');
  assert.equal(await field(), code);
  assert.deepEqual(await chip(), [code, 'false']);
  assert.equal(await field(), '');
});

test('Apps tab: Odoo\'s filters (Installed by default), the word being typed searches inside them', async () => {
  await click('.tabs [data-tab="apps"]');
  await panel.waitForSelector('#apps .module-picker li');
  const shown = () => panel.$$eval('#apps .module-picker li:not([hidden])', (lis) => lis.map((li) => ({
    name: li.querySelector('.name').textContent, // a state pill only when not installed (the other pill is the version)
    state: [...li.querySelectorAll('.pill')].map((p) => p.textContent).find((t) => !/^\d/.test(t)) || 'installed',
  })));
  const type = (v) => panel.$eval('#apps input[type=text]', (i, v) => { i.value = v; i.dispatchEvent(new Event('input')); }, v);
  const facet = (label) => panel.$eval('#apps .searchbar', (bar, label) => { // ▾, then the filter: as in Odoo's search panel
    if (bar.querySelector('.search-panel').hidden) bar.querySelector('.search-toggle').click();
    [...bar.querySelectorAll('.search-item')].find((b) => b.textContent.replace('✓ ', '') === label).click();
  }, label);
  const facets = () => panel.$$eval('#apps .searchbar .facet', (fs) => fs.map((f) => f.firstChild.textContent));

  await type('');
  const installed = await shown();
  assert.ok(installed.some((m) => m.name === 'base'), 'base is installed');
  assert.ok(installed.every((m) => m.state === 'installed'), 'Installed filter by default');
  assert.deepEqual(await facets(), ['Installed'], 'shown as a facet inside the search bar');
  await type('crm_s');
  assert.deepEqual(await shown(), [], 'the search stays inside the filters, as in Odoo');
  await facet('Not Installed');
  assert.deepEqual(await facets(), ['Installed or Not Installed'], 'one facet per group, its options OR\'ed');
  assert.deepEqual((await shown()).find((m) => m.name === 'crm_sms'), { name: 'crm_sms', state: 'uninstalled' }, 'Installed or Not Installed');
  await facet('Apps');
  assert.equal((await shown()).find((m) => m.name === 'crm_sms'), undefined, 'crm_sms is not an application');
  await panel.$eval('#apps input[type=text]', (i) => { i.value = ''; i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true })); });
  assert.deepEqual(await facets(), ['Installed or Not Installed'], 'Backspace in the empty input removes the last facet (Apps)');
  await type('crm_s');
  await panel.$eval('#apps .module-picker li:not([hidden]) input', (b) => b.click());
  assert.equal(await panel.$eval('#apps input[type=text]', (i) => i.value), 'crm_sms; ');
  await facet('Not Installed'); // back to the default filters
  assert.deepEqual(await facets(), ['Installed']);
  assert.ok((await shown()).some((m) => m.name === 'crm_sms'), 'a ticked module shows whatever the filters');
});

test('every tab is in sight: the tab strip wraps instead of scrolling', async () => {
  const hidden = await panel.$$eval('.tabs button', (bs) => {
    const nav = bs[0].parentElement.getBoundingClientRect();
    return bs.filter((b) => { const r = b.getBoundingClientRect(); return r.left < nav.left || r.right > nav.right; }).map((b) => b.dataset.tab);
  });
  assert.deepEqual(hidden, []);
});

test('toolbar popup: the page\'s database, and its debug mode switched from there', async () => {
  const [ext] = (await browser.extensions()).values();
  await ext.triggerAction(page);
  const popup = await (await browser.waitForTarget((t) => t.url().endsWith('/src/popup/popup.html'))).asPage();
  await popup.waitForSelector('#page-info [data-info=db]');
  assert.equal(await popup.$eval('#page-info [data-info=db]', (e) => e.textContent), process.env.ODOO_DB || 'e2e');
  await popup.waitForSelector('#debug button.on');
  assert.equal(await popup.$eval('#debug button.on', (b) => b.textContent), 'Off');
  await Promise.all([page.waitForNavigation(), popup.$$eval('#debug button', (bs) => bs.find((b) => b.textContent === 'Debug').click())]);
  assert.equal(await page.evaluate(() => window.odoo.debug), '1');
  await page.goto(page.url().replace('debug=1', 'debug=0')); // back to off for what follows
  await page.waitForSelector('.o_form_view');
});

test('toolbar popup: debug kept on for this Odoo, a page opened without ?debug= gets it, ?debug=0 is left alone', async () => {
  const popup = async () => {
    const [ext] = (await browser.extensions()).values();
    await ext.triggerAction(page);
    const p = await (await browser.waitForTarget((t) => t.url().endsWith('/src/popup/popup.html'))).asPage();
    await p.waitForSelector('#debug button.on');
    return p;
  };
  let p = await popup();
  assert.match(await p.$eval('#shortcuts', (n) => n.textContent), /panel.*debug/);
  await Promise.all([page.waitForNavigation(), p.$eval('#keep', (b) => b.click())]); // off → debug, and kept
  assert.equal(await page.evaluate(() => window.odoo.debug), '1');
  await page.goto(`${new URL(page.url()).origin}/odoo/action-base.action_res_users/2`); // no ?debug=
  await page.waitForFunction(() => new URLSearchParams(location.search).get('debug') === '1', { timeout: 15_000 });
  await page.goto(page.url().replace('debug=1', 'debug=0'));
  await page.waitForSelector('.o_form_view');
  assert.equal(await page.evaluate(() => window.odoo.debug), '');
  p = await popup();
  await p.$eval('#keep', (b) => b.click()); // not kept any more
  await p.waitForFunction(async () => !Object.keys((await chrome.storage.local.get('autoDebug')).autoDebug).length);
  await p.close();
});

test('Security tab: log in as the picked user in an incognito window, this session stays', async () => {
  panel = await page.waitForFrame((f) => f.url().endsWith('/src/panel/panel.html')); // reopened after the reload above
  await panel.waitForSelector('.tabs [data-tab="security"]');
  await click('.tabs [data-tab="security"]');
  const search = '#security .user-search input';
  await panel.waitForSelector(search);
  await panel.$eval(search, (i) => { i.focus(); i.value = 'e2e_d'; i.dispatchEvent(new Event('input')); });
  await panel.$eval(search, (i) => i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })));
  await panel.waitForSelector('#security .user-line .user-name', { timeout: 15_000 }); // the name: logs in as them
  const opened = browser.waitForTarget((t) => t.type() === 'page' && t.url().includes('/web/login?'), { timeout: 15_000 });
  await click('#security .user-line .user-name');
  const login = await (await opened).asPage();
  await login.waitForSelector('input[name=login]');
  assert.equal(await login.$eval('input[name=login]', (i) => i.value), 'e2e_demo');
  assert.match(await login.evaluate(() => new URLSearchParams(location.search).get('redirect')), /^\/odoo\/.*\/2(\?|$)/); // back to this record
  await login.close();
  // the window's link went through /web/session/logout: in this window's cookies, admin would be logged out
  assert.equal((await rpc(page, '/web/session/get_session_info', {})).username, 'admin');
});

test('after an update of the extension, the page opened before gets a working button and panel again', async () => {
  await browser.installExtension(EXT); // Chrome orphans the content scripts of the open tabs: background.js injects them again
  panel = await page.waitForFrame(async (f) => f.url().endsWith('/src/panel/panel.html') && await f.evaluate(() => !!chrome.runtime?.id).catch(() => false), { timeout: 15_000 });
  await panel.waitForFunction(() => document.querySelector('#status')?.textContent.includes('res.users'), { timeout: 15_000 });
  assert.equal(await page.evaluate(() => document.querySelectorAll('odoo-debug-root').length), 1, 'the orphaned copy made way');
  const frame = await panel.frameElement();
  await click('#minimize');
  for (let i = 0; i < 50 && await frame.boundingBox(); i++) await new Promise((r) => setTimeout(r, 100));
  assert.equal(await frame.boundingBox(), null, 'minimized');
});

test('⌥/Alt + click copies the technical name: a field, the label of a readonly one, a tracked change in the chatter', async (t) => {
  await page.browserContext().overridePermissions(new URL(page.url()).origin, ['clipboard-read', 'clipboard-write', 'clipboard-sanitized-write']);
  const altClick = async (sel) => {
    await page.evaluate(() => navigator.clipboard.writeText('-'));
    const { x, y } = await page.$eval(sel, (n) => {
      n.scrollIntoView({ block: 'center' });
      const r = n.getBoundingClientRect();
      return { x: r.x + Math.min(10, r.width / 2), y: r.y + r.height / 2 };
    });
    await page.keyboard.down('Alt');
    await page.mouse.click(x, y);
    await page.keyboard.up('Alt');
    await new Promise((r) => setTimeout(r, 300));
    return page.evaluate(() => navigator.clipboard.readText());
  };
  const [model] = await rpc(page, '/web/dataset/call_kw', { model: 'ir.model', method: 'search', args: [[['model', '=', 'res.partner']]], kwargs: {} });
  await page.goto(`${new URL(page.url()).origin}/odoo/action-base.action_model_model/${model}`); // a base model: its name is readonly
  await page.waitForSelector('.o_form_view .o_field_widget[name="model"]');
  assert.equal(await altClick('.o_form_view .o_field_widget[name="model"]'), 'model');
  assert.equal(await page.$eval('label.o_form_label[for^="model_"]', (l) => !!document.getElementById(l.htmlFor)), false, 'no input carries the id');
  assert.equal(await altClick('label.o_form_label[for^="model_"]'), 'model');

  const partner = (await rpc(page, '/web/session/get_session_info', {})).partner_id;
  await rpc(page, '/web/dataset/call_kw', { model: 'res.partner', method: 'write', args: [[partner], { email: `e2e${Date.now()}@example.com` }], kwargs: {} });
  await page.goto(`${new URL(page.url()).origin}/odoo/action-base.action_partner_form/${partner}`);
  await page.waitForSelector('.o_form_view');
  if (!await page.waitForSelector('.o-mail-Message-tracking', { timeout: 10_000 }).catch(() => null)) return t.skip('no chatter (mail not installed)');
  const label = await page.$eval('.o-mail-Message-tracking .o-mail-Message-trackingField', (n) => n.textContent);
  assert.equal(label, '(Email)');
  assert.equal(await altClick('.o-mail-Message-tracking'), 'email');
});

test('no error from the extension in the console', () => {
  assert.deepEqual(errors, []);
});
