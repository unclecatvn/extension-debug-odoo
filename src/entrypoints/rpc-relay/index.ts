// ISOLATED-world content script: forwards what the MAIN world reports (RPCs recorded by rpc-recorder, fields picked on
// the page) to the panel.
// Injected again by entrypoints/background on install / update, possibly next to a copy the manifest already ran:
// every copy of an extension shares the page's isolated world, so the last one injected claims the relay and the
// others step back (two copies forwarding would log each RPC twice and re-render the View tab twice per pick).
import type { ExtMessage } from '../../contracts/messages.ts';

declare global { var __odooDebugRelay: symbol | undefined }
const me = Symbol('rpc-relay');
globalThis.__odooDebugRelay = me;

const forward = (msg: ExtMessage) => {
  if (globalThis.__odooDebugRelay !== me) return; // a newer copy relays
  if (!chrome.runtime?.id) return; // orphaned by an update: the copy injected again relays
  chrome.runtime.sendMessage(msg).catch(() => {}); // panel closed → dropped (rpc-recorder keeps a buffer)
};
document.addEventListener('odoo-debug-rpc', (e) => forward({ type: 'odoo-rpc', raw: e.detail }));
document.addEventListener('odoo-debug-pick', (e) => forward({ type: 'odoo-pick', name: e.detail }));
