// npm run screenshots: regenerates website/screenshots/*.png (shared with the READMEs) from a real Odoo, with the
// unpacked extension in headless Chrome, 1440×900 at 2×. Needs Sales + CRM with demo data (sale.sale_order_16):
//   ODOO_VERSION=18 ODOO_MODULES=sale_management,crm ODOO_ARGS= docker compose -f e2e/compose.yml up -d --wait
// Leaves the server profiler on in that database (the Perf shot): throw it away afterwards (down -v).
import { writeFile } from 'node:fs/promises';
import puppeteer from 'puppeteer';
import { ODOO, EXT, rpc, openForm, openPanel } from '../e2e/odoo.mjs';

const OUT = new URL('../website/screenshots/', import.meta.url);
const W = 1440, H = 900;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// element.click(), not a mouse click: Puppeteer misplaces those in an iframe inside a closed shadow root
const click = (sel) => panel.$eval(sel, (n) => n.click());

const browser = await puppeteer.launch({ enableExtensions: [EXT], pipe: true, defaultViewport: { width: W, height: H, deviceScaleFactor: 2 } });
const page = await browser.newPage();
page.on('dialog', (d) => d.accept()); // Perf: "Enable profiling for 5 minutes?"
const worker = await (await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().startsWith('chrome-extension://'))).worker();
const settings = (s) => worker.evaluate((s) => chrome.storage.local.set(s), s); // the panel applies the theme live
await settings({ lang: 'en', theme: 'light' });

await openForm(browser, page, 'action-base.action_res_users/2'); // any form: logs in and warms the webclient up
const [, soId] = await rpc(page, '/web/dataset/call_kw', { model: 'ir.model.data', method: 'check_object_reference', args: ['sale', 'sale_order_16'], kwargs: {} });
await page.goto(`${ODOO}/odoo/action-sale.action_orders/${soId}`);
await page.waitForSelector('.o_form_view');
let panel = await openPanel(page);
await panel.waitForFunction(() => document.querySelector('#status')?.textContent.includes('sale.order'), { timeout: 15_000 });

/** Shows `tab` with the cards whose title starts with one of `cards` open (all of them: none given), loaded. */
async function show(tab, cards, sections = []) {
  await click(`.tabs [data-tab="${tab}"]`);
  await panel.$$eval(`#${tab} details.card`, (cs, titles) => cs.forEach((c) => {
    c.open = !titles || titles.some((t) => c.querySelector('h3').textContent.startsWith(t));
  }), cards ?? null);
  await panel.waitForFunction((t) => [...document.querySelectorAll(`#${t} .card-body`)].filter((b) => b.closest('details')?.open ?? true) // titleless cards: always open
    .every((b) => b.childElementCount && !b.querySelector(':scope > .loading')), { timeout: 30_000 }, tab);
  // collapsible sections inside the cards (Combined arch, user_context…), by the start of their summary
  await panel.$$eval(`#${tab} .card-body details`, (ds, names) => ds.forEach((d) => {
    if (names.some((n) => d.querySelector('summary').textContent.startsWith(n))) d.open = true;
  }), sections);
  await panel.$eval('main', (m) => { m.scrollTop = 0; });
}

async function full(on) {
  const now = await panel.$eval('#full', (b) => b.getAttribute('aria-pressed') === 'true');
  if (now !== on) await click('#full');
  await panel.waitForFunction((on) => document.querySelector('#full').getAttribute('aria-pressed') === String(on), {}, on);
}

async function shot(name) {
  await page.mouse.move(4, H - 4); // no hover effect anywhere
  await sleep(400); // transitions, fonts
  const png = await page.screenshot();
  if (name) await writeFile(new URL(`${name}.png`, OUT), png);
  console.log(name || '(overview part)');
  return png;
}

// ---------- beside the form ----------
await show('record', ['Identity', 'Fields']);
const light = await shot();
await settings({ theme: 'dark' });
const dark = await shot();
await settings({ theme: 'light' });
await writeFile(new URL('overview.png', OUT), await diagonal(light, dark, await panelBox()));
console.log('overview');

await show('view', ['Inherited Views'], ['Combined Arch']);
await shot('side-view');
await show('rpc'); // the form's web_read, edited and sent again: its answer under the editor
await panel.$$eval('#rpc .list > li', (lis) => lis.find((li) => li.dataset.q === 'sale.order web_read').click());
await panel.waitForSelector('#rpc .detail .btn');
await panel.$eval('#rpc .detail .btn', (b) => b.click()); // Edit & Resend
await panel.$eval('#rpc .detail .composer textarea', (t) => { // a smaller specification: the answer fits beside it
  const body = JSON.parse(t.value);
  body.params.kwargs.specification = { name: {}, state: {}, amount_total: {}, partner_id: { fields: { display_name: {} } } };
  t.value = JSON.stringify(body, null, 2);
});
await click('#rpc .detail .composer button[type=submit]');
await panel.waitForSelector('#rpc .detail .composer .pill', { timeout: 15_000 });
await panel.$eval('#rpc .detail .composer textarea', (t) => { t.rows = 8; }); // the answer in sight too
await shot('side-rpc');

await show('code');
await panel.$eval('#code textarea.code', (t) => {
  t.value = [
    "const orders = await env['sale.order'].search([['state', '=', 'sale']], { limit: 5 });",
    'for (const so of orders) print(so.name, so.partner_id.name);',
    "return orders.read(['name', 'partner_id', 'amount_total']);",
  ].join('\n');
  t.dispatchEvent(new Event('input')); // the editor paints on input
});
await click('#code .console .btn');
await panel.waitForFunction(() => document.querySelector('#code .output table'), { timeout: 15_000 });
await shot('side-code');

await settings({ theme: 'dark' });
await show('security', ['User Risks', 'Why Allowed']);
await shot('side-security-dark');
await settings({ theme: 'light' });

// ---------- full screen ----------
await full(true);
await show('record', ['Identity', 'Fields']);
await shot('full-record');
await show('security', ['Groups', 'User Risks', 'Why Allowed']); // Groups | User risks side by side
await panel.$eval('#security .groups-box input[type=search]', (i) => { i.value = 'sales'; i.dispatchEvent(new Event('input')); }); // a few groups, with some to add
await shot('full-security');

// Perf: start the profiler, reload the page (the panel comes back, full screen, on this tab) so its requests are
// recorded, then select the form's web_read: its SQL shows in the pane beside the list.
await show('perf');
await click('#perf .card .btn');
await panel.waitForFunction(() => document.querySelector('#perf .pill.ok'), { timeout: 15_000 });
await page.reload();
await page.waitForSelector('.o_form_view');
panel = await page.waitForFrame((f) => f.url().endsWith('/src/panel/panel.html'), { timeout: 15_000 });
await panel.waitForFunction(() => document.querySelector('#status')?.textContent.includes('sale.order'), { timeout: 15_000 });
await sleep(1500); // the chatter's requests
await click('#refresh');
await show('perf');
const row = await panel.waitForFunction(() => [...document.querySelectorAll('#perf .list > li')]
  .find((li) => li.dataset.q.includes('sale.order/web_read')), { timeout: 15_000 });
await row.evaluate((li) => li.click());
await panel.waitForFunction(() => document.querySelector('#perf .pane .detail details'), { timeout: 15_000 });
await panel.$$eval('#perf .pane .detail > div > details', (ds) => ds.forEach((d) => { d.open = true; }));
await panel.$eval('main', (m) => { m.scrollTop = 0; });
await page.mouse.move(4, H - 4);
await sleep(400);
await writeFile(new URL('full-perf.png', OUT), await page.screenshot());
console.log('full-perf');

await browser.close();

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
