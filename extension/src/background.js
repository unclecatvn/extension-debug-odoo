// Toolbar icon: greyed out everywhere, enabled only on Odoo pages (Chrome can't hide a pinned icon per site).
// declarativeContent re-checks every page load and navigation by itself. Clicking it opens src/popup/.
chrome.action.disable();

chrome.runtime.onInstalled.addListener(() => {
  chrome.declarativeContent.onPageChanged.removeRules(undefined, () => {
    chrome.declarativeContent.onPageChanged.addRules([{
      // webclient (/odoo, /web) or any frontend page: login, portal, website (web.frontend_layout's #wrapwrap)
      conditions: ['body.o_web_client', '#wrapwrap'].map((sel) => new chrome.declarativeContent.PageStateMatcher({ css: [sel] })),
      actions: [new chrome.declarativeContent.ShowAction()],
    }]);
  });
});

// Chrome doesn't inject content scripts into the tabs already open: none there after an install, orphaned ones after an
// update or a reload of the extension (the button and the panel stop answering). Inject them again; hook.js keeps its
// first copy (a window guard), bubble.js replaces its own.
chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason !== 'install' && reason !== 'update') return;
  const [main, isolated] = chrome.runtime.getManifest().content_scripts;
  for (const { id } of await chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] })) {
    chrome.scripting.executeScript({ target: { tabId: id }, world: 'MAIN', files: main.js }).catch(() => {}); // discarded tab…
    chrome.scripting.executeScript({ target: { tabId: id }, files: isolated.js }).catch(() => {});
  }
});

// Keyboard shortcuts (manifest "commands", changed in chrome://extensions/shortcuts). Odoo pages only: elsewhere the
// content script isn't listening and window.odoo is missing, so both do nothing.
chrome.commands.onCommand.addListener(async (command, tab) => {
  if (!tab?.id) return;
  if (command === 'toggle-panel') chrome.tabs.sendMessage(tab.id, { type: 'odoo-toggle' }).catch(() => {});
  if (command === 'popout-panel') popOut(tab.id);
  if (command === 'toggle-debug') {
    chrome.scripting.executeScript({ target: { tabId: tab.id }, world: 'MAIN', func: pageToggleDebug }).catch(() => {});
  }
});

// ---------- the panel in its own window, bound to an Odoo tab (src/panel/panel.html?tab=<id>): one per tab ----------
const panelUrl = (tabId) => chrome.runtime.getURL(`src/panel/panel.html?tab=${tabId}`);
const popoutOf = async (tabId) => (await chrome.runtime.getContexts({ contextTypes: ['TAB'], documentUrls: [panelUrl(tabId)] }))[0];

/** Opens the window of this tab, or brings it to the front when it is open already. */
async function popOut(tabId) {
  const open = await popoutOf(tabId);
  if (open) return chrome.windows.update(open.windowId, { focused: true });
  // ponytail: a fixed size, wide enough for the full-screen layout (900 px); remember the bounds if asked
  chrome.windows.create({ url: panelUrl(tabId), type: 'popup', width: 1100, height: 800 });
}

// from the panel's ⧉ (in the page), the toolbar popup, or the round button while the window is open
chrome.runtime.onMessage.addListener((msg, sender) => {
  const tabId = msg?.tabId ?? sender.tab?.id;
  if (msg?.type === 'odoo-popout' && tabId) popOut(tabId);
});
// the Odoo tab closed: its window has nothing left to show
chrome.tabs.onRemoved.addListener(async (tabId) => {
  const open = await popoutOf(tabId);
  if (open) chrome.windows.remove(open.windowId).catch(() => {});
});

/** Debug off → on, on (or assets) → off. Self-contained: runs in the page. */
function pageToggleDebug() {
  if (typeof window.odoo?.csrf_token !== 'string') return;
  const u = new URL(location.href);
  u.searchParams.set('debug', window.odoo.debug ? '0' : '1');
  location.href = u.toString();
}
