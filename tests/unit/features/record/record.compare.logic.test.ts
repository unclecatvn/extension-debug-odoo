import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compareField, compareRows, comparisonCell, comparisonScope, pinForScope, validateCompareIds } from '../../../../src/features/record/record.compare.logic.ts';
import type { FieldsGet } from '../../../../src/odoo/models.ts';

const fields: FieldsGet = {
  name: { string: 'Name', type: 'char', store: true },
  tags: { string: 'Tags', type: 'many2many', store: true },
  lines: { string: 'Lines', type: 'one2many', store: true },
  secret: { string: 'Secret', type: 'char', store: true, groups: 'base.group_system' },
  computed: { string: 'Computed', type: 'char', store: false },
};

test('comparison IDs are unique saved positive integers; no silent truncation or invalid filtering', () => {
  assert.deepEqual(validateCompareIds([3, 1, 3, 2]), { ids: [3, 1, 2] });
  assert.equal(validateCompareIds([]).error, 'count');
  assert.equal(validateCompareIds([1, 1]).error, 'count');
  assert.equal(validateCompareIds([1, 2, 3, 4, 5]).error, undefined);
  assert.equal(validateCompareIds([1, 2, 3, 4, 5, 6]).error, 'count');
  for (const bad of [0, -1, 1.5, '2', null, undefined, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(validateCompareIds([1, 2, bad]).error, 'invalid');
  }
});

test('field equality respects relation semantics, types, nested JSON and empty values', () => {
  const value = (v: unknown) => ({ status: 'value' as const, value: v });
  const equal = (type: string, a: unknown, b: unknown) => compareField(type, [value(a), value(b)]);
  assert.equal(equal('many2many', [2, 1], [1, 2]), 'same');
  assert.equal(equal('one2many', [2, 1], [1, 2]), 'different');
  assert.equal(equal('many2one', [7, 'Old label'], [7, 'New label']), 'same');
  assert.equal(equal('many2one', [7, 'Same'], [8, 'Same']), 'different');
  assert.equal(equal('json', { b: [2, 1], a: false }, { a: false, b: [2, 1] }), 'same');
  assert.equal(equal('json', { a: 1 }, { a: '1' }), 'different');
  assert.equal(equal('boolean', false, null), 'different');
  assert.equal(equal('char', false, ''), 'different');
  assert.equal(equal('integer', 0, false), 'different');
});

test('missing, restricted, partial compute and failed record values are explicit, never equal by accident', () => {
  assert.deepEqual(comparisonCell('name', fields.name!, { values: {} }), { status: 'missing' });
  assert.deepEqual(comparisonCell('secret', fields.secret!, { values: {} }), { status: 'restricted' });
  assert.deepEqual(comparisonCell('computed', fields.computed!, { values: {}, partial: true, error: 'compute' }), { status: 'unavailable' });
  assert.deepEqual(comparisonCell('name', fields.name!, { values: {}, error: 'AccessError' }), { status: 'unreadable' });
  assert.deepEqual(comparisonCell('name', fields.name!, { values: { name: false }, error: 'compute', partial: true }), { status: 'value', value: false });
  assert.equal(compareField('char', [{ status: 'missing' }, { status: 'missing' }]), 'unknown');
  assert.equal(compareField('char', [{ status: 'value', value: 'A' }, { status: 'unreadable' }]), 'unknown');
  assert.equal(compareField('char', [{ status: 'value', value: 'A' }, { status: 'value', value: 'B' }, { status: 'unreadable' }]), 'different');
});

test('differences-only retains unknown fields, field search matches names and labels', () => {
  const records = [{ id: 1, values: { name: 'same', tags: [2, 1], lines: [1, 2] } }, { id: 2, values: { name: 'same', tags: [1, 2], lines: [2, 1] } }];
  assert.deepEqual(compareRows(fields, records, '', true).map((r) => r.name), ['computed', 'lines', 'secret']);
  assert.deepEqual(compareRows(fields, records, 'NAME', false).map((r) => r.name), ['name']);
  assert.equal(compareRows(fields, records, 'absent', false).length, 0);
});

test('pin scope includes origin, database, model and user, with no unsafe ambiguous scope', () => {
  const scope = comparisonScope('https://one.test', 'db', 'res.partner', 7)!;
  const pin = { scope, id: 42 };
  assert.deepEqual(pinForScope(pin, scope), pin);
  for (const args of [
    ['https://two.test', 'db', 'res.partner', 7], ['https://one.test', 'other', 'res.partner', 7],
    ['https://one.test', 'db', 'res.users', 7], ['https://one.test', 'db', 'res.partner', 8],
  ] as const) assert.equal(pinForScope(pin, comparisonScope(args[0], args[1], args[2], args[3])), null);
  assert.equal(comparisonScope('https://one.test', '', 'res.partner', 7), null);
  assert.equal(comparisonScope('https://one.test', 'db', 'res.partner', 0), null);
  assert.equal(pinForScope(pin, null), null);
});
