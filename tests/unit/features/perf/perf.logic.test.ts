import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  appFrame, callerOf, compare, describeQuery, diagnose, FRAMEWORK_CALLER, delta, frameText, hotspots, isAsset, isOwnRequest, isSessionOf, ms, normalizeQuery, parseSamples,
  parseSql, requestName, sessionLabel, shortFile, sqlSummary, type Frame, type ProfileRow, type SqlEntry,
} from '../../../../src/features/perf/perf.logic.ts';

const ORM: Frame = ['/srv/odoo/odoo/orm/models.py', 3000, 'read', ''];
const SQL_DB: Frame = ['/srv/odoo/odoo/sql_db.py', 350, 'execute', ''];
const LOOP: Frame = ['/srv/addons/my_sale/models/sale_order.py', 42, '_compute_margin', ''];
const OTHER: Frame = ['/srv/odoo/addons/sale/models/sale_order.py', 120, 'action_confirm', ''];
const q = (query: string, time: number, app: Frame): SqlEntry => ({ query, full_query: `${query} -- values`, time, stack: [app, ORM, SQL_DB] });

test('requestName: a call_kw as method and model, any other route as it is', () => {
  assert.deepEqual(requestName('/web/dataset/call_kw/res.users/web_read?'), { method: 'web_read', model: 'res.users' });
  assert.deepEqual(requestName('/web/action/load?'), { route: '/web/action/load' });
  assert.deepEqual(requestName('/odoo/sales?debug=1'), { route: '/odoo/sales?debug=1' });
});

test('the panel\'s own requests are recognised; a session is a user\'s', () => {
  assert.ok(isOwnRequest('/web/dataset/call_kw/ir.profile/search_read?odoo_debug_panel=1'));
  assert.ok(isOwnRequest('/web/session/get_session_info?a=1&odoo_debug_panel=1'));
  assert.ok(!isOwnRequest('/web/dataset/call_kw/sale.order/web_read?'));
  assert.ok(!isOwnRequest('/web/dataset/call_kw/sale.order/web_read?odoo_debug_panel=10'));
  assert.ok(isSessionOf('2026-10-02 09:14:03 Mitchell Admin', 'Mitchell Admin'));
  assert.ok(!isSessionOf('2026-10-02 09:14:03 Marc Demo', 'Mitchell Admin'));
  assert.equal(sessionLabel('2026-10-02 09:14:03 Mitchell Admin', '2026-10-02'), '09:14:03');
  assert.equal(sessionLabel('2026-10-01 18:00:00 Mitchell Admin', '2026-10-02'), '2026-10-01 18:00:00');
});

test('appFrame: the line of an addon under the ORM, not the framework', () => {
  assert.deepEqual(appFrame([LOOP, ORM, SQL_DB]), LOOP);
  assert.deepEqual(appFrame([OTHER, LOOP, ['/usr/lib/python3.12/site-packages/psycopg2/x.py', 1, 'f', '']]), LOOP, 'a library is framework too');
  assert.deepEqual(appFrame([ORM, SQL_DB]), SQL_DB, 'nothing but framework: the innermost');
  assert.equal(appFrame([]), null);
  assert.equal(shortFile(LOOP[0]), 'my_sale/models/sale_order.py');
  assert.equal(shortFile(OTHER[0]), 'sale/models/sale_order.py');
  assert.equal(frameText(LOOP), 'my_sale/models/sale_order.py:42 _compute_margin()');
  assert.equal(callerOf([LOOP, ORM, SQL_DB]), 'my_sale/models/sale_order.py:42 _compute_margin()');
  assert.equal(callerOf([ORM, SQL_DB]), FRAMEWORK_CALLER, 'no addon line: the framework');
});

test('sqlSummary: totals, repeated statements (N+1) and the lines sending them', () => {
  const loop = Array.from({ length: 5 }, () => q('SELECT "price" FROM "product" WHERE id IN %s', 0.002, LOOP));
  const entries = [...loop, q('SELECT  "name"\n FROM "res_partner" WHERE id = %s', 0.004, OTHER), q('SELECT "name" FROM "res_partner" WHERE id = %s', 0.001, LOOP),
    q('UPDATE "sale_order" SET x = %s', 0.05, OTHER)];
  const s = sqlSummary(entries);
  assert.equal(s.count, 8);
  assert.ok(Math.abs(s.time - 0.065) < 1e-9);
  assert.deepEqual(s.repeated.map((g) => [g.query, g.count]), [
    ['SELECT "price" FROM "product" WHERE id IN %s', 5],
    ['SELECT "name" FROM "res_partner" WHERE id = %s', 2], // the same statement, whatever the spacing
  ]);
  assert.deepEqual(s.repeated[1]!.callers, ['sale/models/sale_order.py:120 action_confirm()', 'my_sale/models/sale_order.py:42 _compute_margin()']);
  assert.deepEqual(s.callers.map((c) => [c.caller, c.count, c.queries]), [
    ['my_sale/models/sale_order.py:42 _compute_margin()', 6, 2],
    ['sale/models/sale_order.py:120 action_confirm()', 2, 2],
  ]);
  assert.equal(s.slowest[0]!.query, 'UPDATE "sale_order" SET x = %s');
});

test('parseSql: ir.profile.sql as stored, or nothing', () => {
  assert.deepEqual(parseSql(JSON.stringify([{ query: 'SELECT 1', time: 0.1 }, { nope: 1 }])), [{ query: 'SELECT 1', time: 0.1 }]);
  assert.deepEqual(parseSql(false), []);
  assert.deepEqual(parseSql('not json'), []);
});

test('compare: a request against its baseline, before / after a fix', () => {
  const row = (id: number, sql: number, duration: number): ProfileRow => ({ id, name: '/x', session: 's', duration, sql_count: sql, create_date: false });
  const before = sqlSummary([...Array.from({ length: 10 }, () => q('SELECT a FROM t WHERE id = %s', 0.001, LOOP)), q('SELECT b', 0.001, LOOP), q('SELECT b', 0.001, LOOP)]);
  const after = sqlSummary([q('SELECT a FROM t WHERE id IN %s', 0.002, LOOP), q('SELECT b', 0.001, LOOP), q('SELECT b', 0.001, LOOP), q('SELECT b', 0.001, LOOP),
    q('SELECT c', 0, LOOP), q('SELECT c', 0, LOOP)]);
  const c = compare({ row: row(1, 12, 0.3), sum: before }, { row: row(2, 6, 0.1), sum: after });
  assert.deepEqual(c.sql, [12, 6]);
  assert.deepEqual(c.gone.map((g) => g.query), ['SELECT a FROM t WHERE id = %s']);
  assert.deepEqual(c.added.map((g) => g.query), ['SELECT c']);
  assert.deepEqual(c.kept, [{ query: 'SELECT b', before: 2, after: 3 }]);
});

test('ms / delta / normalizeQuery', () => {
  assert.equal(ms(0.0123), '12 ms');
  assert.equal(ms(1.2345), '1.23 s');
  assert.equal(ms(undefined), '0 ms');
  assert.equal(delta(12, 6), '−6');
  assert.equal(delta(1, 3), '+2');
  assert.equal(delta(2, 2), '±0');
  assert.equal(delta(0.3, 0.1, ms), '−200 ms');
  assert.equal(normalizeQuery('SELECT  a\n\tFROM t '), 'SELECT a FROM t');
});

test('appFrame: a pip-installed Odoo\'s addons are addons, Python\'s own library is framework', () => {
  const pip: Frame = ['/venv/lib/python3.12/site-packages/odoo/addons/sale/models/sale_order.py', 9, '_compute', ''];
  assert.deepEqual(appFrame([pip, ['/usr/lib/python3.12/threading.py', 3, 'wait', '']]), pip);
  assert.deepEqual(appFrame([pip, ['<frozen genericpath>', 19, 'exists', '']]), pip, 'a frozen module of the interpreter is Python\'s own');
});

test('isAsset: static files and the webclient\'s plumbing, not the calls', () => {
  assert.ok(isAsset('/web/service-worker.js') && isAsset('/web/image?model=res.users&field=avatar_128&id=2') && isAsset('/bus/websocket_worker_bundle?v=18.0-7'));
  assert.ok(!isAsset('/web/dataset/call_kw/sale.order/web_read') && !isAsset('/odoo/orders/16') && !isAsset('/mail/data'));
});

test('diagnose: N+1 first (even fast), then fast, then where the time goes', () => {
  const dup = (n: number) => sqlSummary(Array.from({ length: n }, () => q('SELECT 1', 0.001, LOOP)));
  assert.equal(diagnose(0.02, dup(5)), 'n1');
  assert.equal(diagnose(0.02, dup(2)), 'fast');
  assert.equal(diagnose(1, sqlSummary([q('SELECT 1', 0.6, LOOP)])), 'sql');
  assert.equal(diagnose(1, sqlSummary([q('SELECT 1', 0.1, LOOP)])), 'python');
});

test('describeQuery: what a statement does, on which table', () => {
  assert.deepEqual(describeQuery('SELECT "res_partner"."id" FROM "res_partner" WHERE 1'), { op: 'read', table: 'res_partner' });
  assert.deepEqual(describeQuery('UPDATE "sale_order" SET "x" = 1'), { op: 'write', table: 'sale_order' });
  assert.deepEqual(describeQuery('INSERT INTO "mail_message" ("a") VALUES (1)'), { op: 'create', table: 'mail_message' });
  assert.deepEqual(describeQuery('WITH t AS (SELECT 1 FROM a) DELETE FROM "b" WHERE 1'), { op: 'delete', table: 'b' });
  assert.deepEqual(describeQuery('SAVEPOINT x'), { op: 'other', table: '' });
});

test('hotspots: a sample lasts until the next one; the stdlib and the ORM are skipped for the module code under them', () => {
  const ctl: Frame = ['/x/odoo/addons/web/controllers/dataset.py', 1, 'call_kw', ''];
  const mine: Frame = ['/x/odoo/addons/sale/models/so.py', 9, '_compute', 'for so in self:'];
  const orm: Frame = ['/x/odoo/odoo/models.py', 5, 'read', ''];
  const thr: Frame = ['/usr/lib/python3.12/threading.py', 3, 'wait', ''];
  const hs = hotspots([{ start: 0, stack: [ctl, mine, orm] }, { start: 0.3, stack: [ctl] }, { start: 0.4, stack: [thr] }, { start: 0.5, stack: [] }],
    [{ query: 'A', stack: [ctl, mine, orm], time: 0.1 }, { query: 'A', stack: [ctl, mine, orm], time: 0.05 }]);
  assert.deepEqual(hs.map((h) => [h.frame[2], +h.time.toFixed(2), +h.sql.toFixed(2), h.count, h.path.map((f) => f[2])]),
    [['_compute', 0.3, 0.15, 2, ['call_kw']], ['call_kw', 0.1, 0, 0, []]]);
  assert.deepEqual(parseSamples('[{"start":1,"stack":[]},{"x":1}]'), [{ start: 1, stack: [] }]);
  assert.deepEqual(parseSamples('not json'), []);
});
