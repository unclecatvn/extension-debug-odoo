import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  callStats, cleanPythonError, codeKey, columnType, columnsOf, completionAt, kindOf, PRELUDE_LINES, pythonErrorLine, pythonProgram,
  pythonSyntaxError, rankSuggestions, smartEdit, tokenize, toCsv, toMarkdown,
} from '../../../../src/features/code/code.logic.ts';

test('codeKey: one code per Odoo and language', () => {
  assert.equal(codeKey('http://a:8069', 'js'), 'odoo-debug-orm-code:http://a:8069');
  assert.equal(codeKey('http://a:8069', 'python'), 'odoo-debug-orm-code:http://a:8069:py');
});

test('kindOf: what a run returned', () => {
  assert.equal(kindOf({ $recordset: 'res.partner', ids: [1] }), 'recordset');
  assert.equal(kindOf({ $rows: 'res.partner', rows: [] }), 'rows');
  assert.equal(kindOf([{ id: 1 }, { id: 2 }]), 'table');
  assert.equal(kindOf([{ $recordset: 'x', ids: [] }]), 'list', 'recordsets in a list: not rows');
  assert.equal(kindOf([1, 2]), 'list');
  assert.equal(kindOf({ $datetime: '2026-10-02 09:30:00' }), 'datetime');
  assert.equal(kindOf({ $date: '2026-10-02' }), 'date');
  assert.equal(kindOf({ a: 1 }), 'dict');
  assert.equal(kindOf(null), 'null');
  assert.equal(kindOf(3.5), 'number');
});

test('columnType: a column typed by its values', () => {
  assert.equal(columnType('id', [1, 2]), 'id');
  assert.equal(columnType('partner_id', [[3, 'Admin'], false]), 'many2one');
  assert.equal(columnType('tag_ids', [[1, 2], []]), 'ids');
  assert.equal(columnType('active', [true, false]), 'boolean');
  assert.equal(columnType('qty', [1, 2]), 'integer');
  assert.equal(columnType('price', [1.5, 2]), 'float');
  assert.equal(columnType('d', ['2026-10-02', false]), 'date');
  assert.equal(columnType('dt', ['2026-10-02 09:30:00']), 'datetime');
  assert.equal(columnType('dt', [{ $datetime: '2026-10-02 09:30:00' }]), 'datetime');
  assert.equal(columnType('name', ['a', 'b']), 'text');
  assert.equal(columnType('x', [null, false]), 'boolean');
  assert.equal(columnType('x', [null]), 'empty');
});

test('columnsOf, toCsv, toMarkdown: plain cells', () => {
  const rows = [{ name: 'A, "B"', id: 1, partner_id: [3, 'Admin'], tag_ids: [1, 2], when: { $date: '2026-10-02' } }, { id: 2, name: 'x|y', partner_id: false }];
  assert.deepEqual(columnsOf(rows), ['id', 'name', 'partner_id', 'tag_ids', 'when']);
  assert.equal(toCsv(rows), 'id,name,partner_id,tag_ids,when\r\n1,"A, ""B""",Admin,"1, 2",2026-10-02\r\n2,x|y,,,');
  assert.equal(toMarkdown(rows).split('\n')[2], '| 1 | A, "B" | Admin | 1, 2 | 2026-10-02 |');
  assert.equal(toMarkdown(rows).split('\n')[3], '| 2 | x\\|y |  |  |  |');
});

test('callStats: dry-run calls are held, not written', () => {
  const c = (write: boolean, extra = {}) => ({ model: 'm', method: 'x', args: '', kwargs: '', write, ms: 1, ...extra });
  assert.deepEqual(callStats([c(false), c(true), c(true, { dry: true }), c(true, { error: 'no' })]), { total: 4, writes: 3, errors: 1, written: 1, held: 1 });
});

test('pythonProgram: the code as the body of _main, its value through action; a dry run rolls back', () => {
  const p = pythonProgram("x = 1\n\treturn x", true);
  const lines = p.split('\n');
  assert.equal(lines[PRELUDE_LINES - 1], 'def _main():');
  assert.equal(lines[PRELUDE_LINES], '    x = 1', 'line 1 of the code right after the prelude');
  assert.equal(lines[PRELUDE_LINES + 1], '        return x', 'a tab becomes 4 spaces');
  assert.match(p, /env\.cr\.rollback\(\)/);
  assert.match(p, /'dry': True/);
  const commit = pythonProgram('return 1', false);
  assert.doesNotMatch(commit, /rollback/);
  assert.match(commit, /^action = \{'type': 'ir\.actions\.client'/m);
});

test('Python errors: back to the line of the code', () => {
  const tb = `Traceback (most recent call last):\n  File "/odoo/tools/safe_eval.py", line 409, in safe_eval\n  File "ir.actions.server(7,)", line ${PRELUDE_LINES + 30}, in <module>\n  File "ir.actions.server(7,)", line ${PRELUDE_LINES + 3}, in _main\nAttributeError: x`;
  assert.equal(pythonErrorLine(tb, 3), 3, 'the frame in the code, not in the wrapper after it');
  assert.equal(pythonErrorLine('no frame', 3), null);
  assert.deepEqual(cleanPythonError(`AttributeError("'res.partner' object has no attribute 'nope'") while evaluating\n'_out = []…'`),
    { message: "AttributeError: 'res.partner' object has no attribute 'nope'", wrapped: true });
  assert.deepEqual(cleanPythonError("ZeroDivisionError('division by zero') while evaluating\n'…'"), { message: 'ZeroDivisionError: division by zero', wrapped: true });
  assert.deepEqual(cleanPythonError('stop here'), { message: 'stop here', wrapped: false }, 'a UserError comes as it is');
  assert.deepEqual(pythonSyntaxError(`SyntaxError : '(' was never closed at line ${PRELUDE_LINES + 2}\n    return (`), { message: "SyntaxError: '(' was never closed", line: 2 });
  assert.equal(pythonSyntaxError('Something else'), null);
});

test('completionAt: models, fields, members, the screen\'s variables (JS and Python)', () => {
  const at = (code: string, screen: string | null = null) => completionAt(code, code.length, screen);
  assert.deepEqual(at("env['res.pa"), { kind: 'model', prefix: 'res.pa', from: 5 });
  assert.deepEqual(at("rs = env['sale.order']\nrs.search([['sta"), { kind: 'field', model: 'sale.order', path: [], prefix: 'sta', from: 36 });
  const m = at('record.partner_id.na', 'sale.order');
  assert.equal(m?.kind, 'member');
  assert.deepEqual(m && 'model' in m ? [m.model, m.path, m.prefix] : null, ['sale.order', ['partner_id'], 'na']);
  const py = at("orders = env['sale.order'].search([])\nfor o in orders:\n    o.partner_id.cou");
  assert.deepEqual(py && 'model' in py ? [py.model, py.path, py.prefix] : null, ['sale.order', ['partner_id'], 'cou'], 'a Python for loop variable');
  assert.equal(at("print('done')"), null, 'after a closed string: nothing');
});

test('rankSuggestions: starting with the prefix first, the shortest first', () => {
  const items = ['name_search', 'name', 'display_name', 'nam'].map((label) => ({ label, detail: '' }));
  assert.deepEqual(rankSuggestions(items, 'nam').map((x) => x.label), ['name', 'name_search', 'display_name']);
});

test('tokenize: JS and Python', () => {
  assert.deepEqual(tokenize("const x = env['a'] // c", 'js').filter(([t]) => t).map(([t, s]) => `${t}:${s}`), ['kw:const', 'builtin:env', "string:'a'", 'comment:// c']);
  assert.deepEqual(tokenize("def f():\n    return record.name  # c", 'python').filter(([t]) => t).map(([t, s]) => `${t}:${s}`),
    ['kw:def', 'fn:f', 'kw:return', 'builtin:record', 'prop:name', 'comment:# c']);
});

test('smartEdit: pairs, and Python indents after a colon', () => {
  assert.deepEqual(smartEdit('x', 1, 1, '('), { from: 1, to: 1, text: '()', select: [2, 2] });
  assert.equal(smartEdit("don", 3, 3, "'"), null, 'an apostrophe after a word');
  const py = smartEdit('for r in rs:', 12, 12, 'Enter', 'python');
  assert.deepEqual(py, { from: 12, to: 12, text: '\n    ', select: [17, 17] });
  assert.equal(smartEdit('x', 1, 1, '`', 'python'), null, 'no backtick pairs in Python');
});
