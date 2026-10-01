import assert from 'node:assert/strict';
import { pickGroupField, localTime } from '../extension/src/shared/odoo.js';

assert.equal(pickGroupField({ group_ids: {}, all_group_ids: {} }), 'all_group_ids');
assert.equal(pickGroupField({ groups_id: {} }), 'groups_id');
assert.equal(pickGroupField({}), null);

// UTC timestamps show on the browser's clock: ISO (RPC log), server datetime and profiling session name (Perf)
const at = new Date(2026, 8, 30, 16, 5, 9); // local
const iso = at.toISOString();
assert.equal(localTime(iso), '16:05:09');
assert.equal(localTime(iso.slice(0, 19).replace('T', ' ')), '16:05:09');
assert.equal(localTime(`${iso.slice(0, 19).replace('T', ' ')} Administrator`), '16:05:09');
assert.equal(localTime(undefined), ''); assert.equal(localTime(false), ''); assert.equal(localTime('t'), '');
