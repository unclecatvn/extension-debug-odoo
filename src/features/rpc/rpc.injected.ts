// RPC tab, functions run IN the Odoo page (MAIN world): only each function's own source text reaches it (npm run
// check:page), no chrome.* (tsconfig.page.json).
import type { RawRpc } from '../../contracts/messages.ts';

/** What the page recorded before the panel opened (entrypoints/rpc-recorder keeps the last 300 calls). */
export function pageRpcLog(): RawRpc[] {
  return window.__odooDebugHook?.buf.slice() || [];
}
