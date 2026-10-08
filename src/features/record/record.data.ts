// Record value reads shared by the single-record inspector and comparison. Adapter choice is passed explicitly so
// the same size-only and compute-fallback behavior is testable without Chrome or an Odoo server.
import type { Json } from '../../contracts/json.ts';
import type { OdooAdapter } from '../../odoo/adapter.ts';
import type { FieldsGet } from '../../odoo/models.ts';
import { call } from '../../odoo/rpc.ts';
import { binarySizes } from './record.logic.ts';

export interface RecordValues {
  values: Record<string, unknown>;
  error?: unknown;
  partial?: boolean;
  fieldErrors?: Record<string, unknown>;
}
export interface ComparedRecord extends RecordValues { id: number }
export type RecordReader = (model: string, method: string, args: Json[], kwargs: { [key: string]: Json | undefined }) => Promise<Record<string, unknown>[]>;

/** A broken non-stored compute does not hide stored fields. Binaries are always size-only, including retries. */
export async function readValues(model: string, resId: number, fields: FieldsGet, binaryRead: OdooAdapter['orm']['binaryRead'], reader: RecordReader = call): Promise<RecordValues> {
  const web = binaryRead === 'web';
  const binaries = web ? Object.keys(fields).filter((n) => fields[n]!.type === 'binary') : [];
  const read = (names?: string[]) => reader(model, 'read', [[resId], ...(names ? [names] : [])], web ? {} : { context: { bin_size: true } })
    .then((r) => r[0] || {});
  const sizes: Promise<Pick<RecordValues, 'values' | 'fieldErrors'>> = binaries.length
    ? reader(model, 'read', [[resId], binaries], { load: 'web' }).then(
      (r) => ({ values: binarySizes(r[0] || {}, binaries) }),
      (error: unknown) => ({ values: {}, fieldErrors: Object.fromEntries(binaries.map((name) => [name, error])) }))
    : Promise.resolve({ values: {} });
  const others = binaries.length ? Object.keys(fields).filter((n) => !binaries.includes(n)) : undefined;
  try {
    const [values, bins] = await Promise.all([read(others), sizes]);
    return { ...bins, values: { ...values, ...bins.values } };
  } catch (error) {
    const stored = Object.entries(fields).filter(([n, f]) => f.store && !binaries.includes(n)).map(([name]) => name);
    try {
      const [values, bins] = await Promise.all([read(stored), sizes]);
      return { ...bins, values: { ...values, ...bins.values }, error, partial: true };
    } catch (readError) {
      return { values: {}, error: readError };
    }
  }
}

/** No batch read: one record's ACL/rule/compute failure must not poison the other columns. */
export async function readComparisonRecords(model: string, ids: readonly number[], fields: FieldsGet, binaryRead: OdooAdapter['orm']['binaryRead'], reader: RecordReader = call): Promise<ComparedRecord[]> {
  return Promise.all(ids.map(async (id) => ({ id, ...await readValues(model, id, fields, binaryRead, reader) })));
}
