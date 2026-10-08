import assert from 'node:assert/strict';
import { test } from 'node:test';
import { jsonCount, jsonEntries, jsonKind, jsonScalar, jsonTokens } from '../../../src/ui/json.ts';

test('kinds, scalars, counts, entries', () => {
  assert.deepEqual([null, [1], {}, 'a', 1, false, undefined].map(jsonKind), ['null', 'array', 'object', 'string', 'number', 'boolean', 'other']);
  assert.equal(jsonScalar('say "hi"\n'), '"say \\"hi\\"\\n"');
  assert.equal(jsonScalar(1.5), '1.5');
  assert.equal(jsonScalar(false), 'false');
  assert.equal(jsonScalar(null), 'null');
  assert.equal(jsonScalar(NaN), 'NaN');
  assert.deepEqual(jsonCount([1, 2, 3]), { n: 3, unit: 'items' });
  assert.deepEqual(jsonCount({ a: 1 }), { n: 1, unit: 'keys' });
  assert.deepEqual(jsonEntries([7, 'Azure']), [[null, 7], [null, 'Azure']]);
  assert.deepEqual(jsonEntries({ id: 7 }), [['id', 7]]);
});

test('long strings clipped, big values open less', async () => {
  const { clipString, openDepthFor } = await import('../../../src/ui/json.ts');
  assert.deepEqual(clipString('abc', 5), { head: 'abc', rest: 0 });
  assert.deepEqual(clipString('abcdefgh', 5), { head: 'abcde', rest: 3 });
  assert.equal(openDepthFor([{ a: 1 }]), 2);
  assert.equal(openDepthFor(Array.from({ length: 2000 }, (_, i) => ({ id: i, name: `Partner ${i}` }))), 1);
});

test('a folded object previews what tells it apart', async () => {
  const { jsonPreview } = await import('../../../src/ui/json.ts');
  assert.equal(jsonPreview({ image_128: 'x', name: 'Partner 2', country_id: { id: 1 }, id: 2 }), 'id: 2, name: "Partner 2", image_128: "x"');
  assert.equal(jsonPreview({ display_name: 'Vietnam', id: 233 }), 'id: 233, display_name: "Vietnam"');
  assert.equal(jsonPreview({ a: [1], b: {} }), '');
  const long = jsonPreview({ note: 'x'.repeat(100) }, 20);
  assert.equal(long.length, 20);
  assert.ok(long.startsWith('note: "x') && long.endsWith('…'));
});

test('JSON text coloured: keys apart from string values, the whole text covered, half-typed text too', () => {
  const text = '{\n  "model": "res.partner", "ids": [7, -1.5e2], "ok": true, "x": null, "half": "unclo';
  const tokens = jsonTokens(text);
  assert.equal(tokens.map(([, t]) => t).join(''), text);
  assert.deepEqual(tokens.filter(([type]) => type === 'fn').map(([, t]) => t), ['"model"', '"ids"', '"ok"', '"x"', '"half"']);
  assert.deepEqual(tokens.filter(([type]) => type === 'string').map(([, t]) => t), ['"res.partner"', '"unclo']);
  assert.deepEqual(tokens.filter(([type]) => type === 'number').map(([, t]) => t), ['7', '-1.5e2']);
  assert.deepEqual(tokens.filter(([type]) => type === 'kw').map(([, t]) => t), ['true', 'null']);
});

