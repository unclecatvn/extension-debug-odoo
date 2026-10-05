// Perf tab: the pure part (no chrome.*, no DOM), unit-tested. What Odoo's profiler (odoo/tools/profiler.py, the same in
// 18.0 and 19.0) records per request — ir.profile.sql, a JSON list of { query, full_query, time, start, stack } —
// summed up, grouped by query (the N+1 suspects) and by the line of code sending them, and two requests compared.

/** A stack frame as the profiler writes it: [file, line, function, code]. */
export type Frame = [string, number, string, string?];

/** One SQL query of a profile. `query`: the statement with its placeholders (the same for every call of one loop);
 * `full_query`: with the values. `time` in seconds. */
export interface SqlEntry { query: string; full_query?: string; time?: number; start?: number; stack?: Frame[] }

/** ir.profile, the columns of the list (cpu_duration: 19.0 only). Durations in seconds. */
export interface ProfileRow {
  id: number;
  name: string;
  session: string;
  duration: number;
  cpu_duration?: number;
  sql_count: number;
  create_date: string | false;
}

/** "/web/dataset/call_kw/res.users/web_read?" → the method and model, as the RPC tab names them; any other route as
 * it is (its query string kept when it has one). */
export function requestName(name: string): { method: string; model: string } | { route: string } {
  const m = /\/web\/dataset\/call_kw\/([^/?]+)\/([^/?]+)/.exec(name);
  return m ? { method: m[2]!, model: m[1]! } : { route: name.replace(/\?$/, '') };
}

/** The panel's own requests while profiling (it reads through the page's session, its URL marked: odoo/rpc.ts →
 * PANEL_MARK): left out of the list. */
export const isOwnRequest = (name: string) => /[?&]odoo_debug_panel=1(&|$)/.test(name);

/** A profile session is "<date time> <user name>" (profiler.make_session): whether it is this user's. */
export const isSessionOf = (session: string, userName: string) => session.endsWith(` ${userName}`);
/** "2026-10-02 09:14:03 Mitchell Admin" → "09:14:03" (the day when not `today`). */
export function sessionLabel(session: string, today: string): string {
  const [day, time] = session.split(' ');
  return day === today ? time ?? session : `${day} ${time ?? ''}`.trim();
}

/** The same statement, whatever the spacing: what groups the queries of one loop. */
export const normalizeQuery = (q: string) => q.replace(/\s+/g, ' ').trim();

// the ORM and server, the libraries (site-packages, except a pip-installed odoo's addons) and Python's own (threading…,
// and the modules frozen into the interpreter since 3.11: "<frozen genericpath>")
const FRAMEWORK = /\/odoo\/(orm\/|tools\/|service\/|modules\/|(models|fields|api|sql_db|http|osv\/\w+)\.py)|\/(site|dist)-packages\/(?!odoo\/addons)|\/lib\/python3[.\d]*\/(?!(site|dist)-packages\/)|^<frozen /;
/** The innermost frame outside the ORM and the framework: the line of an addon that caused the query. */
export function appFrame(stack: readonly Frame[] = []): Frame | null {
  for (let i = stack.length - 1; i >= 0; i--) if (!FRAMEWORK.test(stack[i]![0])) return stack[i]!;
  return stack[stack.length - 1] ?? null;
}
/** The caller of queries no addon sent (the stack is all framework: the request itself, the registry…). */
export const FRAMEWORK_CALLER = '(framework)';
/** The line of an addon that sent a query, or FRAMEWORK_CALLER. */
export function callerOf(stack: readonly Frame[] = []): string {
  for (let i = stack.length - 1; i >= 0; i--) if (!FRAMEWORK.test(stack[i]![0])) return frameText(stack[i]!);
  return FRAMEWORK_CALLER;
}
/** ".../odoo/addons/sale/models/sale_order.py" → "sale/models/sale_order.py" (the addon and its path). */
export const shortFile = (file: string) => file.replace(/^.*?\/(?:odoo\/)?addons\/|^.*?\/odoo\//, '');
export const frameText = (f: Frame | null) => (f ? `${shortFile(f[0])}:${f[1]} ${f[2]}()` : '');

export interface QueryGroup { query: string; count: number; time: number; first: SqlEntry; callers: string[] }
export interface CallerGroup { caller: string; frame: Frame | null; count: number; time: number; queries: number }
export interface SqlSummary {
  count: number;
  /** seconds spent in SQL */
  time: number;
  /** statements run more than once, the most repeated first: N+1 suspects */
  repeated: QueryGroup[];
  /** the lines of code sending the most queries */
  callers: CallerGroup[];
  slowest: SqlEntry[];
}

export function sqlSummary(entries: readonly SqlEntry[], n = 15): SqlSummary {
  const byQuery = new Map<string, QueryGroup>();
  const byCaller = new Map<string, CallerGroup & { set: Set<string> }>();
  for (const e of entries) {
    const q = normalizeQuery(e.query);
    const caller = callerOf(e.stack);
    const f = caller === FRAMEWORK_CALLER ? null : appFrame(e.stack);
    const g = byQuery.get(q) ?? { query: q, count: 0, time: 0, first: e, callers: [] };
    g.count++;
    g.time += e.time ?? 0;
    if (!g.callers.includes(caller)) g.callers.push(caller);
    byQuery.set(q, g);
    const c = byCaller.get(caller) ?? { caller, frame: f, count: 0, time: 0, queries: 0, set: new Set<string>() };
    c.count++;
    c.time += e.time ?? 0;
    c.set.add(q);
    byCaller.set(caller, c);
  }
  return {
    count: entries.length,
    time: entries.reduce((t, e) => t + (e.time ?? 0), 0),
    repeated: [...byQuery.values()].filter((g) => g.count > 1).sort((a, b) => b.count - a.count || b.time - a.time).slice(0, n),
    callers: [...byCaller.values()].map(({ set, ...c }) => ({ ...c, queries: set.size }))
      .sort((a, b) => b.count - a.count || b.time - a.time).slice(0, n),
    slowest: [...entries].sort((a, b) => (b.time ?? 0) - (a.time ?? 0)).slice(0, n),
  };
}

/** ir.profile.sql (JSON text) → its entries; [] when absent or not JSON. */
export function parseSql(text: string | false | null | undefined): SqlEntry[] {
  if (!text) return [];
  try {
    const v = JSON.parse(text) as unknown;
    return Array.isArray(v) ? v.filter((e): e is SqlEntry => !!e && typeof (e as SqlEntry).query === 'string') : [];
  } catch { return []; }
}

/** A request against a baseline (before / after a fix): what changed, and the repeated statements gone, new or still
 * there (with their counts before → after). */
export interface Comparison {
  sql: [number, number];
  duration: [number, number];
  sqlTime: [number, number];
  gone: QueryGroup[];
  added: QueryGroup[];
  kept: { query: string; before: number; after: number }[];
}
export function compare(base: { row: ProfileRow; sum: SqlSummary }, other: { row: ProfileRow; sum: SqlSummary }): Comparison {
  const before = new Map(base.sum.repeated.map((g) => [g.query, g]));
  const after = new Map(other.sum.repeated.map((g) => [g.query, g]));
  return {
    sql: [base.row.sql_count, other.row.sql_count],
    duration: [base.row.duration, other.row.duration],
    sqlTime: [base.sum.time, other.sum.time],
    gone: [...before.values()].filter((g) => !after.has(g.query)),
    added: [...after.values()].filter((g) => !before.has(g.query)),
    kept: [...after.values()].filter((g) => before.has(g.query)).map((g) => ({ query: g.query, before: before.get(g.query)!.count, after: g.count })),
  };
}

/** One sample of the profiler's Python stacks (ir.profile.traces_async): when (s), and the stack then. */
export interface Sample { start: number; stack?: Frame[] }

/** ir.profile.traces_async (JSON text) → its samples; [] when absent or not JSON. */
export function parseSamples(text: string | false | null | undefined): Sample[] {
  if (!text) return [];
  try {
    const v = JSON.parse(text) as unknown;
    return Array.isArray(v) ? v.filter((e): e is Sample => !!e && typeof (e as Sample).start === 'number') : [];
  } catch { return []; }
}

// Static files and the webclient's own plumbing: nothing to optimise in a module, out of the list unless asked.
const ASSET = /^\/(web\/(static|assets|image|content|manifest|service-worker|webclient\/(locale|translations))|bus\/websocket_worker_bundle)|\.(js|css|png|jpe?g|svg|ico|woff2?)(\?|$)/;
export const isAsset = (name: string) => ASSET.test(name);

/** What to look at first in a request of `duration` s: 'n1' (one statement run 5× or more: it grows with the
 * records, even when fast), 'fast' (< 100 ms), 'sql' (the database takes half the time or more) or 'python'. */
export type Diagnosis = 'n1' | 'fast' | 'sql' | 'python';
export function diagnose(duration: number, sum: SqlSummary): Diagnosis {
  if ((sum.repeated[0]?.count ?? 0) >= 5) return 'n1';
  if (duration < 0.1) return 'fast';
  return sum.time >= duration / 2 ? 'sql' : 'python';
}

/** A SQL statement → what it does, for a sentence: op 'read' | 'create' | 'write' | 'delete' | 'other' and its table. */
export function describeQuery(query = ''): { op: 'read' | 'create' | 'write' | 'delete' | 'other'; table: string } {
  const q = query.replace(/\s+/g, ' ');
  const m = /^\s*(?:WITH\b.*?\)\s*)?(SELECT|INSERT INTO|UPDATE|DELETE FROM)\b/i.exec(q);
  const ops = { SELECT: 'read', 'INSERT INTO': 'create', UPDATE: 'write', 'DELETE FROM': 'delete' } as const;
  const op = m ? ops[m[1]!.toUpperCase() as keyof typeof ops] : 'other';
  const re = { read: /\bFROM\s+"?(\w+)"?/i, create: /\bINTO\s+"?(\w+)"?/i, write: /\bUPDATE\s+"?(\w+)"?/i, delete: /\bFROM\s+"?(\w+)"?/i, other: null }[op];
  const from = m ? q.slice(m.index + m[0].length - m[1]!.length) : q; // after a WITH: the statement's own table
  return { op, table: re?.exec(from)?.[1] ?? '' };
}

/** A function of the modules a request spent time in: its frame (first line seen), the module functions above it
 * (`path`), the time from the Python samples (`sampled`) and from the queries it ran (`sql`, `count`), `time` the
 * larger of the two. */
export interface Hotspot { frame: Frame; path: Frame[]; sampled: number; sql: number; count: number; time: number }
/** Where a request's time goes, per function outside the framework (appFrame() of each stack), slowest first: a sample
 * lasts until the next one; the queries add their time to the function that ran them. */
export function hotspots(samples: readonly Sample[] = [], queries: readonly SqlEntry[] = [], n = 8): Hotspot[] {
  const spots = new Map<string, Omit<Hotspot, 'time'>>();
  const spot = (stack: readonly Frame[]) => {
    const f = appFrame(stack);
    if (!f || FRAMEWORK.test(f[0])) return null; // only the framework (waiting, dispatching…): no module code to point at
    const key = `${f[0]}\0${f[2]}`;
    if (!spots.has(key)) spots.set(key, { frame: f, path: stack.filter((x) => x !== f && !FRAMEWORK.test(x[0])), sampled: 0, sql: 0, count: 0 });
    return spots.get(key)!;
  };
  samples.forEach((e, i) => {
    const next = samples[i + 1];
    const s = next && e.stack?.length ? spot(e.stack) : null;
    if (s) s.sampled += next!.start - e.start;
  });
  for (const q of queries) {
    const s = spot(q.stack ?? []);
    if (s) { s.sql += q.time ?? 0; s.count++; }
  }
  return [...spots.values()].map((s) => ({ ...s, time: Math.max(s.sampled, s.sql) })).sort((a, b) => b.time - a.time).slice(0, n);
}

/** Seconds → "12 ms" / "1.24 s". */
export const ms = (s: number | undefined) => { const v = (s ?? 0) * 1000; return v >= 1000 ? `${(v / 1000).toFixed(2)} s` : `${Math.round(v)} ms`; };
/** A change as "+3" / "−12" / "±0". */
export const delta = (a: number, b: number, fmt: (x: number) => string = String) => (b === a ? '±0' : `${b > a ? '+' : '−'}${fmt(Math.abs(b - a))}`);
