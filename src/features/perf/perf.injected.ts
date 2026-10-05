// Perf tab, functions run IN the Odoo page (MAIN world): only each function's own source text reaches it (npm run
// check:page), no chrome.* (tsconfig.page.json). Same in 18.0 and 19.0.

/** GETs `path` with the page's session (a cookie route such as /web/set_profiling), on the fetch the page had before
 * rpc-recorder wrapped it. */
export async function pageGet(path: string): Promise<{ status: number; text: string } | { error: string }> {
  const f = window.__odooDebugHook?.fetch || window.fetch;
  try {
    const r = await f(path, { credentials: 'same-origin' });
    return { status: r.status, text: await r.text() };
  } catch (e) {
    return { error: String(e) };
  }
}
