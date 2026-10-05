// Shared by tools/intro.mjs and tools/screenshots.mjs: the Odoo of tools/compose.yml (Sales + CRM with demo data),
// driven from Puppeteer with the built extension (dist/: npm run build first).
// ODOO_URL (default http://localhost:8069), ODOO_DB / ODOO_LOGIN / ODOO_PASSWORD (default e2e / admin / admin).
export const ODOO = process.env.ODOO_URL || 'http://localhost:8069';
export const EXT = new URL('../dist', import.meta.url).pathname;
/** The panel's page, in its iframe or its own window. */
export const isPanel = (f) => new URL(f.url(), 'http://x').pathname === '/panel/index.html';

/** JSON-RPC from the page `p` (same origin: its session cookie). Throws the server's message on an error. */
export async function rpc(p, route, params) {
  const r = await p.evaluate(async (route, params) => fetch(route, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', params }),
  }).then((res) => res.json()), route, params);
  if (r.error) throw new Error(`${route}: ${r.error.data?.message || r.error.message}`);
  return r.result;
}

/** Logs `p` in (not through the login form: typing in it is flaky, this sets the same cookie). */
export async function login(p) {
  await p.goto(`${ODOO}/web/login`);
  await rpc(p, '/web/session/authenticate', {
    db: process.env.ODOO_DB || 'e2e', login: process.env.ODOO_LOGIN || 'admin', password: process.env.ODOO_PASSWORD || 'admin',
  });
}

/** Opens /odoo/<path> in `p` and waits for the form, the webclient warmed up first in a throwaway context. */
export async function openForm(browser, p, path) {
  const warmup = await browser.createBrowserContext();
  const w = await warmup.newPage();
  await login(w).then(() => w.goto(`${ODOO}/odoo/${path}`)).then(() => w.waitForSelector('.o_form_view', { timeout: 20_000 })).catch(() => {});
  await warmup.close();
  await login(p);
  await p.goto(`${ODOO}/odoo/${path}`);
  await p.waitForSelector('.o_form_view', { timeout: 120_000 });
}

/** Clicks the Odoo Debug button (its shadow root is closed: where it sits by default) and returns the panel's frame. */
export async function openPanel(p) {
  await p.waitForSelector('odoo-debug-root');
  const { w, h } = await p.evaluate(() => ({ w: innerWidth, h: innerHeight }));
  await p.mouse.click(w - 16 - 20, h - 8 - 20); // bottom right: 16px from the side, 8px above the edge
  return p.waitForFrame(isPanel, { timeout: 15_000 });
}

/** The extension's service worker: its storage sets the panel's settings live (theme, language). */
export async function settingsOf(browser) {
  const worker = await (await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().startsWith('chrome-extension://'))).worker();
  return (s) => worker.evaluate((s) => chrome.storage.local.set(s), s);
}
