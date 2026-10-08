// Pure saved-record comparison: validation, pin isolation, typed equality, explicit unknown cells and filtering.
import type { FieldInfo, FieldsGet } from '../../odoo/models.ts';
import type { ComparedRecord, RecordValues } from './record.data.ts';

export function validateCompareIds(input: readonly unknown[]): { ids: number[]; error?: 'invalid' | 'count' } {
  if (input.some((id) => typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0)) return { ids: [], error: 'invalid' };
  const ids = [...new Set(input as readonly number[])];
  return ids.length >= 2 && ids.length <= 5 ? { ids } : { ids: [], error: 'count' };
}

export interface PinnedRecord { scope: string; id: number }
export function comparisonScope(origin: string, database: string, model: string, uid: number): string | null {
  return origin && database && model && Number.isSafeInteger(uid) && uid > 0 ? JSON.stringify([origin, database, model, uid]) : null;
}
export function pinForScope(pin: PinnedRecord | null, scope: string | null): PinnedRecord | null {
  return scope && pin?.scope === scope ? pin : null;
}

export type ComparisonCell = { status: 'value'; value: unknown } | { status: 'missing' | 'restricted' | 'unreadable' | 'unavailable' };
export type ComparisonStatus = 'same' | 'different' | 'unknown';
export function comparisonCell(name: string, field: FieldInfo, read: RecordValues): ComparisonCell {
  if (Object.hasOwn(read.values, name)) return { status: 'value', value: read.values[name] };
  if (read.error && !read.partial) return { status: 'unreadable' };
  if (Object.hasOwn(read.fieldErrors ?? {}, name)) return { status: 'unavailable' };
  if (field.groups) return { status: 'restricted' };
  if (read.partial && !field.store) return { status: 'unavailable' };
  return { status: 'missing' };
}

/** Odoo JSON values: object key order is irrelevant; array order matters except for many2many membership. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  return `${typeof value}:${JSON.stringify(value)}`;
}
function comparable(type: string, value: unknown): string {
  if (type === 'many2one' && Array.isArray(value)) return canonical(value[0]);
  if (type === 'many2many' && Array.isArray(value)) return JSON.stringify([...new Set(value.map(canonical))].sort());
  return canonical(value);
}
export function compareField(type: string, cells: readonly ComparisonCell[]): ComparisonStatus {
  const known = cells.filter((c): c is Extract<ComparisonCell, { status: 'value' }> => c.status === 'value');
  if (new Set(known.map((c) => comparable(type, c.value))).size > 1) return 'different';
  return known.length === cells.length && known.length >= 2 ? 'same' : 'unknown';
}

export interface ComparisonRow { name: string; field: FieldInfo; cells: ComparisonCell[]; status: ComparisonStatus }
export function compareRows(fields: FieldsGet, records: readonly ComparedRecord[], query = '', differencesOnly = false): ComparisonRow[] {
  const q = query.trim().toLowerCase();
  return Object.keys(fields).sort().flatMap((name) => {
    const field = fields[name]!;
    if (![name, field.string, field.type].join(' ').toLowerCase().includes(q)) return [];
    const cells = records.map((record) => comparisonCell(name, field, record));
    const status = compareField(field.type, cells);
    return differencesOnly && status === 'same' ? [] : [{ name, field, cells, status }];
  });
}
