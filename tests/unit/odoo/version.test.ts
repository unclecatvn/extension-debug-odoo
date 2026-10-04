import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseVersion, pickMajor } from '../../../src/odoo/version.ts';

test('server_version_info → version', () => {
  assert.deepEqual(parseVersion([18, 0, 0, 'final', 0, ''], '18.0'), { major: 18, minor: 0, saas: false, label: '18.0' });
  assert.deepEqual(parseVersion(['saas~18', 2, 0, 'final', 0, '']), { major: 18, minor: 2, saas: true, label: 'saas~18.2' });
  assert.deepEqual(parseVersion([19, 0, 0, 'final', 0, 'e'], '19.0+e'), { major: 19, minor: 0, saas: false, label: '19.0+e' });
  assert.equal(parseVersion(undefined), null);
  assert.equal(parseVersion(['master']), null);
});

test('the adapter and how far it is trusted', () => {
  const pick = (info: (number | string)[]) => pickMajor(parseVersion(info)!);
  assert.deepEqual(pick([18, 0]), { major: 18, support: 'tested' });
  assert.deepEqual(pick([19, 0]), { major: 19, support: 'tested' });
  assert.deepEqual(pick(['saas~18', 4]), { major: 18, support: 'untested' }); // between 18 and 19: the 18 adapter
  assert.deepEqual(pick([20, 0]), { major: 20, support: 'tested' });
  assert.deepEqual(pick(['saas~19', 2]), { major: 19, support: 'untested' });
  assert.deepEqual(pick([21, 0]), { major: 20, support: 'untested' }); // newer: the newest adapter
  assert.deepEqual(pick([17, 0]), { major: 18, support: 'unsupported' }); // older: the oldest adapter
});
