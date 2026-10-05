import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  definingModules, accessSummary, accessLevel, byApp, compareGroups, copyGroups, directGroups, failingRules, groupsSpecAllows, impliedBy, managerState, modeVerdict, newGrants, ruleEvalContext, rulesVerdict, shortGroupName, unavailableNames, unblockers, usesAccessOperator, type Rule, type VerdictInput,
} from '../../../../src/features/security/security.logic.ts';
import type { IrModelAccess } from '../../../../src/odoo/models.ts';

const acl = (id: number, group: number | false, perms: string): IrModelAccess => ({
  id, name: `acl${id}`, group_id: group ? [group, `G${group}`] : false,
  perm_read: perms.includes('r'), perm_write: perms.includes('w'), perm_create: perms.includes('c'), perm_unlink: perms.includes('d'),
});
const rule = (id: number, groups: number[], perms = 'rwcd', via?: Rule['via']): Rule => ({
  id, name: `rule${id}`, groups, global: !groups.length, domain_force: '[]',
  perm_read: perms.includes('r'), perm_write: perms.includes('w'), perm_create: perms.includes('c'), perm_unlink: perms.includes('d'), ...(via ? { via } : {}),
});

// sale.order: salesman (10) reads/writes/creates, manager (11, implies 10) deletes too; salesman's own orders rule (101),
// manager's all orders rule (102), a global multi-company rule (100)
const SALES: Omit<VerdictInput, 'groupIds' | 'passed'> = {
  superuser: false, resId: 42,
  acls: [acl(1, 10, 'rwc'), acl(2, 11, 'rwcd')],
  rules: [rule(100, []), rule(101, [10]), rule(102, [11])],
};
const closure = (id: number) => new Set(id === 11 ? [11, 10] : [id]);

test('rules: global AND, group rules OR, a parent through _inherits as one more global', () => {
  const p = (o: Record<number, boolean>) => new Map(Object.entries(o).map(([k, v]) => [Number(k), v]));
  const rs = [rule(1, []), rule(2, [10]), rule(3, [11])];
  assert.equal(rulesVerdict(rs, p({ 1: true, 2: false, 3: true })), true);
  assert.equal(rulesVerdict(rs, p({ 1: true, 2: false, 3: false })), false);
  assert.equal(rulesVerdict(rs, p({ 1: false, 2: true, 3: true })), false);
  assert.equal(rulesVerdict(rs, p({ 1: true, 2: false })), null); // rule 3 could not be evaluated
  const parent = [rule(7, [], 'rwcd', { model: 'res.partner', link: 'partner_id' }), rule(8, [10], 'rwcd', { model: 'res.partner', link: 'partner_id' })];
  assert.equal(rulesVerdict([...rs, ...parent], p({ 1: true, 2: true, 3: true, 7: true, 8: false })), false);
  assert.deepEqual(failingRules([...rs, ...parent], p({ 1: true, 2: true, 3: true, 7: true, 8: false })).map((r) => [r.id, r.via?.link]), [[8, 'partner_id']]);
  assert.deepEqual(failingRules(rs, p({ 1: true, 2: false, 3: false })).map((r) => r.id), [2, 3]);
});

test('a salesman on someone else\'s order: write refused by the rules; the manager group allows it, and the rest too', () => {
  const input = { ...SALES, groupIds: new Set([10]), passed: new Map([[100, true], [101, false], [102, true]]) };
  const write = modeVerdict(input, 'write');
  assert.deepEqual([write.ok, write.why, write.failing.map((r) => r.id)], [false, 'rules', [101]]);
  assert.deepEqual([modeVerdict(input, 'unlink').ok, modeVerdict(input, 'unlink').why], [false, 'no-acl']);
  assert.deepEqual(unblockers(input, 'write', closure), [{ id: 11, adds: [11], also: ['read', 'create', 'unlink'] }]); // rule 101 covers every operation
  assert.deepEqual(modeVerdict({ ...input, resId: null }, 'write').why, 'model-only');
  assert.equal(modeVerdict({ ...input, superuser: true }, 'unlink').ok, true);
});

test('what a group opens elsewhere: the operations on other models the user had not', () => {
  const row = (model: [number, string], group: number | false, perms: string) => ({ model_id: model, group_id: group ? [group, ''] as [number, string] : false as const,
    perm_read: perms.includes('r'), perm_write: perms.includes('w'), perm_create: perms.includes('c'), perm_unlink: perms.includes('d') });
  const rows = [row([1, 'Sales Order'], 10, 'rwc'), row([1, 'Sales Order'], 11, 'rwcd'), row([2, 'Pricelist'], 11, 'rw'), row([2, 'Pricelist'], false, 'r')];
  assert.deepEqual(newGrants(rows, new Set([10]), [11]), [{ model: 'Pricelist', modes: ['write'] }, { model: 'Sales Order', modes: ['unlink'] }]);
});

test('the evaluation context: the selected companies, the first one current; `time` is gone in 19', () => {
  const ctx = ruleEvalContext({ id: 7, login: 'marc', partner_id: 3, commercial_partner_id: 1, company_id: 1, company_ids: [1, 2], employee_id: false,
    employee_ids: [], groupIds: [10] }, [2, 1]);
  assert.deepEqual([ctx.company_ids, ctx.company_id, ctx.user.company_ids.ids, ctx.user.partner_id.commercial_partner_id.id], [[2, 1], 2, [1, 2], 1]);
  assert.deepEqual(unavailableNames("[('date', '<=', time.strftime('%Y-%m-%d'))]", ['user', 'company_ids', 'company_id']), ['time']);
  assert.deepEqual(unavailableNames("[('date', '<=', time.strftime('%Y-%m-%d'))]", ['user', 'time']), []);
  assert.deepEqual(unavailableNames("[('name', '=', 'time.x')]", []), []);
});

test('groups: set on the user vs implied, by application, compared, copied', () => {
  const implied = (id: number) => new Set(id === 11 ? [10, 1] : id === 10 ? [1] : []);
  assert.deepEqual([...directGroups(new Set([1, 10, 11, 5]), implied)], [11, 5]);
  assert.deepEqual(Object.fromEntries(impliedBy(new Set([1, 10, 11]), implied)), { 1: [10, 11], 10: [11] });
  const apps = byApp([{ id: 1, full_name: 'Sales / User', app: 'Sales' }, { id: 2, full_name: 'Portal', app: '' }, { id: 3, full_name: 'Accounting / Billing', app: 'Accounting' }]);
  assert.deepEqual(apps.map((a) => a.app), ['Accounting', 'Sales', '']);
  assert.equal(shortGroupName(apps[1]!.groups[0]!), 'User');
  assert.deepEqual(compareGroups(new Set([1, 2, 3]), new Set([2, 4])), { onlyA: [1, 3], onlyB: [4], both: 1 });
  assert.deepEqual(copyGroups([1, 2], [2, 4], 'add'), { adds: [4], removes: [], commands: [[4, 4]] });
  assert.deepEqual(copyGroups([1, 2], [2, 4], 'same'), { adds: [4], removes: [1], commands: [[6, 0, [2, 4]]] });
});

test('groups="…" as has_groups reads it', () => {
  const has = (x: string) => x === 'base.group_user';
  assert.equal(groupsSpecAllows('base.group_user,!base.group_portal', has), true);
  assert.equal(groupsSpecAllows('base.group_system', has), false);
  assert.equal(groupsSpecAllows('!base.group_user', has), false);
  assert.equal(groupsSpecAllows('!base.group_portal', has), true);
});

test('the database manager, read from its markup in any language', () => {
  const list = '<div class="col-lg-6 offset-lg-3 o_database_list">';
  assert.deepEqual(managerState(200, `${list}<div class="alert alert-danger text-center">Trình quản lý đã bị tắt</div>`), { status: 200, reachable: true, disabled: true, insecure: false });
  assert.equal(managerState(200, `${list}<div class="alert alert-warning">Cảnh báo…<br/><a href="#" data-bs-toggle="modal" data-bs-target=".o_database_master">đặt</a></div>`).insecure, true);
  assert.equal(managerState(200, `${list}<div class="alert alert-danger">bad password</div>`).disabled, false);
  assert.equal(managerState(404, 'Not Found').reachable, false);
});

test('the record matrix: group rules alone, the fixes merged per group', async () => {
  const { groupRulesVerdict, fixes } = await import('../../../../src/features/security/security.logic.ts');
  const p = new Map([[101, false], [102, true]]);
  assert.equal(groupRulesVerdict([rule(101, [10])], p), false);
  assert.equal(groupRulesVerdict([rule(101, [10]), rule(102, [11])], p), true);
  assert.equal(groupRulesVerdict([], p), true);
  const input = { ...SALES, groupIds: new Set([10]), passed: new Map([[100, true], [101, false], [102, true]]) };
  assert.deepEqual(fixes(input, closure), [{ id: 11, adds: [11], allows: ['read', 'write', 'create', 'unlink'] }]);
});

test('rights per model from the ACLs, and the module of a model', async () => {
  const { modelRights, firstModule } = await import('../../../../src/features/security/security.logic.ts');
  const row = (model: [number, string], group: number | false, perms: string) => ({ model_id: model, group_id: group ? [group, ''] as [number, string] : false as const,
    perm_read: perms.includes('r'), perm_write: perms.includes('w'), perm_create: perms.includes('c'), perm_unlink: perms.includes('d') });
  const m = modelRights([row([1, 'Sales Order'], 10, 'rw'), row([1, 'Sales Order'], 11, 'rwcd'), row([2, 'Country'], false, 'r'), row([3, 'Pricelist'], 11, 'r')], new Set([10]));
  assert.deepEqual([...m.values()].map((x) => [x.model[1], [...x.modes]]), [['Sales Order', ['read', 'write']], ['Country', ['read']]]);
  assert.equal(firstModule('sale, sale_stock'), 'sale');
  assert.equal(firstModule(false), '');
});

test('the session companies as a tree: parents first, a disallowed ancestor flagged', async () => {
  const { companyTree } = await import('../../../../src/features/security/security.logic.ts');
  const c = (id: number, name: string, parent: number | false, children: number[], sequence = 10) => ({ id, name, sequence, parent_id: parent, child_ids: children });
  const tree = companyTree({ current_company: 2,
    allowed_companies: { 2: c(2, 'SF', 1, [4]), 3: c(3, 'Chicago', 1, []), 4: c(4, 'SF Shop', 2, []), 9: c(9, 'Other', false, [], 5) },
    disallowed_ancestor_companies: { 1: c(1, 'Holding', false, [2, 3]) } });
  assert.deepEqual(tree.map((t) => `${'  '.repeat(t.depth)}${t.company.name}${t.allowed ? '' : ' ×'}`), ['Other', 'Holding ×', '  Chicago', '  SF', '    SF Shop']);
});

test('the user attributes the rules read, and a short evaluation error', async () => {
  const { userPaths, shortError } = await import('../../../../src/features/security/security.logic.ts');
  assert.deepEqual(userPaths([
    "['|', ('crm_group_id', 'child_of', user.manager_crm_group_ids.ids), ('user_id', '=', user.id)]",
    "[('department_id', '=', user.employee_id.department_id.id), ('name', '=', 'user.fake')]",
    "[('x', 'in', user.manager_crm_group_ids.ids)]",
  ]), [['manager_crm_group_ids', 'ids'], ['id'], ['employee_id', 'department_id', 'id']]);
  assert.equal(shortError("Can not evaluate python expression: ([\n  '|',\n])\nError: Cannot read properties of undefined (reading 'ids')"),
    "Cannot read properties of undefined (reading 'ids')");
});

test('definingModules: the oldest xmlid of a model names the module creating it, not ir.model.modules\' first (sorted by name)', () => {
  const rows = [
    { id: 900, module: 'account', res_id: 7 }, // account extends res.groups: its xmlid is newer
    { id: 12, module: 'base', res_id: 7 },
    { id: 950, module: 'account', res_id: 8 },
    { id: 990, module: 'account_asset', res_id: 8 },
  ];
  assert.deepEqual([...definingModules(rows)], [[7, 'base'], [8, 'account']]);
});

test('accessLevel / accessSummary: a model\'s access in words, summed per module', () => {
  assert.equal(accessLevel(new Set(['read', 'write', 'create', 'unlink'] as const)), 'full');
  assert.equal(accessLevel(new Set(['read'] as const)), 'read');
  assert.equal(accessLevel(new Set(['read', 'write'] as const)), 'partial');
  assert.equal(accessLevel(undefined), 'none');
  assert.deepEqual(accessSummary([{ level: 'full', rules: 1 }, { level: 'full', rules: 0 }, { level: 'read', rules: 2 }, { level: 'partial', rules: 0 }]),
    { full: 2, read: 1, partial: 1, ruled: 2 });
});

test('20 (ir.access as ACLs and rules): permissions OR-ed, one without domain opens every record; no permission on a parent refuses', () => {
  const p = (o: Record<number, boolean>) => new Map(Object.entries(o).map(([k, v]) => [Number(k), v]));
  // permissions: salesman (10) own orders (201), manager (11) every order (202, no domain); restriction: company (200)
  const input: VerdictInput = { superuser: false, resId: 42, groupRulesRequired: true, groupIds: new Set([10, 11]),
    acls: [acl(201, 10, 'rwc'), acl(202, 11, 'rwcd')], rules: [rule(200, []), rule(201, [10], 'rwc'), rule(202, [11])],
    passed: p({ 200: true, 201: false, 202: true }) };
  assert.equal(modeVerdict(input, 'write').ok, true);
  assert.equal(modeVerdict({ ...input, passed: p({ 200: false, 201: true, 202: true }) }, 'write').ok, false); // the restriction
  const parent = rule(300, [12], 'rwcd', { model: 'res.partner', link: 'partner_id' }); // a permission of a group the user lacks
  const withParent = { ...input, rules: [...input.rules, parent], passed: p({ 200: true, 201: false, 202: true, 300: true }) };
  assert.deepEqual([modeVerdict(withParent, 'read').ok, modeVerdict(withParent, 'read').why], [false, 'parent']);
  assert.equal(modeVerdict({ ...withParent, resId: null }, 'read').ok, false); // refused at model level too
  assert.equal(modeVerdict({ ...withParent, groupRulesRequired: false }, 'read').ok, true); // 18 / 19: no group rule, no restriction
  assert.equal(modeVerdict({ ...input, parents: ['res.partner'] }, 'read').ok, false); // a parent with no ir.access at all
  assert.equal(modeVerdict({ ...withParent, groupIds: new Set([10, 11, 12]) }, 'read').ok, true);
});

test('the access operator of 20 domains', () => {
  assert.equal(usesAccessOperator(['|', ['move_id', 'access', 'read'], ['user_id', '=', 7]]), true);
  assert.equal(usesAccessOperator([['user_id', '=', 7]]), false);
});
