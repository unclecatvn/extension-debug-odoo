import assert from 'node:assert/strict';
import { test } from 'node:test';
import { idsOfCall, modeOfCall, parseAccessError } from '../../../src/odoo/access-error.ts';

// As ir.model.access._make_access_error / ir.rule._make_access_error write them (18.0 and 19.0)
const ACL = "You are not allowed to modify 'Sales Order' (sale.order) records.\n\nThis operation is allowed for the following groups:\n"
  + '\t- Sales / User: All Documents\n\t- Sales / Administrator\n\nContact your administrator to request access if necessary.';
const RULE = "Uh-oh! Looks like you have stumbled upon some top-secret records.\n\nSorry, Marc Demo (id=7) doesn't have 'write' access to:\n"
  + '- Sales Order (sale.order)\n\nIf you really, really need access, perhaps you can win over your friendly administrator with a batch of freshly baked cookies.';
const RULE_DEBUG = "Uh-oh! Looks like you have stumbled upon some top-secret records.\n\nSorry, Marc Demo (id=7) doesn't have 'read' access to:\n"
  + '- Sales Order, S00042 (sale.order: 42)\n- Sales Order, S00043 (sale.order: 43, company=My Company (San Francisco))\n\n'
  + 'Blame the following rules:\n- Personal Orders\n- Sales Order multi-company\n\n'
  + 'If you really, really need access, perhaps you can win over your friendly administrator with a batch of freshly baked cookies.\n\n'
  + 'Note: this might be a multi-company issue. Switching company may help - in Odoo, not in real life!';

test('an ACL error: model, operation, the groups that would allow it', () => {
  assert.deepEqual(parseAccessError(ACL), { kind: 'acl', model: 'sale.order', ids: [], mode: 'write', user: null, rules: [],
    groups: ['Sales / User: All Documents', 'Sales / Administrator'] });
});

test('a record rule error: the user, the operation, the model', () => {
  assert.deepEqual(parseAccessError(RULE), { kind: 'rule', model: 'sale.order', ids: [], mode: 'write', user: { name: 'Marc Demo', id: 7 },
    rules: [], groups: [] });
});

test('in debug mode: the records (company suffix too) and the rules blamed', () => {
  const p = parseAccessError(RULE_DEBUG)!;
  assert.deepEqual(p.ids, [42, 43]);
  assert.equal(p.mode, 'read');
  assert.deepEqual(p.rules, ['Personal Orders', 'Sales Order multi-company']);
});

test('translated: the operation is unknown, the rest is still read', () => {
  const vi = 'Rất tiếc, Marc Demo (id=7) không có quyền \'ghi\' trên:\n- Đơn bán, S00042 (sale.order: 42)\n\nCác quy tắc sau gây ra lỗi:\n- Personal Orders';
  const p = parseAccessError(vi)!;
  assert.equal(p.kind, 'rule');
  assert.equal(p.mode, null);
  assert.deepEqual([p.model, p.ids, p.user?.id, p.rules], ['sale.order', [42], 7, ['Personal Orders']]);
  assert.equal(parseAccessError('Something else went wrong'), null);
});

test('the access a call needs, and its ids', () => {
  assert.equal(modeOfCall('web_save', [[], {}]), 'create');
  assert.equal(modeOfCall('web_save', [[3], {}]), 'write');
  assert.equal(modeOfCall('web_read', [[3]]), 'read');
  assert.equal(modeOfCall('unlink', [[3]]), 'unlink');
  assert.equal(modeOfCall('action_confirm', [[3]]), null);
  assert.deepEqual(idsOfCall([[3, 4], ['name']]), [3, 4]);
  assert.deepEqual(idsOfCall([[['state', '=', 'draft']]]), []);
});

test('20 (ir.access): \'delete\' for unlink, "Blame the following accesses", web_unlink', () => {
  const msg = "Uh-oh! Looks like you have stumbled upon some top-secret records.\n\nSorry, Marc Demo (id=7) doesn't have 'delete' access to:\n"
    + '- Sales Order, S00042 (sale.order: 42)\n\nBlame the following accesses:\n- Personal Orders\n\n'
    + 'If you really, really need access, perhaps you can win over your friendly administrator with a batch of freshly baked cookies.';
  const p = parseAccessError(msg)!;
  assert.deepEqual([p.kind, p.model, p.ids, p.mode, p.rules], ['rule', 'sale.order', [42], 'unlink', ['Personal Orders']]);
  assert.equal(modeOfCall('web_unlink', [[42]]), 'unlink');
});
