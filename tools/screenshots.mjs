// npm run screenshots: regenerates website/screenshots/*.png from a real Odoo, with the built extension (dist/: npm run
// build first) in headless Chrome, 1440×900 at 2×. Needs the Odoo of tools/compose.yml (Sales + CRM with demo data:
// sale.sale_order_7, Marc Demo's rights on it). Leaves the server profiler on in that database (the Perf shot): throw it away afterwards (down -v).
import { writeFile } from 'node:fs/promises';
import puppeteer from 'puppeteer';
import { ODOO, EXT, rpc, openForm, openPanel, isPanel, settingsOf } from './odoo.mjs';

const OUT = new URL('../website/screenshots/', import.meta.url);
const W = 1440, H = 900;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// element.click(), not a mouse click: Puppeteer misplaces those in an iframe inside a closed shadow root
const click = (sel) => panel.$eval(sel, (n) => n.click());
const clickText = (sel, text) => panel.$$eval(sel, (ns, text) => ns.find((n) => n.textContent.trim().startsWith(text))?.click(), text);

const browser = await puppeteer.launch({ enableExtensions: [EXT], pipe: true, defaultViewport: { width: W, height: H, deviceScaleFactor: 2 } });
const page = await browser.newPage();
page.on('dialog', (d) => d.accept());
const settings = await settingsOf(browser); // the panel applies the theme live
await settings({ lang: 'en', theme: 'light' });

await openForm(browser, page, 'action-base.action_res_users/2'); // any form: logs in and warms the webclient up
const [, soId] = await rpc(page, '/web/dataset/call_kw', { model: 'ir.model.data', method: 'check_object_reference', args: ['sale', 'sale_order_7'], kwargs: {} });
await page.goto(`${ODOO}/odoo/action-sale.action_orders/${soId}`);
await page.waitForSelector('.o_form_view');
let panel = await openPanel(page);
await panel.waitForFunction(() => document.querySelector('#status')?.textContent.includes('sale.order'), { timeout: 15_000 });

/** Shows `tab` with its cards `keys` open (all of them: none given), loaded; then waits for `ready` (a selector). */
async function show(tab, keys = null, ready = null) {
  await click(`.tabs [data-tab="${tab}"]`);
  await panel.$$eval(`#${tab} details.card`, (cs, keys) => cs.forEach((c) => {
    const open = !keys || keys.includes(c.dataset.key);
    if (c.open !== open) { c.open = open; c.dispatchEvent(new Event('toggle')); }
  }), keys);
  await panel.waitForFunction((t) => [...document.querySelectorAll(`#${t} .card-body`)].filter((b) => b.closest('details')?.open ?? true)
    .every((b) => b.childElementCount && !b.querySelector(':scope > .loading')), { timeout: 30_000 }, tab);
  if (ready) await panel.waitForSelector(ready, { timeout: 30_000 });
  await panel.$eval('main', (m) => { m.scrollTop = 0; });
}

async function full(on) {
  const now = await panel.$eval('#full', (b) => b.getAttribute('aria-pressed') === 'true');
  if (now !== on) await click('#full');
  await panel.waitForFunction((on) => document.querySelector('#full').getAttribute('aria-pressed') === String(on), {}, on);
}

async function shot(name) {
  await page.mouse.move(4, H - 4); // no hover effect anywhere
  await sleep(500); // transitions, fonts
  const png = await page.screenshot();
  if (name) await writeFile(new URL(`${name}.png`, OUT), png);
  console.log(name || '(overview part)');
  return png;
}

// ---------- beside the form ----------
await show('record', ['identity', 'fields']);
// a field and what recomputes it: the website's Record card
const filterFields = (q) => panel.$eval('#record details.card[data-key=fields] input[type=search]', (i, q) => { i.value = q; i.dispatchEvent(new Event('input', { bubbles: true })); }, q);
await filterFields('amount_total');
await sleep(400);
await panel.$$eval('#record .list > li:not([hidden])', (lis) => lis.find((li) => li.querySelector('.name')?.textContent === 'amount_total')?.querySelector('.pill')?.click());
await sleep(700);
await card('record', await shot(), '#record details.card[data-key=fields] .card-body', { maxH: 300 });
await panel.$$eval('#record .list > li.open .pill', (ps) => ps.forEach((p) => p.click()));
await filterFields('');
await sleep(400);
const light = await shot();
await settings({ theme: 'dark' });
await sleep(1200); // the panel re-themed (storage → settings → every open panel)
const dark = await shot();
await settings({ theme: 'light' });
await writeFile(new URL('overview.png', OUT), await diagonal(light, dark, await panelBox()));
console.log('overview');

// View: the customer picked on the page, why it is read-only and which views it goes through
await show('view', ['overview', 'composition', 'field']);
await clickText('#view details.card[data-key=field] button', '⌖ Pick on Page');
await sleep(400);
await pickOnPage(await page.$eval('.o_field_widget[name=partner_id]', (n) => { const b = n.getBoundingClientRect(); return [b.x + 30, b.y + b.height / 2]; }));
await panel.waitForFunction(() => /state in \['cancel', 'sale'\]/.test(document.querySelector('#view details.card[data-key=field]')?.textContent || ''), { timeout: 15_000 });
// a wheel first: the panel gives up putting back the tab's last scroll position, which would undo this one
await panel.$eval('main', (m) => m.dispatchEvent(new WheelEvent('wheel')));
await panel.$eval('#view details.card[data-key=field]', (c) => [...c.querySelectorAll('h4')].find((h) => /^now/i.test(h.textContent.trim()))?.scrollIntoView({ block: 'start' }));
await card('view', await shot('side-view'), '#view details.card[data-key=field]', { from: 'Now', maxH: 360 });

// i18n: "Order Date" picked on the page: where it comes from, where to change it (shown full screen below)
await show('translations', null, '#translations .subview-body');
await clickText('#translations button', '⌖ Pick on Page');
await sleep(400);
await pickOnPage(await page.$$eval('.o_form_view label', (ls) => { const b = ls.find((x) => x.textContent.trim().startsWith('Order Date')).getBoundingClientRect(); return [b.x + 30, b.y + b.height / 2]; }));
await panel.waitForFunction(() => /date_order/.test(document.querySelector('#translations .subview-body')?.textContent || ''), { timeout: 15_000 });

await show('menus', null, '#menus .list.menus li');
await card('menus', await shot('side-menus'), '#menus .list.menus', { maxH: 250 });

await show('rpc'); // the form's web_read, edited and sent again right in its detail: its answer under the editor
await panel.$$eval('#rpc .list > li', (lis) => lis.find((li) => li.dataset.q === 'sale.order web_read').click());
await panel.waitForSelector('#rpc .detail form.composer textarea'); // editable right away
await panel.$eval('#rpc .detail form.composer textarea', (t) => { // a smaller specification: the answer fits beside it
  const body = JSON.parse(t.value);
  body.params.kwargs.specification = { name: {}, state: {}, amount_total: {}, partner_id: { fields: { display_name: {} } } };
  t.value = JSON.stringify(body, null, 2);
});
await click('#rpc .detail form.composer button[type=submit]');
await panel.waitForFunction(() => document.querySelector('#rpc .detail form.composer .answer')?.textContent.includes('HTTP'), { timeout: 15_000 });
await panel.$eval('#rpc .detail form.composer textarea', (t) => { t.rows = 8; }); // the answer in sight too
await card('rpc', await shot('side-rpc'), '#rpc .detail form.composer', { maxH: 420 });

await show('code'); // a change tried in a Python dry run: the new totals, then everything rolled back
await clickText('#code .seg button', 'Python');
await clickText('#code .seg button', 'Dry run');
await panel.$eval('#code textarea.code', (t) => {
  t.value = "record.order_line.write({'discount': 10})\nreturn record.read(['amount_untaxed', 'amount_total'])";
  t.dispatchEvent(new Event('input')); // the editor paints on input
});
await click('#code .console-acts .btn.primary');
await panel.waitForFunction(() => document.querySelector('#code .output table'), { timeout: 15_000 });
await card('code', await shot('side-code'), '#code .output', { maxH: 300 });

await settings({ theme: 'dark' });
await sleep(1200);
await show('security', null, '#security .subview table.matrix'); // this order: ACLs and rules × operations
await shot('side-security-dark');
await settings({ theme: 'light' });
await sleep(1200);

// Security: why Marc Demo can't open this order (the rule refusing), and the group that would let him
await panel.$eval('#security .user-search input', (i) => i.focus());
await page.keyboard.type('marc', { delay: 40 });
await panel.waitForSelector('#security .user-search .suggest:not([hidden]) li', { timeout: 15_000 });
await page.keyboard.press('Enter');
await panel.waitForFunction(() => /Personal Orders/.test(document.querySelector('#security .subview table.matrix')?.textContent || ''), { timeout: 20_000 });
await sleep(800);
const scrollToRules = () => panel.$eval('main', (m) => m.dispatchEvent(new WheelEvent('wheel'))).then(() => panel.$$eval('#security .subview table.matrix tr', (rs) => rs.find((r) => /Group rules/.test(r.textContent))?.scrollIntoView({ block: 'start' })));
await scrollToRules();
await card('security', await shot(), '#security .subview-body', { from: 'Group rules', maxH: 520 });

// ---------- full screen ----------
await full(true);
await show('record', ['identity', 'fields']);
await shot('full-record');
await show('security', null, '#security .subview table.matrix'); // Marc Demo still: the same, full screen
await sleep(600);
await panel.$$eval('#security .subview table.matrix tr', (rs) => rs.find((r) => /Global rules/.test(r.textContent))?.scrollIntoView({ block: 'start' }));
await shot('full-security');

await show('translations');
await card('i18n', await shot('full-i18n'), '#translations .subview-body table.matrix', { maxH: 200 });

// Apps: what installing website_sale brings, as Odoo computes it
await show('apps', null, '#apps .searchbar input');
for (const x of await panel.$$('#apps .searchbar .facet-x')) await x.evaluate((b) => b.click()); // every module
await panel.$eval('#apps .searchbar input', (i) => { i.value = 'website_sale;'; i.dispatchEvent(new Event('input', { bubbles: true })); });
await sleep(600);
await panel.$$eval('#apps table.matrix tr[data-id]', (rs) => rs.find((r) => !r.hidden && /^website_sale ·/.test(r.querySelector('.mx-label')?.innerText.split('\n').at(-1) || ''))?.querySelector('.mx-label').click());
await panel.waitForFunction(() => /website_sale/.test(document.querySelector('#apps .groups-pane')?.textContent || ''), { timeout: 15_000 });
await panel.$$eval('#apps .groups-pane details.fold', (ds) => ds.forEach((d) => {
  const open = /^Depends/.test(d.querySelector('summary').textContent.trim());
  if (d.open !== open) { d.open = open; d.dispatchEvent(new Event('toggle')); }
}));
await panel.waitForFunction(() => /also installs/i.test(document.querySelector('#apps .groups-pane')?.textContent || ''), { timeout: 20_000 });
await sleep(600);
await card('apps', await shot('full-apps'), '#apps .groups-pane', { from: 'Installing it also installs', maxH: 120 });

// Perf: start the profiler, reload the page (the panel comes back, full screen, on this tab) so its requests are
// recorded, then open the slowest call: its diagnosis in the pane beside the list.
await show('perf', null, '#perf .perf-recorder');
await clickText('#perf .perf-recorder .btn', 'Start Profiling');
await sleep(800);
await clickText('#perf .perf-recorder .chip', '5 minutes'); // not allowed on the database yet: for 5 minutes
await panel.waitForFunction(() => /RECORDING/.test(document.querySelector('#perf .perf-recorder')?.textContent || ''), { timeout: 15_000 });
await page.reload();
await page.waitForSelector('.o_form_view');
panel = await page.waitForFrame(isPanel, { timeout: 15_000 });
await panel.waitForFunction(() => document.querySelector('#status')?.textContent.includes('sale.order'), { timeout: 15_000 });
await sleep(1500); // the chatter's requests
await clickText('#perf .toolbar .chip', '⟳');
await panel.waitForFunction(() => document.querySelectorAll('#perf table.matrix tr[data-id]').length > 3, { timeout: 20_000 });
await panel.$$eval('#perf table.matrix tr[data-id]', (rs) => (rs.find((r) => /web_read/.test(r.textContent)) ?? rs[0]).click());
await panel.waitForSelector('#perf .groups-pane .perf-diag', { timeout: 15_000 });
await sleep(800);
await panel.$eval('main', (m) => { m.scrollTop = 0; });
await card('perf', await shot('full-perf'), '#perf .groups-pane', { maxH: 245 });
await clickText('#perf .perf-recorder .btn', 'Stop Profiling');

await browser.close();

/** A close-up of `sel` (in the panel) cut out of the screenshot `png`: the website's feature card `card-<name>.png`.
 * `from`: start at the first element whose text starts so; at most `maxH` CSS px tall, within the panel. */
async function card(name, png, sel, { from = null, maxH = 400, pad = 10 } = {}) {
  const f = await (await panel.frameElement()).boundingBox();
  const r = await panel.$eval(sel, (n, from) => {
    const b = n.getBoundingClientRect();
    const start = from && [...n.querySelectorAll('*')].find((x) => !x.children.length && x.textContent.trim().toLowerCase().startsWith(from.toLowerCase()));
    const top = start ? start.getBoundingClientRect().top : b.top;
    return { x: b.left, y: top, w: b.width, h: b.bottom - top };
  }, from);
  const x0 = Math.max(f.x, f.x + r.x - pad), y0 = Math.max(f.y, f.y + r.y - pad);
  const x1 = Math.min(f.x + f.width, f.x + r.x + r.w + pad), y1 = Math.min(f.y + f.height, y0 + Math.min(r.h, maxH) + 2 * pad);
  const c = await browser.newPage();
  const out = await c.evaluate(async (b64, clip, scale) => {
    const img = await new Promise((ok) => { const i = new Image(); i.onload = () => ok(i); i.src = `data:image/png;base64,${b64}`; });
    const cv = Object.assign(document.createElement('canvas'), { width: Math.round(clip.w * scale), height: Math.round(clip.h * scale) });
    cv.getContext('2d').drawImage(img, clip.x * scale, clip.y * scale, clip.w * scale, clip.h * scale, 0, 0, cv.width, cv.height);
    return cv.toDataURL('image/png').split(',')[1];
  }, Buffer.from(png).toString('base64'), { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, 2);
  await c.close();
  await writeFile(new URL(`card-${name}.png`, OUT), Buffer.from(out, 'base64'));
  console.log(`card-${name}`);
}

/** A click on the Odoo page at [x, y] (the panel's ⌖ Pick on Page waits for it). */
async function pickOnPage([x, y]) {
  await page.mouse.move(x, y);
  await sleep(200);
  await page.mouse.click(x, y);
}

/** The panel's box in CSS px (its iframe sits in a closed shadow root: found from the frame). */
async function panelBox() {
  const el = await panel.frameElement();
  return el.boundingBox();
}

/** `light` with the part of the panel right of a diagonal taken from `dark`, and a thin line along it. */
async function diagonal(light, dark, box) {
  const c = await browser.newPage();
  const png = await c.evaluate(async (a, b, box, scale) => {
    const img = (b64) => new Promise((ok) => { const i = new Image(); i.onload = () => ok(i); i.src = `data:image/png;base64,${b64}`; });
    const [la, da] = await Promise.all([img(a), img(b)]);
    const cv = Object.assign(document.createElement('canvas'), { width: la.width, height: la.height });
    const g = cv.getContext('2d');
    g.drawImage(la, 0, 0);
    const top = { x: (box.x + box.width * 0.78) * scale, y: box.y * scale };
    const bottom = { x: (box.x + box.width * 0.43) * scale, y: (box.y + box.height) * scale };
    g.save();
    g.beginPath();
    g.rect(box.x * scale, box.y * scale, box.width * scale, box.height * scale); // only the panel: the page is the same
    g.clip();
    g.beginPath();
    g.moveTo(top.x, top.y); g.lineTo(cv.width, top.y); g.lineTo(cv.width, bottom.y); g.lineTo(bottom.x, bottom.y);
    g.closePath();
    g.clip();
    g.drawImage(da, 0, 0);
    g.restore();
    g.save();
    g.beginPath();
    g.rect(box.x * scale, box.y * scale, box.width * scale, box.height * scale);
    g.clip();
    g.strokeStyle = 'rgba(255,255,255,.9)';
    g.lineWidth = 3 * scale;
    g.beginPath(); g.moveTo(top.x, top.y); g.lineTo(bottom.x, bottom.y); g.stroke();
    g.restore();
    return cv.toDataURL('image/png').split(',')[1];
  }, Buffer.from(light).toString('base64'), Buffer.from(dark).toString('base64'), box, 2);
  await c.close();
  return Buffer.from(png, 'base64');
}
