// Runs IN the Odoo page (MAIN world), through chrome.scripting.executeScript({ func }): only each function's own source
// text reaches the page, so nothing from outside it but browser globals and types (npm run check:page), and no
// chrome.* (tsconfig.page.json). Arguments and results cross as JSON.
// What the panel shows in its header and every tab starts from: the screen Odoo is on.

export interface PageState {
  url: string;
  origin: string;
  /** performance.timeOrigin: changes on every page load (not on Odoo's pushState navigation); the panel's cache lives that long */
  loadedAt: number;
  odoo: boolean;
  debug: string;
  model?: string | null;
  resId?: number | null;
  viewType?: string | null;
  viewId?: number | false;
  context?: unknown;
  domain?: unknown;
  action?: Record<string, unknown> | null;
  /** set by the panel when the tab could not be scripted */
  error?: string;
}

export function pageState(): PageState {
  const odoo = window.odoo;
  const base = { url: location.href, origin: location.origin, loadedAt: performance.timeOrigin, odoo: !!odoo, debug: odoo?.debug || '' };
  const c = odoo?.__WOWL_DEBUG__?.root?.env?.services?.action?.currentController;
  if (!c) {
    // Fallback when the webclient internals aren't reachable: /odoo/<...>/<model.name>/<id>
    const m = location.pathname.match(/\/odoo\/(?:.*\/)?([a-z0-9_]+\.[a-z0-9_.]+)\/(\d+)/);
    return { ...base, model: m?.[1] || null, resId: m?.[2] ? +m[2] : null };
  }
  const p = c.props || {};
  const viewType = c.view?.type || null;
  // props.resId goes stale after the pager or "New"; the form keeps currentState.resId in sync (it builds the URL).
  const resId = (viewType === 'form' ? c.currentState?.resId : p.resId) || null;
  const views = c.action?.views || [];
  const viewId = (views.find(([, t]) => t === viewType) || [])[0] || false;
  const plain = (o: unknown): unknown => { try { return JSON.parse(JSON.stringify(o ?? null)); } catch { return String(o); } };
  return {
    ...base, odoo: true,
    model: p.resModel || c.action?.res_model || null,
    resId, viewType, viewId,
    context: plain(p.context), domain: plain(p.domain),
    action: plain(c.action) as Record<string, unknown> | null,
  };
}
