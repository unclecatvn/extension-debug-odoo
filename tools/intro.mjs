// npm run intro: records website/intro.mp4 (the website's hero, 15 s, muted loop) and website/intro.gif (the READMEs:
// GitHub doesn't play a video from the repository) from a real Odoo, with the unpacked extension in headless Chrome.
// Same Odoo as tools/screenshots.mjs (Sales + CRM with demo data); needs ffmpeg on the PATH.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import puppeteer from 'puppeteer';
import { ODOO, EXT, rpc, openForm } from '../e2e/odoo.mjs';

const OUT = new URL('../website/', import.meta.url).pathname;
const W = 1440, H = 900, SECONDS = 15;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({ enableExtensions: [EXT], pipe: true, defaultViewport: { width: W, height: H, deviceScaleFactor: 1 } });
const page = await browser.newPage();
const worker = await (await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().startsWith('chrome-extension://'))).worker();
const settings = (s) => worker.evaluate((s) => chrome.storage.local.set(s), s); // the panel applies the theme live
await settings({ lang: 'en', theme: 'light' });

await openForm(browser, page, 'action-base.action_res_users/2');
const [, soId] = await rpc(page, '/web/dataset/call_kw', { model: 'ir.model.data', method: 'check_object_reference', args: ['sale', 'sale_order_16'], kwargs: {} });
await page.goto(`${ODOO}/odoo/action-sale.action_orders/${soId}`);
await page.waitForSelector('.o_form_view');
await page.evaluate(() => { // a fresh start: the panel closed, its button bottom right, every card closed
  sessionStorage.clear();
  localStorage.removeItem('odoo-debug-pos');
});
await page.reload();
await page.waitForSelector('odoo-debug-root');
await sleep(1500); // the chatter

// What the viewer sees besides the page: a pointer moving to what gets clicked, and a caption per feature.
await page.evaluate(() => {
  const css = document.createElement('style');
  css.textContent = `
    #intro-cursor { position: fixed; z-index: 2147483647; left: 0; top: 0; width: 22px; height: 22px; pointer-events: none;
      transition: transform .55s cubic-bezier(.4, 0, .2, 1); filter: drop-shadow(0 2px 3px rgb(0 0 0 / .35)); }
    #intro-cursor.down::after { content: ''; position: absolute; left: -12px; top: -12px; width: 24px; height: 24px; border-radius: 50%;
      background: rgb(113 75 103 / .35); animation: intro-ping .45s ease-out forwards; }
    @keyframes intro-ping { from { transform: scale(.3); opacity: 1; } to { transform: scale(1.6); opacity: 0; } }
    #intro-caption { position: fixed; z-index: 2147483647; left: 32px; bottom: 32px; max-width: 760px; padding: 14px 22px; border-radius: 14px;
      background: rgb(113 75 103 / .95); color: #fff; font: 600 24px/1.3 system-ui, -apple-system, sans-serif; letter-spacing: -.01em;
      box-shadow: 0 10px 30px rgb(0 0 0 / .3); transition: opacity .3s, transform .3s; }
    #intro-caption.out { opacity: 0; transform: translateY(8px); }
    #intro-caption small { display: block; margin-top: 2px; font-weight: 400; font-size: 17px; color: #f1e4ee; }`;
  const cursor = Object.assign(document.createElement('div'), { id: 'intro-cursor' });
  cursor.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24"><path d="M4 2l16 10-7 1.5L9.5 21z" fill="#fff" stroke="#18181b" stroke-width="1.6" stroke-linejoin="round"/></svg>';
  cursor.style.transform = `translate(${innerWidth * 0.55}px, ${innerHeight * 0.6}px)`;
  document.body.append(css, cursor, Object.assign(document.createElement('div'), { id: 'intro-caption', className: 'out' }));
});

async function caption(title, sub) {
  await page.evaluate(async (title, sub) => {
    const c = document.getElementById('intro-caption');
    c.classList.add('out');
    await new Promise((r) => setTimeout(r, 300));
    c.replaceChildren(title, Object.assign(document.createElement('small'), { textContent: sub }));
    c.classList.remove('out');
  }, title, sub);
}
const pointTo = (x, y) => page.evaluate((x, y) => { document.getElementById('intro-cursor').style.transform = `translate(${x}px, ${y}px)`; }, x, y);
const press = () => page.evaluate(() => {
  const c = document.getElementById('intro-cursor');
  c.classList.remove('down');
  void c.offsetWidth;
  c.classList.add('down');
});

let panel;
/** Moves the pointer onto `sel` in the panel, then clicks it (element.click(): the iframe sits in a closed shadow root). */
async function clickIn(sel, pick = null) {
  const f = await (await panel.frameElement()).boundingBox();
  const r = await panel.evaluate((sel, pick) => {
    const n = pick ? [...document.querySelectorAll(sel)].find((x) => x.textContent.trim() === pick) : document.querySelector(sel);
    n.scrollIntoView({ block: 'nearest' });
    const b = n.getBoundingClientRect();
    return { x: b.x + Math.min(b.width / 2, 40), y: b.y + b.height / 2 };
  }, sel, pick);
  await pointTo(f.x + r.x, f.y + r.y);
  await sleep(600);
  await press();
  await panel.evaluate((sel, pick) => (pick ? [...document.querySelectorAll(sel)].find((x) => x.textContent.trim() === pick) : document.querySelector(sel)).click(), sel, pick);
}
async function typeIn(sel, text) {
  await panel.$eval(sel, (i) => { i.focus(); i.value = ''; });
  for (const ch of text) {
    await panel.$eval(sel, (i, ch) => { i.value += ch; i.dispatchEvent(new Event('input', { bubbles: true })); }, ch);
    await sleep(70);
  }
}
const openCards = (tab, titles) => panel.$$eval(`#${tab} details.card`, (cs, titles) => cs.forEach((c) => {
  c.open = titles.some((t) => c.querySelector('h3').textContent.startsWith(t));
}), titles);

// ---------- the film ----------
const dir = mkdtempSync(join(tmpdir(), 'odoo-debug-intro-'));
const raw = join(dir, 'raw.webm');
const recorder = await page.screencast({ path: raw });
const t0 = Date.now();

await caption('Odoo Debug', 'A debug panel right on the Odoo page');
await sleep(900);
await pointTo(W - 36, H - 28); // the round button, bottom right
await sleep(650);
await press();
await page.mouse.click(W - 36, H - 28);
panel = await page.waitForFrame((f) => f.url().endsWith('/src/panel/panel.html'), { timeout: 15_000 });
await panel.waitForFunction(() => document.querySelector('#status')?.textContent.includes('sale.order'), { timeout: 15_000 });
await openCards('record', ['Fields']);
await caption('Record', 'Every field: its type, its module, its value');
await panel.waitForSelector('#record .card-body input[type=search]');
await typeIn('#record .card-body input[type=search]', 'amount');
await sleep(700);

await clickIn('.tabs [data-tab="rpc"]');
await caption('RPC', 'Edit a call, send it again, copy it as cURL');
await clickIn('#rpc .list > li[data-q="sale.order web_read"] .name');
await panel.waitForSelector('#rpc .detail .btn');
await clickIn('#rpc .detail .btn'); // Edit & Resend
await panel.$eval('#rpc .detail .composer textarea', (t) => {
  const body = JSON.parse(t.value);
  body.params.kwargs.specification = { name: {}, state: {}, amount_total: {}, partner_id: { fields: { display_name: {} } } };
  t.value = JSON.stringify(body, null, 2);
  t.rows = 7;
});
await clickIn('#rpc .detail .composer button[type=submit]');
await panel.waitForSelector('#rpc .detail .composer .pill', { timeout: 15_000 });
await sleep(1300);

await clickIn('.tabs [data-tab="code"]');
await caption('Code', 'The ORM from JavaScript, as the logged-in user');
await panel.waitForSelector('#code textarea.code');
await panel.$eval('#code textarea.code', (t) => {
  t.value = "const so = await env['sale.order'].search([['state', '=', 'sale']], { limit: 4 });\nreturn so.read(['name', 'partner_id', 'amount_total']);";
  t.dispatchEvent(new Event('input'));
});
await clickIn('#code .console .btn');
await panel.waitForFunction(() => document.querySelector('#code .output table'), { timeout: 15_000 });
await sleep(1000);

await clickIn('#full'); // full screen
await clickIn('.tabs [data-tab="security"]');
await caption('Security', 'Why an operation is allowed or blocked, rule by rule');
await openCards('security', ['Groups', 'User risks', 'Why allowed']);
await sleep(1600);
await settings({ theme: 'dark' });
await caption('Free and open source', 'Odoo 18 and 19 · Chrome, Edge, Brave');
await sleep(1600);

const took = (Date.now() - t0) / 1000;
await recorder.stop();
await browser.close();

// Fitted to SECONDS (sped up or slowed down a little), constant 30 fps: H.264 for the website, a GIF for the READMEs.
const speed = (SECONDS / took).toFixed(4);
console.log(`recorded ${took.toFixed(1)} s → ×${(took / SECONDS).toFixed(2)}`);
const ff = (...a) => execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...a], { stdio: 'inherit' });
ff('-i', raw, '-vf', `setpts=${speed}*PTS,fps=30,scale=${W}:-2`, '-t', String(SECONDS), '-an', '-c:v', 'libx264', '-preset', 'slow', '-crf', '24',
  '-pix_fmt', 'yuv420p', '-movflags', '+faststart', join(OUT, 'intro.mp4'));
ff('-i', join(OUT, 'intro.mp4'), '-vf', 'fps=12,scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle',
  join(OUT, 'intro.gif'));
rmSync(dir, { recursive: true });
console.log('website/intro.mp4, website/intro.gif');
