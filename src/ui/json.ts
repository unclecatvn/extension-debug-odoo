// JSON for reading: how a value shows in the JSON viewer (json-view.ts), how JSON text is coloured in an editor
// (editor.ts). Pure: tested by tests/unit/ui/json.test.ts.

export type JsonKind = 'string' | 'number' | 'boolean' | 'null' | 'array' | 'object' | 'other';

/** The JSON kind of a value (undefined, functions…: 'other', shown as text). */
export function jsonKind(v: unknown): JsonKind {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  const t = typeof v;
  return t === 'string' || t === 'number' || t === 'boolean' ? t : t === 'object' ? 'object' : 'other';
}

/** A scalar as JSON writes it ("text" quoted and escaped, 1.5, true, null). */
export function jsonScalar(v: unknown): string {
  if (typeof v === 'number' && !Number.isFinite(v)) return String(v); // NaN / Infinity: not JSON, shown as they are
  return JSON.stringify(v) ?? String(v);
}

/** What a folded array / object says about itself: "3 items", "1 key"… */
export function jsonCount(v: unknown[] | Record<string, unknown>): { n: number; unit: 'items' | 'keys' } {
  return Array.isArray(v) ? { n: v.length, unit: 'items' } : { n: Object.keys(v).length, unit: 'keys' };
}

/** The entries of an array or object, as [key (null for an array item), value]. */
export function jsonEntries(v: unknown[] | Record<string, unknown>): [string | null, unknown][] {
  return Array.isArray(v) ? v.map((x) => [null, x]) : Object.entries(v);
}

/** A string value shown in full only up to `max` characters (base64 images, attachments): its head, and how many
 * characters are left out (0: shown whole). */
export function clipString(s: string, max = 300): { head: string; rest: number } {
  return s.length > max ? { head: s.slice(0, max), rest: s.length - max } : { head: s, rest: 0 };
}

/** How far a JSON tree opens by itself: two levels, one for a big value (a search_read of many records). */
export const openDepthFor = (v: unknown, bigChars = 20_000): number => ((JSON.stringify(v)?.length ?? 0) > bigChars ? 1 : 2);

const PREVIEW_KEYS = ['id', 'display_name', 'name']; // how Odoo records are told apart

/** What a folded object shows of itself: its identifying scalars (id, display_name, name), else its first ones, as
 * `key: value` pairs, within `max` characters. '' when it has no scalar. */
export function jsonPreview(obj: Record<string, unknown>, max = 60): string {
  const scalars = Object.entries(obj).filter(([, v]) => { const k = jsonKind(v); return k !== 'array' && k !== 'object' && k !== 'other'; });
  const picked = [...scalars.filter(([k]) => PREVIEW_KEYS.includes(k)).sort(([a], [b]) => PREVIEW_KEYS.indexOf(a) - PREVIEW_KEYS.indexOf(b)),
    ...scalars.filter(([k]) => !PREVIEW_KEYS.includes(k))].slice(0, 3);
  let out = '';
  for (const [k, v] of picked) {
    const part = `${out ? ', ' : ''}${k}: ${jsonScalar(v)}`;
    if (out && (out + part).length > max) break;
    out += part;
  }
  return out.length > max ? `${out.slice(0, max - 1)}…` : out;
}

const JSON_TOKEN = /("(?:[^"\\\n]|\\.)*"?)(\s*:)?|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|\b(true|false|null)\b|([{}[\],:])/g;

/** JSON text → [type, text] covering all of it, coloured as the JSON viewer does (keys fn, strings, numbers, true /
 * false / null kw, punctuation). Never throws on half-typed JSON. */
export function jsonTokens(text: string): [string, string][] {
  const out: [string, string][] = [];
  let at = 0;
  for (const m of text.matchAll(JSON_TOKEN)) {
    if (m.index > at) out.push(['', text.slice(at, m.index)]);
    at = m.index + m[0].length;
    const [all, str, colon, num, word] = m;
    if (str) out.push([colon ? 'fn' : 'string', str], ...(colon ? [['punct', colon] as [string, string]] : []));
    else out.push([num ? 'number' : word ? 'kw' : 'punct', all]);
  }
  if (at < text.length) out.push(['', text.slice(at)]);
  return out;
}

