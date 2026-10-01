// MAIN-world content script, document_start: records Odoo JSON-RPC calls (XHR + fetch) before the
// webclient loads, so the log works without DevTools. Only active on pages that define `odoo`.
(() => {
  if (window.__odooDebugHook) return;
  const MAX = 300;
  const BODY_MAX = 200000; // ponytail: bodies cut at 200 KB so a huge search_read can't bloat the page
  const SIZE_MAX = 20e6; // and the whole buffer kept under ~20 MB of text (300 × 2 × 200 KB would be 120 MB)
  const buf = [];
  let size = 0;
  const sizeOf = (e) => (e.body?.length || 0) + (e.response?.length || 0);
  const origFetch = window.fetch;
  Object.defineProperty(window, '__odooDebugHook', { value: { buf, fetch: origFetch } });

  // web.layout (base of every Odoo page) sets `odoo = { csrf_token, debug }`. Not __session_info__: session.js deletes it on
  // load. Not a bare `window.odoo` either: any element with id="odoo" defines that.
  const isOdoo = () => typeof window.odoo?.csrf_token === 'string';
  const cut = (t) => (typeof t === 'string' && t.length > BODY_MAX ? t.slice(0, BODY_MAX) : t);
  const wanted = (method, url, body) =>
    method === 'POST' && isOdoo() && typeof body === 'string' && (body.includes('"jsonrpc"') || url.includes('/json/2/'));
  const push = (e) => {
    buf.push(e);
    size += sizeOf(e);
    while (buf.length > MAX || (size > SIZE_MAX && buf.length > 1)) size -= sizeOf(buf.shift());
    document.dispatchEvent(new CustomEvent('odoo-debug-rpc', { detail: JSON.stringify(e) }));
  };

  // The ISOLATED world can't see `window.odoo`: tell bubble.js this is an Odoo page, and its debug mode.
  document.addEventListener('DOMContentLoaded', () => {
    if (isOdoo()) document.dispatchEvent(new CustomEvent('odoo-debug-ready', { detail: window.odoo.debug || '' }));
  });

  // bubble.js (⌥/Alt + click on a chatter tracking line) asks the technical names of the fields labelled `detail` on the
  // current model. Labels from fields_get, in the user's language: the ones the tracking line shows.
  document.addEventListener('odoo-debug-field-of', async (e) => {
    let names = [];
    try {
      const { env } = window.odoo.__WOWL_DEBUG__.root;
      const fields = await env.services.field.loadFields(env.services.action.currentController.props.resModel);
      names = Object.keys(fields).filter((n) => fields[n].string === e.detail);
    } catch { /* not the webclient, or no current model */ }
    document.dispatchEvent(new CustomEvent('odoo-debug-field-names', { detail: JSON.stringify(names) }));
  });

  const P = XMLHttpRequest.prototype;
  const open = P.open;
  const send = P.send;
  P.open = function (method, url) {
    try { this.__odooDebug = { method: String(method).toUpperCase(), url: new URL(url, location.href).href }; } catch { /* bad url */ }
    return open.apply(this, arguments);
  };
  P.send = function (body) {
    const d = this.__odooDebug;
    if (d && wanted(d.method, d.url, body)) {
      const t0 = performance.now();
      const at = new Date().toISOString();
      this.addEventListener('loadend', () => push({
        ...d, body: cut(body), status: this.status, ms: Math.round(performance.now() - t0), at,
        response: cut(this.responseType === '' || this.responseType === 'text' ? this.responseText : ''),
      }));
    }
    return send.apply(this, arguments);
  };

  window.fetch = async function (input, init) {
    let url, method, body;
    try {
      const req = input instanceof Request ? input : null;
      url = new URL(req ? req.url : String(input), location.href).href;
      method = String(init?.method || req?.method || 'GET').toUpperCase();
      body = init?.body;
    } catch { return origFetch.apply(this, arguments); }
    if (!wanted(method, url, body)) return origFetch.apply(this, arguments);
    const t0 = performance.now();
    const at = new Date().toISOString();
    const res = await origFetch.apply(this, arguments);
    res.clone().text().then((t) => push({ method, url, body: cut(body), status: res.status, ms: Math.round(performance.now() - t0), at, response: cut(t) }), () => {});
    return res;
  };
})();
