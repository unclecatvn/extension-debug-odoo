// Runs IN the Odoo page (MAIN world), through chrome.scripting.executeScript({ func }): only each function's own source
// text reaches the page, so nothing from outside it but browser globals and types (npm run check:page), and no
// chrome.* (tsconfig.page.json). Arguments and results cross as JSON.
// HTTP calls with the page's own session (cookie, same origin), on the fetch the page had before rpc-recorder wrapped
// it: the panel's own calls stay out of the RPC log.
import type { Json } from '../contracts/json.ts';

/** JSON-RPC answer, flattened: the result, or the server error with its traceback and exception type. */
export type PageRpcResult = { result: unknown } | { error: string; traceback?: string; errorType?: string };

export async function pageRpc(route: string, params: { [key: string]: Json | undefined }): Promise<PageRpcResult> {
  const f = window.__odooDebugHook?.fetch || window.fetch;
  try {
    const r = await f(route, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'call', id: Date.now(), params }),
    });
    const j = (await r.json()) as { result?: unknown; error?: { message: string; data?: { message?: string; debug?: string; name?: string } } };
    if (j.error) return { error: j.error.data?.message || j.error.message, traceback: j.error.data?.debug, errorType: j.error.data?.name };
    return { result: j.result };
  } catch (e) {
    return { error: String(e) };
  }
}

/** Plain same-origin GET (profiler routes are type=http, not JSON-RPC). */
export async function pageFetch(url: string): Promise<{ status: number; text: string } | { error: string }> {
  const f = window.__odooDebugHook?.fetch || window.fetch;
  try {
    const r = await f(url, { cache: 'no-store' });
    return { status: r.status, text: await r.text() };
  } catch (e) {
    return { error: String(e) };
  }
}

/** POSTs `body` (JSON text) to `route` with the page's session, on the unwrapped fetch: a request sent again (RPC: Edit &
 * Resend; Perf: profiled) stays out of the log. */
export async function pageSend(route: string, body: string): Promise<{ status: number; text: string; ms: number } | { error: string }> {
  const f = window.__odooDebugHook?.fetch || window.fetch;
  const t0 = performance.now();
  try {
    const r = await f(route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
    return { status: r.status, text: await r.text(), ms: Math.round(performance.now() - t0) };
  } catch (e) {
    return { error: String(e) };
  }
}
