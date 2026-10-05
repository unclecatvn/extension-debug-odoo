// Service worker: the toolbar icon (enabled on Odoo pages only), content scripts injected again after an install or an
// update, keyboard shortcuts, the panel in its own window (detached-panel.ts).
import type { ExtMessage } from '../../contracts/messages.ts';
import { pageToggleDebug } from '../../injected/debug-mode.ts';
import { detach, listenDetachedPanels } from './detached-panel.ts';

listenDetachedPanels();

// Toolbar icon: greyed out everywhere, enabled only on Odoo pages (Chrome can't hide a pinned icon per site).
// declarativeContent re-checks every page load and navigation by itself. Clicking it opens entrypoints/popup.
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
// update or a reload of the extension (the button and the panel stop answering). Inject them again; rpc-recorder keeps
// its first copy (a window guard), launcher replaces its own.
chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason !== 'install' && reason !== 'update') return;
  const [main, isolated] = chrome.runtime.getManifest().content_scripts || [];
  for (const { id } of await chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] })) {
    if (id == null) continue;
    if (main?.js) chrome.scripting.executeScript({ target: { tabId: id }, world: 'MAIN', files: main.js }).catch(() => {}); // discarded tab…
    if (isolated?.js) chrome.scripting.executeScript({ target: { tabId: id }, files: isolated.js }).catch(() => {});
  }
});

// Keyboard shortcuts (manifest "commands", changed in chrome://extensions/shortcuts). Odoo pages only: elsewhere the
// content script isn't listening and window.odoo is missing, so both do nothing.
chrome.commands.onCommand.addListener((command, tab) => {
  if (tab?.id == null) return;
  if (command === 'toggle-panel') chrome.tabs.sendMessage(tab.id, { type: 'odoo-toggle' } satisfies ExtMessage).catch(() => {});
  if (command === 'popout-panel') void detach(tab.id);
  if (command === 'toggle-debug') chrome.scripting.executeScript({ target: { tabId: tab.id }, world: 'MAIN', func: pageToggleDebug }).catch(() => {});
});
