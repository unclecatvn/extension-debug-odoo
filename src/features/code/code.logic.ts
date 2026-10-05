// Code tab: the pure part (no chrome.*, no DOM), unit-tested. The two languages of the console — JavaScript run in the
// page with an ORM-like env (code.injected.ts), Python run on the server by a temporary server action — share: the
// editor's colours and smart typing, the suggestions, and the typed values a run returns (recordsets, rows of a model,
// dates…), shown by code.result.ts and exported here (CSV, Markdown).

export type Lang = 'js' | 'python';
/** read-only: a call that writes is refused (JS) · dry: writes are not kept (JS: not sent; Python: rolled back) ·
 * write: every call is committed */
export type RunMode = 'read' | 'dry' | 'write';

/** localStorage key of the editor's code for an Odoo origin and a language. */
export const codeKey = (origin: string, lang: Lang) => `odoo-debug-orm-code:${origin}${lang === 'python' ? ':py' : ''}`;

// ---------- the values a run returns (both languages) ----------

/** A recordset: its model, ids, and the display names of the first ones (Python sends them). */
export interface RecordsetValue { $recordset: string; ids: number[]; names?: string[]; count?: number }
/** Rows of a model (read / search_read / web_search_read in JS): their columns are its fields. */
export interface RowsValue { $rows: string; rows: Record<string, unknown>[] }
export type Typed = RecordsetValue | RowsValue | { $date: string } | { $datetime: string } | { $bytes: number } | { $repr: string };

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
export const isRecordset = (v: unknown): v is RecordsetValue => isObj(v) && typeof v.$recordset === 'string' && Array.isArray(v.ids);
export const isRows = (v: unknown): v is RowsValue => isObj(v) && typeof v.$rows === 'string' && Array.isArray(v.rows);

/** What a value is, for how to show it. */
export type ValueKind = 'recordset' | 'rows' | 'table' | 'date' | 'datetime' | 'bytes' | 'repr' | 'null' | 'boolean' | 'number'
  | 'string' | 'list' | 'dict';
export function kindOf(v: unknown): ValueKind {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'boolean') return 'boolean';
  if (typeof v === 'number') return 'number';
  if (typeof v === 'string') return 'string';
  if (Array.isArray(v)) return v.length && v.every((r) => isObj(r) && !isTypedObj(r)) ? 'table' : 'list';
  if (isRecordset(v)) return 'recordset';
  if (isRows(v)) return 'rows';
  if (isObj(v)) {
    if (typeof v.$date === 'string') return 'date';
    if (typeof v.$datetime === 'string') return 'datetime';
    if (typeof v.$bytes === 'number') return 'bytes';
    if (typeof v.$repr === 'string') return 'repr';
    return 'dict';
  }
  return 'string';
}
const isTypedObj = (r: Record<string, unknown>) => ['$recordset', '$rows', '$date', '$datetime', '$bytes', '$repr'].some((k) => k in r);

/** The type of a column guessed from its values when no model says it (Python rows, read_group, plain objects). */
export type ColumnType = 'id' | 'many2one' | 'ids' | 'boolean' | 'integer' | 'float' | 'date' | 'datetime' | 'recordset' | 'text' | 'json' | 'empty';
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d+)?$/;
export function columnType(name: string, values: readonly unknown[]): ColumnType {
  const vs = values.filter((v) => v !== null && v !== undefined && v !== false);
  if (!vs.length) return values.some((v) => v === false) && name !== 'id' ? 'boolean' : 'empty';
  const all = (p: (v: unknown) => boolean) => vs.every(p);
  if (name === 'id' && all((v) => Number.isInteger(v))) return 'id';
  if (all((v) => v === true)) return 'boolean';
  if (all((v) => Array.isArray(v) && v.length === 2 && Number.isInteger(v[0]) && typeof v[1] === 'string')) return 'many2one';
  if (all((v) => Array.isArray(v) && v.every((x) => Number.isInteger(x)))) return 'ids';
  if (all((v) => Number.isInteger(v))) return 'integer';
  if (all((v) => typeof v === 'number')) return 'float';
  if (all((v) => isObj(v) && typeof v.$date === 'string') || all((v) => typeof v === 'string' && DATE.test(v))) return 'date';
  if (all((v) => isObj(v) && typeof v.$datetime === 'string') || all((v) => typeof v === 'string' && DATETIME.test(v))) return 'datetime';
  if (all((v) => isRecordset(v))) return 'recordset';
  if (all((v) => typeof v === 'string')) return 'text';
  return 'json';
}

/** The columns of rows, in first-seen order, id first. */
export function columnsOf(rows: readonly Record<string, unknown>[]): string[] {
  const cols: string[] = [];
  const seen = new Set<string>();
  for (const r of rows) for (const k of Object.keys(r)) if (!seen.has(k)) { seen.add(k); cols.push(k); }
  const i = cols.indexOf('id');
  if (i > 0) { cols.splice(i, 1); cols.unshift('id'); }
  return cols;
}

/** A cell as plain text (CSV, Markdown, copy): many2one as its name, ids joined, recordsets as model(ids), dates as ISO. */
export function plainCell(v: unknown): string {
  if (v === null || v === undefined || v === false) return '';
  if (v === true) return 'true';
  if (Array.isArray(v)) {
    if (v.length === 2 && Number.isInteger(v[0]) && typeof v[1] === 'string') return v[1];
    if (v.every((x) => typeof x === 'number')) return v.join(', ');
    return JSON.stringify(v);
  }
  if (isRecordset(v)) return `${v.$recordset}(${v.ids.join(', ')})`;
  if (isObj(v)) {
    if (typeof v.$date === 'string') return v.$date;
    if (typeof v.$datetime === 'string') return v.$datetime;
    if (typeof v.$repr === 'string') return v.$repr;
    return JSON.stringify(v);
  }
  return String(v);
}

export function toCsv(rows: readonly Record<string, unknown>[], cols = columnsOf(rows)): string {
  const q = (s: string) => (/[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  return [cols.map(q).join(','), ...rows.map((r) => cols.map((c) => q(plainCell(r[c]))).join(','))].join('\r\n');
}

export function toMarkdown(rows: readonly Record<string, unknown>[], cols = columnsOf(rows)): string {
  const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
  return [`| ${cols.map(cell).join(' | ')} |`, `| ${cols.map(() => '---').join(' | ')} |`,
    ...rows.map((r) => `| ${cols.map((c) => cell(plainCell(r[c]))).join(' | ')} |`)].join('\n');
}

/** A value as JSON, the typed markers kept (what Copy JSON gives). */
export const toJson = (v: unknown) => JSON.stringify(v, null, 2) ?? 'null';

/** Calls summary: how many, how many write, failed, wrote and succeeded (the page then shows stale data), were held
 * back by a dry run. */
export interface CallEntry { model: string; method: string; args: string; kwargs: string; write: boolean; dry?: boolean; error?: string; ms: number }
export function callStats(calls: readonly CallEntry[] = []) {
  return {
    total: calls.length,
    writes: calls.filter((c) => c.write).length,
    errors: calls.filter((c) => c.error).length,
    written: calls.filter((c) => c.write && !c.dry && !c.error).length,
    held: calls.filter((c) => c.dry).length,
  };
}

// ---------- Python: the program the server action runs ----------

/** Lines the program puts before the user's code (its line 1 is the program's PRELUDE_LINES + 1). */
export const PYTHON_PRELUDE = `_out = []
def _ser(v, depth=0):
    if v is None or isinstance(v, (bool, int, float, str)):
        return v
    if isinstance(v, datetime.datetime):
        return {'$datetime': v.isoformat(' ')}
    if isinstance(v, datetime.date):
        return {'$date': v.isoformat()}
    if isinstance(v, bytes):
        return {'$bytes': len(v)}
    if depth > 8:
        return {'$repr': repr(v)[:300]}
    if isinstance(v, dict):
        out = {}
        for k in v:
            out[str(k)] = _ser(v[k], depth + 1)
        return out
    if isinstance(v, (list, tuple, set)):
        return [_ser(x, depth + 1) for x in list(v)[:2000]]
    try:
        name = v._name
        ids = v.ids
    except Exception:
        return {'$repr': repr(v)[:2000]}
    return {'$recordset': name, 'ids': ids[:2000], 'names': [r.display_name for r in v[:50]], 'count': len(ids)}
def print(*args):
    _out.append([_ser(a) for a in args])
def _main():
`;
export const PRELUDE_LINES = PYTHON_PRELUDE.split('\n').length - 1;

/** The server action's code: the user's code as the body of _main() (so `return` works), its value and prints
 * serialized, written to `action` (what ir.actions.server.run returns). `dry`: everything rolled back before. */
export function pythonProgram(code: string, dry: boolean): string {
  const body = code.replace(/\r\n?/g, '\n').replace(/\t/g, '    ').split('\n').map((l) => `    ${l}`).join('\n');
  return `${PYTHON_PRELUDE}${body}
    pass
_value = _main()
_payload = {'value': _ser(_value), 'has_value': _value is not None, 'out': _out, 'dry': ${dry ? 'True' : 'False'}}
${dry ? 'env.flush_all()\nenv.cr.rollback()\nenv.invalidate_all()\n' : ''}action = {'type': 'ir.actions.client', 'tag': 'odoo_debug_console', 'params': _payload}
`;
}

/** The line of the user's code a server traceback points to (the last frame in the server action's code), or null. */
export function pythonErrorLine(traceback: string, codeLines: number): number | null {
  const frames = [...traceback.matchAll(/File "[^"]*ir\.actions\.server\(\d+,?\)[^"]*", line (\d+)/g)].map((m) => Number(m[1]) - PRELUDE_LINES);
  const inCode = frames.filter((l) => l >= 1 && l <= codeLines);
  return inCode.length ? inCode[inCode.length - 1]! : null;
}

/** Odoo checks the code when the server action is created: "SyntaxError : '(' was never closed at line 29\n    return ("
 * → the error, at the line of the user's code. */
export function pythonSyntaxError(message: string): { message: string; line: number | null } | null {
  const m = /(\w*Error) : ([\s\S]*?) at line (\d+)/.exec(message);
  if (!m) return null;
  const line = Number(m[3]) - PRELUDE_LINES;
  return { message: `${m[1]}: ${m[2]!.trim()}`, line: line >= 1 ? line : null };
}

/** safe_eval wraps an error in a ValueError with the whole program: "AttributeError(\"'int' object has no attribute
 * 'x'\") while evaluating\n'…'" → "AttributeError: 'int' object has no attribute 'x'"; `wrapped`: it was (the
 * ValueError is not the error). */
export function cleanPythonError(message: string): { message: string; wrapped: boolean } {
  const m = /^([\s\S]*?) while evaluating\n/.exec(message);
  if (!m) return { message: message.trim(), wrapped: false };
  const inner = m[1]!.trim();
  const repr = /^(\w+)\((['"])([\s\S]*)\2\)$/.exec(inner); // Name("message") / Name('message')
  return { message: repr ? `${repr[1]}: ${repr[3]!.replace(/\\(['"])/g, '$1')}` : inner, wrapped: true };
}

// ---------- the editor: suggestions ----------

export interface Suggestion { label: string; detail: string }
export type Completion =
  | { kind: 'model'; prefix: string; from: number }
  | { kind: 'field'; model: string; path: string[]; prefix: string; from: number }
  | { kind: 'member'; model: string | null; path: string[]; prefix: string; from: number; on: string | null }
  | { kind: 'global'; prefix: string; from: number };

/** The recordset API suggested after a dot: [name, signature], per language. */
export const METHODS: Record<Lang, [string, string][]> = {
  js: [
    ['search', '(domain, { limit, order })'], ['search_read', '(domain, fields)'], ['search_count', '(domain)'],
    ['read', '(fields)'], ['read_group', '(domain, fields, groupby)'], ['fields_get', '()'], ['name_search', '(name)'],
    ['browse', '(ids)'], ['with_context', '(ctx)'], ['ensure_one', '()'], ['exists', '()'], ['mapped', "('a.b')"],
    ['filtered_domain', '(domain)'], ['create', '(vals)'], ['write', '(vals)'], ['unlink', '()'], ['copy', '(defaults)'],
    ['call', '(method, args, kwargs)'], ['ids', ''], ['id', ''], ['length', ''],
  ],
  python: [
    ['search', '(domain, limit=None, order=None)'], ['search_read', '(domain, fields)'], ['search_count', '(domain)'],
    ['read', '(fields)'], ['_read_group', '(domain, groupby, aggregates)'], ['fields_get', '()'], ['name_search', '(name)'],
    ['browse', '(ids)'], ['with_context', '(**ctx)'], ['sudo', '()'], ['ensure_one', '()'], ['exists', '()'],
    ['mapped', "('a.b')"], ['filtered', '(lambda r: …)'], ['filtered_domain', '(domain)'], ['sorted', "('field')"],
    ['grouped', "('field')"], ['create', '(vals)'], ['write', '(vals)'], ['unlink', '()'], ['copy', '(default)'],
    ['ids', ''], ['id', ''], ['display_name', ''],
  ],
};
export const ENV_MEMBERS: Record<Lang, [string, string][]> = {
  js: [['user', ''], ['company', ''], ['companies', ''], ['uid', ''], ['context', ''], ['lang', ''], ['ref', "('module.xmlid')"]],
  python: [['user', ''], ['company', ''], ['companies', ''], ['uid', ''], ['context', ''], ['lang', ''], ['ref', "('module.xmlid')"],
    ['cr', ''], ['su', ''], ['flush_all', '()']],
};
export const COMMAND_MEMBERS: [string, string][] = [['create', '(vals)'], ['update', '(id, vals)'], ['delete', '(id)'], ['unlink', '(id)'],
  ['link', '(id)'], ['clear', '()'], ['set', '(ids)']];
export const GLOBALS: Record<Lang, [string, string][]> = {
  js: [['env', "['model']"], ['record', ''], ['records', ''], ['model', ''], ['print', '(…)'], ['Command', '.create / link / set…'], ['await', ''], ['return', '']],
  python: [['env', "['model']"], ['record', ''], ['records', ''], ['model', ''], ['print', '(…)'], ['Command', '.create / link / set…'],
    ['UserError', '(msg)'], ['datetime', ''], ['dateutil', ''], ['time', ''], ['log', '(msg)'], ['return', '']],
};

const IDENT = '[A-Za-z_$][\\w$]*';
const ENV_MODELS: Record<string, string> = { user: 'res.users', company: 'res.company', companies: 'res.company' };
type Origin = { model: string; path: string[] };

/** Where the records of `expr` come from, or null: env['model'], env.user…, record / records / model (the screen's
 * model, `screen`), or a variable already known, with fields after it. */
function originOf(expr: string, scope: Map<string, Origin>): Origin | null {
  const e = expr.replace(/^[\s(]*(?:await\s+)?[\s(]*/, '');
  let m = /^env\[\s*(['"])([\w.]+)\1\s*\]/.exec(e);
  if (m) return { model: m[2]!, path: [] };
  m = /^env\.(user|company|companies)\b/.exec(e);
  if (m) return { model: ENV_MODELS[m[1]!]!, path: [] };
  m = new RegExp(`^(${IDENT})((?:\\.[A-Za-z_]\\w*)*)`).exec(e);
  const base = m && scope.get(m[1]!);
  if (!m || !base) return null;
  const hops = m[2]!.split('.').filter(Boolean);
  if (e[m[0].length] === '(') hops.pop(); // the last word is a method: x.partner_id.read(…)
  return { model: base.model, path: [...base.path, ...hops] };
}

/** The variables assigned before the cursor → where their records come from (JS: const x = …, for (const r of x);
 * Python: x = …, for r in x:). record / records / model are the screen's model. */
function scopeOf(code: string, screen: string | null): Map<string, Origin> {
  const scope = new Map<string, Origin>();
  if (screen) for (const v of ['record', 'records', 'model']) scope.set(v, { model: screen, path: [] });
  const re = new RegExp(`(?:\\b(?:const|let|var)\\s+|^[ \\t]*|[;{}]\\s*)(${IDENT})\\s*=(?!=)\\s*([^;\\n]*)`
    + `|for\\s*\\(\\s*(?:const|let|var)\\s+(${IDENT})\\s+of\\s+([^)\\n]*)|^[ \\t]*for\\s+(${IDENT})\\s+in\\s+([^:\\n]*):`, 'gm');
  for (const [, v, rhs, lv, lrhs, pv, prhs] of code.matchAll(re)) {
    const name = (v ?? lv ?? pv)!;
    const origin = originOf((rhs ?? lrhs ?? prhs)!, scope);
    if (origin) scope.set(name, origin); else scope.delete(name);
  }
  return scope;
}

/**
 * What to suggest at `pos` in `code`, or null: models inside env['…'; fields inside a string (of the model of the
 * variable whose method is called, else the last env['model'] before the cursor, else the screen's); members after a
 * dot (methods and fields; env. and Command. their own); a bare word (env, print…). `from`: where the prefix starts.
 */
export function completionAt(code: string, pos: number, screen: string | null = null): Completion | null {
  const before = code.slice(0, pos);
  const line = before.slice(before.lastIndexOf('\n') + 1);
  const at = (prefix: string) => pos - prefix.length;
  const envs = [...before.matchAll(/env\[\s*(['"])([\w.]+)\1\s*\]/g)];
  const last = envs.at(-1)?.[2] ?? screen;
  const scope = scopeOf(before, screen);

  let m = /env\[\s*(['"])([\w.]*)$/.exec(before);
  if (m) return { kind: 'model', prefix: m[2]!, from: at(m[2]!) };

  m = /(['"])([\w.]*)$/.exec(line);
  if (m) {
    const quotes = line.slice(0, m.index).split(m[1]!).length - 1;
    if (quotes % 2) return null; // the closing quote of a string: nothing to suggest after it
    const call = new RegExp(`(${IDENT})((?:\\.[A-Za-z_]\\w*)*)\\.[A-Za-z_]\\w*\\([^()]*$`).exec(line.slice(0, m.index));
    const base = (call && scope.get(call[1]!)) || (last ? { model: last, path: [] } : null);
    if (!base) return null;
    const parts = m[2]!.split('.');
    const prefix = parts.pop()!;
    const hops = call?.[1] && scope.has(call[1]) ? call[2]!.split('.').filter(Boolean) : [];
    return { kind: 'field', model: base.model, path: [...base.path, ...hops, ...parts], prefix, from: at(prefix) };
  }

  m = new RegExp(`(?:(${IDENT})|[\\])])((?:\\.[A-Za-z_]\\w*)*)\\.([A-Za-z_]\\w*)?$`).exec(line);
  if (m) {
    const prefix = m[3] ?? '';
    const path = m[2]!.split('.').filter(Boolean);
    const on = m[1] ?? null;
    const base = on === 'env' ? (path[0]! in ENV_MODELS ? { model: ENV_MODELS[path.shift()!]!, path: [] } : null) : on ? scope.get(on) : null;
    if (base) return { kind: 'member', model: base.model, path: [...base.path, ...path], prefix, from: at(prefix), on: on === 'env' ? null : on };
    return { kind: 'member', model: last, path, prefix, from: at(prefix), on };
  }

  m = /(?:^|[^\w$.'"])([A-Za-z_]\w*)$/.exec(line);
  if (m) return { kind: 'global', prefix: m[1]!, from: at(m[1]!) };
  return null;
}

/** The suggestions matching `prefix`: starting with it first (the shortest first), then containing it; at most `max`. */
export function rankSuggestions(items: readonly Suggestion[], prefix: string, max = 500): Suggestion[] {
  const p = prefix.toLowerCase();
  const starts: Suggestion[] = [];
  const contains: Suggestion[] = [];
  for (const it of items) {
    const l = it.label.toLowerCase();
    if (l === p) continue; // already typed in full
    if (l.startsWith(p)) starts.push(it);
    else if (p && l.includes(p)) contains.push(it);
  }
  if (p) starts.sort((a, b) => a.label.length - b.label.length);
  return [...starts, ...contains].slice(0, max);
}

// ---------- the editor: colours and smart typing ----------

const KEYWORDS: Record<Lang, Set<string>> = {
  js: new Set(['const', 'let', 'var', 'await', 'async', 'return', 'for', 'of', 'in', 'if', 'else', 'while', 'break', 'continue', 'new',
    'function', 'throw', 'try', 'catch', 'finally', 'typeof', 'true', 'false', 'null', 'undefined', 'this']),
  python: new Set(['def', 'return', 'for', 'in', 'if', 'elif', 'else', 'while', 'break', 'continue', 'pass', 'and', 'or', 'not', 'is',
    'lambda', 'try', 'except', 'finally', 'raise', 'with', 'as', 'True', 'False', 'None', 'del', 'global', 'yield', 'assert']),
};
const BUILTINS: Record<Lang, Set<string>> = {
  js: new Set(['env', 'print', 'Command', 'record', 'records', 'model']),
  python: new Set(['env', 'print', 'Command', 'record', 'records', 'model', 'UserError', 'datetime', 'dateutil', 'time', 'log',
    'len', 'sum', 'min', 'max', 'sorted', 'list', 'dict', 'set', 'tuple', 'str', 'int', 'float', 'bool', 'range', 'enumerate', 'zip']),
};
const TOKEN: Record<Lang, RegExp> = {
  js: new RegExp([
    '(\\/\\/[^\\n]*|\\/\\*[\\s\\S]*?(?:\\*\\/|$))', // comment
    '(\'(?:[^\'\\\\\\n]|\\\\.)*\'?|"(?:[^"\\\\\\n]|\\\\.)*"?|`(?:[^`\\\\]|\\\\[\\s\\S])*`?)', // string, closed or not (being typed)
    '(\\b\\d[\\d_]*(?:\\.\\d+)?\\b)',
    '([A-Za-z_$][\\w$]*)',
  ].join('|'), 'g'),
  python: new RegExp([
    '(#[^\\n]*)',
    '(\'\'\'[\\s\\S]*?(?:\'\'\'|$)|"""[\\s\\S]*?(?:"""|$)|[rbfRBF]?\'(?:[^\'\\\\\\n]|\\\\.)*\'?|[rbfRBF]?"(?:[^"\\\\\\n]|\\\\.)*"?)',
    '(\\b\\d[\\d_]*(?:\\.\\d+)?\\b)',
    '([A-Za-z_][\\w]*)',
  ].join('|'), 'g'),
};

export type TokenType = '' | 'comment' | 'string' | 'number' | 'kw' | 'builtin' | 'fn' | 'prop';
/** Source → [[type, text]] covering all of it, to colour. Never throws on half-typed code. */
export function tokenize(code: string, lang: Lang = 'js'): [TokenType, string][] {
  const out: [TokenType, string][] = [];
  const push = (type: TokenType, text: string) => {
    if (!text) return;
    const prev = out[out.length - 1];
    if (!type && prev && !prev[0]) prev[1] += text; else out.push([type, text]);
  };
  let at = 0;
  for (const m of code.matchAll(TOKEN[lang])) {
    push('', code.slice(at, m.index));
    at = m.index + m[0].length;
    const [text, comment, string, number, word] = m;
    if (comment) push('comment', text);
    else if (string) push('string', text);
    else if (number) push('number', text);
    else if (code[m.index - 1] === '.') push(code[at] === '(' ? 'fn' : 'prop', text);
    else if (KEYWORDS[lang].has(word!)) push('kw', text);
    else if (BUILTINS[lang].has(word!)) push('builtin', text);
    else push(code[at] === '(' ? 'fn' : '', text);
  }
  push('', code.slice(at));
  return out;
}

const PAIRS: Record<string, string> = { '(': ')', '[': ']', '{': '}', "'": "'", '"': '"', '`': '`' };

/** The quote the end of `line` is inside, or '' (a quote is closed by the same one, \\ escapes). */
function openQuote(line: string): string {
  let q = '';
  for (let i = 0; i < line.length; i++) {
    if (q && line[i] === '\\') i++;
    else if (q) { if (line[i] === q) q = ''; }
    else if ("'\"`".includes(line[i]!)) q = line[i]!;
  }
  return q;
}

export interface Edit { from: number; to: number; text: string; select: [number, number] }
/**
 * What typing `key` (a character, Backspace or Enter) does with the selection [start, end), when the editor is smarter
 * than a textarea; null: let the browser type it. Pairs ( [ { ' " (and ` in JS) close themselves, a closer next is
 * skipped, Backspace between a pair deletes both; Enter keeps the indent, one more after an opener (and, in Python,
 * after a line ending with ':'), the closer on its own line between brackets.
 */
export function smartEdit(value: string, start: number, end: number, key: string, lang: Lang = 'js'): Edit | null {
  const before = value[start - 1] ?? '';
  const next = value[end] ?? '';
  const sel = value.slice(start, end);
  const line = value.slice(value.lastIndexOf('\n', start - 1) + 1, start);
  const unit = lang === 'python' ? '    ' : '  ';
  const quotes = lang === 'python' ? "'\"" : "'\"`";
  const move = (at: number): Edit => ({ from: start, to: start, text: '', select: [at, at] });

  if (key === 'Backspace') {
    if (sel || !before || PAIRS[before] !== next) return null;
    return { from: start - 1, to: start + 1, text: '', select: [start - 1, start - 1] };
  }
  if (key === 'Enter') {
    const indent = /^[ \t]*/.exec(line)![0];
    const opener = '([{'.includes(before) && before ? before : '';
    if (opener && next === PAIRS[opener] && !sel) {
      const text = `\n${indent}${unit}\n${indent}`;
      const caret = start + 1 + indent.length + unit.length;
      return { from: start, to: end, text, select: [caret, caret] };
    }
    const deeper = !!opener || (lang === 'python' && /:\s*(#.*)?$/.test(line));
    const text = `\n${indent}${deeper ? unit : ''}`;
    return { from: start, to: end, text, select: [start + text.length, start + text.length] };
  }
  if (key.length !== 1) return null;

  const quote = openQuote(line);
  if (!sel && next === key && (')]}'.includes(key) ? !quote : quote === key || (!quote && quotes.includes(key)))) return move(start + 1);
  if (!(key in PAIRS) || (key === '`' && lang === 'python')) return null;
  const close = PAIRS[key]!;
  if (sel) return { from: start, to: end, text: key + sel + close, select: [start + 1, start + 1 + sel.length] };
  if (quote) return null;
  if (quotes.includes(key) && /[\w$]/.test(before)) return null;
  if (next && !/[\s)\]}.,;:]/.test(next)) return null;
  return { from: start, to: end, text: key + close, select: [start + 1, start + 1] };
}
