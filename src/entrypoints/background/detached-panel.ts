// The panel in its own window ("detached"), to keep it on a second screen next to the Odoo tab it inspects.
// The window shows panel/index.html?tab=<id>: bound to that tab from anywhere. This keeps which tab's panel is in which
// window (chrome.storage.session: the service worker may stop at any time, the session storage stays), tells the
// tab's launcher when its panel leaves or comes back, and remembers the window's last bounds (chrome.storage.local).
import { isExtMessage, type ExtMessage } from '../../contracts/messages.ts';

const WINDOWS_KEY = 'detachedPanels'; // storage.session: { [tabId]: windowId }
const BOUNDS_KEY = 'detachedPanelBounds'; // storage.local: { left, top, width, height } of the last detached window
const DEFAULT_BOUNDS = { width: 560, height: 860 };

type Bounds = { left?: number; top?: number; width?: number; height?: number };

async function windows(): Promise<Record<string, number>> {
  const { [WINDOWS_KEY]: map = {} } = (await chrome.storage.session.get(WINDOWS_KEY)) as { [WINDOWS_KEY]?: Record<string, number> };
  return map;
}
const saveWindows = (map: Record<string, number>) => chrome.storage.session.set({ [WINDOWS_KEY]: map });
const tell = (tabId: number, msg: ExtMessage) => chrome.tabs.sendMessage(tabId, msg).catch(() => {}); // tab gone / not Odoo

/** The window of `tabId`'s detached panel, if it still exists. */
async function windowOf(tabId: number): Promise<number | null> {
  const id = (await windows())[tabId];
  if (id == null) return null;
  return chrome.windows.get(id).then(() => id, async () => { await forget(tabId); return null; });
}

async function forget(tabId: number) {
  const map = await windows();
  delete map[tabId];
  await saveWindows(map);
}

/** Opens the panel of `tabId` in its own window, or brings that window to the front. */
export async function detach(tabId: number) {
  const existing = await windowOf(tabId);
  if (existing != null) { await chrome.windows.update(existing, { focused: true }); return; }
  const { [BOUNDS_KEY]: bounds = DEFAULT_BOUNDS } = (await chrome.storage.local.get(BOUNDS_KEY)) as { [BOUNDS_KEY]?: Bounds };
  const win = await chrome.windows.create({ url: chrome.runtime.getURL(`panel/index.html?tab=${tabId}`), type: 'popup', focused: true, ...bounds });
  if (win?.id == null) return;
  await saveWindows({ ...(await windows()), [tabId]: win.id });
  await tell(tabId, { type: 'odoo-detached', on: true });
}

async function attach(tabId: number) {
  const id = await windowOf(tabId);
  await forget(tabId); // before closing it: onRemoved then finds nothing to tell again
  await tell(tabId, { type: 'odoo-detached', on: false });
  await tell(tabId, { type: 'odoo-toggle', open: true });
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (tab?.windowId != null) await chrome.windows.update(tab.windowId, { focused: true }).catch(() => {});
  await chrome.tabs.update(tabId, { active: true }).catch(() => {});
  if (id != null) await chrome.windows.remove(id).catch(() => {});
}

/** Brings `tabId`'s panel window to the front → whether there was one. */
async function focus(tabId: number): Promise<boolean> {
  const id = await windowOf(tabId);
  if (id == null) return false;
  await chrome.windows.update(id, { focused: true });
  return true;
}

export function listenDetachedPanels() {
  chrome.runtime.onMessage.addListener((msg: unknown, sender, reply) => {
    if (!isExtMessage(msg)) return;
    const from = sender.tab?.id; // the launcher's tab (content script)
    switch (msg.type) {
      case 'odoo-detach': void detach(msg.tabId); return;
      case 'odoo-attach': void attach(msg.tabId); return;
      case 'odoo-focus-panel': if (from != null) { void focus(from).then(reply); return true; } return;
      case 'odoo-detached-state': if (from != null) { void windowOf(from).then((id) => reply(id != null)); return true; } return;
      default: return;
    }
  });

  // closed by the user: its tab's launcher shows the panel again on the next click
  chrome.windows.onRemoved.addListener(async (windowId) => {
    const map = await windows();
    const tab = Object.keys(map).find((t) => map[t] === windowId);
    if (tab == null) return;
    await forget(Number(tab));
    await tell(Number(tab), { type: 'odoo-detached', on: false });
  });

  // the inspected tab closed: its panel window has nothing left to show
  chrome.tabs.onRemoved.addListener(async (tabId) => {
    const id = await windowOf(tabId);
    await forget(tabId);
    if (id != null) await chrome.windows.remove(id).catch(() => {});
  });

  // moved / resized: the next detached window opens there
  chrome.windows.onBoundsChanged.addListener(async (win) => {
    if (win.id == null || !Object.values(await windows()).includes(win.id)) return;
    const { left, top, width, height } = win;
    await chrome.storage.local.set({ [BOUNDS_KEY]: { left, top, width, height } satisfies Bounds });
  });
}
