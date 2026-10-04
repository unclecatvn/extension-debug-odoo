import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MENUS, actionDomain, actionPath, availableMenus } from '../../../../src/features/menus/menus.logic.ts';

test('every menu opens an action named by its xmlid, once', () => {
  for (const m of MENUS) assert.match(m.action, /^[a-z_]+\.[a-z_]+$/, m.label);
  assert.equal(new Set(MENUS.map((m) => m.action)).size, MENUS.length);
  assert.equal(new Set(MENUS.map((m) => m.label)).size, MENUS.length);
});

test('actionPath, actionDomain', () => {
  assert.equal(actionPath('base.action_rule'), 'action-base.action_rule');
  const menus = [{ label: 'Rules', action: 'base.action_rule', model: 'ir.rule' }, { label: 'Views', action: 'base.action_ui_view', model: 'ir.ui.view' },
    { label: 'Templates', action: 'mail.action_tmpl', model: 'mail.template' }];
  assert.deepEqual(actionDomain(menus), [['module', 'in', ['base', 'mail']], ['name', 'in', ['action_rule', 'action_ui_view', 'action_tmpl']]]);
  // without the mail module its menu goes; an xmlid of the same name in another module is not the action
  const rows = [{ module: 'base', name: 'action_ui_view' }, { module: 'base', name: 'action_rule' }, { module: 'base', name: 'action_tmpl' }];
  assert.deepEqual(availableMenus(menus, rows).map((m) => m.label), ['Rules', 'Views'], "in the menus' order");
  assert.deepEqual(availableMenus(menus, []), []);
});

test('Record Rules until 19, Access Rights (ir.access) on 20: each shows where its action exists', () => {
  const on = (names: string[]) => availableMenus(MENUS, names.map((name) => ({ module: 'base', name }))).map((m) => m.model);
  assert.deepEqual(on(['action_rule']), ['ir.rule']);
  assert.deepEqual(on(['ir_access_action']), ['ir.access']);
});
