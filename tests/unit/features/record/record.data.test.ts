import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readComparisonRecords, readValues, type RecordReader } from '../../../../src/features/record/record.data.ts';
import type { FieldsGet } from '../../../../src/odoo/models.ts';

const fields: FieldsGet = {
  name: { string: 'Name', type: 'char', store: true },
  computed: { string: 'Computed', type: 'char', store: false },
  image: { string: 'Image', type: 'binary', store: true },
};

test('size-only adapter reads exclude all binary content and preserve stored fallback values', async () => {
  const calls: unknown[][] = [];
  const reader: RecordReader = async (...args) => {
    calls.push(args);
    const [, , positional, kwargs] = args;
    if (kwargs.load === 'web') return [{ id: 1, image: { size: 1024, checksum: 'irrelevant' } }];
    if ((positional[1] as string[]).includes('computed')) throw new Error('compute failed');
    return [{ id: 1, name: 'saved' }];
  };
  const result = await readValues('fixture.record', 1, fields, 'web', reader);
  assert.equal(result.partial, true);
  assert.deepEqual(result.values, { id: 1, name: 'saved', image: '1.00 Kb' });
  assert.equal(calls.length, 3);
  assert.deepEqual((calls.find((x) => (x[3] as { load?: string }).load === 'web')![2] as unknown[])[1], ['image']);
  for (const args of calls.filter((x) => (x[3] as { load?: string }).load !== 'web')) assert.ok(!(args[2] as string[][])[1]!.includes('image'));
});

test('older adapters always request bin_size including stored fallback', async () => {
  const reader: RecordReader = async (_model, _method, args, kwargs) => {
    assert.deepEqual(kwargs, { context: { bin_size: true } });
    if (args.length === 1) throw new Error('compute failed');
    return [{ name: 'saved', image: '2 Kb' }];
  };
  assert.equal((await readValues('fixture.record', 1, fields, 'bin_size', reader)).values.image, '2 Kb');
});

test('an unreadable record never discards readable peers; records are read independently', async () => {
  const calls: number[][] = [];
  const reader: RecordReader = async (_model, _method, args) => {
    const ids = args[0] as number[];
    calls.push(ids);
    if (ids[0] === 2) throw new Error('AccessError');
    return [{ id: ids[0], name: `Record ${ids[0]}` }];
  };
  const records = await readComparisonRecords('fixture.record', [1, 2, 3], fields, 'bin_size', reader);
  assert.deepEqual(records.map((r) => r.id), [1, 2, 3]);
  assert.equal(records[0]!.values.name, 'Record 1');
  assert.equal(records[2]!.values.name, 'Record 3');
  assert.equal((records[1]!.error as Error).message, 'AccessError');
  assert.ok(calls.every((ids) => ids.length === 1));
});

test('failed size-only binary reads are explicit, never replaced by binary payload', async () => {
  const reader: RecordReader = async (_model, _method, _args, kwargs) => {
    if (kwargs.load === 'web') throw new Error('binary access');
    return [{ id: 1, name: 'ok' }];
  };
  const result = await readValues('fixture.record', 1, fields, 'web', reader);
  assert.equal(result.values.name, 'ok');
  assert.equal('image' in result.values, false);
  assert.equal((result.fieldErrors?.image as Error).message, 'binary access');
});
