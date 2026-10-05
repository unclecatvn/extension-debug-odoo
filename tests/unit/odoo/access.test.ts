import assert from 'node:assert/strict';
import { test } from 'node:test';
import { accessPerms, aclOf, restricts, ruleOf, type IrAccess } from '../../../src/odoo/access.ts';

const row = (group: number | false, operation: string, domain: string | false = false): IrAccess =>
  ({ id: 5, name: 'a', model_id: [3, 'Sales Order'], group_id: group ? [group, 'G'] : false, operation, domain });

test('ir.access operation letters → the four operations (u = write, d = unlink)', () => {
  assert.deepEqual(accessPerms('ru'), { perm_read: true, perm_write: true, perm_create: false, perm_unlink: false });
  assert.deepEqual(accessPerms('crud'), { perm_read: true, perm_write: true, perm_create: true, perm_unlink: true });
  assert.deepEqual(accessPerms('d'), { perm_read: false, perm_write: false, perm_create: false, perm_unlink: true });
});

test('a permission is an ACL and a group rule; a restriction only a global rule', () => {
  assert.deepEqual(aclOf(row(10, 'cr')), { id: 5, name: 'a', group_id: [10, 'G'], model_id: [3, 'Sales Order'],
    perm_read: true, perm_write: false, perm_create: true, perm_unlink: false });
  assert.equal(aclOf(row(false, 'r', "[('company_id', 'in', company_ids)]")), null);
  const perm = ruleOf(row(10, 'r', "[('user_id', '=', user.id)]"));
  assert.deepEqual([perm.global, perm.groups, perm.domain_force], [false, [10], "[('user_id', '=', user.id)]"]);
  const restriction = ruleOf(row(false, 'rud', "[('company_id', 'in', company_ids)]"));
  assert.deepEqual([restriction.global, restriction.groups, restriction.perm_create], [true, [], false]);
  assert.equal(ruleOf(row(10, 'r')).domain_force, false);
});

test('a domain restricts unless empty', () => {
  assert.equal(restricts(false), false);
  assert.equal(restricts(' [ ] '), false);
  assert.equal(restricts("[('active', '=', True)]"), true);
});
