// Apps tab, functions run IN the Odoo page (MAIN world): only each function's own source text reaches it (npm run
// check:page), no chrome.* (tsconfig.page.json). Same in 18.0 and 19.0.

/** Whether the Odoo server serves `path` (e.g. /sale/static/description/index.html): a HEAD with the page's session, on
 * the fetch the page had before rpc-recorder wrapped it (kept out of the RPC log). */
export async function pageHasFile(path: string): Promise<boolean> {
  const f = window.__odooDebugHook?.fetch || window.fetch;
  try {
    const r = await f(path, { method: 'HEAD', credentials: 'same-origin' });
    return r.ok;
  } catch {
    return false;
  }
}
