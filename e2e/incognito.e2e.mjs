// End-to-end, in an incognito window with the extension allowed there (where Security logs in as the picked user):
// chrome.runtime messages of an incognito tab go to the extension's regular profile, never to the panel in that tab.
// Its own browser: allowing incognito reloads the extension.
import { test, before, after } from 'node:test';
import puppeteer from 'puppeteer';
import { ODOO, EXT, rpc, login, openPanel } from './odoo.mjs';

let browser, page, panel;

before(async () => {
  browser = await puppeteer.launch({ enableExtensions: [EXT], pipe: true, args: ['--window-size=1400,900'] });
  const id = new URL((await browser.waitForTarget((t) => t.type() === 'service_worker')).url()).host;
  const chromePage = await browser.newPage();
  await chromePage.goto('chrome://extensions'); // the page of the "Allow in incognito" switch: its API
  await chromePage.evaluate((extensionId) => chrome.developerPrivate.updateExtensionConfiguration({ extensionId, incognitoAccess: true }), id);
  await chromePage.waitForFunction((id) => chrome.developerPrivate.getExtensionInfo(id).then((i) => i.incognitoAccess.isActive), {}, id);
  await chromePage.evaluate((id) => new Promise((done) => chrome.management.setEnabled(id, true, done)), id); // the reload leaves it disabled
  await chromePage.waitForFunction((id) => chrome.developerPrivate.getExtensionInfo(id).then((i) => i.state === 'ENABLED'), {}, id);

  await chromePage.goto(`chrome-extension://${id}/src/popup/popup.html`); // an extension page: chrome.windows
  await chromePage.evaluate((url) => chrome.windows.create({ incognito: true, url }), `${ODOO}/web/login`);
  page = await (await browser.waitForTarget((t) => t.type() === 'page' && t.url().startsWith(ODOO))).page();
  await login(page); // the login page again, logged in: an Odoo page, so the button is there
});

after(() => browser?.close());

test('incognito window: a call the page makes while the panel is open is added to the RPC tab', async () => {
  panel = await openPanel(page);
  await panel.waitForFunction(() => document.querySelector('#status')?.childElementCount, { timeout: 15_000 }); // started: the page's buffer is read
  await rpc(page, '/web/session/get_session_info', {});
  await panel.waitForFunction(() => document.querySelector('#rpc .list .name')?.textContent === '/web/session/get_session_info', { timeout: 15_000 });
});
