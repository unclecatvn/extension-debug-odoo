// Security tab, functions run IN the Odoo page (MAIN world): only each function's own source text reaches it (npm run
// check:page), no chrome.* (tsconfig.page.json). What they read is the same in 18.0 and 19.0: py_js, the user module's
// context (allowed_company_ids, also in the cids cookie), the database manager's page.
import type { Json } from '../../contracts/json.ts';

/** A rule's domain evaluated, or why it couldn't be. */
export type Evaluated = { domain: unknown } | { error: string };

/** Evaluates ir.rule domain_force strings with the webclient's Python evaluator (py_js), in `ctx`. */
export function pageEvalDomains(exprs: string[], ctx: Json): Evaluated[] {
  const N_ = (s: string) => s; // error msgids, translated by the panel
  type Py = { evaluateExpr(expr: string, ctx: unknown): unknown };
  const py = window.odoo?.loader?.modules.get('@web/core/py_js/py') as Py | undefined;
  if (!py) return exprs.map(() => ({ error: N_('py_js is not loaded') }));
  return exprs.map((e) => {
    try { return { domain: py.evaluateExpr(e || '[]', ctx) }; } catch (err) { return { error: String((err as Error)?.message || err) }; }
  });
}

/** The companies enabled in the page's company switcher, the current one first (allowed_company_ids). */
export function pageCompanies(): number[] | null {
  type User = { context?: { allowed_company_ids?: number[] } };
  const user = (window.odoo?.loader?.modules.get('@web/core/user') as { user?: User } | undefined)?.user;
  const ids = user?.context?.allowed_company_ids;
  if (Array.isArray(ids) && ids.length) return ids;
  const cids = /(?:^|;\s*)cids=([^;]+)/.exec(document.cookie)?.[1];
  return cids ? decodeURIComponent(cids).split(/[-,]/).map(Number).filter(Boolean) : null;
}

/** Read-only probe of the web-facing settings, same-origin so every response header is readable. */
export async function pageProbe() {
  const f = window.__odooDebugHook?.fetch || window.fetch;
  const post = (url: string) => f(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'call', id: 1, params: {} }),
  }).then((r) => r.json() as Promise<{ result?: unknown }>).catch(() => ({}) as { result?: unknown });
  const H = ['content-security-policy', 'strict-transport-security', 'x-frame-options', 'x-content-type-options', 'referrer-policy', 'server', 'x-powered-by'];
  const page = await f(location.href, { cache: 'no-store' });
  let manager: { status: number; html: string } | null = null;
  try {
    const m = await f('/web/database/manager', { cache: 'no-store' });
    manager = { status: m.status, html: m.ok ? (await m.text()).slice(0, 200_000) : '' };
  } catch { /* blocked: stays null */ }
  const list = (await post('/web/database/list')).result;
  const info = (await post('/web/webclient/version_info')).result as { server_version?: string } | undefined;
  return {
    host: location.hostname,
    protocol: location.protocol,
    headers: Object.fromEntries(H.map((h) => [h, page.headers.get(h)])) as Record<string, string | null>,
    manager,
    dbList: Array.isArray(list) ? list as string[] : null,
    version: info?.server_version ?? null,
  };
}
