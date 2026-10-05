import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clip, depLayout, edgeKey, NODE_W, pathBetween } from '../../../../src/features/apps/apps.graph.logic.ts';
import { moduleGraph, simulateInstall, type DepRow, type ModuleState } from '../../../../src/features/apps/apps.logic.ts';

// base ← mail ← product ← sale ← sale_stock → stock → product; sale_stock auto-installed (sale + stock); my_sale on sale_stock
const MODS: [string, ModuleState, boolean?][] = [
  ['base', 'installed'], ['mail', 'installed'], ['product', 'uninstalled'], ['sale', 'uninstalled'], ['stock', 'installed'],
  ['sale_stock', 'uninstalled', true], ['my_sale', 'uninstalled'],
];
const mods = MODS.map(([name, state, auto], i) => ({ id: i + 1, name, state, auto_install: !!auto, country_ids: [] as number[] }));
const id = (n: string) => mods.find((m) => m.name === n)!.id;
const dep = (m: string, d: string, auto = false): DepRow => ({ name: d, module_id: [id(m), `Title ${m}`], auto_install_required: auto });
const DEPS = [dep('mail', 'base'), dep('product', 'base'), dep('product', 'mail'), dep('sale', 'product'), dep('sale', 'mail'), dep('stock', 'product'),
  dep('sale_stock', 'sale', true), dep('sale_stock', 'stock', true), dep('my_sale', 'sale_stock')];
const graph = moduleGraph(mods, DEPS);
const state = (n: string) => mods.find((m) => m.name === n)?.state;
const layerOf = (l: ReturnType<typeof depLayout>, n: string) => l.nodes.find((x) => x.name === n)?.layer;

test('needs: what it stands on, left to right; redundant edges left out', () => {
  const l = depLayout({ center: 'sale', mode: 'needs', graph, state });
  assert.deepEqual(l.nodes.map((n) => n.name).sort(), ['base', 'mail', 'product', 'sale']);
  assert.deepEqual([layerOf(l, 'base'), layerOf(l, 'mail'), layerOf(l, 'product'), layerOf(l, 'sale')], [0, 1, 2, 3]);
  const edges = l.edges.map(edgeKey).sort();
  assert.deepEqual(edges, ['mail>base', 'product>mail', 'sale>product'], 'sale>mail and product>base go through another module');
  assert.equal(l.nodes.find((n) => n.name === 'sale')!.kind, 'center');
  assert.equal(l.nodes.find((n) => n.name === 'base')!.kind, 'installed');
  assert.ok(l.width >= 4 * NODE_W && l.height > 0);
});

test('install: what button_install brings, coloured by why, plugged into the installed modules', () => {
  const sim = simulateInstall(['sale'], mods, DEPS, []);
  const l = depLayout({ center: 'sale', mode: 'install', graph, state, sim });
  const kind = (n: string) => l.nodes.find((x) => x.name === n)?.kind;
  assert.equal(kind('product'), 'new');
  assert.equal(kind('sale_stock'), 'auto');
  assert.equal(kind('stock'), 'installed', 'what an auto module stands on shows, installed');
  assert.equal(kind('my_sale'), undefined, 'not brought: not drawn');
  const hidden = depLayout({ center: 'sale', mode: 'install', graph, state, sim, hide: new Set(['product', 'mail', 'stock']) });
  assert.deepEqual(hidden.hidden, ['mail', 'stock'], 'product is brought: never hidden; mail and stock, installed, are');
});

test('used-by: levels of dependents, capped; hubs hidden but the center', () => {
  const one = depLayout({ center: 'product', mode: 'used-by', graph, state, depth: 1 });
  assert.deepEqual(one.nodes.map((n) => n.name).sort(), ['product', 'sale', 'stock']);
  const all = depLayout({ center: 'product', mode: 'used-by', graph, state, depth: 9 });
  assert.deepEqual(all.nodes.map((n) => n.name).sort(), ['my_sale', 'product', 'sale', 'sale_stock', 'stock']);
  const installed = depLayout({ center: 'product', mode: 'used-by', graph, state, depth: 9, keep: (n) => state(n) === 'installed' });
  assert.deepEqual(installed.nodes.map((n) => n.name).sort(), ['product', 'stock'], 'what an uninstall would remove: the installed ones');
  const capped = depLayout({ center: 'product', mode: 'used-by', graph, state, depth: 9, cap: 3 });
  assert.equal(capped.nodes.length, 3);
  assert.equal(capped.more, 2);
  const hidden = depLayout({ center: 'sale', mode: 'needs', graph, state, hide: new Set(['base', 'mail', 'sale']) });
  assert.deepEqual(hidden.nodes.map((n) => n.name).sort(), ['product', 'sale']);
  assert.deepEqual(hidden.hidden, ['base', 'mail']);
});

test('no two modules overlap; a layer is a column', () => {
  const l = depLayout({ center: 'base', mode: 'used-by', graph, state, depth: 9 });
  const seen = new Set(l.nodes.map((n) => `${n.x},${n.y}`));
  assert.equal(seen.size, l.nodes.length);
  for (const n of l.nodes) assert.equal(n.x, l.nodes.find((o) => o.layer === n.layer)!.x);
  for (const e of l.edges) assert.ok(layerOf(l, e.from)! > layerOf(l, e.to)!, `${edgeKey(e)} goes right to left`);
});

test('pathBetween: the chain either way; nothing when neither needs the other', () => {
  const l = depLayout({ center: 'base', mode: 'used-by', graph, state, depth: 9 });
  const fromBase = pathBetween(l.edges, 'base', 'my_sale'); // base needs nothing: found from my_sale down to base
  assert.ok(fromBase.nodes.has('base') && fromBase.nodes.has('my_sale'));
  const p = pathBetween(l.edges, 'my_sale', 'base');
  assert.ok(p.nodes.has('my_sale') && p.nodes.has('base') && p.nodes.has('sale_stock'));
  assert.equal(p.edges.size, p.nodes.size - 1);
  assert.equal(pathBetween(l.edges, 'sale', 'stock').nodes.size, 0);
});

test('clip', () => {
  assert.equal(clip('sale'), 'sale');
  assert.equal(clip('a_very_long_module_technical_name', 10), 'a_very_lo…');
});
