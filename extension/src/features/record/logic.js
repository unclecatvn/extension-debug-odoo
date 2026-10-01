// Pure helpers, no chrome.* / DOM: tested by tests/record.test.mjs.

/** Field value → display string. */
export function fmtValue(v, type) {
  if (v === false && type !== 'boolean') return '';
  if (type === 'many2one' && Array.isArray(v)) return `${v[1]} (#${v[0]})`;
  if (Array.isArray(v)) return v.length > 20 ? `[${v.slice(0, 20).join(', ')}, …] (${v.length})` : `[${v.join(', ')}]`;
  if (v !== null && typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

/** fields_get (with depends) → Map field → fields recomputed when it changes (transitively, same model only). */
export function reverseDeps(fields) {
  const direct = new Map();
  for (const [name, f] of Object.entries(fields)) {
    for (const path of f.depends || []) {
      const head = path.split('.')[0];
      if (head === name || !(head in fields)) continue;
      if (!direct.has(head)) direct.set(head, new Set());
      direct.get(head).add(name);
    }
  }
  const out = new Map();
  for (const [name, kids] of direct) {
    const seen = new Set();
    const todo = [...kids];
    while (todo.length) {
      const x = todo.pop();
      if (x === name || seen.has(x)) continue;
      seen.add(x);
      todo.push(...(direct.get(x) || []));
    }
    out.set(name, [...seen].sort());
  }
  return out;
}
