import assert from 'node:assert/strict';
import { aclGrants, rulesFor, rulesVerdict, modeVerdict, unblockers, ruleEvalContext, auditModel, checkInstance, userRisks, groupTree } from '../extension/src/features/security/logic.js';

const P = (r, w, c, u) => ({ perm_read: r, perm_write: w, perm_create: c, perm_unlink: u });
const mine = new Set([10, 11]);
const acls = [{ name: 'user', group_id: [10, 'User'], ...P(1, 1, 0, 0) }, { name: 'mgr', group_id: [99, 'Mgr'], ...P(1, 1, 1, 1) }];
assert.deepEqual(aclGrants(acls, mine, 'write').map((a) => a.name), ['user']);
assert.deepEqual(aclGrants(acls, mine, 'unlink'), []);
assert.equal(aclGrants([{ name: 'all', group_id: false, ...P(1, 0, 0, 0) }], new Set(), 'read').length, 1);

const rules = [
  { id: 1, global: true, groups: [], ...P(1, 1, 1, 1) },
  { id: 2, global: false, groups: [10], ...P(1, 0, 0, 0) },
  { id: 3, global: false, groups: [11], ...P(1, 0, 0, 0) },
  { id: 4, global: false, groups: [99], ...P(1, 1, 1, 1) },
];
assert.deepEqual(rulesFor(rules, mine, 'read').map((r) => r.id), [1, 2, 3]);
assert.deepEqual(rulesFor(rules, mine, 'write').map((r) => r.id), [1]);
const V = (ids, pass) => rulesVerdict(rules.filter((r) => ids.includes(r.id)), new Map(pass));
assert.equal(V([1, 2, 3], [[1, true], [2, false], [3, true]]), true);   // one group rule is enough
assert.equal(V([1, 2, 3], [[1, true], [2, false], [3, false]]), false); // no group rule passes
assert.equal(V([1, 2, 3], [[1, false], [2, true], [3, true]]), false);  // global rule blocks
assert.equal(V([1, 2, 3], [[1, true], [2, false]]), null);              // rule 3 unknown
assert.equal(V([1, 2, 3], [[2, true], [3, true]]), null);               // global unknown
assert.equal(V([1], [[1, true]]), true);
assert.equal(V([], []), true);

const MV = (mode, resId, pass, u = { id: 7 }) => modeVerdict({ u, groupIds: mine, acls, rules, mode, resId, passed: new Map(pass) }).ok;
assert.equal(MV('unlink', 5, [], { id: 1 }), true);                    // superuser
assert.equal(MV('unlink', 5, []), false);                              // no ACL
assert.equal(MV('write', false, []), true);                            // ACL, no record
assert.equal(MV('read', 5, [[1, true], [2, false], [3, true]]), true);
assert.equal(MV('read', 5, [[1, false], [2, true], [3, true]]), false);
assert.equal(MV('read', 5, [[1, true]]), null);                        // group rules unknown

const closure = (id) => new Set(id === 99 ? [99, 12] : [id]); // Mgr implies group 12
const UB = (mode, resId, pass) => unblockers({ u: { id: 7 }, groupIds: mine, acls, rules, mode, resId, passed: new Map(pass), closure });
assert.deepEqual(UB('unlink', false, []), [{ id: 99, adds: [99, 12] }]);  // no ACL: Mgr's ACL, plus what it implies
assert.deepEqual(UB('unlink', 5, [[1, true], [4, true]]), [{ id: 99, adds: [99, 12] }]);
assert.deepEqual(UB('unlink', 5, [[1, true], [4, false]]), []);          // Mgr's rule doesn't match the record
assert.deepEqual(UB('unlink', 5, [[1, false], [4, true]]), []);          // a global rule blocks: no group helps

const ctx = ruleEvalContext({ id: 7, login: 'e', partner_id: [3, 'E'], commercial_partner_id: 30, company_id: [1, 'C'], company_ids: [1, 2] });
assert.equal(ctx.user.partner_id.commercial_partner_id.id, 30); assert.equal(ctx.user.commercial_partner_id.id, 30);
assert.deepEqual(ctx.company_ids, [1, 2]); assert.equal(ctx.company_id, 1); assert.equal(ctx.user.employee_id.id, false);

const lv = (xs) => xs.map((x) => x.level);
const portal = new Map([[50, 'base.group_portal']]);
assert.deepEqual(lv(auditModel({ fields: {}, acls: [], rules: [], groupXml: portal })), ['info']);
assert.deepEqual(lv(auditModel({ fields: {}, acls: [{ name: 'x', group_id: false, ...P(1, 1, 0, 0) }], rules: [], groupXml: portal })), ['high']);
assert.deepEqual(lv(auditModel({ fields: {}, acls: [{ name: 'x', group_id: [50, ''], ...P(1, 0, 0, 0) }], rules: [], groupXml: portal })), ['low']);
const co = { company_id: { type: 'many2one', relation: 'res.company' } };
assert.deepEqual(lv(auditModel({ fields: co, acls: acls, rules: [], groupXml: portal })), ['med']);
assert.deepEqual(lv(auditModel({ fields: co, acls: acls, rules: [{ global: true, domain_force: "[('company_id', 'in', company_ids)]" }], groupXml: portal })), []);
assert.deepEqual(lv(auditModel({ fields: { api_key: { type: 'char' }, x_token: { type: 'char', groups: 'base.group_system' } }, acls, rules: [], groupXml: portal })), ['low']);

const good = { host: 'erp.x.com', protocol: 'https:', headers: { 'strict-transport-security': '1', 'x-frame-options': 'DENY', 'x-content-type-options': 'nosniff', 'content-security-policy': "frame-ancestors 'self'" }, manager: { reachable: true, disabled: true }, dbList: null, version: null };
assert.deepEqual(checkInstance(good, { httpOnly: true, secure: true, sameSite: 'lax' }), []);
assert.deepEqual(lv(checkInstance({ ...good, manager: { reachable: true, insecure: true } }, { httpOnly: true, secure: true })), ['high']);
assert.deepEqual(lv(checkInstance({ ...good, manager: { reachable: true } , dbList: ['a'] }, { httpOnly: false, secure: false, sameSite: 'no_restriction' })), ['high', 'high', 'med', 'high', 'med']);
assert.deepEqual(lv(checkInstance({ ...good, host: 'localhost', protocol: 'http:', headers: {}, manager: {} }, null)), ['info', 'info', 'med', 'low', 'low']);

const has = (set) => (n) => set.includes(n);
assert.deepEqual(userRisks({ id: 2, login: 'admin', totp_enabled: false, share: false }, has(['group_system', 'group_erp_manager'])).map((x) => x.level), ['high', 'med', 'high']);
assert.deepEqual(userRisks({ id: 9, login: 'e', totp_enabled: true, share: false, api_key_ids: [1] }, has(['group_user'])).map((x) => x.level), ['med']);
assert.deepEqual(userRisks({ id: 9, login: 'p', share: true }, has(['group_portal'])).map((x) => x.level), ['info', 'info']);

// admin → manager → user, sales manager → user: user under both
const imp = { 1: [2], 2: [3], 4: [3], 3: [] };
const gt = groupTree([1, 2, 3, 4], (id) => imp[id]);
assert.deepEqual(gt.roots, [1, 4]);
assert.deepEqual([gt.kidsOf(1), gt.kidsOf(2), gt.kidsOf(4), gt.kidsOf(3)], [[2], [3], [3], []]);
assert.deepEqual([gt.below(1), gt.below(4), gt.below(3)], [2, 1, 0]);
const gt19 = groupTree([2, 3], (id) => [id, ...imp[id]]); // 19: a group counts itself
assert.deepEqual([gt19.roots, gt19.kidsOf(2), gt19.below(2)], [[2], [3], 1]);
