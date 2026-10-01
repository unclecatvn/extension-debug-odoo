// Pure helpers, no chrome.* / DOM: tested by tests/perf.test.mjs.

/** ir.profile sql entries → totals, repeated queries (N+1 suspects) and the slowest ones. */
export function sqlSummary(entries, n = 10) {
  const groups = new Map();
  for (const e of entries) {
    const g = groups.get(e.query) || { query: e.query, count: 0, time: 0, first: e };
    g.count++;
    g.time += e.time || 0;
    groups.set(e.query, g);
  }
  return {
    count: entries.length,
    time: entries.reduce((t, e) => t + (e.time || 0), 0),
    dups: [...groups.values()].filter((g) => g.count > 1).sort((a, b) => b.count - a.count || b.time - a.time).slice(0, n),
    slow: [...entries].sort((a, b) => (b.time || 0) - (a.time || 0)).slice(0, n),
  };
}

// the ORM and server, the libraries (site-packages, except a pip-installed odoo's addons) and Python's own (threading…)
const FRAMEWORK = /\/odoo\/(orm\/|tools\/|service\/|(models|fields|api|sql_db|http)\.py)|\/(site|dist)-packages\/(?!odoo\/addons)|\/lib\/python3[.\d]*\/(?!(site|dist)-packages\/)/;
/** Profiler stack ([file, line, func, code] frames) → the innermost frame outside the ORM/framework. */
export function appFrame(stack = []) {
  for (let i = stack.length - 1; i >= 0; i--) if (!FRAMEWORK.test(stack[i][0])) return stack[i];
  return stack[stack.length - 1] || null;
}

// Static files and the webclient's own plumbing: nothing to optimise in a module, hidden from the list by default.
const ASSET = /^\/(web\/(static|assets|image|content|manifest|service-worker|webclient\/(locale|translations))|bus\/websocket_worker_bundle)|\.(js|css|png|jpe?g|svg|ico|woff2?)(\?|$)/;
export const isAsset = (name) => ASSET.test(name);

/** What to look at first in a request of `duration` s with sqlSummary() `sum`: 'n1' (one query run ≥ 5×), 'fast'
 * (< 100 ms), 'sql' (the database takes half the time or more) or 'python'. */
export function diagnose(duration, sum) {
  if (sum.dups[0]?.count >= 5) return 'n1';
  if (duration < 0.1) return 'fast';
  return sum.time >= duration / 2 ? 'sql' : 'python';
}

/** "/usr/lib/python3/dist-packages/odoo/addons/sale/models/sale_order.py" → "sale/models/sale_order.py" (from the module,
 * custom addons paths too); a server file from odoo/ ("odoo/models.py"); anything else as it is. */
export const shortPath = (file) => (/\/[\w.-]*addons\//.test(file) ? file.replace(/^.*\/[\w.-]*addons\//, '') : file.replace(/^.*\/(?=odoo\/)/, ''));

/** A SQL query → what it does, for a sentence: op 'read' | 'create' | 'write' | 'delete' | 'other' and its main table. */
export function describeQuery(query = '') {
  const q = query.replace(/\s+/g, ' ');
  const m = /^\s*(?:WITH\b.*?\)\s*)?(SELECT|INSERT INTO|UPDATE|DELETE FROM)\b/i.exec(q);
  const op = { SELECT: 'read', 'INSERT INTO': 'create', UPDATE: 'write', 'DELETE FROM': 'delete' }[m?.[1].toUpperCase()] || 'other';
  const re = { read: /\bFROM\s+"?(\w+)"?/i, create: /\bINTO\s+"?(\w+)"?/i, write: /\bUPDATE\s+"?(\w+)"?/i, delete: /\bFROM\s+"?(\w+)"?/i }[op];
  return { op, table: re?.exec(m ? q.slice(m.index + m[0].length - m[1].length) : q)?.[1] || '' }; // after a WITH: the statement's own table
}

/** Where a request's time goes, per function outside the framework (appFrame() of each stack), slowest first: `time`
 * from the profiler's samples (`traces_async`: each lasts until the next one) or its queries if longer, `sql` / `count`
 * from the queries it ran, `frame` (its first line seen) and `path` (the functions outside the framework that called it). */
export function hotspots(samples = [], queries = [], n = 8) {
  const spots = new Map();
  const spot = (stack) => {
    const f = appFrame(stack);
    if (!f || FRAMEWORK.test(f[0])) return null; // only the framework (waiting, dispatching…): no module code to point at
    const key = `${f[0]}\0${f[2]}`;
    if (!spots.has(key)) spots.set(key, { frame: f, path: stack.filter((x) => x !== f && !FRAMEWORK.test(x[0])), sampled: 0, sql: 0, count: 0 });
    return spots.get(key);
  };
  samples.forEach((e, i) => {
    const next = samples[i + 1];
    const s = next && e.stack?.length ? spot(e.stack) : null;
    if (s) s.sampled += next.start - e.start;
  });
  for (const q of queries) {
    const s = spot(q.stack || []);
    if (s) { s.sql += q.time || 0; s.count++; }
  }
  return [...spots.values()].map((s) => ({ ...s, time: Math.max(s.sampled, s.sql) }))
    .sort((a, b) => b.time - a.time).slice(0, n);
}
