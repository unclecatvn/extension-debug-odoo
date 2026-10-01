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

const FRAMEWORK = /\/odoo\/(orm\/|tools\/|service\/|(models|fields|api|sql_db|http)\.py)|\/(site|dist)-packages\/(?!odoo\/addons)/;
/** Profiler stack ([file, line, func, code] frames) → the innermost frame outside the ORM/framework. */
export function appFrame(stack = []) {
  for (let i = stack.length - 1; i >= 0; i--) if (!FRAMEWORK.test(stack[i][0])) return stack[i];
  return stack[stack.length - 1] || null;
}
