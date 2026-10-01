// Functions injected into the Odoo tab (MAIN world) via chrome.scripting.executeScript.
// Each must be self-contained: only its source text is sent to the page.

export function pageState() {
  const odoo = window.odoo;
  // loadedAt changes on every page load (not on Odoo's pushState navigation): the panel's cache lives that long.
  const base = { url: location.href, origin: location.origin, loadedAt: performance.timeOrigin, odoo: !!odoo };
  const c = odoo?.__WOWL_DEBUG__?.root?.env?.services?.action?.currentController;
  if (!c) {
    // Fallback when the webclient internals aren't reachable: /odoo/<...>/<model.name>/<id>
    const m = location.pathname.match(/\/odoo\/(?:.*\/)?([a-z0-9_]+\.[a-z0-9_.]+)\/(\d+)/);
    return { ...base, model: m?.[1] || null, resId: m ? +m[2] : null };
  }
  const p = c.props || {};
  const viewType = c.view?.type || null;
  // props.resId goes stale after the pager or "New"; the form keeps currentState.resId in sync (it builds the URL).
  const resId = (viewType === 'form' ? c.currentState?.resId : p.resId) || null;
  const views = c.action?.views || [];
  const viewId = (views.find(([, t]) => t === viewType) || [])[0] || false;
  const plain = (o) => { try { return JSON.parse(JSON.stringify(o ?? null)); } catch { return String(o); } };
  return {
    ...base,
    model: p.resModel || c.action?.res_model || null,
    resId, viewType, viewId,
    context: plain(p.context), domain: plain(p.domain),
    action: plain(c.action),
  };
}

export async function pageRpc(route, params) {
  const f = window.__odooDebugHook?.fetch || window.fetch; // unhooked: our own calls stay out of the RPC log
  try {
    const r = await f(route, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'call', id: Date.now(), params }),
    });
    const j = await r.json();
    if (j.error) return { error: j.error.data?.message || j.error.message, traceback: j.error.data?.debug, errorType: j.error.data?.name };
    return { result: j.result };
  } catch (e) {
    return { error: String(e) };
  }
}

/** Plain same-origin GET (profiler routes are type=http, not JSON-RPC). */
export async function pageFetch(url) {
  const f = window.__odooDebugHook?.fetch || window.fetch;
  try {
    const r = await f(url, { cache: 'no-store' });
    return { status: r.status, text: await r.text() };
  } catch (e) {
    return { error: String(e) };
  }
}

export function pageDebug(mode) {
  const u = new URL(location.href);
  u.searchParams.set('debug', mode); // '0' turns it off (Odoo keeps debug in the session otherwise)
  location.href = u.toString();
}

export function pageGo(path) {
  location.href = path;
}
