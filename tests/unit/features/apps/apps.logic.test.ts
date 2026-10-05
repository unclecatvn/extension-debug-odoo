import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  byKind, compareVersions, definingModule, descriptionDoc, moduleFilter, moduleGraph, pendingOf, planInstall, planUpgrade, searchText,
  simulateInstall, splitNames, stateKind, versionDrift, type AppModule, type DepRow, type ModuleState,
} from '../../../../src/features/apps/apps.logic.ts';

const mod = (id: number, name: string, state: ModuleState, extra: Partial<AppModule> = {}): AppModule => ({
  id, name, shortdesc: name, summary: false, state, latest_version: false, author: false, application: false,
  category_id: false, auto_install: false, to_buy: false, country_ids: [], ...extra,
});

test('splitNames: separators, blanks and repeats', () => {
  assert.deepEqual(splitNames(' sale; stock,  sale\nmy_module ;'), ['sale', 'stock', 'my_module']);
  assert.deepEqual(splitNames(''), []);
});

test('planInstall sorts each name by what Activate can do', () => {
  const rows = [mod(1, 'a', 'uninstalled'), mod(2, 'b', 'installed'), mod(3, 'c', 'uninstallable'), mod(4, 'd', 'to remove'), mod(5, 'e', 'to install'), mod(6, 'f', 'to upgrade')];
  const p = planInstall(['a', 'b', 'c', 'd', 'e', 'f', 'zz'], rows);
  assert.deepEqual(p.install.map((m) => m.name), ['a', 'e']);
  assert.deepEqual(p.installed.map((m) => m.name), ['b', 'f']);
  assert.deepEqual(p.uninstallable.map((m) => m.name), ['c']);
  assert.deepEqual(p.busy.map((m) => m.name), ['d']);
  assert.deepEqual(p.missing, ['zz']);
});

test('planUpgrade: installed only', () => {
  const p = planUpgrade(['a', 'b', 'c', 'x'], [mod(1, 'a', 'installed'), mod(2, 'b', 'uninstalled'), mod(3, 'c', 'to upgrade')]);
  assert.deepEqual(p.upgrade.map((m) => m.name), ['a', 'c']);
  assert.deepEqual(p.notInstalled.map((m) => m.name), ['b']);
  assert.deepEqual(p.missing, ['x']);
});

test('moduleFilter: OR inside a group, AND across groups and the category', () => {
  const sale = mod(1, 'sale', 'installed', { application: true, category_id: [7, 'Sales'] });
  const extra = mod(2, 'sale_margin', 'uninstalled', { category_id: [7, 'Sales'] });
  const crm = mod(3, 'crm', 'to remove', { application: true, category_id: [8, 'CRM'] });
  const all = [sale, extra, crm];
  const names = (f: Parameters<typeof moduleFilter>[0]) => all.filter(moduleFilter(f)).map((m) => m.name);
  assert.deepEqual(names({}), ['sale', 'sale_margin', 'crm']);
  assert.deepEqual(names({ installed: true }), ['sale', 'crm'], 'to remove counts as installed, as in Odoo');
  assert.deepEqual(names({ notInstalled: true }), ['sale_margin']);
  assert.deepEqual(names({ installed: true, notInstalled: true }), ['sale', 'sale_margin', 'crm'], 'both ticked: no filter');
  assert.deepEqual(names({ extra: true }), ['sale_margin']);
  assert.deepEqual(names({ installed: true, apps: true, category: 'Sales' }), ['sale']);
});

test('searchText: name, title, summary and author, lower case', () => {
  assert.equal(searchText(mod(1, 'sale', 'installed', { shortdesc: 'Sales', summary: 'Quotations', author: 'Odoo S.A.' })), 'sale sales quotations odoo s.a.');
});

test('stateKind and pendingOf', () => {
  assert.equal(stateKind('installed'), 'ok');
  assert.equal(stateKind('to remove'), 'med');
  assert.equal(stateKind('uninstallable'), 'err');
  assert.equal(stateKind('uninstalled'), '');
  assert.deepEqual(pendingOf([mod(1, 'a', 'installed'), mod(2, 'b', 'to install'), mod(3, 'c', 'to upgrade'), mod(4, 'd', 'to remove')]).map((m) => m.name), ['b', 'c', 'd']);
});

test('compareVersions / versionDrift: numeric, part by part', () => {
  assert.equal(compareVersions('18.0.1.10', '18.0.1.9'), 1);
  assert.equal(compareVersions('18.0.1.0', '18.0.1'), 0);
  assert.equal(compareVersions('17.0.2.0', '18.0.1.0'), -1);
  assert.equal(versionDrift('18.0.1.0', '18.0.1.1'), 'disk-newer');
  assert.equal(versionDrift('18.0.1.1', '18.0.1.0'), 'disk-older');
  assert.equal(versionDrift('18.0.1.0', '18.0.1.0'), null);
  assert.equal(versionDrift(false, '18.0.1.0'), null, 'not installed: nothing to compare');
});

const dep = ([id, name]: [number, string], depends: string): DepRow => ({ name: depends, module_id: [id, `Title of ${name}`] }); // the label is the title
const MODS = ['base', 'mail', 'product', 'sale', 'stock', 'sale_stock', 'my_sale'].map((n, i) => ({ name: n, id: i + 1 }));
const DEPS = [
  dep([2, 'mail'], 'base'), dep([3, 'product'], 'base'), dep([3, 'product'], 'mail'),
  dep([4, 'sale'], 'product'), dep([5, 'stock'], 'product'), dep([6, 'sale_stock'], 'sale'), dep([6, 'sale_stock'], 'stock'),
  dep([7, 'my_sale'], 'sale_stock'), dep([7, 'my_sale'], 'ghost'),
];

test('moduleGraph: both directions, transitively, nearest first, and the missing ones', () => {
  const g = moduleGraph(MODS, DEPS);
  assert.deepEqual(g.depends('sale_stock'), ['sale', 'stock']);
  assert.deepEqual(g.dependents('product'), ['sale', 'stock']);
  assert.deepEqual(g.upstream(['sale_stock']), ['sale', 'stock', 'product', 'base', 'mail']);
  assert.deepEqual(g.downstream(['product']), ['sale', 'stock', 'sale_stock', 'my_sale']);
  assert.deepEqual(g.downstream(['my_sale']), []);
  assert.deepEqual(g.missing('my_sale'), ['ghost']);
  assert.deepEqual(g.upstream(['my_sale']).includes('ghost'), true, 'a missing module still counts as needed');
});

test('definingModule: the one every other module touching the model depends on', () => {
  const g = moduleGraph(MODS, DEPS);
  assert.equal(definingModule(['sale', 'sale_stock', 'my_sale'], g), 'sale');
  assert.equal(definingModule(['product'], g), 'product');
  assert.equal(definingModule(['sale', 'stock'], g), null, 'neither depends on the other: unknown');
});

test('byKind: models a developer looks for first, the rest by size', () => {
  const x = (id: number, model: string) => ({ id, model, name: `x${id}`, res_id: id, noupdate: false });
  const kinds = byKind([x(1, 'mail.template'), x(2, 'ir.ui.view'), x(3, 'ir.model'), x(4, 'res.partner'), x(5, 'res.partner'), x(6, 'ir.ui.view')]);
  assert.deepEqual(kinds.map((k) => [k.model, k.rows.length]), [['ir.model', 1], ['ir.ui.view', 2], ['res.partner', 2], ['mail.template', 1]]);
});

test('descriptionDoc: resolved against the Odoo it comes from, links in a new tab', () => {
  const doc = descriptionDoc('http://localhost:8069', '<p>Hi</p>');
  assert.match(doc, /<base href="http:\/\/localhost:8069\/" target="_blank">/);
  assert.match(doc, /<body><p>Hi<\/p><\/body>/);
  assert.match(descriptionDoc('http://a"b', ''), /href="http:\/\/a&#34;b\/"/, 'the origin cannot close the attribute');
});

test('simulateInstall: dependencies first, then the auto_install modules their triggers bring, round after round', () => {
  const mods = [
    mod(1, 'base', 'installed'), mod(2, 'product', 'uninstalled'), mod(3, 'sale', 'uninstalled'), mod(4, 'stock', 'installed'),
    mod(5, 'sale_stock', 'uninstalled', { auto_install: true }), mod(6, 'sale_stock_margin', 'uninstalled', { auto_install: true }),
    mod(7, 'sale_mrp', 'uninstalled', { auto_install: true }), mod(8, 'mrp', 'uninstalled'),
    mod(9, 'l10n_vn', 'uninstalled', { auto_install: true, country_ids: [241] }), mod(10, 'account', 'installed'),
    mod(11, 'sale_loyalty', 'uninstalled', { auto_install: true }), mod(12, 'loyalty', 'uninstalled'),
  ];
  const d = (id: number, name: string, auto = false): DepRow => ({ name, module_id: [id, `Title ${id}`], auto_install_required: auto });
  const deps = [
    d(2, 'base'), d(3, 'product'), d(4, 'product'),
    d(5, 'sale', true), d(5, 'stock', true), // sale_stock: auto_install True (every depends)
    d(6, 'sale_stock', true), // a second round: brought by sale_stock
    d(7, 'sale', true), d(7, 'mrp', true), // mrp not installed: not triggered
    d(9, 'account', true), // a localization
    d(11, 'sale', true), d(11, 'loyalty'), // auto_install: ['sale']; loyalty a plain dependency
  ];
  const sim = simulateInstall(['sale'], mods, deps, [1]);
  assert.deepEqual(sim.brought.map((b) => `${b.name}:${b.reason}`), [
    'product:depends', 'sale:depends', 'sale_stock:auto', 'loyalty:depends', 'sale_loyalty:auto', 'sale_stock_margin:auto',
  ]);
  assert.deepEqual(sim.brought.find((b) => b.name === 'sale_stock')?.via, ['sale', 'stock']);
  assert.deepEqual(sim.brought.find((b) => b.name === 'loyalty')?.via, ['sale_loyalty'], 'a non-trigger dependency comes with the auto module');
  assert.ok(!sim.brought.some((b) => b.name === 'l10n_vn'), 'account is installed, not being installed: not triggered');
  assert.ok(!sim.brought.some((b) => b.name === 'sale_mrp'));
  assert.deepEqual(simulateInstall(['stock'], mods, deps, []).brought, [], 'already installed: nothing');
});

test('simulateInstall: a localization only for a company in its countries; missing and uninstallable dependencies', () => {
  const mods = [mod(1, 'account', 'uninstalled'), mod(2, 'l10n_vn', 'uninstalled', { auto_install: true, country_ids: [241] }),
    mod(3, 'x', 'uninstalled'), mod(4, 'old', 'uninstallable')];
  const deps: DepRow[] = [{ name: 'account', module_id: [2, 'Vietnam'], auto_install_required: true },
    { name: 'ghost', module_id: [3, 'X'] }, { name: 'old', module_id: [3, 'X'] }];
  assert.deepEqual(simulateInstall(['account'], mods, deps, [241]).brought.map((b) => b.name), ['account', 'l10n_vn']);
  assert.deepEqual(simulateInstall(['account'], mods, deps, [233]).brought.map((b) => b.name), ['account']);
  const x = simulateInstall(['x'], mods, deps, []);
  assert.deepEqual(x.missing, [{ module: 'x', dependency: 'ghost' }]);
  assert.deepEqual(x.uninstallable, ['old']);
});
