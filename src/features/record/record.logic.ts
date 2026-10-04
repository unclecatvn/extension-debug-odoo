// Record tab, pure part: field values as text, what a field change recomputes, the description line of a field, the
// quick filters, the links a value opens. Tested by tests/unit/features/record/record.logic.test.ts.
import { _t } from '../../i18n/i18n.ts';
import type { FieldInfo, FieldsGet, IrModelField } from '../../odoo/models.ts';

const RELATIONAL = ['many2one', 'one2many', 'many2many'];

/** A field value as text. many2one: "name (#id)"; selection: "value · label"; long id lists cut at 20. */
export function fmtValue(v: unknown, f: Pick<FieldInfo, 'type' | 'selection'>): string {
  if (v === false && f.type !== 'boolean') return '';
  if (f.type === 'many2one' && Array.isArray(v)) return `${v[1]} (#${v[0]})`;
  if (f.type === 'selection' && f.selection) {
    const label = f.selection.find(([value]) => value === v)?.[1];
    return label != null && label !== String(v) ? `${String(v)} · ${label}` : String(v);
  }
  if (Array.isArray(v)) return v.length > 20 ? `[${v.slice(0, 20).join(', ')}, …] (${v.length})` : `[${v.join(', ')}]`;
  if (v !== null && typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

/** The full value, to copy: text as it is, anything else as JSON. */
export const copyValue = (v: unknown): string => (typeof v === 'string' ? v : JSON.stringify(v, null, 2) ?? String(v));

/** fields_get (with depends) → field → the fields recomputed when it changes (transitively, same model only). */
export function reverseDeps(fields: FieldsGet): Map<string, string[]> {
  const direct = new Map<string, Set<string>>();
  for (const [name, f] of Object.entries(fields)) {
    for (const path of f.depends || []) {
      const head = path.split('.')[0]!;
      if (head === name || !(head in fields)) continue;
      if (!direct.has(head)) direct.set(head, new Set());
      direct.get(head)!.add(name);
    }
  }
  const out = new Map<string, string[]>();
  for (const [name, kids] of direct) {
    const seen = new Set<string>();
    const todo = [...kids];
    while (todo.length) {
      const x = todo.pop()!;
      if (x === name || seen.has(x)) continue;
      seen.add(x);
      todo.push(...(direct.get(x) || []));
    }
    out.set(name, [...seen].sort());
  }
  return out;
}

/** A field described in one line: label, relation, storage, how it is computed, constraints, modules, recomputes. */
export function describeField(f: FieldInfo, ir: Pick<IrModelField, 'modules' | 'index'> | undefined, recomputes: string[] | undefined): string {
  return [
    f.string,
    f.relation && `→ ${f.relation}`,
    f.store ? 'stored' : 'non-stored',
    f.related ? `related ${[f.related].flat().join('.')}` : f.depends?.length ? `ƒ ${f.depends.join(', ')}` : '',
    f.required && 'required',
    f.readonly && 'readonly',
    ir?.index && 'indexed',
    f.groups && `groups ${f.groups}`,
    ir?.modules && `[${ir.modules}]`,
    recomputes?.length && _t('change → recomputes %s', recomputes.join(', ')),
  ].filter(Boolean).join(' · ');
}

/** Quick filters of the field list, combined with AND. */
export const QUICK_FILTERS = {
  stored: (f: FieldInfo) => !!f.store,
  computed: (f: FieldInfo) => !!f.related || !!f.depends?.length,
  relational: (f: FieldInfo) => RELATIONAL.includes(f.type),
  required: (f: FieldInfo) => !!f.required,
  groups: (f: FieldInfo) => !!f.groups,
} as const;
export type QuickFilter = keyof typeof QUICK_FILTERS;

export const matchesAll = (f: FieldInfo, on: ReadonlySet<QuickFilter>) => [...on].every((k) => QUICK_FILTERS[k](f));

/** The record a value opens in Odoo (/odoo/<model>/<id>): a set many2one. */
export function linkedRecord(f: Pick<FieldInfo, 'type' | 'relation'>, v: unknown): string | null {
  return f.type === 'many2one' && f.relation && Array.isArray(v) && Number.isInteger(v[0]) ? `${f.relation}/${v[0]}` : null;
}

/** A size as Odoo's human_size writes it (what bin_size gives): "12.34 Kb". */
export function humanSize(size: number): string {
  const units = ['bytes', 'Kb', 'Mb', 'Gb', 'Tb'];
  let s = size, i = 0;
  while (s >= 1024 && i < units.length - 1) { s /= 1024; i++; }
  return `${s.toFixed(2)} ${units[i]}`;
}

/** Binaries read with load='web' (20: { size, filename?, checksum }) → their size as bin_size gives it; unset: false. */
export function binarySizes(row: Record<string, unknown>, names: readonly string[]): Record<string, string | false> {
  return Object.fromEntries(names.filter((n) => n in row).map((n) => {
    const v = row[n] as { size?: number } | false;
    return [n, v && typeof v.size === 'number' ? humanSize(v.size) : false];
  }));
}

/** The record as JSON (Copy as JSON): the values read, in field order; binaries as read (their size, bin_size). */
export function recordJson(values: Record<string, unknown>, fields: FieldsGet): string {
  return JSON.stringify(Object.fromEntries(Object.keys(fields).sort().filter((n) => n in values).map((n) => [n, values[n]])), null, 2);
}


/** How a field's value shows once its row opens: `text` as it is (char, text, selection, dates, a binary's size), `code`
 * coloured as markup (html), `json` as a foldable JSON tree (relations, json / properties, numbers, booleans…). */
export function valueDisplay(type: string, v: unknown): 'text' | 'code' | 'json' {
  if (typeof v !== 'string') return 'json';
  return type === 'html' ? 'code' : 'text';
}
