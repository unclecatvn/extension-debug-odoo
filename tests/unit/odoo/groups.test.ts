import assert from 'node:assert/strict';
import { test } from 'node:test';
import { groupsLabel, parseGroups } from '../../../src/odoo/groups.ts';

test('a groups spec: parsed, then shown by group name', () => {
  
  assert.deepEqual(parseGroups('base.group_user, base.group_portal,!base.group_system'),
    [{ xmlid: 'base.group_user', not: false }, { xmlid: 'base.group_portal', not: false }, { xmlid: 'base.group_system', not: true }]);
  const names = new Map([['base.group_system', 'Administration / Settings'], ['base.group_portal', 'User types / Portal']]);
  assert.equal(groupsLabel('base.group_system', names), 'Administration / Settings');
  assert.equal(groupsLabel('base.group_user,!base.group_portal', names), 'base.group_user · not User types / Portal'); // unknown name: the xmlid
  assert.equal(groupsLabel('!base.group_portal', names), 'not User types / Portal');
});
