import assert from 'node:assert/strict';
import { MENUS, actionPath, actionDomain, availableMenus } from '../extension/src/features/menus/logic.js';

// every menu opens an action named by its xmlid, once
for (const m of MENUS) assert.match(m.action, /^[a-z_]+\.[a-z_]+$/, m.label);
assert.equal(new Set(MENUS.map((m) => m.action)).size, MENUS.length);
assert.equal(new Set(MENUS.map((m) => m.label)).size, MENUS.length);

assert.equal(actionPath('base.action_rule'), 'action-base.action_rule');

const menus = [{ label: 'Rules', action: 'base.action_rule' }, { label: 'Views', action: 'base.action_ui_view' }, { label: 'Templates', action: 'mail.action_tmpl' }];
assert.deepEqual(actionDomain(menus), [['module', 'in', ['base', 'mail']], ['name', 'in', ['action_rule', 'action_ui_view', 'action_tmpl']]]);

// without the mail module its menu goes; an xmlid of the same name in another module is not the action
const rows = [{ module: 'base', name: 'action_ui_view' }, { module: 'base', name: 'action_rule' }, { module: 'base', name: 'action_tmpl' }];
assert.deepEqual(availableMenus(menus, rows).map((m) => m.label), ['Rules', 'Views'], 'in the menus\' order');
assert.deepEqual(availableMenus(menus, []), []);
