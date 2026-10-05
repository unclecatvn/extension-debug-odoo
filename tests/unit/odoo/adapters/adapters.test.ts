import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SUPPORTED } from '../../../../src/odoo/version.ts';
import { ADAPTERS, missingFields } from '../../../../src/odoo/detect.ts';

test('every supported major has its adapter, under its own number', () => {
  for (const major of SUPPORTED) assert.equal(ADAPTERS[major].major, major);
});

test('each adapter self-checks the fields it names', () => {
  for (const a of Object.values(ADAPTERS)) {
    const checked = new Set(a.expects.map((e) => `${e.model}.${e.field}`));
    for (const f of [`res.users.${a.users.allGroupsField}`, `res.users.${a.users.writeGroupsField}`, `res.groups.${a.groups.impliedField}`,
      `res.groups.${a.groups.appField}`, `res.groups.${a.groups.usersField}`, ...a.modules.uninstallWizard.impactedFields.map((f) => `base.module.uninstall.${f}`)]) {
      assert.ok(checked.has(f), `v${a.major} uses ${f} without checking it`);
    }
  }
});

test('ORM method lists: model-level reads are read methods; each version keeps only its public API', () => {
  for (const a of Object.values(ADAPTERS)) {
    const read = new Set(a.orm.readMethods);
    for (const m of a.orm.modelMethods) if (m !== 'create' && m !== 'name_create') assert.ok(read.has(m), `v${a.major}: ${m}`);
  }
  const { 18: v18, 19: v19, 20: v20 } = ADAPTERS;
  assert.ok(!v18.orm.readMethods.includes('formatted_read_group')); // added in 19
  assert.ok(v19.orm.readMethods.includes('formatted_read_group'));
  for (const m of ['check_access_rights', 'check_access_rule']) assert.ok(!v20.orm.readMethods.includes(m)); // removed in 20
  assert.ok(!v20.orm.readMethods.includes('exists')); // @api.private
  for (const m of ['search_fetch', 'check_access']) { // @api.private in 19
    assert.ok(v18.orm.readMethods.includes(m));
    assert.ok(!v19.orm.readMethods.includes(m));
  }
});

test('record rules: `time` reaches the domains of 18 and 20, not 19', () => {
  assert.ok(ADAPTERS[18].rules.evalNames.includes('time'));
  assert.ok(!ADAPTERS[19].rules.evalNames.includes('time'));
  assert.ok(ADAPTERS[20].rules.evalNames.includes('time'));
});

test('access: ACLs and rules until 19, ir.access in 20 (no permission refuses, every parent checked)', () => {
  assert.deepEqual([ADAPTERS[18].access, ADAPTERS[19].access, ADAPTERS[20].access], ['split', 'split', 'unified']);
  assert.deepEqual([ADAPTERS[18].rules.groupRulesRequired, ADAPTERS[19].rules.groupRulesRequired, ADAPTERS[20].rules.groupRulesRequired], [false, false, true]);
  assert.equal(ADAPTERS[20].rules.inheritsStoredOnly, false);
  assert.ok(ADAPTERS[20].rules.inheritsUnchecked.parents.includes('mail.alias'));
});

test('JSON-2 in 20: read_group\'s new signature, web_unlink, no exists', () => {
  const api = ADAPTERS[20].api;
  assert.equal(api.kind, 'json2');
  if (api.kind !== 'json2') return;
  assert.deepEqual(api.signatures.read_group?.params, ['domain', 'groupby', 'aggregates', 'having', 'offset', 'limit', 'order']);
  assert.deepEqual(api.signatures.web_unlink, { params: [], model: false });
  assert.equal(api.signatures.exists, undefined);
  assert.equal(api.signatures.web_read, (ADAPTERS[19].api as typeof api).signatures.web_read);
});

test('20: get_str, formatted_read_group, binaries read with load=web', () => {
  assert.deepEqual([ADAPTERS[19].profiler.paramGetter, ADAPTERS[20].profiler.paramGetter], ['get_param', 'get_str']);
  assert.deepEqual([ADAPTERS[19].orm.groupMethod, ADAPTERS[20].orm.groupMethod], ['read_group', 'formatted_read_group']);
  assert.deepEqual([ADAPTERS[19].orm.binaryRead, ADAPTERS[20].orm.binaryRead], ['bin_size', 'web']);
});

test('the webclient translations route: a unique segment in 18, none since 19', () => {
  assert.ok(ADAPTERS[18].i18n.webTranslationsPath.includes('{unique}'));
  assert.equal(ADAPTERS[19].i18n.webTranslationsPath, '/web/webclient/translations');
  assert.equal(ADAPTERS[20].i18n.webTranslationsPath, '/web/webclient/translations');
});

test('modules: the uninstall wizard takes one module in 18, several since 19, applications apart in 20; only 19 refuses while modules wait', () => {
  assert.deepEqual(ADAPTERS[18].modules, { uninstallWizard: { moduleField: 'module_id', many: false, impactedFields: ['module_ids'], showAll: true }, refusesWhilePending: false });
  assert.deepEqual(ADAPTERS[19].modules, { uninstallWizard: { moduleField: 'module_ids', many: true, impactedFields: ['impacted_module_ids'], showAll: true }, refusesWhilePending: true });
  assert.deepEqual(ADAPTERS[20].modules, { uninstallWizard: { moduleField: 'module_ids', many: true, impactedFields: ['impacted_application_ids', 'impacted_module_ids'], showAll: false },
    refusesWhilePending: false });
});

test('speedscope: one profile in 18 (only while profiling is allowed), several side by side in 19', () => {
  assert.deepEqual([ADAPTERS[18].profiler.speedscopeMany, ADAPTERS[18].profiler.speedscopeNeedsEnabled], [false, true]);
  assert.deepEqual([ADAPTERS[19].profiler.speedscopeMany, ADAPTERS[19].profiler.speedscopeNeedsEnabled], [true, false]);
  assert.ok(!ADAPTERS[18].profiler.listFields.includes('cpu_duration'));
  assert.ok(ADAPTERS[19].profiler.listFields.includes('cpu_duration'));
});

test('self-check: missing fields', () => {
  const expects = ADAPTERS[19].expects;
  assert.deepEqual(missingFields(expects, Object.fromEntries(expects.map((e) => [e.model, expects.filter((x) => x.model === e.model).map((x) => x.field)]))), []);
  const missing = missingFields(expects, { 'res.users': ['group_ids', 'all_group_ids'], 'res.groups': ['all_implied_ids', 'privilege_id', 'all_user_ids'],
    'base.module.uninstall': ['impacted_module_ids'] }); // ir.profile unreadable
  assert.deepEqual(missing.map((m) => `${m.model}.${m.field}`), ['ir.profile.cpu_duration']);
});
