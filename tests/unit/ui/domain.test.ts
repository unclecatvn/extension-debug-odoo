import assert from 'node:assert/strict';
import { test } from 'node:test';
import { domainTree, formatPyDomain, pyTokens } from '../../../src/ui/domain.ts';

test('a domain as written: one term per line, strings and nesting kept', () => {
  assert.equal(formatPyDomain("['|', ('company_id', '=', False), ('company_id', 'in', company_ids)]"),
    "[\n    '|',\n    ('company_id', '=', False),\n    ('company_id', 'in', company_ids)\n]");
  assert.equal(formatPyDomain("[('name', '=', 'a, b')]"), "[('name', '=', 'a, b')]"); // one term: as it is
  assert.equal(formatPyDomain('[]'), '[]');
  assert.equal(formatPyDomain("[('x', 'in', [1, 2]), ('y', '=', 1)]"), "[\n    ('x', 'in', [1, 2]),\n    ('y', '=', 1)\n]");
  assert.equal(formatPyDomain('some_function()'), 'some_function()');
});

test('python tokens: the source back, keywords and strings told apart', () => {
  const src = "[('active', '=', True), ('user_id', '=', user.id)]";
  const toks = pyTokens(src);
  assert.equal(toks.map((t) => t.text).join(''), src);
  assert.deepEqual(toks.filter((t) => t.type === 'kw').map((t) => t.text), ['True']);
  assert.deepEqual(toks.filter((t) => t.type === 'string').map((t) => t.text), ["'active'", "'='", "'user_id'", "'='"]);
});

test('an evaluated domain as a tree: prefix operators, implicit AND, constants', () => {
  assert.deepEqual(domainTree(['|', ['company_id', '=', false], ['company_id', 'in', [1]]]), { kind: 'any', children: [
    { kind: 'leaf', field: 'company_id', op: '=', value: false }, { kind: 'leaf', field: 'company_id', op: 'in', value: [1] }] });
  assert.deepEqual(domainTree([['a', '=', 1], ['b', '=', 2]]), { kind: 'all', children: [
    { kind: 'leaf', field: 'a', op: '=', value: 1 }, { kind: 'leaf', field: 'b', op: '=', value: 2 }] });
  const nested = domainTree(['|', '|', ['a', '=', 1], ['b', '=', 2], ['c', '=', 3]]);
  assert.equal(nested?.kind === 'any' ? nested.children.length : 0, 3); // any of any: flattened
  assert.deepEqual(domainTree(['!', ['a', '=', 1]]), { kind: 'not', child: { kind: 'leaf', field: 'a', op: '=', value: 1 } });
  assert.deepEqual(domainTree([[1, '=', 1]]), { kind: 'const', value: true });
  assert.deepEqual(domainTree([]), { kind: 'const', value: true });
  assert.equal(domainTree(['|', ['a', '=', 1]]), null);
  assert.equal(domainTree('nope'), null);
});
