// Function injected into the Odoo tab (MAIN world) via chrome.scripting.executeScript.
// Self-contained: only its source text is sent to the page.

/** Runs `code` (the body of an async function) with a small ORM over /web/dataset/call_kw, in the Odoo session:
 * the server applies the logged-in user's ACLs, record rules, field groups and companies to every call.
 * opts.readonly blocks every method outside READ before it is sent. That is a guard against slips, not a security
 * boundary: the code runs with the page's own JS rights, and the server is what enforces access.
 * Returns { ok, value?, error?, out, calls, ms }, JSON-safe (recordsets → { $recordset, ids }). */
export async function pageRunCode(code, opts = {}) {
  const N_ = (s) => s; // error msgids, translated by the panel
  const { readonly = true, context: fallback = {}, uid: fallbackUid = null } = opts;
  const f = window.__odooDebugHook?.fetch || window.fetch; // unhooked: the RPC tab logs the page's calls, not ours
  const MAX_CALLS = 1000; // a loop gone wrong stops here instead of hammering the server
  const SOURCE = 'odoo-debug-code.js';
  const HEADER_LINES = 2; // lines V8 puts before the body of `new AsyncFunction(...)`
  // Methods that only read. Everything else (write, create, unlink, action_*, button_*…) needs "Allow Writes".
  const READ = new Set([
    'search', 'search_read', 'search_count', 'search_fetch', 'read', 'read_group', 'formatted_read_group',
    'web_search_read', 'web_read', 'web_read_group', 'fields_get', 'name_search', 'default_get', 'get_views',
    'get_view', 'has_access', 'check_access', 'check_access_rights', 'check_access_rule', 'exists', 'has_group',
    'check_object_reference', 'get_metadata', 'export_data', 'read_progress_bar',
  ]);
  // @api.model methods: called without ids (call_kw would take the first argument as the ids otherwise).
  const MODEL_LEVEL = new Set([
    'search', 'search_read', 'search_count', 'read_group', 'formatted_read_group', 'web_search_read', 'web_read_group',
    'fields_get', 'name_search', 'name_create', 'default_get', 'get_views', 'get_view', 'create', 'check_object_reference',
    'read_progress_bar',
  ]);

  const started = performance.now();
  const out = [];
  const calls = [];

  let userContext = null;
  try { userContext = window.odoo?.loader?.modules?.get('@web/core/user')?.user?.context; } catch { /* webclient internals moved */ }
  const base = { ...(userContext || fallback) }; // lang, tz, uid, allowed_company_ids: what the webclient itself sends
  const uid = base.uid ?? fallbackUid;
  const companyIds = base.allowed_company_ids || [];

  const fail = (msgid, args, message) => Object.assign(new Error(message), { msgid, args });
  const short = (v) => { try { const s = JSON.stringify(v); return s.length > 300 ? `${s.slice(0, 300)}…` : s; } catch { return String(v); } };

  // Every call goes out in the order the code issued it, one at a time: `rec.state = 'sent'` (a write the code cannot
  // await) is then sent before the next read. A failed assignment fails every later call, and the run.
  let chain = Promise.resolve();
  let assignError = null;
  function callKw(...call) {
    const p = chain.then(() => send(...call));
    chain = p.catch(() => {});
    return p;
  }

  /** One call_kw, right now (callKw queues it; only the queue itself and an assignment holding it call this). */
  async function send(model, method, args, kwargs, context) {
    if (assignError) throw assignError;
    const name = `${model}.${method}`;
    if (readonly && !READ.has(method)) {
      throw fail(N_('%s writes: blocked in read-only mode (tick "Allow Writes" to run it)'), [name], `${name} writes: blocked in read-only mode`);
    }
    if (calls.length >= MAX_CALLS) throw fail(N_('Stopped after %s calls'), [MAX_CALLS], `Stopped after ${MAX_CALLS} calls`);
    const entry = { model, method, args: short(args), kwargs: short(kwargs), write: !READ.has(method), ms: 0 };
    calls.push(entry);
    if (entry.write) values.clear(); // field values read before a write may be stale after it
    const t = performance.now();
    try {
      const r = await f(`/web/dataset/call_kw/${model}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0', method: 'call', id: Date.now(),
          params: { model, method, args, kwargs: { ...kwargs, context: { ...base, ...context, ...kwargs.context } } },
        }),
      });
      const j = await r.json();
      if (j.error) {
        const d = j.error.data || {};
        entry.error = d.message || j.error.message;
        throw Object.assign(new Error(entry.error), { traceback: d.debug, type: d.name, server: true });
      }
      return j.result;
    } finally {
      entry.ms = Math.round(performance.now() - t);
      if (entry.write) values.clear();
    }
  }

  const RELATIONAL = ['many2one', 'one2many', 'many2many'];
  const NUMERIC = ['integer', 'float', 'monetary'];
  const values = new Map(); // "model context" → Map(id → { field: value }): field values read during this run
  const fieldCache = new Map();
  async function fieldInfo(rs, name, call = callKw) {
    const key = `${rs._name} ${name}`;
    if (!fieldCache.has(key)) fieldCache.set(key, (await call(rs._name, 'fields_get', [[name]], { attributes: ['type', 'relation'] }, rs._context))[name]);
    const info = fieldCache.get(key);
    if (!info) throw fail(N_('%s has no field %s'), [rs._name, name], `${rs._name} has no field ${name}`);
    return info;
  }

  /** A field of a singleton, like rec.state in Python: read once for every record of its prefetch group (the recordset
   * it was iterated from), then served from `values` until something writes. */
  async function fieldValue(rs, name, call = callKw) {
    const key = `${rs._name} ${JSON.stringify(rs._context)}`;
    if (!values.has(key)) values.set(key, new Map());
    const cache = values.get(key);
    const id = rs._ids[0];
    const has = (x) => cache.has(x) && name in cache.get(x);
    if (!has(id)) {
      const group = [id, ...rs._prefetch.filter((x) => x !== id && !has(x))].slice(0, 1000);
      const read = (ids) => call(rs._name, 'read', [ids], { fields: [name], load: false }, rs._context);
      let rows;
      try { rows = await read(group); } catch (e) {
        if (group.length === 1) throw e;
        rows = await read([id]); // one record of the group may be unreadable: only this one has to be
      }
      for (const row of rows) cache.set(row.id, { ...cache.get(row.id), [name]: row[name] });
    }
    return cache.get(id)[name];
  }

  /** rec.partner_id.country_id.code: each hop on a single record (Expected singleton otherwise, as in Python).
   * Relational end → recordset, other fields → value; on an empty recordset → false / 0 / an empty recordset. */
  async function resolvePath(rs, path, call = callKw) {
    let cur = rs;
    for (const [i, name] of path.entries()) {
      const last = i === path.length - 1;
      if (i && name in cur && typeof cur[name] !== 'function') { // rec.partner_id.ids / .id / .length
        if (last) return cur[name];
        throw fail(N_('%s.%s is not relational'), [cur._name, name], `${cur._name}.${name} is not relational`);
      }
      if (cur.length > 1) throw fail(N_('Expected singleton: %s'), [String(cur)], `Expected singleton: ${cur}`);
      const info = await fieldInfo(cur, name, call);
      const relational = RELATIONAL.includes(info.type);
      if (!relational && !last) throw fail(N_('%s.%s is not relational'), [cur._name, name], `${cur._name}.${name} is not relational`);
      if (!relational) return cur.length ? fieldValue(cur, name, call) : NUMERIC.includes(info.type) ? 0 : false;
      const v = cur.length ? await fieldValue(cur, name, call) : false;
      cur = wrap(info.relation, info.type === 'many2one' ? (v ? [v] : []) : v || [], cur._context);
    }
    return cur;
  }

  /** What `rec.x` is when x is not a Recordset member: a field when awaited (`await rec.state`, or returned / printed),
   * a method when called (`await rec.action_confirm()`), and a longer path when followed (`rec.partner_id.name`). */
  const lazies = new WeakMap(); // lazy → { rs, path }: settle() resolves it with the caller it is given

  /** rec.state = 'sent' → write({ state: 'sent' }) on rec, like in Python (rec.partner_id.name = … writes the partner).
   * Queued at once, in order with every other call; its error surfaces at the next call or at the end of the run,
   * reported at the line of the assignment (`origin`). */
  function assign(rs, path, name, value, origin) {
    const label = `${rs._name}.${[...path, name].join('.')}`;
    if (readonly) throw fail(N_('%s writes: blocked in read-only mode (tick "Allow Writes" to run it)'), [label], `${label} writes: blocked in read-only mode`);
    values.clear(); // a read issued after this line must not be served what was read before it
    const p = chain.then(async () => {
      const target = path.length ? await resolvePath(rs, path, send) : rs;
      if (!(target instanceof Recordset)) throw fail(N_('%s.%s is not relational'), [rs._name, path.join('.')], `${label}: not a recordset`);
      if (!target.length) return;
      let v = await settle(value, send);
      if (v instanceof Recordset) { // rec.partner_id = partner / rec.tag_ids = tags
        const info = await fieldInfo(target, name, send);
        v = info.type === 'many2one' ? v.id : RELATIONAL.includes(info.type) ? [[6, 0, v.ids]] : v.id;
      }
      await send(target._name, 'write', [target.ids, { [name]: plain(v) }], {}, target._context);
    }).catch((e) => {
      e.stack = `${e.stack}\n${origin.stack}`; // the line of the assignment, not of the queue
      assignError ??= e;
    });
    chain = p;
  }

  function lazy(rs, path) {
    const label = `${rs._name}.${path.join('.')}`;
    const p = new Proxy(function field() {}, {
      get(_, prop) {
        if (prop === 'then') return (ok, ko) => resolvePath(rs, path).then(ok, ko);
        if (prop === Symbol.toPrimitive || prop === 'toString' || prop === 'valueOf') {
          return () => { throw fail(N_('%s is read from the server: await it before using its value'), [label], `${label} is read from the server: await it before using its value`); };
        }
        if (typeof prop === 'symbol' || prop === 'toJSON') return undefined;
        return lazy(rs, [...path, prop]);
      },
      set(_, prop, value) {
        if (typeof prop === 'symbol') return false;
        assign(rs, path, prop, value, new Error());
        return true;
      },
      async apply(_, __, args) {
        const target = path.length > 1 ? await resolvePath(rs, path.slice(0, -1)) : rs;
        const method = path.at(-1);
        if (!(target instanceof Recordset)) {
          throw fail(N_('%s.%s is not relational'), [rs._name, path.slice(0, -1).join('.')], `${label}: not a recordset`);
        }
        return typeof target[method] === 'function' && method in target ? target[method](...args) : target.call(method, args);
      },
    });
    lazies.set(p, { rs, path });
    return p;
  }

  class Recordset {
    constructor(model, ids, context, prefetch) {
      this._name = model;
      this._ids = ids;
      this._context = context;
      this._prefetch = prefetch || ids;
    }
    /** for (const rec of rs): singletons sharing rs as their prefetch group (one read per field for all of them). */
    *[Symbol.iterator]() { for (const id of this._ids) yield wrap(this._name, [id], this._context, this._ids); }
    get ids() { return [...this._ids]; }
    get id() { return this._ids[0] ?? false; }
    get length() { return this._ids.length; }
    get context() { return { ...base, ...this._context }; }
    toString() { return `${this._name}(${this._ids.join(', ')})`; }
    _model(method, args = [], kwargs = {}) { return callKw(this._name, method, args, kwargs, this._context); }
    _records(method, args = [], kwargs = {}) { return callKw(this._name, method, [this._ids, ...args], kwargs, this._context); }

    browse(ids = []) {
      const list = (Array.isArray(ids) ? ids : [ids]).filter((id) => id || id === 0);
      return wrap(this._name, list, this._context);
    }
    with_context(ctx = {}) { return wrap(this._name, this._ids, { ...this._context, ...ctx }); }
    ensure_one() {
      if (this._ids.length !== 1) throw fail(N_('Expected singleton: %s'), [String(this)], `Expected singleton: ${this}`);
      return this;
    }
    /** Any public method: on these records (their ids go first), or on the model when the recordset is empty or the
     * method is a known @api.model one. env['x'].call('m', args, kwargs) is therefore always a model-level call. */
    call(method, args = [], kwargs = {}) {
      return MODEL_LEVEL.has(method) || !this._ids.length ? this._model(method, args, kwargs) : this._records(method, args, kwargs);
    }

    async search(domain = [], kwargs = {}) { return this.browse(await this._model('search', [domain], kwargs)); }
    search_read(domain = [], fields, kwargs = {}) { return this._model('search_read', [domain], { ...(fields && { fields }), ...kwargs }); }
    search_count(domain = [], kwargs = {}) { return this._model('search_count', [domain], kwargs); }
    read(fields, kwargs = {}) { return this._records('read', [], { ...(fields && { fields }), ...kwargs }); }
    read_group(domain, fields, groupby, kwargs = {}) { return this._model('read_group', [domain, fields, groupby], kwargs); }
    fields_get(allfields, attributes) {
      return this._model('fields_get', [], { ...(allfields && { allfields }), ...(attributes && { attributes }) });
    }
    name_search(name = '', kwargs = {}) { return this._model('name_search', [], { name, ...kwargs }); }
    async create(vals) {
      const r = await this._model('create', [vals]);
      return this.browse(r);
    }
    write(vals) { return this._records('write', [vals]); }
    unlink() { return this._records('unlink'); }
    async copy(defaults) {
      const r = await this._records('copy', [], defaults ? { default: defaults } : {});
      return this.browse(r);
    }
    async exists() { return this.browse(await this._records('exists')); }
    async filtered_domain(domain) {
      if (!this._ids.length) return this;
      const found = new Set(await this._model('search', [[['id', 'in', this._ids], ...domain]], { context: { active_test: false } }));
      return this.browse(this._ids.filter((id) => found.has(id)));
    }
    /** mapped('partner_id.country_id.code'): reads hop by hop. Relational end → recordset (deduplicated), else values. */
    async mapped(path) {
      let rs = this;
      const parts = path.split('.');
      for (const [i, name] of parts.entries()) {
        const last = i === parts.length - 1;
        const info = await fieldInfo(rs, name);
        const relational = RELATIONAL.includes(info.type);
        if (!relational && !last) throw fail(N_('%s.%s is not relational'), [rs._name, name], `${rs._name}.${name} is not relational`);
        const rows = rs._ids.length ? await rs._records('read', [], { fields: [name], load: false }) : [];
        if (!relational) return rows.map((r) => r[name]);
        const ids = new Set();
        for (const r of rows) for (const id of info.type === 'many2one' ? [r[name]] : r[name]) if (id) ids.add(id);
        rs = wrap(info.relation, [...ids], rs._context);
      }
      return rs;
    }
  }

  /** Unknown attributes are fields or methods (see lazy): `await so.state`, `await so.action_confirm()`. */
  function wrap(model, ids, context = {}, prefetch = null) {
    const rs = new Recordset(model, ids, context, prefetch);
    return new Proxy(rs, {
      get(target, prop, receiver) {
        if (typeof prop === 'symbol' || prop in target) return Reflect.get(target, prop, receiver);
        if (prop === 'then' || prop === 'toJSON' || prop.startsWith('_')) return undefined; // `await rs` must not call the server
        return lazy(receiver, [prop]);
      },
      set(target, prop, value, receiver) {
        if (typeof prop === 'symbol' || prop in target || prop.startsWith('_')) {
          throw new TypeError(`${String(prop)} cannot be assigned on a recordset`);
        }
        assign(receiver, [], prop, value, new Error());
        return true;
      },
    });
  }

  const api = {
    uid,
    context: base,
    lang: base.lang,
    get user() { return wrap('res.users', uid ? [uid] : []); },
    get company() { return wrap('res.company', companyIds.slice(0, 1)); },
    get companies() { return wrap('res.company', companyIds); },
    /** env.ref('base.main_company'): only records the user can read (check_object_reference raises otherwise). */
    async ref(xmlid) {
      const [module, ...rest] = xmlid.split('.');
      const [model, id] = await callKw('ir.model.data', 'check_object_reference', [module, rest.join('.'), true], {}, {});
      return wrap(model, [id]);
    },
  };
  const env = new Proxy(api, {
    get(target, prop) {
      if (typeof prop === 'symbol' || prop === 'then') return undefined;
      return prop in target ? target[prop] : wrap(prop, []);
    },
  });
  const Command = {
    create: (vals) => [0, 0, vals], update: (id, vals) => [1, id, vals], delete: (id) => [2, id, 0],
    unlink: (id) => [3, id, 0], link: (id) => [4, id, 0], clear: () => [5, 0, 0], set: (ids) => [6, 0, ids],
  };

  function plain(v, seen = new WeakSet(), depth = 0) {
    if (v instanceof Recordset) return { $recordset: v._name, ids: v.ids };
    if (v === undefined) return null;
    if (typeof v === 'bigint' || typeof v === 'function' || typeof v === 'symbol') return String(v);
    if (v === null || typeof v !== 'object') return v;
    if (v instanceof Date) return v.toISOString();
    if (v instanceof Error) return String(v);
    if (seen.has(v)) return '[Circular]';
    if (depth > 30) return '…';
    seen.add(v);
    const r = Array.isArray(v) ? v.map((x) => plain(x, seen, depth + 1))
      : Object.fromEntries(Object.entries(v).map(([k, x]) => [k, plain(x, seen, depth + 1)]));
    seen.delete(v);
    return r;
  }
  /** Awaits every field access / promise inside a value, so `return [rec.name, rec.state]` shows values.
   * Objects with nothing to await come back as they are (a cycle stays a cycle, for plain() to name). */
  async function settle(v, call = callKw, path = new Set()) {
    if (lazies.has(v)) { const { rs, path: fields } = lazies.get(v); return settle(await resolvePath(rs, fields, call), call, path); }
    if (v instanceof Promise) return settle(await v, call, path);
    if (v === null || typeof v !== 'object' || v instanceof Recordset || path.has(v)) return v;
    const isArray = Array.isArray(v);
    const proto = Object.getPrototypeOf(v);
    if (!isArray && proto !== Object.prototype && proto !== null) return v;
    path.add(v);
    let changed = false;
    const entries = [];
    for (const [k, x] of Object.entries(v)) { // in order: the calls log reads top to bottom
      const y = await settle(x, call, path);
      changed ||= y !== x;
      entries.push([k, y]);
    }
    path.delete(v);
    if (!changed) return v;
    return isArray ? entries.map(([, y]) => y) : Object.fromEntries(entries);
  }
  const pending = []; // print() is sync; the values it was given are settled before the run ends
  const print = (...args) => {
    const line = [];
    out.push(line);
    const p = settle(args).then((vals) => line.push(...vals.map((a) => plain(a))));
    p.catch(() => {}); // awaited (and reported) at the end of the run
    pending.push(p);
  };
  // Python habits: `a = 1` without const/let. Such names live in `locals`, never on window (where `name = …` or
  // `status = …` would overwrite the page's own globals). Names read before being set raise, as in Python.
  const BUILTINS = new Set(['Math', 'JSON', 'Date', 'Object', 'Array', 'Number', 'String', 'Boolean', 'Promise', 'Set', 'Map',
    'RegExp', 'Error', 'Symbol', 'BigInt', 'Intl', 'console', 'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'Infinity',
    'NaN', 'undefined', 'structuredClone', 'encodeURIComponent', 'decodeURIComponent', 'window', 'globalThis']);
  const locals = { env, print, Command };
  const scope = new Proxy(locals, {
    has: (_, key) => typeof key === 'string' && !BUILTINS.has(key),
    get(target, key) {
      if (key === Symbol.unscopables) return undefined;
      if (key in target) return target[key];
      if (key in globalThis) return globalThis[key]; // odoo, fetch, document…: read only through here
      throw new ReferenceError(`${String(key)} is not defined`);
    },
    set(target, key, v) { target[key] = v; return true; },
  });
  const done = (extra) => ({ out, calls, ms: Math.round(performance.now() - started), readonly, uid, ...extra });

  try {
    const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
    // `with` keeps line 1 of the code on line 1 of the body (HEADER_LINES); sloppy mode is what allows it
    const fn = new AsyncFunction('__scope', `with (__scope) { ${code}\n}\n//# sourceURL=${SOURCE}`);
    const value = await settle(await fn(scope));
    await Promise.all(pending);
    await chain; // assignments nothing awaited after them
    if (assignError) throw assignError;
    return done({ ok: true, value: value === undefined ? undefined : plain(value), hasValue: value !== undefined });
  } catch (e) {
    const at = String(e?.stack || '').match(new RegExp(`${SOURCE.replace('.', '\\.')}:(\\d+):(\\d+)`));
    return done({
      ok: false,
      error: {
        message: String(e?.message ?? e), name: e?.name || '', type: e?.type || '', traceback: e?.traceback || '',
        msgid: e?.msgid || '', args: e?.args || [], server: !!e?.server,
        line: at ? +at[1] - HEADER_LINES : null,
      },
    });
  }
}

/** Reloads the data of the view on screen, without reloading the page: Odoo's own `soft_reload` client action
 * (18 and 19), which restores the current controller - what web_refresher's button achieves. A form with unsaved
 * changes is saved first, as when leaving it. */
export async function pageSoftReload() {
  const N_ = (s) => s;
  const action = window.odoo?.__WOWL_DEBUG__?.root?.env?.services?.action;
  if (!action?.currentController) return { error: N_('No view to refresh on this page') };
  try {
    await action.doAction('soft_reload');
    return { ok: true };
  } catch (e) {
    return { error: String(e?.message || e) };
  }
}
