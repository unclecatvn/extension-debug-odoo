import assert from 'node:assert/strict';
import { test } from 'node:test';
import { codeKey, formatValue, printText, cellText, toTable, callStats, isRecordset, completionAt, rankSuggestions, tokenize, smartEdit } from '../extension/src/features/code/logic.js';
import { pageRunCode, pageSoftReload } from '../extension/src/features/code/page.js';

// ---------- logic ----------
assert.equal(codeKey('http://localhost:8068'), 'odoo-debug-orm-code:http://localhost:8068');
assert.notEqual(codeKey('http://localhost:8068'), codeKey('http://localhost:8069'));
assert.equal(codeKey(undefined), 'odoo-debug-orm-code:');
const rs = { $recordset: 'res.partner', ids: [1, 2] };
assert.equal(isRecordset(rs), true);
assert.equal(isRecordset([1]), false);
assert.equal(formatValue(rs), 'res.partner(1, 2)');
assert.equal(formatValue('a'), '"a"');
assert.equal(formatValue({ p: rs }), '{\n  "p": "res.partner(1, 2)"\n}');
assert.equal(printText(['count', 3, rs]), 'count 3 res.partner(1, 2)');

assert.equal(cellText([3, 'Azure']), 'Azure #3');
assert.equal(cellText([1, 2, 3]), '1, 2, 3');
assert.equal(cellText(false), 'false');
assert.equal(cellText(null), '');
assert.equal(cellText(rs), 'res.partner(1, 2)');
assert.equal(cellText({ a: 1 }), '{"a":1}');

assert.equal(toTable([]), null);
assert.equal(toTable([1, 2]), null);
assert.equal(toTable([rs]), null);
assert.equal(toTable({ id: 1 }), null);
const t = toTable([{ name: 'A', id: 1 }, { id: 2, name: 'B', extra: [4, 'X'] }], 1);
assert.deepEqual(t.columns, ['id', 'name', 'extra']);
assert.deepEqual(t.rows, [['1', 'A', '']]);
assert.equal(t.total, 2);

assert.deepEqual(callStats([{ write: true }, { error: 'x' }, {}]), { total: 3, writes: 1, written: 1 });
assert.equal(callStats([{ write: true, error: 'refused' }]).written, 0);

// ---------- pageRunCode against a fake call_kw ----------
const DB = {
  'res.partner': {
    fields: { name: { type: 'char' }, country_id: { type: 'many2one', relation: 'res.country' }, category_id: { type: 'many2many', relation: 'res.partner.category' } },
    rows: { 1: { name: 'A', country_id: 10, category_id: [5, 6] }, 2: { name: 'B', country_id: 10, category_id: [6] }, 3: { name: 'C', country_id: false, category_id: [] } },
  },
  'res.country': { fields: { code: { type: 'char' } }, rows: { 10: { code: 'VN' } } },
};

function server(log) {
  return async (url, init) => {
    const { params } = JSON.parse(init.body);
    const { model, method, args, kwargs } = params;
    log.push({ url, model, method, args, kwargs });
    const m = DB[model];
    const reply = (result) => ({ json: async () => ({ jsonrpc: '2.0', result }) });
    const err = (message, name) => ({ json: async () => ({ jsonrpc: '2.0', error: { message: 'Odoo Server Error', data: { message, name, debug: 'Traceback…' } } }) });
    if (method === 'search') return reply(Object.keys(m.rows).map(Number).filter((id) => !args[0].length || args[0].some(([f, , v]) => f === 'id' && v.includes(id))));
    if (method === 'fields_get') return reply(Object.fromEntries(args[0].map((f) => [f, m.fields[f]])));
    if (method === 'read') {
      const load = kwargs.load !== false;
      return reply(args[0].map((id) => Object.fromEntries([['id', id], ...kwargs.fields.map((f) => {
        const v = m.rows[id][f];
        return [f, load && m.fields[f].type === 'many2one' && v ? [v, `#${v}`] : v];
      })])));
    }
    if (method === 'write' && !('name' in args[1])) { for (const id of args[0]) Object.assign(m.rows[id], args[1]); return reply(true); }
    if (method === 'write') return err('You are not allowed to modify this document', 'odoo.exceptions.AccessError');
    if (method === 'check_object_reference') return reply(['res.partner', 1]);
    if (method === 'action_confirm') return reply(true);
    return err(`no ${method}`, 'builtins.AttributeError');
  };
}

async function run(code, opts = {}) {
  const log = [];
  globalThis.window = { fetch: server(log), odoo: opts.odoo };
  const r = await pageRunCode(code, { context: { lang: 'en_US', uid: 2, allowed_company_ids: [1] }, ...opts });
  return { r, log };
}

test('search, read and the user context', async () => {
  const { r, log } = await run(`const rs = await env['res.partner'].search([]);\nprint('n', rs.length, rs);\nreturn rs.read(['name']);`);
  assert.equal(r.ok, true, r.error?.message);
  assert.deepEqual(r.out, [['n', 3, { $recordset: 'res.partner', ids: [1, 2, 3] }]]);
  assert.deepEqual(r.value.map((x) => x.name), ['A', 'B', 'C']);
  assert.equal(log[0].url, '/web/dataset/call_kw/res.partner/search');
  assert.deepEqual(log[0].args, [[]]); // model-level: no ids
  assert.deepEqual(log[1].args, [[1, 2, 3]]); // record-level: ids first
  assert.deepEqual(log[1].kwargs.context, { lang: 'en_US', uid: 2, allowed_company_ids: [1] });
  assert.equal(r.calls.length, 2);
  assert.equal(r.readonly, true);
});

test('the webclient user context wins over the panel fallback; with_context merges', async () => {
  const odoo = { loader: { modules: new Map([['@web/core/user', { user: { context: { lang: 'vi_VN', uid: 9, allowed_company_ids: [3, 4] } } }]]) } };
  const { r, log } = await run(`const rs = env['res.partner'].browse([1]).with_context({ active_test: false });\nawait rs.read(['name']);\nreturn [env.uid, env.company, env.companies, env.user];`, { odoo });
  assert.equal(r.ok, true, r.error?.message);
  assert.deepEqual(log[0].kwargs.context, { lang: 'vi_VN', uid: 9, allowed_company_ids: [3, 4], active_test: false });
  assert.deepEqual(r.value, [9, { $recordset: 'res.company', ids: [3] }, { $recordset: 'res.company', ids: [3, 4] }, { $recordset: 'res.users', ids: [9] }]);
});

test('mapped follows many2one / many2many hops and dedupes', async () => {
  const { r } = await run(`const rs = env['res.partner'].browse([1, 2, 3]);\nreturn [await rs.mapped('country_id.code'), await rs.mapped('category_id'), await rs.mapped('name')];`);
  assert.equal(r.ok, true, r.error?.message);
  assert.deepEqual(r.value, [['VN'], { $recordset: 'res.partner.category', ids: [5, 6] }, ['A', 'B', 'C']]);
  const bad = await run(`return env['res.partner'].browse([1]).mapped('name.x');`);
  assert.equal(bad.r.ok, false);
  assert.equal(bad.r.error.msgid, '%s.%s is not relational');
});

test('read-only blocks writes before they are sent', async () => {
  const { r, log } = await run(`await env['res.partner'].browse([1]).write({ name: 'X' });`);
  assert.equal(r.ok, false);
  assert.match(r.error.msgid, /blocked in read-only mode/);
  assert.deepEqual(r.error.args, ['res.partner.write']);
  assert.equal(log.length, 0);
  const proxied = await run(`await env['sale.order'].browse([1]).action_confirm();`);
  assert.equal(proxied.r.ok, false);
  assert.equal(proxied.log.length, 0);
});

test('writes allowed: server errors come back with type and traceback; unknown methods go through with ids first', async () => {
  const { r, log } = await run(`return env['res.partner'].browse([1]).write({ name: 'X' });`, { readonly: false });
  assert.equal(r.ok, false);
  assert.equal(r.error.type, 'odoo.exceptions.AccessError');
  assert.equal(r.error.traceback, 'Traceback…');
  assert.equal(r.error.server, true);
  assert.equal(r.calls[0].write, true);
  assert.equal(r.calls[0].error, 'You are not allowed to modify this document');
  assert.equal(log.length, 1);
  const ok = await run(`return env['res.partner'].browse([4]).action_confirm();`, { readonly: false });
  assert.equal(ok.r.value, true);
  assert.deepEqual(ok.log[0].args, [[4]]);
});

test('awaiting a recordset or env does not call the server; env.ref', async () => {
  const { r, log } = await run(`const rs = await env['res.partner'].browse(1);\nreturn [rs, (await env.ref('base.partner_admin')).id];`);
  assert.equal(r.ok, true, r.error?.message);
  assert.deepEqual(r.value, [{ $recordset: 'res.partner', ids: [1] }, 1]);
  assert.deepEqual(log.map((c) => c.method), ['check_object_reference']);
  assert.deepEqual(log[0].args, ['base', 'partner_admin', true]);
});

test('errors in the code report their line; no return value; Command', async () => {
  const { r } = await run(`const a = 1;\nnull.x;`);
  assert.equal(r.ok, false);
  assert.equal(r.error.line, 2);
  assert.equal(r.error.name, 'TypeError');
  const syntax = await run(`return (;`);
  assert.equal(syntax.r.ok, false);
  assert.equal(syntax.r.error.name, 'SyntaxError');
  const none = await run(`print(Command.set([1, 2]), Command.link(3));`);
  assert.equal(none.r.ok, true);
  assert.equal(none.r.hasValue, false);
  assert.deepEqual(none.r.out, [[[6, 0, [1, 2]], [4, 3, 0]]]);
});

test('ensure_one, filtered_domain, circular values', async () => {
  const one = await run(`env['res.partner'].browse([1, 2]).ensure_one();`);
  assert.equal(one.r.error.msgid, 'Expected singleton: %s');
  assert.deepEqual(one.r.error.args, ['res.partner(1, 2)']);
  const fd = await run(`return env['res.partner'].browse([3, 1, 9]).filtered_domain([['name', '!=', false]]);`);
  assert.deepEqual(fd.r.value, { $recordset: 'res.partner', ids: [3, 1] });
  assert.deepEqual(fd.log[0].kwargs.context.active_test, false);
  const circ = await run(`const o = { a: 1 }; o.self = o; return o;`);
  assert.deepEqual(circ.r.value, { a: 1, self: '[Circular]' });
});

test('field access like Python: a = browse(…); return a.state', async () => {
  const { r, log } = await run(`a = env['res.partner'].browse(1)\nreturn a.name`);
  assert.equal(r.ok, true, r.error?.message);
  assert.equal(r.value, 'A');
  assert.equal(globalThis.window.a, undefined); // `a = …` stays in the run's scope
  assert.deepEqual(log.map((c) => c.method), ['fields_get', 'read']);
  assert.deepEqual(log[1].args, [[1]]);
  assert.deepEqual(log[1].kwargs.fields, ['name']);
});

test('paths, empty and multi recordsets, member ends', async () => {
  const { r } = await run(`const a = env['res.partner'].browse(1);
return [a.country_id.code, a.country_id, a.country_id.id, a.category_id.ids, env['res.partner'].browse(3).country_id.code,
  env['res.partner'].browse([]).name, await a.name];`);
  assert.equal(r.ok, true, r.error?.message);
  assert.deepEqual(r.value, ['VN', { $recordset: 'res.country', ids: [10] }, 10, [5, 6], false, false, 'A']);
  const multi = await run(`return env['res.partner'].browse([1, 2]).name;`);
  assert.equal(multi.r.error.msgid, 'Expected singleton: %s');
  const notRel = await run(`return env['res.partner'].browse(1).name.code;`);
  assert.equal(notRel.r.error.msgid, '%s.%s is not relational');
  const noField = await run(`return env['res.partner'].browse(1).nope;`);
  assert.equal(noField.r.error.msgid, '%s has no field %s');
});

test('iterating prefetches: one read per field for the whole recordset; print settles values', async () => {
  const { r, log } = await run(`const rs = await env['res.partner'].search([]);
for (const p of rs) print(p.id, p.name, await p.name);`);
  assert.equal(r.ok, true, r.error?.message);
  assert.deepEqual(r.out, [[1, 'A', 'A'], [2, 'B', 'B'], [3, 'C', 'C']]);
  assert.deepEqual(log.map((c) => c.method), ['search', 'fields_get', 'read']);
  assert.deepEqual(log[2].args, [[1, 2, 3]]);
});

test('a write clears the values read before it; methods through a path', async () => {
  const { r, log } = await run(`const c = env['res.country'].browse(10);
const before = await c.code;
await c.write({ code: 'FR' });
const after = await c.code;
const viaPath = await env['res.partner'].browse(1).country_id.read(['code']);
await c.write({ code: 'VN' });
return [before, after, viaPath[0].code];`, { readonly: false });
  assert.equal(r.ok, true, r.error?.message);
  assert.deepEqual(r.value, ['VN', 'FR', 'FR']);
  assert.equal(log.filter((c) => c.method === 'read').length, 4);
});

test('using a field without await says so; scope keeps page globals safe', async () => {
  const { r } = await run(`const a = env['res.partner'].browse(1);\nif (a.name == 'A') return 1;`);
  assert.equal(r.ok, false);
  assert.equal(r.error.msgid, '%s is read from the server: await it before using its value');
  assert.deepEqual(r.error.args, ['res.partner.name']);
  assert.equal(r.error.line, 2);
  const g = await run(`name = 'x'\nreturn [name, Math.max(1, 2), typeof fetch]`);
  assert.deepEqual(g.r.value, ['x', 2, 'function']); // globals are still readable
  assert.equal(globalThis.name, undefined); // … but `name = …` did not write one
  const undef = await run(`return missing_var`);
  assert.equal(undef.r.error.name, 'ReferenceError');
});

test('completionAt: what to suggest where the cursor is', () => {
  const at = (s) => completionAt(s.replace('|', ''), s.indexOf('|'));
  assert.deepEqual(at("env['sale.or|"), { kind: 'model', prefix: 'sale.or', from: 5 });
  assert.deepEqual(at('env["|'), { kind: 'model', prefix: '', from: 5 });
  const so = "const so = await env['sale.order'].search([['sta|";
  assert.deepEqual(at(so), { kind: 'field', model: 'sale.order', path: [], prefix: 'sta', from: so.indexOf('|') - 3 });
  assert.deepEqual(at("env['sale.order'];\nso.mapped('partner_id.coun|')").path, ['partner_id']);
  assert.equal(at("env['sale.order'];\nprint('done'|"), null, 'after a closing quote');
  assert.equal(at("print('x|"), null, 'a string before any env[...]');
  assert.deepEqual(at("env['sale.order'];\nso.partner_id.na|"), { kind: 'member', model: 'sale.order', path: ['partner_id'], prefix: 'na', from: 33, on: 'so' });
  assert.deepEqual(at("env['res.partner'].sea|"), { kind: 'member', model: 'res.partner', path: [], prefix: 'sea', from: 19, on: null });
  assert.equal(at('env.|').on, 'env');
  assert.deepEqual(at('ret|'), { kind: 'global', prefix: 'ret', from: 0 });
  assert.equal(at('x = 1 |'), null);
});

test('completionAt: a variable has the model it was assigned from, not the last env[...] written', () => {
  const at = (s) => completionAt(s.replace('|', ''), s.indexOf('|'));
  const code = "partners = await env['res.partner'].search([])\nconst orders = await env['sale.order'].search([])\n";
  assert.deepEqual(at(code + 'partners.na|'), { kind: 'member', model: 'res.partner', path: [], prefix: 'na', from: code.length + 9, on: 'partners' });
  assert.equal(at(code + 'orders.partner_id.na|').model, 'sale.order');
  assert.deepEqual(at(code + 'orders.partner_id.na|').path, ['partner_id']);
  // through another variable and a loop: the path follows the relations
  const loop = code + 'const line_ids = orders.order_line\nfor (const l of orders.order_line) print(l.pro|';
  assert.deepEqual([at(loop).model, at(loop).path], ['sale.order', ['order_line']]);
  assert.deepEqual(at(code + 'const first = partners.partner_id\nfirst.na|').path, ['partner_id']);
  // a variable reassigned goes with its new model; `==` is not an assignment
  assert.equal(at(code + "partners = env['res.users'].browse(1)\npartners.lo|").model, 'res.users');
  assert.equal(at("x = env['a.b']\nif (x == env['c.d']) x.f|").model, 'a.b');
  // env.user & co
  assert.deepEqual([at('env.user.partner_id.na|').model, at('env.user.partner_id.na|').path, at('env.user.partner_id.na|').on], ['res.users', ['partner_id'], null]);
  assert.equal(at('u = env.company\nu.na|').model, 'res.company');
  assert.equal(at("env['res.partner'];\nenv.us|").on, 'env');
  // strings: the fields of the variable whose method is called
  const so = code + "orders.mapped('partner_id.co|";
  assert.deepEqual([at(so).kind, at(so).model, at(so).path, at(so).prefix], ['field', 'sale.order', ['partner_id'], 'co']);
  assert.equal(at(code + "partners.filtered_domain([['na|").model, 'res.partner');
  assert.equal(at(code + "env['sale.order'].search([['na|").model, 'sale.order'); // no variable: the last env[…]
});

test('tokenize: colours, half-typed code included, every character kept', () => {
  const code = "const a = await env['sale.order'].search([['x', '=', 1]]) // hi\nprint('un";
  const t = tokenize(code);
  assert.equal(t.map(([, x]) => x).join(''), code);
  const of = (type) => t.filter(([k]) => k === type).map(([, x]) => x);
  assert.deepEqual(of('kw'), ['const', 'await']);
  assert.deepEqual(of('builtin'), ['env', 'print']);
  assert.deepEqual(of('string'), ["'sale.order'", "'x'", "'='", "'un"]);
  assert.deepEqual(of('fn'), ['search']); // after a dot and before a "(": a call
  assert.deepEqual(of('number'), ['1']);
  assert.deepEqual(of('comment'), ['// hi']);
  assert.deepEqual(tokenize('rec.state, a.b(1)').filter(([k]) => k).map(([k, x]) => `${k}:${x}`), ['fn:b', 'number:1']);
  assert.deepEqual(tokenize('/* open'), [['comment', '/* open']]);
});

test('smartEdit: pairs, skipping the closer, Backspace, Enter', () => {
  const edit = (s, key) => { // "|" is the caret, «…» a selection → [the text after the edit, the selection]
    const sel = /«(.*)»/.exec(s);
    const plain = s.replace(/[«»|]/g, '');
    const from = sel ? sel.index : s.indexOf('|');
    const e = smartEdit(plain, from, sel ? from + sel[1].length : from, key);
    return e && [plain.slice(0, e.from) + e.text + plain.slice(e.to), e.select];
  };
  assert.deepEqual(edit('env|', '['), ['env[]', [4, 4]]);
  assert.deepEqual(edit("env[|]", "'"), ["env['']", [5, 5]]);
  assert.deepEqual(edit("env['|']", "'"), ["env['']", [6, 6]], 'the closing quote is skipped');
  assert.deepEqual(edit('f(a|)', ')'), ['f(a)', [4, 4]]);
  assert.deepEqual(edit('a|b', '('), null, 'not before a word');
  assert.deepEqual(edit('don|', "'"), null, 'an apostrophe after a word');
  assert.deepEqual(edit("'a|'", '('), null, 'nothing paired inside a string');
  assert.deepEqual(edit('x = «ab»', '('), ['x = (ab)', [5, 7]], 'a selection is wrapped');
  assert.deepEqual(edit('f(|)', 'Backspace'), ['f', [1, 1]], 'both of an empty pair');
  assert.deepEqual(edit("f(a|)", 'Backspace'), null);
  assert.deepEqual(edit('  a = 1|', 'Enter'), ['  a = 1\n  ', [10, 10]], 'keeps the indent');
  assert.deepEqual(edit('f({|})', 'Enter'), ['f({\n  \n})', [6, 6]], 'the closer moves to its own line');
  assert.deepEqual(edit('if (x) {|', 'Enter'), ['if (x) {\n  ', [11, 11]]);
  assert.deepEqual(edit('a|', 'ArrowLeft'), null);
});

test('rankSuggestions: prefix matches first, then the ones containing it, not the word already typed', () => {
  const items = ['partner_id', 'partner_invoice_id', 'company_id', 'user_id'].map((label) => ({ label }));
  assert.deepEqual(rankSuggestions(items, 'part').map((i) => i.label), ['partner_id', 'partner_invoice_id']);
  assert.deepEqual(rankSuggestions(items, '_id').map((i) => i.label), ['partner_id', 'partner_invoice_id', 'company_id', 'user_id']);
  assert.deepEqual(rankSuggestions(items, 'user_id'), []);
  assert.equal(rankSuggestions(items, '').length, 4);
  assert.deepEqual(rankSuggestions(['name_search', 'name_get', 'name', 'x'].map((label) => ({ label })), 'na').map((i) => i.label), ['name', 'name_get', 'name_search']);
});

test('assigning a field writes it, in order with the other calls', async () => {
  const { r, log } = await run(`a = env['res.country'].browse(10)\nreturn a.code = 'FR'`, { readonly: false });
  assert.equal(r.ok, true, r.error?.message);
  assert.equal(r.value, 'FR');
  assert.deepEqual(log.map((c) => [c.method, c.args]), [['write', [[10], { code: 'FR' }]]]);

  const seq = await run(`a = env['res.country'].browse(10)
const before = await a.code
a.code = 'DE'
const after = await a.code
a.code = 'VN'
return [before, after]`, { readonly: false });
  assert.deepEqual(seq.r.value, ['FR', 'DE']);
  assert.deepEqual(seq.log.map((c) => c.method), ['fields_get', 'read', 'write', 'read', 'write']);
});

test('assignment through a path, of a recordset, on many records, on an empty one', async () => {
  const { r, log } = await run(`const p = env['res.partner'].browse(1)
p.country_id.code = 'JP'
p.country_id = env['res.country'].browse(10)
p.category_id = env['res.partner.category'].browse([5])
env['res.partner'].browse([2, 3]).country_id = false
env['res.partner'].browse([]).country_id = false
return p.country_id.code`, { readonly: false });
  assert.equal(r.ok, true, r.error?.message);
  assert.equal(r.value, 'JP');
  const writes = log.filter((c) => c.method === 'write').map((c) => [c.model, c.args]);
  assert.deepEqual(writes, [
    ['res.country', [[10], { code: 'JP' }]],
    ['res.partner', [[1], { country_id: 10 }]],
    ['res.partner', [[1], { category_id: [[6, 0, [5]]] }]],
    ['res.partner', [[2, 3], { country_id: false }]],
  ]);
});

test('assignment errors: read-only, server refusal (at the assignment line), members', async () => {
  const ro = await run(`a = env['sale.order'].browse(25)\na.state = 'sent'`);
  assert.equal(ro.r.ok, false);
  assert.deepEqual(ro.r.error.args, ['sale.order.state']);
  assert.equal(ro.r.error.line, 2);
  assert.equal(ro.log.length, 0);

  const refused = await run(`const p = env['res.partner'].browse(1)\np.name = 'X'\nprint('after')\nreturn await p.country_id.code`, { readonly: false });
  assert.equal(refused.r.ok, false);
  assert.equal(refused.r.error.type, 'odoo.exceptions.AccessError');
  assert.equal(refused.r.error.line, 2);
  assert.deepEqual(refused.log.map((c) => c.method), ['write']); // nothing after the failed write reaches the server

  const member = await run(`env['res.partner'].browse(1).ids = [2]`, { readonly: false });
  assert.equal(member.r.error.name, 'TypeError');
});

test('pageSoftReload runs Odoo\'s soft_reload on the current controller', async () => {
  const done = [];
  const action = { currentController: { jsId: 'c1' }, doAction: async (a) => { done.push(a); } };
  globalThis.window = { odoo: { __WOWL_DEBUG__: { root: { env: { services: { action } } } } } };
  assert.deepEqual(await pageSoftReload(), { ok: true });
  assert.deepEqual(done, ['soft_reload']);
  globalThis.window = { odoo: {} };
  assert.deepEqual(await pageSoftReload(), { error: 'No view to refresh on this page' });
  action.doAction = async () => { throw new Error('boom'); };
  globalThis.window = { odoo: { __WOWL_DEBUG__: { root: { env: { services: { action } } } } } };
  assert.deepEqual(await pageSoftReload(), { error: 'boom' });
});
