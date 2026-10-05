// Translations tab, pure part: .po files read (entries, coverage), the export wizard's archive unpacked (tgz → files),
// a field's translations laid out per term and language, the sources of a text found among the webclient's code
// translations. Same formats in 18.0 and 19.0 (the route differs: odoo/adapter.ts). Tested by
// tests/unit/features/translations/translations.logic.test.ts.

/** The empty template, always exported: <module>/i18n/<module>.pot (the lang key of base.language.export). */
export const NEW_LANG = '__new__';

/** Wanted codes → active res.lang codes, matched case-insensitively (vi_vn → vi_VN); the rest in `unknown`. */
export function resolveLangs(wanted: readonly string[], active: readonly string[]) {
  const byLower = new Map(active.map((code) => [code.toLowerCase(), code]));
  const codes: string[] = [], unknown: string[] = [];
  for (const w of wanted) {
    const code = byLower.get(w.toLowerCase());
    if (!code) unknown.push(w);
    else if (!codes.includes(code)) codes.push(code);
  }
  return { codes, unknown };
}

/** Text as a person compares it: whitespace collapsed, trimmed. */
export const normalize = (s: string) => s.replace(/\s+/g, ' ').trim();

// ---------- .po ----------

export interface PoEntry {
  msgid: string;
  msgstr: string;
  fuzzy: boolean;
  /** "#: code:addons/sale/models/sale_order.py:0", "#: model:ir.model.fields,field_description:sale.field_…" */
  refs: string[];
}

const unquote = (s: string) => JSON.parse(s.replace(/\\(?!["\\nt])/g, '\\\\')) as string; // a .po string is a C string

/** The entries of a .po / .pot (the header, msgid "", left out). Plural forms keep their first msgstr. */
export function parsePo(text: string): PoEntry[] {
  const out: PoEntry[] = [];
  let cur: { msgid: string[]; msgstr: string[]; fuzzy: boolean; refs: string[] } | null = null;
  let into: 'msgid' | 'msgstr' | null = null;
  const flush = () => {
    if (cur && cur.msgid.length) {
      const msgid = cur.msgid.join('');
      if (msgid) out.push({ msgid, msgstr: cur.msgstr.join(''), fuzzy: cur.fuzzy, refs: cur.refs });
    }
    cur = null;
    into = null;
  };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) { flush(); continue; }
    if (line.startsWith('#')) {
      if (cur?.msgid.length) flush();
      cur ??= { msgid: [], msgstr: [], fuzzy: false, refs: [] };
      if (line.startsWith('#:')) cur.refs.push(...line.slice(2).trim().split(/\s+/));
      else if (line.startsWith('#,') && line.includes('fuzzy')) cur.fuzzy = true;
      continue;
    }
    const m = /^(msgid|msgstr(?:\[0\])?|msgid_plural|msgstr\[\d+\]|msgctxt)\s+(".*")$/.exec(line);
    if (m) {
      const key = m[1]!;
      if (key === 'msgid' && cur?.msgstr.length) flush();
      cur ??= { msgid: [], msgstr: [], fuzzy: false, refs: [] };
      into = key === 'msgid' ? 'msgid' : key === 'msgstr' || key === 'msgstr[0]' ? 'msgstr' : null;
      if (into) cur[into].push(unquote(m[2]!));
      continue;
    }
    if (line.startsWith('"') && cur && into) cur[into].push(unquote(line));
  }
  flush();
  return out;
}

export interface PoStats { total: number; translated: number; missing: number; fuzzy: number }

export function poStats(entries: readonly PoEntry[]): PoStats {
  const fuzzy = entries.filter((e) => e.fuzzy && e.msgstr).length;
  const translated = entries.filter((e) => e.msgstr && !e.fuzzy).length;
  return { total: entries.length, translated, fuzzy, missing: entries.length - translated - fuzzy };
}

/** "sale/i18n/vi_VN.po" → { module: 'sale', lang: 'vi_VN' }; the template "sale/i18n/sale.pot" → lang NEW_LANG. */
export function poPath(path: string): { module: string; lang: string } | null {
  const m = /^([^/]+)\/i18n(?:_extra)?\/([^/]+)\.(po|pot)$/.exec(path);
  return m ? { module: m[1]!, lang: m[3] === 'pot' ? NEW_LANG : m[2]! } : null;
}

// ---------- the export wizard's archive ----------

/** A Binary field value (base64, Odoo wraps it every 76 characters) → bytes. */
export function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64.replace(/\s+/g, ''));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Bytes → base64, for a Binary field. */
export function bytesToB64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** .tgz → .tar */
export async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
}

const BLOCK = 512;
const cstr = (bytes: Uint8Array) => new TextDecoder().decode(bytes).replace(/\0.*$/s, '');

/** The regular files of a tar (ustar, with pax path records: what Python's tarfile writes). */
export function untar(tar: Uint8Array): { name: string; data: Uint8Array }[] {
  const files: { name: string; data: Uint8Array }[] = [];
  let off = 0;
  let paxPath: string | null = null;
  while (off + BLOCK <= tar.length) {
    const h = tar.subarray(off, off + BLOCK);
    if (h.every((b) => b === 0)) break; // end of archive
    const size = parseInt(cstr(h.subarray(124, 136)).trim() || '0', 8);
    const type = String.fromCharCode(h[156] || 48); // NUL = '0', a regular file
    const data = tar.subarray(off + BLOCK, off + BLOCK + size);
    if (type === 'x') paxPath = /(?:^|\n)\d+ path=([^\n]*)\n/.exec(new TextDecoder().decode(data))?.[1] ?? null;
    else {
      if (type === '0') {
        const prefix = cstr(h.subarray(345, 500));
        files.push({ name: paxPath ?? (prefix ? `${prefix}/` : '') + cstr(h.subarray(0, 100)), data });
      }
      paxPath = null;
    }
    off += BLOCK + Math.ceil(size / BLOCK) * BLOCK;
  }
  return files;
}

// ---------- a field's translations ----------

/** What get_field_translations returns: per language, the value (translate=True: the whole value, null when
 * missing) or, for a field translated by terms (html / xml), one entry per term ('' when missing). */
export interface FieldTranslation { lang: string; source: string; value: string | false | null }

/** One row per term (a field translated whole: one row, its source the en_US value), a value per language; a missing
 * translation is null. */
export function translationRows(list: readonly FieldTranslation[], byTerm: boolean): { source: string; values: Map<string, string | null> }[] {
  const rows = new Map<string, Map<string, string | null>>();
  for (const t of list) {
    const key = byTerm ? t.source : '';
    const values = rows.get(key) ?? new Map<string, string | null>();
    values.set(t.lang, t.value === false || t.value == null || (byTerm && t.value === '') ? null : t.value);
    rows.set(key, values);
  }
  return [...rows].map(([source, values]) => ({ source: byTerm ? source : list.find((t) => t.lang === 'en_US')?.source ?? list[0]?.source ?? '', values }));
}

/** How many languages miss a translation in these rows (en_US, the source, never does). */
export const missingIn = (rows: ReturnType<typeof translationRows>, langs: readonly string[]) =>
  langs.filter((l) => l !== 'en_US' && rows.some((r) => r.values.get(l) == null)).length;

// ---------- where a text comes from ----------

/** The webclient's code translations (the route's body.modules). */
export type WebTerms = Record<string, { messages: { id: string; string: string }[] }>;

/** Code terms whose translation (or source) is `text`: module, msgid, translation. Exact first; else the terms
 * containing it (10 at most). */
export function findWebTerms(modules: WebTerms, text: string): { module: string; msgid: string; msgstr: string; exact: boolean }[] {
  const want = normalize(text);
  if (!want) return [];
  const all = Object.entries(modules).flatMap(([module, { messages }]) => messages.map((m) => ({ module, msgid: m.id, msgstr: m.string })));
  const exact = all.filter((t) => normalize(t.msgstr) === want || normalize(t.msgid) === want).map((t) => ({ ...t, exact: true }));
  if (exact.length) return exact;
  const lower = want.toLowerCase();
  return all.filter((t) => normalize(t.msgstr).toLowerCase().includes(lower)).slice(0, 10).map((t) => ({ ...t, exact: false }));
}
