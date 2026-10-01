import assert from 'node:assert/strict';
import { sqlSummary, appFrame, isAsset, diagnose, shortPath, describeQuery, hotspots } from '../extension/src/features/perf/logic.js';

const sq = sqlSummary([{ query: 'A', time: 1 }, { query: 'B', time: 5 }, { query: 'A', time: 2 }]);
assert.equal(sq.count, 3); assert.equal(sq.time, 8);
assert.deepEqual(sq.dups.map((g) => [g.query, g.count, g.time]), [['A', 2, 3]]);
assert.deepEqual(sq.slow.map((e) => e.time), [5, 2, 1]);

assert.deepEqual(appFrame([['/srv/odoo/addons/sale/models/sale_order.py', 9, 'f', ''], ['/srv/odoo/odoo/orm/models.py', 1, 'read', '']]),
  ['/srv/odoo/addons/sale/models/sale_order.py', 9, 'f', '']);
assert.equal(appFrame([]), null);

assert.ok(isAsset('/web/service-worker.js') && isAsset('/web/image?model=res.users&field=avatar_128&id=2') && isAsset('/bus/websocket_worker_bundle?v=18.0-7'));
assert.ok(!isAsset('/web/dataset/call_kw/sale.order/web_read') && !isAsset('/odoo/orders/16') && !isAsset('/mail/data'));

const dup = (n) => sqlSummary(Array.from({ length: n }, () => ({ query: 'A', time: 0.001 })));
assert.equal(diagnose(0.02, dup(5)), 'n1'); // N+1 even when fast: it grows with the records
assert.equal(diagnose(0.02, dup(2)), 'fast');
assert.equal(diagnose(1, sqlSummary([{ query: 'A', time: 0.6 }])), 'sql');
assert.equal(diagnose(1, sqlSummary([{ query: 'A', time: 0.1 }])), 'python');

assert.equal(shortPath('/usr/lib/python3/dist-packages/odoo/addons/calendar/models/res_partner.py'), 'calendar/models/res_partner.py');
assert.equal(shortPath('/mnt/extra-addons/my_mod/models/x.py'), 'my_mod/models/x.py');
assert.equal(shortPath('/home/u/odoo/odoo/models.py'), 'odoo/models.py');

assert.deepEqual(describeQuery('SELECT "res_partner"."id" FROM "res_partner" WHERE 1'), { op: 'read', table: 'res_partner' });
assert.deepEqual(describeQuery('UPDATE "sale_order" SET "x" = 1'), { op: 'write', table: 'sale_order' });
assert.deepEqual(describeQuery('INSERT INTO "mail_message" ("a") VALUES (1)'), { op: 'create', table: 'mail_message' });
assert.deepEqual(describeQuery('WITH t AS (SELECT 1 FROM a) DELETE FROM "b" WHERE 1'), { op: 'delete', table: 'b' });

// a sample lasts until the next one; the stdlib (threading) and the ORM are skipped for the module code under them
const ctl = ['/x/odoo/addons/web/controllers/dataset.py', 1, 'call_kw', ''], mine = ['/x/odoo/addons/sale/models/so.py', 9, '_compute', 'for so in self:'];
const orm = ['/x/odoo/odoo/models.py', 5, 'read', ''], thr = ['/usr/lib/python3.12/threading.py', 3, 'wait', ''];
const hs = hotspots([{ start: 0, stack: [ctl, mine, orm] }, { start: 0.3, stack: [ctl] }, { start: 0.4, stack: [thr] }, { start: 0.5, stack: [] }],
  [{ stack: [ctl, mine, orm], time: 0.1 }, { stack: [ctl, mine, orm], time: 0.05 }]);
assert.deepEqual(hs.map((h) => [h.frame[2], +h.time.toFixed(2), +h.sql.toFixed(2), h.count, h.path.map((f) => f[2])]),
  [['_compute', 0.3, 0.15, 2, ['call_kw']], ['call_kw', 0.1, 0, 0, []]]);
