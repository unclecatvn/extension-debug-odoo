// npm run intro: the intro film, in two steps (or one of them: node tools/intro.mjs record | render).
//   record  plays a real session with the built extension (dist/: npm run build) on the Odoo of tools/compose.yml
//           (Sales + CRM demo data): the panel opened, fields filtered, two orders compared, an RPC edited and sent again
//           in its detail, code typed and run, a user's access explained, a request profiled and diagnosed, the requests
//           grouped by method, a technical screen opened, the themes and languages.
//           Every frame Chrome paints is kept (2880×1800), with a log: where the camera looks, the captions, the waits to cut.
//   render  edits that take in tools/intro.html (the questions, a montage, the title, then the window on a dark stage
//           with a camera following the action and captions) frame by frame, scores it (tools/score.mjs, on its cues),
//           then ffmpeg encodes website/intro.mp4 (1080p60), its poster website/intro-poster.jpg and
//           store/odoo-debug-intro.mp4 (1440p60 master, not committed).
//   node tools/intro.mjs render --stills 4,12.5   only those instants, as PNGs next to the take (to check an edit)
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { tmpdir } from 'node:os';
import puppeteer from 'puppeteer';
import { ODOO, EXT, rpc, openForm, isPanel, settingsOf } from './odoo.mjs';
import { score } from './score.mjs';
import { sqlSummary, parseSql, diagnose } from '../src/features/perf/perf.logic.ts';

const ROOT = new URL('..', import.meta.url).pathname;
const TAKE = join(tmpdir(), 'odoo-debug-take'); // frames/NNNNN.jpg + take.json
const steps = ['record', 'render'].includes(process.argv[2]) ? [process.argv[2]] : ['record', 'render'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => Date.now() / 1000; // the same clock as the screencast's frame timestamps

if (steps.includes('record')) await record();
if (steps.includes('render')) await render();

// ====================================================================================================================
async function record() {
  await rm(TAKE, { recursive: true, force: true });
  await mkdir(join(TAKE, 'frames'), { recursive: true });
  const VW = 1440, VH = 900;
  const browser = await puppeteer.launch({ enableExtensions: [EXT], pipe: true, defaultViewport: { width: VW, height: VH, deviceScaleFactor: 2 } });
  const page = await browser.newPage();
  page.on('dialog', (d) => d.accept());
  await browser.defaultBrowserContext().overridePermissions(ODOO, ['clipboard-read', 'clipboard-write', 'clipboard-sanitized-write']);
  const settings = await settingsOf(browser);
  await settings({ lang: 'en', theme: 'light' });

  await openForm(browser, page, 'action-base.action_res_users/2');
  const [, soId] = await rpc(page, '/web/dataset/call_kw', { model: 'ir.model.data', method: 'check_object_reference', args: ['sale', 'sale_order_7'], kwargs: {} });
  await page.goto(`${ODOO}/odoo/action-sale.action_orders/${soId}`);
  await page.waitForSelector('.o_form_view');
  await page.evaluate(() => { sessionStorage.clear(); for (const k of Object.keys(localStorage)) if (k.startsWith('odoo-debug')) localStorage.removeItem(k); });

  // ---------- the pointer: a cursor drawn in the page, gliding along a curve; the real mouse follows it. In every
  // document the page loads, where the last one left it (sessionStorage). ----------
  await page.evaluateOnNewDocument(() => window === top && addEventListener('DOMContentLoaded', () => { // not in the panel's iframe
    const css = document.createElement('style');
    css.textContent = `#film-cursor { position: fixed; z-index: 2147483647; left: 0; top: 0; pointer-events: none; will-change: transform; }
      #film-cursor svg { display: block; filter: drop-shadow(0 3px 6px rgb(0 0 0 / .35)); transition: transform .12s; transform-origin: 3px 2px; }
      #film-cursor.down svg { transform: scale(.82); }
      #film-cursor i { position: absolute; left: -22px; top: -22px; width: 44px; height: 44px; border-radius: 50%; border: 2px solid rgb(180 124 208 / .9);
        opacity: 0; transform: scale(.3); }
      #film-cursor.ping i { animation: film-ping .55s cubic-bezier(.2, .7, .3, 1); }
      @keyframes film-ping { 0% { opacity: 1; transform: scale(.3); } 100% { opacity: 0; transform: scale(1.25); } }`;
    const c = Object.assign(document.createElement('div'), { id: 'film-cursor' });
    c.innerHTML = '<i></i><svg width="26" height="30" viewBox="0 0 26 30"><path d="M3 2 L3 24 L8.6 18.8 L12.4 27.6 L16.2 26 L12.5 17.4 L20.2 17.2 Z" fill="#111" stroke="#fff" stroke-width="2" stroke-linejoin="round"/></svg>';
    document.documentElement.append(css, c);
    try { window.filmCursor = JSON.parse(sessionStorage.getItem('film-cursor')); } catch { /* none yet */ }
    window.filmCursor ||= { x: innerWidth * .62, y: innerHeight * .7 };
    c.style.transform = `translate(${filmCursor.x}px, ${filmCursor.y}px)`;
    // eased glide along a slight arc, like a hand moving a mouse
    window.filmGlide = (x, y, ms) => new Promise((done) => {
      const a = { ...filmCursor }, t0 = performance.now();
      const bend = Math.hypot(x - a.x, y - a.y) * .12 * (x > a.x ? 1 : -1);
      const step = (now) => {
        const k = Math.min(1, (now - t0) / ms), e = k < .5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2;
        const px = a.x + (x - a.x) * e, py = a.y + (y - a.y) * e - Math.sin(Math.PI * e) * bend;
        c.style.transform = `translate(${px}px, ${py}px)`;
        if (k < 1) return requestAnimationFrame(step);
        filmCursor.x = x; filmCursor.y = y;
        sessionStorage.setItem('film-cursor', JSON.stringify(filmCursor));
        done();
      };
      requestAnimationFrame(step);
    });
    window.filmPress = (down) => {
      c.classList.toggle('down', down);
      if (!down) { c.classList.remove('ping'); void c.offsetWidth; c.classList.add('ping'); }
    };
  }));
  await page.reload();
  await page.waitForSelector('odoo-debug-root');
  await sleep(2000); // the chatter, the avatars

  // ---------- the director's log ----------
  const log = { viewport: [VW, VH], cams: [], captions: [], cuts: [], fast: [], spots: [], notes: [] };
  /** The camera frames `r` ({ x, y, w, h } in page px; null: the whole page) from now on. */
  const cam = (r) => log.cams.push({ t: now(), r });
  const caption = (title, text) => log.captions.push({ t: now(), title, text });
  /** The answer on screen: a glowing outline around `r` (page px) with `label`, for `dur` s. */
  const spot = (r, label, dur = 2.8) => log.spots.push({ t: now() + .15, r, label, dur });
  /** A card beside the window: `title` and some lines of text (what was copied…), for `dur` s. */
  const note = (title, text, dur = 3.2) => log.notes.push({ t: now(), title, text, dur });
  /** Waits for `p`; a long wait is cut from the film. */
  async function wait(p) {
    const a = now();
    const v = await p;
    const b = now();
    if (b - a > .6) log.cuts.push([a + .2, b - .15]);
    return v;
  }

  let panel;
  /** Waits until `scope` (in the panel) has nothing loading; that wait is cut, even a short one: a dissolve over it. */
  async function settled(scope) {
    const a = now();
    await panel.waitForFunction((s) => !document.querySelector(`${s} .loading`), { timeout: 20_000 }, scope);
    const b = now();
    if (b - a > .1) log.cuts.push([a + .05, b + .1]);
    await sleep(150);
  }
  const boxOf = async (sel, pick) => { // an element's box in page px (in the panel: through its iframe)
    const r = await panel.evaluate((sel, pick) => {
      const n = pick ? [...document.querySelectorAll(sel)].find((x) => x.textContent.trim().startsWith(pick)) : document.querySelector(sel);
      if (!n) return null;
      n.scrollIntoView({ block: 'nearest' });
      const b = n.getBoundingClientRect();
      return { x: b.x, y: b.y, w: b.width, h: b.height };
    }, sel, pick);
    if (!r) throw new Error(`not found: ${sel} ${pick || ''}`);
    const f = await (await panel.frameElement()).boundingBox();
    return { x: f.x + r.x, y: f.y + r.y, w: r.w, h: r.h };
  };
  /** The box (page px) of the row holding `text` in `scope` (the deepest element with it, then its tr / li). `center`:
   * scrolled to the middle (the first of a part); else into sight only when it is not, so a box measured before stays
   * right. `last`: the last one found. */
  const boxOfText = async (scope, text, last = false, center = false) => {
    const r = await panel.evaluate((scope, text, last, center) => {
      const has = (n) => (n.textContent || '').toLowerCase().includes(text.toLowerCase());
      const deepest = [...document.querySelectorAll(`${scope} *`)].filter((n) => has(n) && ![...n.children].some(has));
      const n = (last ? deepest.at(-1) : deepest[0]);
      if (!n) return null;
      const row = n.closest('tr, li') || n;
      row.scrollIntoView({ block: center ? 'center' : 'nearest' });
      const b = row.getBoundingClientRect();
      return { x: b.x, y: b.y, w: b.width, h: b.height };
    }, scope, text, last, center);
    if (!r) throw new Error(`text not found: ${scope} ${text}`);
    const f = await (await panel.frameElement()).boundingBox();
    return { x: f.x + r.x, y: f.y + r.y, w: r.w, h: r.h };
  };
  const pad = (b, p = 6) => ({ x: b.x - p, y: b.y - p, w: b.w + 2 * p, h: b.h + 2 * p });
  const panelBox = async () => { const f = await (await panel.frameElement()).boundingBox(); return { x: f.x, y: f.y, w: f.width, h: f.height }; };
  async function glide(x, y, ms = 650) {
    await page.evaluate((x, y, ms) => filmGlide(x, y, ms), x, y, ms);
    await page.mouse.move(x, y);
  }
  async function click(x, y, opts = {}) {
    await glide(x, y, opts.ms);
    await sleep(140);
    await page.evaluate(() => filmPress(true));
    await page.mouse.down();
    await sleep(90);
    await page.mouse.up();
    await page.evaluate(() => filmPress(false));
    await sleep(opts.after ?? 350);
  }
  const at = (b, fx = .5, fy = .5) => [b.x + b.w * fx, b.y + b.h * fy];
  const clickIn = async (sel, pick, opts) => click(...at(await boxOf(sel, pick), opts?.fx ?? .5, .5), opts);
  /** Types like a person; a long text plays faster in the film. */
  async function type(text, delay = 55) {
    const a = now();
    for (const ch of text) { await page.keyboard.type(ch); await sleep(delay * (.6 + Math.random() * .8)); }
    if (text.length > 12) log.fast.push([a + .3, now() - .1, 1.8]);
  }

  // ---------- action ----------
  const client = await page.createCDPSession();
  const frames = [];
  client.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
    const name = String(frames.length).padStart(5, '0') + '.jpg';
    writeFileSync(join(TAKE, 'frames', name), Buffer.from(data, 'base64'));
    frames.push({ t: metadata.timestamp, f: name });
    client.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
  });
  await client.send('Page.startScreencast', { format: 'jpeg', quality: 93, maxWidth: VW * 2, maxHeight: VH * 2, everyNthFrame: 1 });
  log.start = now();
  cam(null);
  await sleep(1600);

  // 1. the button opens the panel, beside the page
  caption('Odoo Debug', 'A debug panel, right on the Odoo page.');
  await click(VW - 36, VH - 28, { ms: 1100, after: 0 });
  panel = await page.waitForFrame(isPanel, { timeout: 15_000 });
  await wait(panel.waitForFunction(() => document.querySelector('#status')?.textContent.includes('sale.order'), { timeout: 15_000 }));
  await sleep(300);
  const pb = await panelBox();
  const onPanel = () => cam({ x: pb.x - 20, y: pb.y, w: pb.w + 40, h: pb.h });
  cam({ x: pb.x - 380, y: pb.y - 40, w: pb.w + 420, h: pb.h + 60 });
  await sleep(900);

  // 2. Record: a field, what it is and what recomputes it
  caption('Record', 'Every field of the record: its type, its value, where it is defined, what recomputes it.');
  await clickIn('#record details.card[data-key=fields] summary');
  await wait(panel.waitForSelector('#record details.card[data-key=fields] input[type=search]', { timeout: 15_000 }));
  onPanel();
  await clickIn('#record details.card[data-key=fields] input[type=search]');
  await type('amount_total', 90);
  await sleep(600);
  await panel.$$eval('#record .list > li:not([hidden])', (lis) => lis.find((li) => li.querySelector('.name')?.textContent === 'amount_total')?.classList.add('film-pick'));
  await clickIn('#record .list > li.film-pick .pill', null, { fx: .5 });
  await sleep(700);
  const field = await boxOf('#record .list > li.film-pick');
  cam({ x: field.x - 30, y: field.y - 160, w: field.w + 60, h: Math.max(field.h + 260, 420) });
  spot(pad(field), 'stored · computed from the order lines · module sale');
  await sleep(3200);

  // 3. on the page: ⌥ + click a field copies its technical name
  caption('⌥ + click', 'Any field on the page, or a change in the chatter: its technical name, copied.');
  const customer = await page.$eval('.o_field_widget[name=partner_id]', (n) => { const b = n.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; });
  cam({ x: customer.x - 160, y: customer.y - 110, w: 720, h: 380 });
  await glide(customer.x + 60, customer.y + customer.h / 2, 1000);
  await sleep(200);
  await page.keyboard.down('Alt');
  await click(customer.x + 60, customer.y + customer.h / 2, { ms: 120, after: 0 });
  await page.keyboard.up('Alt');
  await sleep(1800);

  // 4. View: why the customer is read-only, and which view says so
  caption('View', 'Why is this field read-only? The condition, its value right now, and the view that set it.');
  onPanel();
  await clickIn('.tabs [data-tab="view"]', null, { ms: 900 });
  await wait(panel.waitForSelector('#view details.card[data-key=field]', { timeout: 15_000 }));
  if (!await panel.$eval('#view details.card[data-key=field]', (c) => c.open)) await clickIn('#view details.card[data-key=field] summary');
  await clickIn('#view details.card[data-key=field] button', '⌖ Pick on Page', { after: 400 });
  await click(customer.x + 40, customer.y + customer.h / 2, { ms: 1000, after: 0 }); // the field picked on the page
  await wait(panel.waitForFunction(() => /state in \['cancel', 'sale'\]/.test(document.querySelector('#view details.card[data-key=field]')?.textContent || ''), { timeout: 15_000 }));
  await sleep(300);
  const ro = await boxOfText('#view details.card[data-key=field]', "state in ['cancel', 'sale']", false, true);
  cam({ x: ro.x - 40, y: ro.y - 200, w: ro.w + 80, h: 460 });
  spot(pad(ro), 'read-only: state is "sale"');
  await sleep(3000);
  const story = await boxOfText('#view details.card[data-key=field]', 'view_order_form', false, true);
  cam({ x: story.x - 40, y: story.y - 140, w: story.w + 80, h: 460 });
  spot(pad(story), 'set by sale · view_order_form');
  await sleep(2600);

  // 5. Translations: where a text of the page comes from, and where to change it
  caption('i18n', 'Where does a text come from? Pick it on the page: its source, and where to change it.');
  onPanel();
  await clickIn('.tabs [data-tab="translations"]', null, { ms: 900 });
  await wait(panel.waitForSelector('#translations .subview-body', { timeout: 15_000 }));
  await clickIn('#translations button', '⌖ Pick on Page', { after: 400 });
  const orderDate = await page.$$eval('.o_form_view label', (ls) => { const l = ls.find((x) => x.textContent.trim().startsWith('Order Date')); const b = l.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; });
  await click(orderDate.x + 30, orderDate.y + orderDate.h / 2, { ms: 1000, after: 0 });
  await wait(panel.waitForFunction(() => /date_order/.test(document.querySelector('#translations .subview-body')?.textContent || ''), { timeout: 15_000 }));
  await sleep(300);
  await clickIn('#full', null, { ms: 800, after: 700 }); // the answer wide, full screen
  const found = await boxOf('#translations .subview-body table.matrix');
  cam({ x: found.x - 30, y: found.y - 140, w: found.w + 60, h: Math.max(found.h + 240, 460) });
  spot(pad(found), 'the field label of sale.order.date_order, and the view: where to change each');
  await sleep(3400);
  await clickIn('#full', null, { ms: 800, after: 600 }); // back beside the page

  // 6. Compare: two orders ticked in the list, side by side, only the fields that differ
  caption('Compare', 'Two orders side by side, saved values only: just the fields that differ.');
  const boxOnPage = (sel, text) => page.evaluate((sel, text) => {
    const n = [...document.querySelectorAll(sel)].find((x) => !text || x.textContent.includes(text));
    const b = n.getBoundingClientRect();
    return { x: b.x, y: b.y, w: b.width, h: b.height };
  }, sel, text);
  cam(null);
  await click(...at(await boxOnPage('.o_breadcrumb .breadcrumb-item a, .o_breadcrumb a', 'Sales Orders')), { ms: 1000, after: 0 });
  await wait(page.waitForSelector('.o_list_view .o_data_row', { timeout: 15_000 }));
  await sleep(700);
  const tick = async (name) => click(...at(await boxOnPage('.o_data_row', name), 0, .5).map((v, k) => k ? v : v + 18), { ms: 700, after: 250 });
  for (const name of ['S00007', 'S00006']) await tick(name);
  onPanel();
  await clickIn('.tabs [data-tab="record"]', null, { ms: 900 });
  await wait(panel.waitForSelector('#record details.card[data-key=compare]', { timeout: 15_000 }));
  if (!await panel.$eval('#record details.card[data-key=compare]', (c) => c.open)) await clickIn('#record details.card[data-key=compare] summary');
  await clickIn('#record .compare-bar .btn', 'Compare selected', { after: 0 });
  await wait(panel.waitForSelector('#record .compare-table tbody tr', { timeout: 15_000 }));
  await clickIn('#record .compare .chip', 'Differences only', { after: 500 });
  const diff = await boxOf('#record .compare-wrap');
  cam({ x: diff.x - 30, y: diff.y - 120, w: diff.w + 60, h: Math.min(diff.h + 200, 560) });
  spot(pad({ ...diff, h: Math.min(diff.h, 300) }), 'S00007 and S00006: only what differs');
  await sleep(3200);
  for (const name of ['S00007', 'S00006']) await page.evaluate((name) => [...document.querySelectorAll('.o_data_row')] // unticked, out of frame
    .find((r) => r.textContent.includes(name))?.querySelector('.o_list_record_selector input')?.click(), name);

  // 7. RPC: the calls live; one opened is its request, edited and sent again right there, copied as cURL
  caption('RPC', 'Every call, live. Edit it and send it again, right there, or copy it as cURL for the external API.');
  await clickIn('.tabs [data-tab="rpc"]');
  cam(null);
  // the order again: its calls show up in the log as they happen
  await sleep(600);
  await click(...at(await boxOnPage('.o_data_row .o_data_cell[name=name]', 'S00007'), .3), { ms: 900, after: 0 });
  await wait(page.waitForSelector('.o_form_view', { timeout: 15_000 }));
  onPanel();
  await sleep(1300);
  await panel.$$eval('#rpc .list > li', (lis) => lis.find((li) => li.querySelector('.name')?.textContent === 'web_read' && li.textContent.includes('sale.order'))?.classList.add('film-pick')); // the latest
  await clickIn('#rpc .list > li.film-pick .name');
  await sleep(500);
  await wait(panel.waitForSelector('#rpc .detail form.composer textarea'));
  // the body, editable right away: `specification` cut down to three fields, typed where it starts
  await panel.$eval('#rpc .detail form.composer textarea', (t) => {
    const body = JSON.parse(t.value);
    delete body.params.kwargs.specification;
    t.value = JSON.stringify(body, null, 2).replace('"kwargs": {', '"kwargs": {\n      "specification": ');
    t.rows = 9;
    t.scrollTop = Math.max(0, t.value.slice(0, t.value.indexOf('"specification"')).split('\n').length * 16 - 60);
    t.dispatchEvent(new Event('input')); t.dispatchEvent(new Event('scroll')); // the coloured copy over it (ui/editor.ts) repainted
  });
  const ta = await boxOf('#rpc .detail form.composer textarea');
  cam({ x: ta.x - 20, y: ta.y - 70, w: ta.w + 40, h: ta.h + 330 });
  await click(...at(ta, .6, .55), { ms: 700, after: 150 });
  await panel.$eval('#rpc .detail form.composer textarea', (t) => { const at = t.value.indexOf('"specification": ') + 17; t.setSelectionRange(at, at); });
  await type('{"name": {}, "state": {}, "amount_total": {}},', 45);
  await sleep(300);
  await clickIn('#rpc .detail form.composer button[type=submit]');
  await wait(panel.waitForFunction(() => document.querySelector('#rpc .detail form.composer .answer')?.textContent.includes('HTTP'), { timeout: 15_000 })); // the recorded answer, replaced
  log.posterAt = now();
  const answer = await boxOf('#rpc .detail form.composer .answer');
  spot(pad({ ...answer, h: Math.min(answer.h, 220) }), 'sent again: only the three fields asked');
  await sleep(2600);
  await page.evaluate(() => navigator.clipboard.writeText('')).catch(() => {});
  await clickIn('#rpc .detail form.composer .btn', 'Copy as cURL', { after: 600 });
  const curl = await page.evaluate(() => navigator.clipboard.readText()).catch(() => '');
  if (curl) note('Copied as cURL', curl.split('\n').slice(0, 9).join('\n'));
  await sleep(3000);

  // 8. Code: a change tried for real, then rolled back (Python, dry run)
  caption('Code', 'Try a change for real, then roll it back: a Python dry run shows what it would do.');
  onPanel();
  await clickIn('.tabs [data-tab="code"]', null, { ms: 900 });
  await wait(panel.waitForSelector('#code textarea.code', { timeout: 15_000 }));
  await clickIn('#code .seg button', 'Python', { after: 300 });
  await clickIn('#code .seg button', 'Dry run', { after: 300 });
  await clickIn('#code textarea.code', null, { after: 200 });
  const code = "record.order_line.write({'discount': 10})\nreturn record.read(['amount_untaxed', 'amount_total'])";
  await panel.$eval('#code textarea.code', (t) => { t.value = ''; t.dispatchEvent(new Event('input')); });
  await type(code, 40);
  await panel.$eval('#code .suggest', (s) => { s.hidden = true; }).catch(() => {});
  if (await panel.$eval('#code textarea.code', (t) => t.value) !== code) { // smart typing differed: the intended text
    await panel.$eval('#code textarea.code', (t, v) => { t.value = v; t.dispatchEvent(new Event('input')); }, code);
  }
  await clickIn('#code .console-acts .btn.primary');
  await wait(panel.waitForFunction(() => document.querySelector('#code .output table'), { timeout: 20_000 })
    .catch(async (e) => { throw new Error(`${e.message}: ${await panel.$eval('#code', (c) => c.querySelector('.output')?.textContent + ' | ' + c.querySelector('textarea.code').value)}`); }));
  await sleep(300);
  const out = await boxOf('#code .output');
  cam({ x: out.x - 20, y: out.y - 220, w: out.w + 40, h: out.h + 260 });
  spot(pad({ ...out, h: Math.min(out.h, 260) }), 'total 1,706.00 → 1,535.40, then rolled back');
  await sleep(3600);

  // 9. Security, full screen: why Marc can't open this order, and the group that would let him
  caption('Security', 'Why can\'t Marc open this order? The rule that refuses, and the group that would let him.');
  cam(null); // wide before the panel changes size: never zoomed in on a place being redrawn
  await sleep(1100);
  await clickIn('#full', null, { ms: 800, after: 500 });
  await clickIn('.tabs [data-tab="security"]', null, { ms: 800 });
  await wait(panel.waitForSelector('#security .user-search input', { timeout: 15_000 }));
  const search = await boxOf('#security .user-search input');
  const bar = await boxOf('#security .sec-bar');
  cam({ x: bar.x - 30, y: bar.y - 40, w: bar.w + 60, h: bar.h + 240 }); // the whole bar: whose rights, and the search
  await click(...at(search, .2), { after: 200 });
  await type('marc', 120);
  await wait(panel.waitForSelector('#security .user-search .suggest:not([hidden]) li', { timeout: 15_000 }));
  await sleep(400);
  await page.keyboard.press('Enter');
  await wait(panel.waitForFunction(() => /Marc/.test(document.querySelector('#security .sec-bar .who')?.textContent || ''), { timeout: 15_000 }));
  await wait(panel.waitForFunction(() => /Personal Orders/.test(document.querySelector('#security .subview table.matrix')?.textContent || ''), { timeout: 20_000 }));
  await settled('#security');
  const rule = await boxOfText('#security .subview table.matrix', 'Personal Orders', false, true);
  const result = await boxOfText('#security .subview table.matrix', 'Result', true);
  cam({ x: rule.x - 30, y: rule.y - 200, w: rule.w + 60, h: result.y + result.h - rule.y + 320 });
  await sleep(700); // the camera there first
  spot(pad({ ...rule, h: result.y + result.h - rule.y }, 4), 'refused by Personal Orders: only his own orders', 3);
  await sleep(3300);
  await panel.$$eval('#security .subview-body table.matrix', (ts) => ts.at(-1).classList.add('film-allow')); // "To allow it"
  const allow = await boxOfText('#security table.film-allow', 'Sales / User: All Documents', false, true);
  cam({ x: allow.x - 30, y: allow.y - 160, w: allow.w + 60, h: 420 });
  await sleep(700);
  spot(pad(allow, 4), 'the group that would allow it', 2.4);
  await sleep(2700);
  await clickIn('#security .subview-body button', 'Try', { ms: 800, after: 0 });
  await wait(panel.waitForSelector('#security .trybar', { timeout: 15_000 }));
  await settled('#security'); // the rights read again with it: cut
  const now2 = await boxOfText('#security .subview table.matrix', 'Result', true, true);
  cam({ x: now2.x - 30, y: now2.y - 260, w: now2.w + 60, h: 460 });
  await sleep(700);
  spot(pad(now2, 4), 'tried with it: allowed, nothing written', 2.6);
  await sleep(2900);
  cam(null);
  await clickIn('#security .trybar button', 'Discard', { after: 0 });
  await settled('#security');

  // 10. Apps: what installing a module brings, as Odoo computes it, before the click
  caption('Apps', 'What does installing a module bring? Odoo\'s own answer, before you click Install.');
  cam(null);
  await clickIn('.tabs [data-tab="apps"]', null, { ms: 900 });
  await wait(panel.waitForSelector('#apps .searchbar input', { timeout: 15_000 }));
  await sleep(800);
  for (const x of await panel.$$('#apps .searchbar .facet-x')) await x.evaluate((b) => b.click()); // every module, not only the installed ones
  await clickIn('#apps .searchbar input', null, { after: 200 });
  await type('website_sale;', 90);
  await sleep(700);
  await panel.$$eval('#apps table.matrix tr[data-id]', (rs) => rs.find((r) => !r.hidden && /^website_sale ·/.test(r.querySelector('.mx-label')?.innerText.split('\n').at(-1) || ''))?.classList.add('film-pick'));
  await clickIn('#apps table.matrix tr.film-pick .mx-label', null, { ms: 900, after: 0 });
  await wait(panel.waitForFunction(() => /website_sale/.test(document.querySelector('#apps .groups-pane')?.textContent || ''), { timeout: 15_000 }));
  await panel.$$eval('#apps .groups-pane details.fold', (ds) => ds.forEach((d) => { // the description folded, the dependencies open
    const open = /^Depends/.test(d.querySelector('summary').textContent.trim());
    if (d.open !== open) { d.open = open; d.dispatchEvent(new Event('toggle')); }
  }));
  await wait(panel.waitForFunction(() => /also installs/i.test(document.querySelector('#apps .groups-pane')?.textContent || ''), { timeout: 20_000 }));
  await sleep(500);
  const brings = await boxOfText('#apps .groups-pane', 'also installs', false, true);
  const pane = await boxOf('#apps .groups-pane');
  cam({ x: pane.x - 30, y: brings.y - 220, w: pane.w + 60, h: 560 });
  spot(pad({ x: pane.x + 12, y: brings.y - 6, w: pane.w - 24, h: 150 }, 0), 'installing it also installs these, and auto-installs those');
  await sleep(3600);
  await panel.$$eval('#apps .groups-pane details.fold', (ds) => { const d = ds.find((x) => /^Dependency diagram/.test(x.querySelector('summary').textContent.trim())); if (d) { d.open = true; d.dispatchEvent(new Event('toggle')); } });
  await wait(panel.waitForSelector('#apps .groups-pane .dep-graph svg .g-node', { timeout: 20_000 }));
  await sleep(400);
  const graph = await boxOf('#apps .groups-pane .dep-graph');
  cam({ x: graph.x - 30, y: graph.y - 40, w: graph.w + 60, h: Math.min(graph.h + 80, 620) });
  await sleep(3000);

  // 11. Perf: a request profiled, what to look at first, and where the time goes
  caption('Perf', 'Why is it slow? An N+1 and the line of code running it, and where the time goes.');
  cam(null);
  await clickIn('.tabs [data-tab="perf"]', null, { ms: 900 });
  await wait(panel.waitForSelector('#perf .perf-recorder .btn', { timeout: 15_000 }));
  // a cold start, as after a deployment: writing a system parameter clears Odoo's caches, so the profiled reload below
  // shows the queries a warm server would skip (the repeated ones the diagnosis calls N+1). The demo database only.
  await rpc(page, '/web/dataset/call_kw/ir.config_parameter/set_param', { model: 'ir.config_parameter', method: 'set_param', args: ['odoo_debug.film', String(Date.now())], kwargs: {} });
  await clickIn('#perf .perf-recorder .btn', 'Start Profiling', { after: 600 });
  if (await panel.$$eval('#perf .perf-recorder .chip', (cs) => cs.some((c) => c.textContent === '5 minutes'))) { // not allowed yet: for 5 minutes
    await clickIn('#perf .perf-recorder .chip', '5 minutes', { after: 300 });
  }
  await wait(panel.waitForFunction(() => /RECORDING/.test(document.querySelector('#perf .perf-recorder')?.textContent || ''), { timeout: 15_000 }));
  // the page reloads (cut from the film): its requests are profiled; the panel comes back, full screen, on this tab
  await wait((async () => {
    await page.reload();
    await page.waitForSelector('.o_form_view');
    panel = await page.waitForFrame(isPanel, { timeout: 15_000 });
    await panel.waitForSelector('#perf .perf-recorder', { timeout: 15_000 });
    await sleep(1500); // the chatter's requests
  })());
  await clickIn('#perf .toolbar .chip', '⟳', { after: 0 });
  await wait(panel.waitForFunction(() => document.querySelectorAll('#perf table.matrix tr[data-id]').length > 3, { timeout: 20_000 }));
  // the request worth showing: the one the panel diagnoses as an N+1 (its most repeated query), else the slowest. Read
  // here with the panel's own logic; through /ir.profile/ in the route, so the panel leaves this read out of its list.
  const ids = await panel.$$eval('#perf table.matrix tr[data-id]', (rs) => rs.map((r) => +r.dataset.id));
  const profiles = await rpc(page, '/web/dataset/call_kw/ir.profile/read', { model: 'ir.profile', method: 'read', args: [ids, ['duration', 'sql']], kwargs: {} });
  const rated = profiles.map((p) => {
    const sum = sqlSummary(parseSql(p.sql));
    return { id: p.id, kind: diagnose(p.duration, sum), n: sum.repeated[0]?.count || 0, duration: p.duration };
  });
  const best = rated.filter((r) => r.kind === 'n1').sort((a, b) => b.n - a.n)[0] || rated.sort((a, b) => b.duration - a.duration)[0];
  console.log('perf pick:', JSON.stringify(best));
  const r1 = await boxOf(`#perf table.matrix tr[data-id="${best.id}"] .mx-label`);
  cam({ x: r1.x - 40, y: r1.y - 120, w: 1300, h: 720 });
  await click(...at(r1, .3), { ms: 900, after: 0 });
  await wait(panel.waitForSelector('#perf .groups-pane .perf-diag', { timeout: 15_000 }));
  await sleep(400);
  const diag = await boxOf('#perf .groups-pane .perf-diag');
  cam({ x: diag.x - 30, y: diag.y - 200, w: diag.w + 60, h: 520 });
  spot(pad(diag, 4), best.kind === 'n1' ? `one query run ${best.n}×: the line that loops` : 'what to look at first');
  await sleep(3400);
  const byCode = await boxOfText('#perf .groups-pane', 'By code: where the time goes', false, true);
  const hot = await boxOf('#perf .groups-pane details.fold[open] table.matrix');
  cam({ x: hot.x - 30, y: byCode.y - 40, w: hot.w + 60, h: Math.min(hot.y + hot.h - byCode.y + 80, 560) });
  spot(pad({ ...hot, h: Math.min(hot.h, 200) }, 4), 'the time, function by function of the modules');
  await sleep(3200);
  // every request of the session, grouped by model and method
  caption('Perf', 'Or the whole session, grouped by method: how often, how long, how many queries.');
  await clickIn('#perf .toolbar .chip', 'Group by method', { ms: 900, after: 0 });
  await wait(panel.waitForFunction(() => / groups · /.test(document.querySelector('#perf .toolbar .muted')?.textContent || ''), { timeout: 15_000 }));
  await sleep(400);
  const groups = await boxOf('#perf table.matrix');
  cam({ x: groups.x - 30, y: groups.y - 80, w: groups.w + 60, h: Math.min(groups.h + 160, 560) });
  spot(pad({ ...groups, h: Math.min(groups.h, 300) }, 4), 'count, total, median and SQL, per method');
  await sleep(3200);

  // 12. Menus: the technical screens, one click away; the page opens the one picked
  caption('Menus', 'Models, views, record rules, crons… the technical screens, one click away.');
  cam(null);
  await clickIn('.tabs [data-tab="menus"]', null, { ms: 900 });
  await wait(panel.waitForSelector('#menus .list.menus li', { timeout: 15_000 }));
  const menus = await boxOf('#menus .list.menus');
  cam({ x: menus.x - 30, y: menus.y - 60, w: Math.min(menus.w + 60, 1100), h: 600 });
  await sleep(1500);
  await clickIn('#menus .list.menus li span', 'Record Rules', { ms: 900, after: 0 });
  await wait(page.waitForSelector('.o_list_view .o_data_row', { timeout: 15_000 }));
  cam(null);
  await sleep(2200);

  // 13. themes, then the whole page
  caption('Yours', 'Odoo\'s light or dark, or an editor theme. Ten languages, Arabic right to left.');
  cam(null);
  await glide(VW * .6, VH * .55, 900);
  for (const [theme, lang] of [['dracula', 'fr'], ['nord', 'ja'], ['github-light', 'ar']]) { await settings({ theme, lang }); await sleep(1500); } // a language reloads the panel
  await sleep(600);
  log.end = now();
  await client.send('Page.stopScreencast');
  await sleep(300);
  log.frames = frames;
  await writeFile(join(TAKE, 'take.json'), JSON.stringify(log));
  console.log(`take: ${frames.length} frames, ${(log.end - log.start).toFixed(1)} s, ${log.cuts.length} cuts → ${TAKE}`);
  await panel.$$eval('#perf .btn', (bs) => bs.find((b) => /Stop Profiling/.test(b.textContent))?.click()).catch(() => {}); // the profiler off again
  await sleep(500);
  await browser.close();
}

// ====================================================================================================================
async function render() {
  // tools/intro.html loads the take's frames and its log over http
  const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml' };
  const server = createServer(async (req, res) => {
    const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    try {
      const body = await readFile(p.startsWith('/take/') ? join(TAKE, p.slice(6)) : join(ROOT, p));
      res.writeHead(200, { 'Content-Type': TYPES[extname(p)] || 'application/octet-stream' }).end(body);
    } catch { res.writeHead(404).end(); }
  }).listen(0);
  const W = 2560, H = 1440, FPS = 60;
  const browser = await puppeteer.launch({ args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.error('stage:', e.message));
  await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: W / 1920 });
  await page.goto(`http://localhost:${server.address().port}/tools/intro.html`);
  await page.waitForFunction(() => window.ready, { timeout: 60_000 });
  const { duration, posterAt, cues } = await page.evaluate(() => ({ duration: window.DURATION, posterAt: window.POSTER_AT, cues: window.MUSIC }));
  const only = process.argv.includes('--stills') ? process.argv[process.argv.indexOf('--stills') + 1].split(',').map(Number) : null;
  if (only) {
    console.log(`duration ${duration.toFixed(2)} s, poster at ${posterAt.toFixed(2)} s, captions ${JSON.stringify(await page.evaluate(() => window.CAPS))}`);
    console.log(`spots ${JSON.stringify(await page.evaluate(() => window.SPOTS))}`);
    for (const t of only) {
      await page.evaluate((t) => window.renderAt(t), t);
      await writeFile(join(TAKE, `still-${t}.png`), await page.screenshot());
      console.log(join(TAKE, `still-${t}.png`));
    }
  } else {
    await mkdir(join(ROOT, 'store'), { recursive: true });
    const master = join(ROOT, 'store', 'odoo-debug-intro.mp4'), picture = join(TAKE, 'picture.mp4'), music = join(TAKE, 'score.wav');
    await writeFile(music, score(cues));
    const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-i', '-',
      '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-pix_fmt', 'yuv420p', picture], { stdio: ['pipe', 'inherit', 'inherit'] });
    const n = Math.round(duration * FPS), t0 = Date.now();
    for (let i = 0; i < n; i++) {
      await page.evaluate((t) => window.renderAt(t), i / FPS);
      const buf = await page.screenshot({ type: 'jpeg', quality: 94, optimizeForSpeed: true });
      if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
      if (i % FPS === 0) process.stdout.write(`\r${i}/${n} frames, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
    }
    ff.stdin.end();
    await new Promise((r) => ff.on('close', r));
    const enc = (...a) => execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...a], { stdio: 'inherit' });
    enc('-i', picture, '-i', music, '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11', '-ar', '48000',
      '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', master);
    console.log(`\n${master} (${duration.toFixed(1)} s)`);
    enc('-i', master, '-vf', 'scale=1920:1080:flags=lanczos', '-c:v', 'libx264', '-preset', 'slow', '-crf', '29', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', join(ROOT, 'website', 'intro.mp4'));
    enc('-ss', String(posterAt), '-i', join(ROOT, 'website', 'intro.mp4'), '-frames:v', '1', '-q:v', '3', join(ROOT, 'website', 'intro-poster.jpg'));
    console.log('website/intro.mp4, website/intro-poster.jpg');
  }
  await browser.close();
  server.close();
}
