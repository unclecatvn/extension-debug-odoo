// Pure helpers, no chrome.* / DOM: tested by tests/code.test.mjs.

export const MAX_ROWS = 500; // table rows shown; the raw JSON below it still has everything

/** localStorage key of the editor's code for an Odoo origin (scheme + host + port: two ports are two servers). */
export const codeKey = (origin) => `odoo-debug-orm-code:${origin || ''}`;

export const isRecordset = (v) => !!v && typeof v === 'object' && !Array.isArray(v) && typeof v.$recordset === 'string';
const recordsetText = (v) => `${v.$recordset}(${v.ids.join(', ')})`;

/** A value from pageRunCode as text: recordsets as sale.order(1, 2), the rest as indented JSON. */
export function formatValue(v) {
  if (isRecordset(v)) return recordsetText(v);
  return JSON.stringify(v, (k, x) => (isRecordset(x) ? recordsetText(x) : x), 2) ?? String(v);
}

/** One print(...) line: strings as-is (like Python's print), everything else formatted. */
export const printText = (values) => values.map((v) => (typeof v === 'string' ? v : formatValue(v))).join(' ');

/** A table cell: many2one [id, name] → "name #id", id lists → "1, 2", recordsets → model(ids), objects → JSON. */
export function cellText(v) {
  if (v == null) return '';
  if (isRecordset(v)) return recordsetText(v);
  if (Array.isArray(v)) {
    if (v.length === 2 && Number.isInteger(v[0]) && typeof v[1] === 'string') return `${v[1]} #${v[0]}`;
    if (v.every((x) => typeof x === 'number')) return v.join(', ');
    return JSON.stringify(v);
  }
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

/** A list of plain objects (search_read, read, read_group…) → { columns, rows, total }, or null when it is not one.
 * Columns in first-seen order, id first. */
export function toTable(v, max = MAX_ROWS) {
  if (!Array.isArray(v) || !v.length) return null;
  if (!v.every((r) => r && typeof r === 'object' && !Array.isArray(r) && !isRecordset(r))) return null;
  const cols = [];
  const seen = new Set();
  for (const r of v) for (const k of Object.keys(r)) if (!seen.has(k)) { seen.add(k); cols.push(k); }
  if (seen.has('id')) cols.splice(cols.indexOf('id'), 1), cols.unshift('id');
  return { columns: cols, rows: v.slice(0, max).map((r) => cols.map((c) => cellText(r[c]))), total: v.length };
}

/** Calls summary: how many, how many wrote, how many wrote and succeeded (the page then shows stale data). */
export function callStats(calls = []) {
  return {
    total: calls.length, writes: calls.filter((c) => c.write).length,
    written: calls.filter((c) => c.write && !c.error).length,
  };
}

// ---------- suggestions in the editor ----------

/** The recordset API of page.js (pageRunCode), suggested after a dot: [name, signature]. */
export const METHODS = [
  ['search', '(domain, { limit, order })'], ['search_read', '(domain, fields)'], ['search_count', '(domain)'],
  ['read', '(fields)'], ['read_group', '(domain, fields, groupby)'], ['fields_get', '()'], ['name_search', '(name)'],
  ['browse', '(ids)'], ['with_context', '(ctx)'], ['ensure_one', '()'], ['exists', '()'], ['mapped', "('a.b')"],
  ['filtered_domain', '(domain)'], ['create', '(vals)'], ['write', '(vals)'], ['unlink', '()'], ['copy', '(defaults)'],
  ['call', '(method, args, kwargs)'], ['ids', ''], ['id', ''], ['length', ''],
];
export const ENV_MEMBERS = [['user', ''], ['company', ''], ['companies', ''], ['uid', ''], ['context', ''], ['lang', ''], ['ref', "('module.xmlid')"]];
export const COMMAND_MEMBERS = [['create', '(vals)'], ['update', '(id, vals)'], ['delete', '(id)'], ['unlink', '(id)'], ['link', '(id)'], ['clear', '()'], ['set', '(ids)']];
export const GLOBALS = [['env', "['model']"], ['print', '(…)'], ['Command', '.create / link / set…'], ['await', ''], ['return', '']];

const IDENT = '[A-Za-z_$][\\w$]*';
const ENV_MODELS = { user: 'res.users', company: 'res.company', companies: 'res.company' };

/** Where the records of `expr` come from: { model, path } (path: relational fields followed from model), or null.
 * Understood: env['model'], env.user / company / companies, and a variable seen in `scope` with fields after it. */
function originOf(expr, scope) {
  expr = expr.replace(/^[\s(]*(?:await\s+)?[\s(]*/, '');
  let m = /^env\[\s*(['"])([\w.]+)\1\s*\]/.exec(expr);
  if (m) return { model: m[2], path: [] };
  m = /^env\.(user|company|companies)\b/.exec(expr);
  if (m) return { model: ENV_MODELS[m[1]], path: [] };
  m = new RegExp(`^(${IDENT})((?:\\.[A-Za-z_]\\w*)*)`).exec(expr);
  const base = m && scope.get(m[1]);
  if (!base) return null;
  const hops = m[2].split('.').filter(Boolean);
  if (expr[m[0].length] === '(') hops.pop(); // the last word is a method: x.partner_id.read(…)
  return { model: base.model, path: [...base.path, ...hops] };
}

/** The variables assigned before the cursor (x = env['m'], const y = x.partner_id, for (const r of x.line_ids)) → origin. */
function scopeOf(code) {
  const scope = new Map();
  const re = new RegExp(`(?:\\b(?:const|let|var)\\s+|^[ \\t]*|[;{}]\\s*)(${IDENT})\\s*=(?!=)\\s*([^;\\n]*)|for\\s*\\(\\s*(?:const|let|var)\\s+(${IDENT})\\s+of\\s+([^)\\n]*)`, 'gm');
  for (const [, v, rhs, lv, lrhs] of code.matchAll(re)) {
    const origin = originOf(rhs ?? lrhs, scope);
    if (origin) scope.set(v ?? lv, origin); else scope.delete(v ?? lv);
  }
  return scope;
}

/**
 * What to suggest at `pos` in `code`, or null:
 * - { kind: 'model', prefix }: inside env['…'
 * - { kind: 'field', model, path, prefix }: inside a string ('state', 'partner_id.na'), fields of the model, following
 *   `path` (the relational fields before the last dot). The model is the one of the variable whose method is being
 *   called (orders.mapped('…')), else the last env['model'] before the cursor
 * - { kind: 'member', model, path, prefix, on }: after a dot (orders.partner_id.na): methods and fields; `on` is the
 *   first word (env., Command. have their own members), null when it is a variable or env.user…
 * - { kind: 'global', prefix }: a bare word (env, print…)
 * `from` is where the replaced prefix starts. Variables get the model they were assigned from (scopeOf); a variable
 * not understood (a call's result, a function argument) falls back to the last env['model'] written before the cursor
 * (ponytail: no real type inference, a JS parser if it is not enough).
 */
export function completionAt(code, pos) {
  const before = code.slice(0, pos);
  const line = before.slice(before.lastIndexOf('\n') + 1);
  const at = (prefix) => pos - prefix.length;
  const envs = [...before.matchAll(/env\[\s*(['"])([\w.]+)\1\s*\]/g)];
  const last = envs.at(-1)?.[2] || null;
  const scope = scopeOf(before);

  let m = /env\[\s*(['"])([\w.]*)$/.exec(before);
  if (m) return { kind: 'model', prefix: m[2], from: at(m[2]) };

  m = /(['"])([\w.]*)$/.exec(line);
  if (m) {
    const quotes = line.slice(0, m.index).split(m[1]).length - 1;
    if (quotes % 2) return null; // the closing quote of a string: nothing to suggest after it
    const call = new RegExp(`(${IDENT})((?:\\.[A-Za-z_]\\w*)*)\\.[A-Za-z_]\\w*\\([^()]*$`).exec(line.slice(0, m.index));
    const base = (call && scope.get(call[1])) || (last && { model: last, path: [] });
    if (!base) return null;
    const parts = m[2].split('.');
    const prefix = parts.pop();
    const hops = call?.[1] && scope.has(call[1]) ? call[2].split('.').filter(Boolean) : [];
    return { kind: 'field', model: base.model, path: [...base.path, ...hops, ...parts], prefix, from: at(prefix) };
  }

  // a.b.c.pre or env['x'].pre / (…).pre: the chain after the first word are fields
  m = new RegExp(`(?:(${IDENT})|[\\])])((?:\\.[A-Za-z_]\\w*)*)\\.([A-Za-z_]\\w*)?$`).exec(line);
  if (m) {
    const prefix = m[3] || '';
    const path = m[2].split('.').filter(Boolean);
    const on = m[1] || null;
    const base = on === 'env' ? (path[0] in ENV_MODELS ? { model: ENV_MODELS[path.shift()], path: [] } : null) : scope.get(on);
    if (base) return { kind: 'member', model: base.model, path: [...base.path, ...path], prefix, from: at(prefix), on: on === 'env' ? null : on };
    return { kind: 'member', model: last, path, prefix, from: at(prefix), on };
  }

  m = /(?:^|[^\w$.'"])([A-Za-z_]\w*)$/.exec(line);
  if (m) return { kind: 'global', prefix: m[1], from: at(m[1]) };
  return null;
}

/** items: [{ label, detail }] → the ones matching `prefix`: starting with it first (the shortest first), then containing it; at most `max`
 * (every field of a big model: right after a dot the list must reach them all by scrolling). */
export function rankSuggestions(items, prefix, max = 500) {
  const p = prefix.toLowerCase();
  const starts = [], contains = [];
  for (const it of items) {
    const l = it.label.toLowerCase();
    if (l === p) continue; // already typed in full
    if (l.startsWith(p)) starts.push(it);
    else if (p && l.includes(p)) contains.push(it);
  }
  if (p) starts.sort((a, b) => a.label.length - b.label.length); // `name` before `name_search`
  return [...starts, ...contains].slice(0, max);
}

// ---------- the editor: colours and smart typing ----------

const KEYWORDS = new Set(['const', 'let', 'var', 'await', 'async', 'return', 'for', 'of', 'in', 'if', 'else', 'while', 'break', 'continue', 'new',
  'function', 'throw', 'try', 'catch', 'finally', 'typeof', 'true', 'false', 'null', 'undefined', 'this']);
const BUILTINS = new Set(['env', 'print', 'Command']);
const TOKEN = new RegExp([
  '(\\/\\/[^\\n]*|\\/\\*[\\s\\S]*?(?:\\*\\/|$))', // comment
  '(\'(?:[^\'\\\\\\n]|\\\\.)*\'?|"(?:[^"\\\\\\n]|\\\\.)*"?|`(?:[^`\\\\]|\\\\[\\s\\S])*`?)', // string, closed or not (being typed)
  '(\\b\\d[\\d_]*(?:\\.\\d+)?\\b)', // number
  '([A-Za-z_$][\\w$]*)', // word
].join('|'), 'g');

/** JS source → [[type, text]] covering all of it, to colour: comment, string, number, kw, builtin, fn (a word before "("),
 * '' for the rest. Never throws on half-typed code. */
export function tokenize(code) {
  const out = [];
  const push = (type, text) => {
    if (!text) return;
    if (!type && out.length && !out.at(-1)[0]) out.at(-1)[1] += text; else out.push([type, text]);
  };
  let at = 0;
  for (const m of code.matchAll(TOKEN)) {
    push('', code.slice(at, m.index));
    at = m.index + m[0].length;
    const [text, comment, string, number, word] = m;
    if (comment) push('comment', text);
    else if (string) push('string', text);
    else if (number) push('number', text);
    else if (code[m.index - 1] === '.') push(code[at] === '(' ? 'fn' : '', text);
    else if (KEYWORDS.has(word)) push('kw', text);
    else if (BUILTINS.has(word)) push('builtin', text);
    else push(code[at] === '(' ? 'fn' : '', text);
  }
  push('', code.slice(at));
  return out;
}

const PAIRS = { '(': ')', '[': ']', '{': '}', "'": "'", '"': '"', '`': '`' };

/** The quote the end of `line` is inside, or '' (a quote is closed by the same one, \\ escapes). */
function openQuote(line) {
  let q = '';
  for (let i = 0; i < line.length; i++) {
    if (q && line[i] === '\\') i++;
    else if (q) { if (line[i] === q) q = ''; }
    else if ("'\"`".includes(line[i])) q = line[i];
  }
  return q;
}

/**
 * What typing `key` (a character, Backspace or Enter) does in `value` with the selection [start, end), when the editor
 * is smarter than a textarea; null: let the browser type it.
 * → { from, to, text, select: [a, b] }: replace value[from, to) by text, then select [a, b) of the new value.
 * Pairs: ( [ { ' " ` insert their closer (before a space, a closer or the end; a selection is wrapped), typing a closer
 * that is next skips it, Backspace between a pair deletes both, Enter keeps the indent (one more, and the closer on
 * its own line, between brackets). Nothing is paired inside a string, nor a quote after a word (it's an apostrophe).
 */
export function smartEdit(value, start, end, key) {
  const before = value[start - 1] ?? '';
  const next = value[end] ?? '';
  const sel = value.slice(start, end);
  const line = value.slice(value.lastIndexOf('\n', start - 1) + 1, start);
  const move = (at) => ({ from: start, to: start, text: '', select: [at, at] });

  if (key === 'Backspace') {
    if (sel || !before || PAIRS[before] !== next) return null;
    return { from: start - 1, to: start + 1, text: '', select: [start - 1, start - 1] };
  }
  if (key === 'Enter') {
    const indent = /^[ \t]*/.exec(line)[0];
    const opener = '([{'.includes(before) && before;
    if (opener && next === PAIRS[opener] && !sel) {
      const text = `\n${indent}  \n${indent}`;
      const caret = start + 1 + indent.length + 2;
      return { from: start, to: end, text, select: [caret, caret] };
    }
    const text = `\n${indent}${opener ? '  ' : ''}`;
    return { from: start, to: end, text, select: [start + text.length, start + text.length] };
  }
  if (key.length !== 1) return null;

  const quote = openQuote(line);
  if (!sel && next === key && (')]}'.includes(key) ? !quote : quote === key || (!quote && "'\"`".includes(key)))) return move(start + 1);
  if (!(key in PAIRS)) return null;
  const close = PAIRS[key];
  if (sel) return { from: start, to: end, text: key + sel + close, select: [start + 1, start + 1 + sel.length] };
  if (quote) return null;
  if ("'\"`".includes(key) && /[\w$]/.test(before)) return null;
  if (next && !/[\s)\]}.,;:]/.test(next)) return null;
  return { from: start, to: end, text: key + close, select: [start + 1, start + 1] };
}
