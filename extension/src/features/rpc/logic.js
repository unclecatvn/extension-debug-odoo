// Pure helpers, no chrome.* / DOM: tested by tests/rpc.test.mjs.

/** Raw entry from hook.js → RPC log entry (request + response parsed), or null if it isn't an Odoo RPC. */
export function parseRpc(raw) {
  if (raw.method !== 'POST') return null;
  const u = new URL(raw.url);
  const path = u.pathname;
  let body = null;
  try { body = JSON.parse(raw.body || ''); } catch { /* not JSON, or cut by hook.js (> 200 KB) */ }
  const base = { path, route: path + u.search, body: raw.body, ms: raw.ms || 0, status: raw.status || 0, at: raw.at, ...parseRpcResponse(raw.response ?? '', raw.status) };
  // A cut body can't be parsed: show its beginning, take model/method from the URL.
  const head = typeof raw.body === 'string' ? `${raw.body.slice(0, 2000)}…` : null;

  const j2 = path.match(/^\/json\/2\/([^/]+)\/([^/]+)/); // Odoo 19 JSON-2 API
  if (j2) return { ...base, model: j2[1], method: j2[2], args: body ?? head, kwargs: null };

  const kw = path.match(/\/call_(?:kw|button)\/([^/]+)\/([^/]+)/);
  if (!body) return kw ? { ...base, model: kw[1], method: kw[2], args: head, kwargs: null } : null;
  if (body.jsonrpc !== '2.0') return null;
  const p = body.params || {};
  if (p.model && p.method) return { ...base, model: p.model, method: p.method, args: p.args, kwargs: p.kwargs };
  return { ...base, model: '', method: path, args: p, kwargs: null }; // other JSON routes: show raw params
}

/** Response body text → { result } | { error, traceback }. */
export function parseRpcResponse(text, status) {
  let j;
  try { j = JSON.parse(text); } catch { return status >= 400 ? { error: `HTTP ${status}` } : { result: text }; }
  if (j?.jsonrpc) {
    return j.error
      ? { error: j.error.data?.message || j.error.message, traceback: j.error.data?.debug, errorType: j.error.data?.name }
      : { result: j.result };
  }
  if (status >= 400) return { error: j?.message || `HTTP ${status}`, traceback: j?.debug, errorType: j?.name }; // JSON-2 error shape
  return { result: j };
}

/** JSON text pretty-printed for editing; left as is when it isn't JSON (e.g. cut by hook.js). */
export function prettyJson(text) {
  try { return JSON.stringify(JSON.parse(text), null, 2); } catch { return text ?? ''; }
}

/** A request as a cURL command. A call_kw / call_button (model and method in its params) becomes the external API's
 * execute_kw on /jsonrpc, authenticated by an API key read from $ODOO_API_KEY (no session to copy, works from anywhere);
 * any other route is kept as is, with the session cookie read from $ODOO_SESSION. */
export function toCurl({ origin, route, body, db, uid }) {
  const sh = (s) => `'${s.replaceAll("'", "'\\''")}'`; // single-quoted for the shell
  let p = null;
  try { p = JSON.parse(body)?.params; } catch { /* not JSON: sent as is */ }
  const lines = (url, ...opts) => [`curl ${sh(url)}`, "-H 'Content-Type: application/json'", ...opts].join(' \\\n  ');
  if (p?.model && p?.method && /^\/web\/dataset\/call_(kw|button)\b/.test(route)) {
    const data = JSON.stringify({ jsonrpc: '2.0', method: 'call', params: { service: 'object', method: 'execute_kw',
      args: [db, uid, '__ODOO_API_KEY__', p.model, p.method, p.args ?? [], p.kwargs ?? {}] } });
    return lines(`${origin}/jsonrpc`, `--data-raw ${sh(data).replace('"__ODOO_API_KEY__"', `"'"$ODOO_API_KEY"'"`)}`);
  }
  return lines(origin + route, '-b "session_id=$ODOO_SESSION"', `--data-raw ${sh(body)}`);
}
