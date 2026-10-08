// MAIN-world content script, document_start: records Odoo JSON-RPC calls (XHR + fetch) before the webclient loads, so
// the log works without DevTools. Only active on pages that define `odoo`. Injected into every page of every site:
// no import but types (scripts/build.ts fails above 4 KB).
import type { RawRpc } from '../../contracts/messages.ts';

type Tracked = XMLHttpRequest & { __odooDebug?: { method: string; url: string } };

(() => {
  if (window.__odooDebugHook) return; // injected again after an update (entrypoints/background): the first copy keeps recording
  const buf: RawRpc[] = [];
  let seq = 0;
  // Detached panels survive navigation: a new document must never reuse a previous request's identity.
  const doc = `${performance.timeOrigin}:${Math.random()}`;
  const len = (e: RawRpc) => e.body.length + e.response.length;
  const fetch = window.fetch;
  Object.defineProperty(window, '__odooDebugHook', { value: { buf, fetch } });

  // web.layout (base of every Odoo page) sets `odoo = { csrf_token, debug }`. Not __session_info__: session.js deletes it
  // on load. Not a bare `window.odoo` either: any element with id="odoo" defines that.
  const odoo = () => typeof window.odoo?.csrf_token === 'string';
  const cut = (t: string) => t.slice(0, 200_000);
  const want = (method: string, url: string, body: unknown): body is string =>
    method === 'POST' && odoo() && typeof body === 'string' && (body.includes('"jsonrpc"') || url.includes('/json/2/'));
  const emit = (e: RawRpc) => {
    // Recount after an in-place completion; starts and answers share the 300-row / ~20 MB text budget.
    let n = buf.reduce((n, x) => n + len(x), 0);
    while (buf.length > 300 || (n > 20e6 && buf.length > 1)) n -= len(buf.shift()!);
    document.dispatchEvent(new CustomEvent('odoo-debug-rpc', { detail: JSON.stringify(e) }));
  };
  const start = (method: string, url: string, body: string) => {
    const t = performance.now();
    const e: RawRpc = { id: `${doc}:${++seq}`, phase: 'pending', method, url, body: cut(body), status: 0, ms: 0, at: new Date().toISOString(), response: '' };
    buf.push(e);
    emit(e);
    return (status: number, response = '', err?: unknown) => {
      if (e.phase === 'complete') return;
      Object.assign(e, { phase: 'complete', status, response: cut(response), ms: Math.round(performance.now() - t) });
      if (err) e.error = String(err);
      emit(e); // an evicted entry is not reinserted
    };
  };

  // The ISOLATED world can't see `window.odoo`: tell the launcher this is an Odoo page, and its debug mode.
  document.addEventListener('DOMContentLoaded', () => {
    if (odoo()) document.dispatchEvent(new CustomEvent('odoo-debug-ready', { detail: window.odoo!.debug || '' }));
  });

  // The launcher (⌥/Alt + click on a chatter tracking line) asks the technical names of the fields labelled `detail` on the
  // current model: labels from Odoo's field service, in the user's language, the ones the tracking line shows.
  document.addEventListener('odoo-debug-field-of', async (e) => {
    let n: string[] = [];
    try {
      const v = window.odoo!.__WOWL_DEBUG__!.root!.env!.services!;
      const f = await v.field!.loadFields(v.action!.currentController!.props!.resModel!);
      n = Object.keys(f).filter((n) => f[n]!.string === e.detail);
    } catch { /* not the webclient, or no current model */ }
    document.dispatchEvent(new CustomEvent('odoo-debug-field-names', { detail: JSON.stringify(n) }));
  });

  const P = XMLHttpRequest.prototype;
  const open = P.open;
  const send = P.send;
  P.open = function (this: Tracked, method: string, url: string | URL) {
    try { this.__odooDebug = { method: String(method).toUpperCase(), url: new URL(url, location.href).href }; } catch { /* bad url */ }
    return Reflect.apply(open, this, arguments);
  } as typeof P.open;
  P.send = function (this: Tracked, body?: Document | XMLHttpRequestBodyInit | null) {
    const d = this.__odooDebug;
    if (!d || !want(d.method, d.url, body)) return Reflect.apply(send, this, arguments);
    const done = start(d.method, d.url, body);
    const ts = ['load', 'error', 'timeout', 'abort'];
    const end = (ev?: Event, err?: unknown) => {
      // Remove every terminal listener, including the ones that did not fire, before this XHR is reused.
      for (const type of ts) this.removeEventListener(type, end);
      done(this.status, this.responseType === '' || this.responseType === 'text' ? this.responseText : '',
        err || (ev?.type !== 'load' ? `XHR ${ev?.type}` : undefined));
    };
    for (const type of ts) this.addEventListener(type, end);
    try { return Reflect.apply(send, this, arguments); } catch (e) { end(undefined, e); throw e; }
  };

  window.fetch = async function (this: unknown, input: RequestInfo | URL, init?: RequestInit) {
    let url: string, m: string, body: unknown;
    try {
      const req = input instanceof Request ? input : null;
      url = new URL(req ? req.url : String(input), location.href).href;
      m = String(init?.method || req?.method || 'GET').toUpperCase();
      body = init?.body;
    } catch { return Reflect.apply(fetch, this, arguments); }
    if (!want(m, url, body)) return Reflect.apply(fetch, this, arguments);
    const done = start(m, url, body);
    let res: Response;
    try { res = await Reflect.apply(fetch, this, arguments); }
    catch (e) { done(0, '', e); throw e; }
    try { res.clone().text().then((t) => done(res.status, t), (e) => done(res.status, '', e)); }
    catch (e) { done(res.status, '', e); }
    return res;
  };
})();
