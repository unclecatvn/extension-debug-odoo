// npm run intro: the intro film, in two steps (or one of them: node tools/intro.mjs record | render).
//   record  plays a real session with the extension on the Odoo of tools/screenshots.mjs (Sales + CRM demo data): the
//           panel opened, fields filtered, an RPC edited and sent again, code typed and run, a user's access explained,
//           a request profiled. Every frame Chrome paints is kept (2880×1800), with a log: where the camera looks,
//           the captions, the waits to cut.
//   render  edits that take in tools/intro.html (the window on a dark stage, a camera following the action, captions)
//           frame by frame, then ffmpeg encodes website/intro.mp4 (1080p60), its poster website/intro-poster.jpg and
//           store/odoo-debug-intro.mp4 (1440p60 master, not committed).
//   node tools/intro.mjs render --stills 4,12.5   only those instants, as PNGs next to the take (to check an edit)
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { tmpdir } from 'node:os';
import puppeteer from 'puppeteer';
import { ODOO, EXT, rpc, openForm } from '../e2e/odoo.mjs';

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
  page.on('dialog', (d) => d.accept()); // Perf: "Enable profiling?"
  const worker = await (await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().startsWith('chrome-extension://'))).worker();
  const settings = (s) => worker.evaluate((s) => chrome.storage.local.set(s), s);
  await settings({ lang: 'en', theme: 'light' });

  await openForm(browser, page, 'action-base.action_res_users/2');
  const [, soId] = await rpc(page, '/web/dataset/call_kw', { model: 'ir.model.data', method: 'check_object_reference', args: ['sale', 'sale_order_16'], kwargs: {} });
  await page.goto(`${ODOO}/odoo/action-sale.action_orders/${soId}`);
  await page.waitForSelector('.o_form_view');
  await page.evaluate(() => { sessionStorage.clear(); localStorage.removeItem('odoo-debug-pos'); });

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
  const log = { viewport: [VW, VH], cams: [], captions: [], cuts: [], fast: [] };
  /** The camera frames `r` ({ x, y, w, h } in page px; null: the whole page) from now on. */
  const cam = (r) => log.cams.push({ t: now(), r });
  const caption = (title, text) => log.captions.push({ t: now(), title, text });
  /** Waits for `p`; a long wait is cut from the film. */
  async function wait(p) {
    const a = now();
    const v = await p;
    const b = now();
    if (b - a > .6) log.cuts.push([a + .2, b - .15]);
    return v;
  }

  let panel;
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
  panel = await page.waitForFrame((f) => f.url().endsWith('/src/panel/panel.html'), { timeout: 15_000 });
  await wait(panel.waitForFunction(() => document.querySelector('#status')?.textContent.includes('sale.order'), { timeout: 15_000 }));
  await sleep(300);
  const pb = await panelBox();
  cam({ x: pb.x - 380, y: pb.y - 40, w: pb.w + 420, h: pb.h + 60 });
  await sleep(900);

  // 2. Record: every field, filtered, one opened
  caption('Record', 'Every field of the record: its type, its module, its value.');
  await clickIn('#record details.card summary', 'Fields');
  await wait(panel.waitForSelector('#record .card-body input[type=search]', { timeout: 15_000 }));
  cam({ ...pb, x: pb.x - 20, w: pb.w + 40 });
  await clickIn('#record .card-body input[type=search]');
  await type('amount', 110);
  await sleep(700);
  await clickIn('#record .list > li:not([hidden]) .name', 'amount_total', { fx: .3 });
  await sleep(1600);

  // 3. on the page: ⌥ + click a field copies its technical name
  caption('⌥ + click', 'Any field of the page: its technical name, copied.');
  const customer = await page.$eval('.o_field_widget[name=partner_id]', (n) => { const b = n.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; });
  cam({ x: customer.x - 160, y: customer.y - 110, w: 720, h: 380 });
  await glide(customer.x + 60, customer.y + customer.h / 2, 1000);
  await sleep(200);
  await page.keyboard.down('Alt');
  await click(customer.x + 60, customer.y + customer.h / 2, { ms: 120, after: 0 });
  await page.keyboard.up('Alt');
  await sleep(1500);

  // 4. View: the inheritance of this form
  cam({ x: pb.x - 20, y: pb.y, w: pb.w + 40, h: pb.h });
  caption('View', 'Which module changed the form, and the arch they build.');
  await clickIn('.tabs [data-tab="view"]', null, { ms: 900 });
  await wait(panel.waitForSelector('#view details.card', { timeout: 15_000 }));
  const inherited = await panel.$eval('#view details.card[data-key=inherited]', (c) => c.open);
  if (!inherited) await clickIn('#view details.card[data-key=inherited] summary');
  await wait(panel.waitForFunction(() => document.querySelector('#view details.card[data-key=inherited] .card-body .list'), { timeout: 15_000 }));
  await sleep(1800);

  // 5. RPC: the calls live, one edited and sent again, copied as cURL
  caption('RPC', 'Every call, live: edit one, send it again, copy it as cURL.');
  await clickIn('.tabs [data-tab="rpc"]');
  cam(null);
  // back to the list, then the order again: their calls show up in the log as they happen
  const boxOnPage = (sel, text) => page.evaluate((sel, text) => {
    const n = [...document.querySelectorAll(sel)].find((x) => !text || x.textContent.includes(text));
    const b = n.getBoundingClientRect();
    return { x: b.x, y: b.y, w: b.width, h: b.height };
  }, sel, text);
  await click(...at(await boxOnPage('.o_breadcrumb .breadcrumb-item a, .o_breadcrumb a', 'Sales Orders')), { ms: 1000, after: 0 });
  await wait(page.waitForSelector('.o_list_view .o_data_row', { timeout: 15_000 }));
  await sleep(900);
  await click(...at(await boxOnPage('.o_data_row .o_data_cell[name=name]', 'S00016'), .3), { ms: 900, after: 0 });
  await wait(page.waitForSelector('.o_form_view', { timeout: 15_000 }));
  cam({ x: pb.x - 20, y: pb.y, w: pb.w + 40, h: pb.h });
  await sleep(1300);
  await clickIn('#rpc .list > li[data-q="sale.order web_read"] .name');
  await sleep(500);
  await clickIn('#rpc .detail .btn', 'Edit & Resend');
  await sleep(500);
  // the body: `specification` cut down to four fields, typed where it starts
  await panel.$eval('#rpc .detail .composer textarea', (t) => {
    const body = JSON.parse(t.value);
    delete body.params.kwargs.specification;
    t.value = JSON.stringify(body, null, 2).replace('"kwargs": {', '"kwargs": {\n      "specification": ');
    t.rows = 9;
    t.scrollTop = Math.max(0, t.value.slice(0, t.value.indexOf('"specification"')).split('\n').length * 16 - 60);
  });
  const ta = await boxOf('#rpc .detail .composer textarea');
  cam({ x: ta.x - 20, y: ta.y - 70, w: ta.w + 40, h: ta.h + 330 });
  await click(...at(ta, .6, .55), { ms: 700, after: 150 });
  await panel.$eval('#rpc .detail .composer textarea', (t) => { const at = t.value.indexOf('"specification": ') + 17; t.setSelectionRange(at, at); });
  await type('{"name": {}, "state": {}, "amount_total": {}},', 45);
  await sleep(300);
  await clickIn('#rpc .detail .composer button[type=submit]');
  await wait(panel.waitForSelector('#rpc .detail .composer .pill', { timeout: 15_000 }));
  log.posterAt = now();
  await sleep(1200);
  await clickIn('#rpc .detail .composer .btn', 'Copy as cURL', { after: 1100 });

  // 6. Code: the ORM typed and run as the logged-in user
  cam({ x: pb.x - 20, y: pb.y, w: pb.w + 40, h: pb.h });
  caption('Code', 'The ORM in JavaScript, run as the logged-in user.');
  await clickIn('.tabs [data-tab="code"]', null, { ms: 900 });
  await wait(panel.waitForSelector('#code textarea.code', { timeout: 15_000 }));
  await clickIn('#code textarea.code', null, { after: 200 });
  const code = "const orders = await env['sale.order'].search([['state', '=', 'sale']], { limit: 5 });\nreturn orders.read(['name', 'partner_id', 'amount_total']);";
  await panel.$eval('#code textarea.code', (t) => { t.value = ''; t.dispatchEvent(new Event('input')); });
  await type(code, 38);
  await panel.$eval('#code .suggest', (s) => { s.hidden = true; }).catch(() => {});
  if (await panel.$eval('#code textarea.code', (t) => t.value) !== code) { // smart typing differed: the intended text
    await panel.$eval('#code textarea.code', (t, v) => { t.value = v; t.dispatchEvent(new Event('input')); }, code);
  }
  await clickIn('#code .console .btn');
  await wait(panel.waitForFunction(() => document.querySelector('#code .output table'), { timeout: 15_000 })
    .catch(async (e) => { throw new Error(`${e.message}: ${await panel.$eval('#code', (c) => c.querySelector('.output')?.textContent + ' | ' + c.querySelector('textarea.code').value)}`); }));
  const out = await boxOf('#code .output');
  cam({ x: out.x - 20, y: out.y - 220, w: out.w + 40, h: out.h + 260 });
  await sleep(2200);

  // 7. Security, full screen: why another user can or can't
  caption('Security', 'Why a user can, or can\'t. Rule by rule.');
  await clickIn('#full', null, { ms: 900, after: 600 });
  cam(null);
  await clickIn('.tabs [data-tab="security"]', null, { ms: 900 });
  await wait(panel.waitForSelector('#security .user-search input', { timeout: 15_000 }));
  await panel.$$eval('#security details.card', (cs) => cs.forEach((c) => { c.open = ['why', 'groups'].includes(c.dataset.key); }));
  const search = await boxOf('#security .user-search input');
  cam({ x: search.x - 40, y: search.y - 60, w: 1000, h: 560 });
  await click(...at(search, .2), { after: 200 });
  await type('marc', 120);
  await sleep(500);
  await page.keyboard.press('Enter');
  await wait(panel.waitForFunction(() => /Marc/.test(document.querySelector('#security .user-line')?.textContent || ''), { timeout: 15_000 }));
  await wait(panel.waitForFunction(() => document.querySelector('#security details.card[data-key=why] .card-body')?.childElementCount
    && !document.querySelector('#security details.card[data-key=why] .card-body > .loading'), { timeout: 20_000 }));
  const why = await boxOf('#security details.card[data-key=why]');
  cam({ x: why.x - 30, y: why.y - 30, w: Math.min(why.w + 60, 1100), h: Math.min(why.h + 60, 560) });
  await sleep(2600);

  // 8. Perf: a request profiled, its repeated queries
  caption('Perf', 'Every request profiled. The N+1 queries, found.');
  cam(null);
  await clickIn('.tabs [data-tab="perf"]', null, { ms: 900 });
  await wait(panel.waitForSelector('#perf .card .btn', { timeout: 15_000 }));
  await clickIn('#perf .card .btn', null, { after: 200 }); // Start profiling (the dialog is accepted)
  await wait(panel.waitForFunction(() => document.querySelector('#perf .pill.ok'), { timeout: 15_000 }));
  // the page reloads (cut from the film): its requests are profiled; the panel comes back, full screen, on this tab
  await wait((async () => {
    await page.reload();
    await page.waitForSelector('.o_form_view');
    panel = await page.waitForFrame((f) => f.url().endsWith('/src/panel/panel.html'), { timeout: 15_000 });
    await panel.waitForSelector('#perf .card .btn', { timeout: 15_000 });
    await sleep(1500); // the chatter's requests
  })());
  await clickIn('#refresh', null, { after: 0 });
  // the request with the most queries
  await wait(panel.waitForFunction(() => document.querySelectorAll('#perf .list > li').length > 3, { timeout: 20_000 }));
  await panel.$$eval('#perf .list > li', (lis) => {
    const sql = (li) => +(li.textContent.match(/(\d+) SQL/)?.[1] || 0);
    lis.reduce((a, b) => (sql(b) > sql(a) ? b : a)).classList.add('film-pick');
  });
  const r1 = await boxOf('#perf .list > li.film-pick .name');
  cam({ x: r1.x - 40, y: r1.y - 120, w: 1300, h: 720 });
  await click(...at(r1, .3), { ms: 900, after: 0 });
  await wait(panel.waitForFunction(() => document.querySelector('#perf .pane .detail details'), { timeout: 15_000 }));
  await panel.$$eval('#perf .pane .detail > div > details', (ds) => ds.forEach((d) => { d.open = true; }));
  const pane = await boxOf('#perf .pane');
  cam({ x: pane.x - 30, y: pane.y - 20, w: Math.min(pane.w + 60, 1000), h: 600 });
  await sleep(2600);

  // 9. themes, then the whole page
  caption('Yours', 'Odoo\'s light or dark, or an editor theme. English or Tiếng Việt.');
  cam(null);
  await glide(VW * .6, VH * .55, 900);
  for (const theme of ['dracula', 'nord', 'github-light']) { await settings({ theme }); await sleep(1100); }
  await sleep(600);
  log.end = now();
  await client.send('Page.stopScreencast');
  await sleep(300);
  log.frames = frames;
  await writeFile(join(TAKE, 'take.json'), JSON.stringify(log));
  console.log(`take: ${frames.length} frames, ${(log.end - log.start).toFixed(1)} s, ${log.cuts.length} cuts → ${TAKE}`);
  await panel.$eval('#perf .card .btn', (b) => /Stop/.test(b.textContent) && b.click()).catch(() => {}); // the profiler off again
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
  const { duration, posterAt } = await page.evaluate(() => ({ duration: window.DURATION, posterAt: window.POSTER_AT }));
  const only = process.argv.includes('--stills') ? process.argv[process.argv.indexOf('--stills') + 1].split(',').map(Number) : null;
  if (only) {
    console.log(`duration ${duration.toFixed(2)} s, poster at ${posterAt.toFixed(2)} s`);
    for (const t of only) {
      await page.evaluate((t) => window.renderAt(t), t);
      await writeFile(join(TAKE, `still-${t}.png`), await page.screenshot());
      console.log(join(TAKE, `still-${t}.png`));
    }
  } else {
    await mkdir(join(ROOT, 'store'), { recursive: true });
    const master = join(ROOT, 'store', 'odoo-debug-intro.mp4');
    const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-i', '-',
      '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', master], { stdio: ['pipe', 'inherit', 'inherit'] });
    const n = Math.round(duration * FPS), t0 = Date.now();
    for (let i = 0; i < n; i++) {
      await page.evaluate((t) => window.renderAt(t), i / FPS);
      const buf = await page.screenshot({ type: 'jpeg', quality: 94, optimizeForSpeed: true });
      if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
      if (i % FPS === 0) process.stdout.write(`\r${i}/${n} frames, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
    }
    ff.stdin.end();
    await new Promise((r) => ff.on('close', r));
    console.log(`\n${master} (${duration.toFixed(1)} s)`);
    const enc = (...a) => execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...a], { stdio: 'inherit' });
    enc('-i', master, '-vf', 'scale=1920:1080:flags=lanczos', '-c:v', 'libx264', '-preset', 'slow', '-crf', '27', '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart', '-an', join(ROOT, 'website', 'intro.mp4'));
    enc('-ss', String(posterAt), '-i', join(ROOT, 'website', 'intro.mp4'), '-frames:v', '1', '-q:v', '3', join(ROOT, 'website', 'intro-poster.jpg'));
    console.log('website/intro.mp4, website/intro-poster.jpg');
  }
  await browser.close();
  server.close();
}
