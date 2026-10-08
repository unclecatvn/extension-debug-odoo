// Code tab, functions run IN the Odoo page (MAIN world): only each function's own source text reaches it (npm run
// check:page), no chrome.* (tsconfig.page.json). Arguments and results cross as JSON. Same in 18.0, 19.0 and 20.0: what
// differs (the public read methods, the @api.model ones, how rows are grouped) comes in as arguments (odoo/adapter.ts → orm).
/* eslint-disable @typescript-eslint/no-explicit-any */

/** The actual page identity expected by this run. It is checked again at the execution/refresh boundary. */
export interface RunPageIdentity { origin: string; url: string; loadedAt: number; model?: string | null; resId?: number | null }

export interface RunOptions {
  page?: RunPageIdentity;
  /** read: a writing call is refused · dry: it is listed, not sent · write: it is sent (committed at once) */
  mode: 'read' | 'dry' | 'write';
  /** the session's user context (lang, tz, companies) when the webclient's can't be read */
  context: Record<string, unknown>;
  uid: number | null;
  /** methods that only read (the rest writes), and the @api.model ones (called without ids): odoo/adapter.ts */
  readMethods: string[];
  modelMethods: string[];
  /** what read_group(domain, fields, groupby) calls: read_group as it is, or formatted_read_group (20), `fields` as
   * its aggregates */
  groupMethod: 'read_group' | 'formatted_read_group';
  /** the screen: its model, the record opened, the records selected → record / records / model */
  screen: { model: string | null; resId: number | null; ids: number[] };
}

export interface RunError {
  message: string; name: string; type: string; traceback: string; msgid: string; args: unknown[]; server: boolean; line: number | null;
}
export interface RunResult {
  ok: boolean;
  value?: unknown;
  hasValue?: boolean;
  error?: RunError;
  /** print(…) lines, each its values */
  out: unknown[][];
  calls: { model: string; method: string; args: string; kwargs: string; write: boolean; dry?: boolean; error?: string; ms: number }[];
  ms: number;
  mode: RunOptions['mode'];
  uid: number | null;
}

/**
 * Runs `code` (the body of an async function) with a small ORM over /web/dataset/call_kw, in the Odoo session: the
 * server applies the logged-in user's ACLs, record rules, field groups and companies to every call. The read-only and
 * dry modes stop a writing call before it is sent: a guard against slips, not a security boundary (the code runs with
 * the page's own JS rights; the server is what enforces access). → a RunResult, JSON-safe: recordsets as
 * { $recordset, ids }, the rows a read returned as { $rows: model, rows }, dates as { $datetime }.
 */
export async function pageRunCode(code: string, opts: RunOptions): Promise<RunResult> {
  const N_ = (s: string) => s; // error msgids, translated by the panel
  if (opts.page) {
    const expected = opts.page;
    const controller = window.odoo?.__WOWL_DEBUG__?.root?.env?.services?.action?.currentController;
    const props = controller?.props;
    const viewType = controller?.view?.type;
    const fallback = location.pathname.match(/\/odoo\/(?:.*\/)?([a-z0-9_]+\.[a-z0-9_.]+)\/(\d+)/);
    const currentModel = props?.resModel || controller?.action?.res_model || (!controller && fallback?.[1]) || null;
    const currentId = controller ? (viewType === 'form' ? controller.currentState?.resId : props?.resId) || null : Number(fallback?.[2]) || null;
    const changed = expected.origin !== location.origin || expected.url !== location.href || expected.loadedAt !== performance.timeOrigin
      || (expected.model ?? null) !== currentModel || (expected.resId ?? null) !== currentId;
    if (changed) throw new Error(N_('The screen changed before the run. Run again.'));
  }
  const { mode, context: fallback, uid: fallbackUid, screen } = opts;
  const READ = new Set(opts.readMethods);
  const MODEL_LEVEL = new Set(opts.modelMethods);
  const f = window.__odooDebugHook?.fetch || window.fetch; // unhooked: the RPC tab logs the page's calls, not ours
  const MAX_CALLS = 1000; // a loop gone wrong stops here instead of hammering the server
  const SOURCE = 'odoo-debug-code.js';
  const HEADER_LINES = 2; // lines V8 puts before the body of `new AsyncFunction(...)`
  const started = performance.now();
  const out: unknown[][] = [];
  const calls: RunResult['calls'] = [];

  let userContext: Record<string, unknown> | null = null;
  try { userContext = (window.odoo as any)?.loader?.modules?.get('@web/core/user')?.user?.context ?? null; } catch { /* webclient internals moved */ }
  const base: Record<string, any> = { ...(userContext || fallback) };
  const uid: number | null = (base.uid as number | undefined) ?? fallbackUid;
  const companyIds: number[] = (base.allowed_company_ids as number[] | undefined) || [];

  const fail = (msgid: string, args: unknown[], message: string) => Object.assign(new Error(message), { msgid, args });
  const blocked = (name: string) => fail(N_('%s writes: blocked in read-only mode (choose "Dry run" or "Allow writes")'), [name], `${name} writes: blocked in read-only mode`);
  const short = (v: unknown) => { try { const s = JSON.stringify(v) ?? ''; return s.length > 300 ? `${s.slice(0, 300)}…` : s; } catch { return String(v); } };
  const rowsOf = new WeakMap<object, string>(); // the rows a read returned → their model ({ $rows } when shown)
  let fakeId = 0; // dry run: what create() answers (negative: no record has it)

  // Every call goes out in the order the code issued it, one at a time: `rec.state = 'sent'` (a write the code cannot
  // await) is then sent before the next read. A failed assignment fails every later call, and the run.
  let chain: Promise<unknown> = Promise.resolve();
  let assignError: Error | null = null;
  function callKw(model: string, method: string, args: unknown[], kwargs: Record<string, unknown>, ctx: Record<string, unknown>): Promise<any> {
    const p = chain.then(() => send(model, method, args, kwargs, ctx));
    chain = p.catch(() => {});
    return p;
  }

  /** One call_kw, right now (callKw queues it). A writing call: refused (read), listed and answered without the server
   * (dry), or sent (write). */
  async function send(model: string, method: string, args: unknown[], kwargs: Record<string, unknown>, ctx: Record<string, unknown>): Promise<any> {
    if (assignError) throw assignError;
    const name = `${model}.${method}`;
    const write = !READ.has(method);
    if (write && mode === 'read') throw blocked(name);
    if (calls.length >= MAX_CALLS) throw fail(N_('Stopped after %s calls'), [MAX_CALLS], `Stopped after ${MAX_CALLS} calls`);
    const entry: RunResult['calls'][number] = { model, method, args: short(args), kwargs: short(kwargs), write, ms: 0 };
    calls.push(entry);
    if (write && mode === 'dry') {
      entry.dry = true;
      if (method === 'create') { const n = Array.isArray(args[0]) ? args[0].length : 1; const ids = Array.from({ length: n }, () => --fakeId); return Array.isArray(args[0]) ? ids : ids[0]; }
      if (method === 'copy') return --fakeId;
      return method === 'write' || method === 'unlink' ? true : null;
    }
    if (write) values.clear(); // field values read before a write may be stale after it
    const t = performance.now();
    try {
      const r = await f(`/web/dataset/call_kw/${model}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0', method: 'call', id: Date.now(),
          params: { model, method, args, kwargs: { ...kwargs, context: { ...base, ...ctx, ...(kwargs.context as object | undefined) } } },
        }),
      });
      const j = await r.json() as { result?: unknown; error?: { message: string; data?: { message?: string; debug?: string; name?: string } } };
      if (j.error) {
        const d = j.error.data || {};
        entry.error = d.message || j.error.message;
        throw Object.assign(new Error(entry.error), { traceback: d.debug, type: d.name, server: true });
      }
      const res: any = j.result;
      if (method === 'read' || method === 'search_read') if (Array.isArray(res)) rowsOf.set(res, model);
      if (method === 'web_search_read' && res && Array.isArray(res.records)) rowsOf.set(res.records, model);
      return res;
    } finally {
      entry.ms = Math.round(performance.now() - t);
      if (write) values.clear();
    }
  }

  const RELATIONAL = ['many2one', 'one2many', 'many2many'];
  const NUMERIC = ['integer', 'float', 'monetary'];
  const values = new Map<string, Map<number, Record<string, unknown>>>(); // "model context" → id → fields read this run
  const fieldCache = new Map<string, { type: string; relation?: string } | undefined>();
  type Caller = (model: string, method: string, args: unknown[], kwargs: Record<string, unknown>, ctx: Record<string, unknown>) => Promise<any>;
  async function fieldInfo(rs: any, name: string, call: Caller = callKw) {
    const key = `${rs._name} ${name}`;
    if (!fieldCache.has(key)) fieldCache.set(key, (await call(rs._name, 'fields_get', [[name]], { attributes: ['type', 'relation'] }, rs._context))[name]);
    const info = fieldCache.get(key);
    if (!info) throw fail(N_('%s has no field %s'), [rs._name, name], `${rs._name} has no field ${name}`);
    return info;
  }

  /** A field of a singleton, like rec.state in Python: read once for every record of its prefetch group (the recordset
   * it was iterated from), then served from `values` until something writes. */
  async function fieldValue(rs: any, name: string, call: Caller = callKw): Promise<unknown> {
    const key = `${rs._name} ${JSON.stringify(rs._context)}`;
    if (!values.has(key)) values.set(key, new Map());
    const cache = values.get(key)!;
    const id = rs._ids[0] as number;
    const has = (x: number) => cache.has(x) && name in cache.get(x)!;
    if (!has(id)) {
      const group = [id, ...(rs._prefetch as number[]).filter((x) => x !== id && !has(x))].slice(0, 1000);
      const read = (ids: number[]) => call(rs._name, 'read', [ids], { fields: [name], load: false }, rs._context);
      let rows: Record<string, unknown>[];
      try { rows = await read(group); } catch (e) {
        if (group.length === 1) throw e;
        rows = await read([id]); // one record of the group may be unreadable: only this one has to be
      }
      for (const row of rows) cache.set(row.id as number, { ...cache.get(row.id as number), [name]: row[name] });
    }
    return cache.get(id)![name];
  }

  /** rec.partner_id.country_id.code: each hop on a single record (Expected singleton otherwise, as in Python).
   * Relational end → recordset, other fields → value; on an empty recordset → false / 0 / an empty recordset. */
  async function resolvePath(rs: any, path: string[], call: Caller = callKw): Promise<unknown> {
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
      cur = wrap(info.relation!, info.type === 'many2one' ? (v ? [v as number] : []) : (v as number[]) || [], cur._context);
    }
    return cur;
  }

  const lazies = new WeakMap<object, { rs: any; path: string[] }>(); // lazy → what it reads, for settle()

  /** rec.state = 'sent' → write({ state: 'sent' }) on rec, like in Python (rec.partner_id.name = … writes the partner).
   * Queued at once, in order with every other call; its error surfaces at the next call or at the end of the run,
   * reported at the line of the assignment (`origin`). */
  function assign(rs: any, path: string[], name: string, value: unknown, origin: Error) {
    const label = `${rs._name}.${[...path, name].join('.')}`;
    if (mode === 'read') throw blocked(label);
    values.clear(); // a read issued after this line must not be served what was read before it
    chain = chain.then(async () => {
      const target: any = path.length ? await resolvePath(rs, path, send) : rs;
      if (!(target instanceof Recordset)) throw fail(N_('%s.%s is not relational'), [rs._name, path.join('.')], `${label}: not a recordset`);
      if (!target.length) return;
      let v: unknown = await settle(value, send);
      if (v instanceof Recordset) { // rec.partner_id = partner / rec.tag_ids = tags
        const info = await fieldInfo(target, name, send);
        v = info.type === 'many2one' ? v.id : RELATIONAL.includes(info.type) ? [[6, 0, v.ids]] : v.id;
      }
      await send(target._name, 'write', [target.ids, { [name]: plain(v) }], {}, target._context);
    }).catch((e: Error) => {
      e.stack = `${e.stack}\n${origin.stack}`; // the line of the assignment, not of the queue
      assignError ??= e;
    });
  }

  /** What `rec.x` is when x is not a Recordset member: a field when awaited (`await rec.state`, or returned / printed),
   * a method when called (`await rec.action_confirm()`), and a longer path when followed (`rec.partner_id.name`). */
  function lazy(rs: any, path: string[]): any {
    const label = `${rs._name}.${path.join('.')}`;
    const p: any = new Proxy(function field() {}, {
      get(_, prop) {
        if (prop === 'then') return (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) => resolvePath(rs, path).then(ok, ko);
        if (prop === Symbol.toPrimitive || prop === 'toString' || prop === 'valueOf') {
          return () => { throw fail(N_('%s is read from the server: await it first'), [label], `${label} is read from the server: await it before using its value`); };
        }
        if (typeof prop === 'symbol' || prop === 'toJSON') return undefined;
        return lazy(rs, [...path, prop]);
      },
      set(_, prop, value) {
        if (typeof prop === 'symbol') return false;
        assign(rs, path, prop, value, new Error());
        return true;
      },
      async apply(_, __, args: unknown[]) {
        const target: any = path.length > 1 ? await resolvePath(rs, path.slice(0, -1)) : rs;
        const method = path[path.length - 1]!;
        if (!(target instanceof Recordset)) {
          throw fail(N_('%s.%s is not relational'), [rs._name, path.slice(0, -1).join('.')], `${label}: not a recordset`);
        }
        return typeof (target as any)[method] === 'function' && method in target ? (target as any)[method](...args) : target.call(method, args);
      },
    });
    lazies.set(p, { rs, path });
    return p;
  }

  class Recordset {
    _name: string;
    _ids: number[];
    _context: Record<string, unknown>;
    _prefetch: number[];
    _root: boolean;
    constructor(model: string, ids: number[], context: Record<string, unknown>, prefetch: number[] | null, root = false) {
      this._name = model;
      this._ids = ids;
      this._context = context;
      this._prefetch = prefetch || ids;
      this._root = root; // env['x'] itself (and its with_context), not an empty search / browse result
    }
    /** for (const rec of rs): singletons sharing rs as their prefetch group (one read per field for all of them). */
    *[Symbol.iterator]() { for (const id of this._ids) yield wrap(this._name, [id], this._context, this._ids); }
    get ids() { return [...this._ids]; }
    get id() { return this._ids[0] ?? false; }
    get length() { return this._ids.length; }
    get context() { return { ...base, ...this._context }; }
    toString() { return `${this._name}(${this._ids.join(', ')})`; }
    _model(method: string, args: unknown[] = [], kwargs: Record<string, unknown> = {}) { return callKw(this._name, method, args, kwargs, this._context); }
    _records(method: string, args: unknown[] = [], kwargs: Record<string, unknown> = {}) { return callKw(this._name, method, [this._ids, ...args], kwargs, this._context); }

    browse(ids: number | number[] = []) {
      const list = (Array.isArray(ids) ? ids : [ids]).filter((id) => id || id === 0);
      return wrap(this._name, list, this._context);
    }
    with_context(ctx: Record<string, unknown> = {}) { return wrap(this._name, this._ids, { ...this._context, ...ctx }, null, this._root); }
    ensure_one() {
      if (this._ids.length !== 1) throw fail(N_('Expected singleton: %s'), [String(this)], `Expected singleton: ${this}`);
      return this;
    }
    /** Any public method: on the model for env['x'] itself or a known @api.model method, else on these records. */
    call(method: string, args: unknown[] = [], kwargs: Record<string, unknown> = {}) {
      return MODEL_LEVEL.has(method) || this._root ? this._model(method, args, kwargs) : this._records(method, args, kwargs);
    }
    async search(domain: unknown[] = [], kwargs: Record<string, unknown> = {}) { return this.browse(await this._model('search', [domain], kwargs)); }
    search_read(domain: unknown[] = [], fields?: string[], kwargs: Record<string, unknown> = {}) { return this._model('search_read', [domain], { ...(fields && { fields }), ...kwargs }); }
    search_count(domain: unknown[] = [], kwargs: Record<string, unknown> = {}) { return this._model('search_count', [domain], kwargs); }
    read(fields?: string[], kwargs: Record<string, unknown> = {}) { return this._records('read', [], { ...(fields && { fields }), ...kwargs }); }
    read_group(domain: unknown[], fields: string[], groupby: string[], kwargs: Record<string, unknown> = {}) {
      return opts.groupMethod === 'formatted_read_group' ? this._model('formatted_read_group', [domain], { groupby, aggregates: fields, ...kwargs })
        : this._model('read_group', [domain, fields, groupby], kwargs);
    }
    fields_get(allfields?: string[], attributes?: string[]) {
      return this._model('fields_get', [], { ...(allfields && { allfields }), ...(attributes && { attributes }) });
    }
    name_search(name = '', kwargs: Record<string, unknown> = {}) { return this._model('name_search', [], { name, ...kwargs }); }
    async create(vals: unknown) { return this.browse(await this._model('create', [vals])); }
    write(vals: Record<string, unknown>) { return this._records('write', [vals]); }
    unlink() { return this._records('unlink'); }
    async copy(defaults?: Record<string, unknown>) { return this.browse(await this._records('copy', [], defaults ? { default: defaults } : {})); }
    exists() { return this.filtered_domain([]); } // exists is @api.private: not callable over RPC
    async filtered_domain(domain: unknown[]) {
      if (!this._ids.length) return this;
      const found = new Set<number>(await this._model('search', [[['id', 'in', this._ids], ...domain]], { context: { active_test: false } }));
      return this.browse(this._ids.filter((id) => found.has(id)));
    }
    /** mapped('partner_id.country_id.code'): reads hop by hop. Relational end → recordset (deduplicated), else values. */
    async mapped(path: string): Promise<unknown> {
      let rs: any = this;
      const parts = path.split('.');
      for (const [i, name] of parts.entries()) {
        const last = i === parts.length - 1;
        const info = await fieldInfo(rs, name);
        const relational = RELATIONAL.includes(info.type);
        if (!relational && !last) throw fail(N_('%s.%s is not relational'), [rs._name, name], `${rs._name}.${name} is not relational`);
        const rows: Record<string, unknown>[] = rs._ids.length ? await rs._records('read', [], { fields: [name], load: false }) : [];
        if (!relational) return rows.map((r) => r[name]);
        const ids = new Set<number>();
        for (const r of rows) for (const id of info.type === 'many2one' ? [r[name]] : (r[name] as number[])) if (id) ids.add(id as number);
        rs = wrap(info.relation!, [...ids], rs._context);
      }
      return rs;
    }
  }

  /** Unknown attributes are fields or methods (see lazy): `await so.state`, `await so.action_confirm()`. */
  function wrap(model: string, ids: number[], context: Record<string, unknown> = {}, prefetch: number[] | null = null, root = false): any {
    const rs = new Recordset(model, ids, context, prefetch, root);
    return new Proxy(rs, {
      get(target, prop, receiver) {
        if (typeof prop === 'symbol' || prop in target) return Reflect.get(target, prop, receiver);
        if (prop === 'then' || prop === 'toJSON' || prop.startsWith('_')) return undefined; // `await rs` must not call the server
        return lazy(receiver, [prop]);
      },
      set(target, prop, value, receiver) {
        if (typeof prop === 'symbol' || prop in target || prop.startsWith('_')) throw new TypeError(`${String(prop)} cannot be assigned on a recordset`);
        assign(receiver, [], prop, value, new Error());
        return true;
      },
    });
  }

  const api: Record<string, unknown> = {
    uid,
    context: base,
    lang: base.lang,
    get user() { return wrap('res.users', uid ? [uid] : []); },
    get company() { return wrap('res.company', companyIds.slice(0, 1)); },
    get companies() { return wrap('res.company', companyIds); },
    /** env.ref('base.main_company'): only records the user can read (check_object_reference raises otherwise). */
    async ref(xmlid: string) {
      const [module, ...rest] = xmlid.split('.');
      const [model, id] = await callKw('ir.model.data', 'check_object_reference', [module, rest.join('.'), true], {}, {}) as [string, number];
      return wrap(model, [id]);
    },
  };
  const env = new Proxy(api, {
    get(target, prop) {
      if (typeof prop === 'symbol' || prop === 'then') return undefined;
      return prop in target ? target[prop] : wrap(prop, [], {}, null, true);
    },
  });
  const Command = {
    create: (vals: unknown) => [0, 0, vals], update: (id: number, vals: unknown) => [1, id, vals], delete: (id: number) => [2, id, 0],
    unlink: (id: number) => [3, id, 0], link: (id: number) => [4, id, 0], clear: () => [5, 0, 0], set: (ids: number[]) => [6, 0, ids],
  };

  function plain(v: unknown, seen = new WeakSet<object>(), depth = 0): unknown {
    if (v instanceof Recordset) return { $recordset: v._name, ids: v.ids };
    if (v === undefined) return null;
    if (typeof v === 'bigint' || typeof v === 'function' || typeof v === 'symbol') return String(v);
    if (v === null || typeof v !== 'object') return v;
    if (v instanceof Date) return { $datetime: v.toISOString().replace('T', ' ').slice(0, 19) };
    if (v instanceof Error) return String(v);
    if (seen.has(v)) return '[Circular]';
    if (depth > 30) return '…';
    seen.add(v);
    const r = Array.isArray(v) ? v.map((x) => plain(x, seen, depth + 1))
      : Object.fromEntries(Object.entries(v).map(([k, x]) => [k, plain(x, seen, depth + 1)]));
    seen.delete(v);
    const model = rowsOf.get(v);
    return model && Array.isArray(r) ? { $rows: model, rows: r } : r;
  }
  /** Awaits every field access / promise inside a value, so `return [rec.name, rec.state]` shows values. Objects with
   * nothing to await come back as they are (the rows of a read keep their model: rowsOf). */
  async function settle(v: unknown, call: Caller = callKw, path = new Set<object>()): Promise<unknown> {
    if (v && (typeof v === 'object' || typeof v === 'function') && lazies.has(v)) { const { rs, path: fields } = lazies.get(v)!; return settle(await resolvePath(rs, fields, call), call, path); }
    if (v instanceof Promise) return settle(await v, call, path);
    if (v === null || typeof v !== 'object' || v instanceof Recordset || path.has(v)) return v;
    const isArray = Array.isArray(v);
    const proto = Object.getPrototypeOf(v);
    if (!isArray && proto !== Object.prototype && proto !== null) return v;
    path.add(v);
    let changed = false;
    const entries: [string, unknown][] = [];
    for (const [k, x] of Object.entries(v)) { // in order: the calls log reads top to bottom
      const y = await settle(x, call, path);
      changed ||= y !== x;
      entries.push([k, y]);
    }
    path.delete(v);
    if (!changed) return v;
    const copy = isArray ? entries.map(([, y]) => y) : Object.fromEntries(entries);
    const model = rowsOf.get(v);
    if (model) rowsOf.set(copy, model);
    return copy;
  }
  const pending: Promise<unknown>[] = []; // print() is sync; the values it was given are settled before the run ends
  const print = (...args: unknown[]) => {
    const line: unknown[] = [];
    out.push(line);
    const p = settle(args).then((vals) => { line.push(...(vals as unknown[]).map((a) => plain(a))); });
    p.catch(() => {}); // awaited (and reported) at the end of the run
    pending.push(p);
  };

  // the screen, as a server action sees it: model (env[model]), record (the one opened), records (the ones selected)
  const scr = screen.model ? {
    model: wrap(screen.model, [], {}, null, true),
    record: wrap(screen.model, screen.resId ? [screen.resId] : []),
    records: wrap(screen.model, screen.ids.length ? screen.ids : screen.resId ? [screen.resId] : []),
  } : { model: null, record: null, records: null };

  // Python habits: `a = 1` without const/let. Such names live in `locals`, never on window (where `name = …` or
  // `status = …` would overwrite the page's own globals). Names read before being set raise, as in Python.
  const BUILTINS = new Set(['Math', 'JSON', 'Date', 'Object', 'Array', 'Number', 'String', 'Boolean', 'Promise', 'Set', 'Map',
    'RegExp', 'Error', 'Symbol', 'BigInt', 'Intl', 'console', 'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'Infinity',
    'NaN', 'undefined', 'structuredClone', 'encodeURIComponent', 'decodeURIComponent', 'window', 'globalThis']);
  const locals: Record<string, unknown> = { env, print, Command, ...scr };
  const scope = new Proxy(locals, {
    has: (_, key) => typeof key === 'string' && !BUILTINS.has(key),
    get(target, key) {
      if (key === Symbol.unscopables) return undefined;
      if (typeof key === 'symbol') return undefined;
      if (key in target) return target[key];
      if (key in globalThis) return (globalThis as any)[key]; // odoo, fetch, document…: read only through here
      throw new ReferenceError(`${String(key)} is not defined`);
    },
    set(target, key, v) { if (typeof key === 'string') target[key] = v; return true; },
  });
  const done = (extra: Partial<RunResult>): RunResult => ({ ok: false, out, calls, ms: Math.round(performance.now() - started), mode, uid, ...extra });

  try {
    const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as new (...a: string[]) => (s: unknown) => Promise<unknown>;
    // `with` keeps line 1 of the code on line 1 of the body (HEADER_LINES); sloppy mode is what allows it
    const fn = new AsyncFunction('__scope', `with (__scope) { ${code}\n}\n//# sourceURL=${SOURCE}`);
    const value = await settle(await fn(scope));
    await Promise.all(pending);
    await chain; // assignments nothing awaited after them
    if (assignError) throw assignError;
    return done({ ok: true, value: value === undefined ? null : plain(value), hasValue: value !== undefined });
  } catch (err) {
    const e = err as Error & { type?: string; traceback?: string; msgid?: string; args?: unknown[]; server?: boolean };
    const at = String(e?.stack || '').match(new RegExp(`${SOURCE.replace('.', '\\.')}:(\\d+):(\\d+)`));
    return done({
      ok: false,
      error: {
        message: String(e?.message ?? e), name: e?.name || '', type: e?.type || '', traceback: e?.traceback || '',
        msgid: e?.msgid || '', args: e?.args || [], server: !!e?.server, line: at ? Number(at[1]) - HEADER_LINES : null,
      },
    });
  }
}

/** Reloads the data of the view on screen, without reloading the page: Odoo's own `soft_reload` client action (18 and
 * 19). A form with unsaved changes is saved first, as when leaving it. */
export async function pageSoftReload(expected: RunPageIdentity): Promise<{ ok: true } | { error: string }> {
  const N_ = (s: string) => s;
  const controller = window.odoo?.__WOWL_DEBUG__?.root?.env?.services?.action?.currentController;
  const props = controller?.props;
  const viewType = controller?.view?.type;
  const fallback = location.pathname.match(/\/odoo\/(?:.*\/)?([a-z0-9_]+\.[a-z0-9_.]+)\/(\d+)/);
  const currentModel = props?.resModel || controller?.action?.res_model || (!controller && fallback?.[1]) || null;
  const currentId = controller ? (viewType === 'form' ? controller.currentState?.resId : props?.resId) || null : Number(fallback?.[2]) || null;
  const changed = expected.origin !== location.origin || expected.url !== location.href || expected.loadedAt !== performance.timeOrigin
    || (expected.model ?? null) !== currentModel || (expected.resId ?? null) !== currentId;
  if (changed) return { error: N_('The screen changed during the run, so it was not refreshed.') };
  const action = (window.odoo as any)?.__WOWL_DEBUG__?.root?.env?.services?.action;
  if (!action?.currentController) return { error: N_('No view to refresh on this page') };
  try {
    await action.doAction('soft_reload');
    return { ok: true };
  } catch (e) {
    return { error: String((e as Error)?.message || e) };
  }
}
