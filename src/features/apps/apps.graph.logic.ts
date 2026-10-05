// Apps tab, the dependency diagram of the module opened: which modules, in which layer, where (pure, unit-tested).
// Left to right, what everything stands on first: a module sits one layer right of the furthest of its dependencies
// (longest path), so `base` is on the left and the modules depending on others on the right. Only the edges that
// matter are drawn: a → c is left out when a → b → c already says it (transitive reduction). Within a layer the order
// follows the neighbours' (barycenter, a few sweeps), so fewer edges cross.
import { isInstalled, type InstallSim, type ModuleGraph, type ModuleState } from './apps.logic.ts';

/** needs: what it stands on · install: what installing it sets to install · used-by: what depends on it */
export type GraphMode = 'needs' | 'install' | 'used-by';
/** center: the module opened · installed · new: installed as a dependency · auto: auto-installed · missing: not on
 * this server · other: not installed (and not brought) */
export type NodeKind = 'center' | 'installed' | 'new' | 'auto' | 'missing' | 'other';

export interface GNode { name: string; kind: NodeKind; layer: number; x: number; y: number }
/** `from` depends on `to` */
export interface GEdge { from: string; to: string }
export interface Layout {
  nodes: GNode[];
  edges: GEdge[];
  width: number;
  height: number;
  /** the hubs left out (base, web, mail…: almost everything depends on them) */
  hidden: string[];
  /** used-by: the modules beyond the cap, not drawn */
  more: number;
}

export const NODE_W = 168;
export const NODE_H = 28;
const GAP_X = 56;
const GAP_Y = 10;
const PAD = 12;

export interface LayoutInput {
  center: string;
  mode: GraphMode;
  graph: ModuleGraph;
  state(name: string): ModuleState | undefined;
  /** install: what Odoo's button_install would set to install (apps.logic.ts → simulateInstall) */
  sim?: InstallSim;
  /** modules left out (never the center, nor what the install brings) */
  hide?: ReadonlySet<string>;
  /** used-by: the dependents kept (e.g. the installed ones: what an uninstall removes); the others are not followed */
  keep?: (name: string) => boolean;
  /** used-by: how many levels of dependents, and at most how many modules */
  depth?: number;
  cap?: number;
}

export function depLayout(input: LayoutInput): Layout {
  const { center, mode, graph, sim } = input;
  const hide = input.hide ?? new Set<string>();
  const brought = new Map(sim?.brought.map((b) => [b.name, b.reason]) ?? []);

  // ---------- which modules ----------
  let names: string[];
  let more = 0;
  if (mode === 'needs') names = [center, ...graph.upstream([center])];
  else if (mode === 'install') {
    const set = new Set([center, ...brought.keys()]);
    // what the new modules stand on that is installed already: where they plug in
    for (const n of [...set]) for (const d of graph.depends(n)) set.add(d);
    names = [...set];
  } else {
    const levels: string[][] = [[center]];
    const seen = new Set([center]);
    for (let i = 0; i < (input.depth ?? 1); i++) {
      const next = levels[i]!.flatMap((n) => graph.dependents(n)).filter((n) => !seen.has(n) && (input.keep?.(n) ?? true) && (seen.add(n), true));
      if (!next.length) break;
      levels.push(next);
    }
    const all = levels.flat();
    const cap = input.cap ?? 80;
    more = Math.max(0, all.length - cap);
    names = all.slice(0, cap);
  }
  // the module opened and what the install brings always show: only the context can be hidden
  const hideable = (n: string) => n !== center && !brought.has(n) && hide.has(n);
  const hidden = names.filter(hideable).sort();
  const inSet = new Set(names.filter((n) => !hideable(n)));

  // ---------- edges, without the redundant ones ----------
  const deps = new Map([...inSet].map((n) => [n, graph.depends(n).filter((d) => inSet.has(d) && d !== n)]));
  const reach = new Map<string, Set<string>>();
  const reachOf = (n: string): Set<string> => {
    let r = reach.get(n);
    if (r) return r;
    reach.set(n, r = new Set()); // a cycle (a broken database) ends here
    for (const d of deps.get(n) ?? []) { r.add(d); for (const x of reachOf(d)) r.add(x); }
    return r;
  };
  const edges: GEdge[] = [];
  for (const [n, ds] of deps) {
    for (const d of ds) if (!ds.some((o) => o !== d && reachOf(o).has(d))) edges.push({ from: n, to: d });
  }

  // ---------- layers: one right of the furthest dependency ----------
  const layerOf = new Map<string, number>();
  const layer = (n: string, stack = new Set<string>()): number => {
    const known = layerOf.get(n);
    if (known !== undefined) return known;
    if (stack.has(n)) return 0;
    stack.add(n);
    const ds = deps.get(n) ?? [];
    const l = ds.length ? 1 + Math.max(...ds.map((d) => layer(d, stack))) : 0;
    stack.delete(n);
    layerOf.set(n, l);
    return l;
  };
  for (const n of inSet) layer(n);
  const layers: string[][] = [];
  for (const n of [...inSet].sort()) (layers[layerOf.get(n)!] ??= []).push(n);
  for (let i = 0; i < layers.length; i++) layers[i] ??= [];

  // ---------- order within a layer: the mean position of its neighbours ----------
  const pos = new Map<string, number>();
  const index = () => layers.forEach((l) => l.forEach((n, i) => pos.set(n, i)));
  index();
  const up = new Map<string, string[]>(); // dependents drawn
  for (const e of edges) { const l = up.get(e.to); if (l) l.push(e.from); else up.set(e.to, [e.from]); }
  const down = new Map<string, string[]>();
  for (const e of edges) { const l = down.get(e.from); if (l) l.push(e.to); else down.set(e.from, [e.to]); }
  const mean = (ns: readonly string[] | undefined, fallback: number) => (ns?.length ? ns.reduce((s, x) => s + pos.get(x)!, 0) / ns.length : fallback);
  for (let sweep = 0; sweep < 4; sweep++) {
    for (let i = 1; i < layers.length; i++) { layers[i] = sortBy(layers[i]!, (n) => mean(down.get(n), pos.get(n)!)); index(); }
    for (let i = layers.length - 2; i >= 0; i--) { layers[i] = sortBy(layers[i]!, (n) => mean(up.get(n), pos.get(n)!)); index(); }
  }

  // ---------- coordinates: each layer a column, centred on the tallest ----------
  const tallest = Math.max(1, ...layers.map((l) => l.length));
  const height = PAD * 2 + tallest * NODE_H + (tallest - 1) * GAP_Y;
  const nodes: GNode[] = layers.flatMap((l, li) => {
    const top = (height - (l.length * NODE_H + (l.length - 1) * GAP_Y)) / 2;
    return l.map((n, i) => ({ name: n, kind: kindOf(n), layer: li, x: PAD + li * (NODE_W + GAP_X), y: top + i * (NODE_H + GAP_Y) }));
  });
  const width = PAD * 2 + layers.length * NODE_W + Math.max(0, layers.length - 1) * GAP_X;
  return { nodes, edges, width, height, hidden, more };

  function kindOf(n: string): NodeKind {
    if (n === center) return 'center';
    const s = input.state(n);
    if (!s) return 'missing';
    const b = brought.get(n);
    if (b) return b === 'auto' ? 'auto' : 'new';
    return isInstalled({ state: s }) ? 'installed' : 'other';
  }
}

/** Stable sort by a key. */
function sortBy<T>(list: readonly T[], key: (x: T) => number): T[] {
  return list.map((x, i) => ({ x, k: key(x), i })).sort((a, b) => a.k - b.k || a.i - b.i).map((e) => e.x);
}

/** The edges and modules linking `a` and `b` along dependencies (a needing b, or b needing a): what explains why one
 * is there for the other. Empty when neither needs the other (an auto-installed module brought by its triggers). */
export function pathBetween(edges: readonly GEdge[], a: string, b: string): { nodes: Set<string>; edges: Set<string> } {
  const out = new Map<string, GEdge[]>();
  for (const e of edges) { const l = out.get(e.from); if (l) l.push(e); else out.set(e.from, [e]); }
  const walk = (from: string, to: string): GEdge[] | null => {
    const prev = new Map<string, GEdge>();
    const queue = [from];
    const seen = new Set([from]);
    while (queue.length) {
      const n = queue.shift()!;
      if (n === to) {
        const path: GEdge[] = [];
        for (let x = to; x !== from; x = prev.get(x)!.from) path.unshift(prev.get(x)!);
        return path;
      }
      for (const e of out.get(n) ?? []) if (!seen.has(e.to)) { seen.add(e.to); prev.set(e.to, e); queue.push(e.to); }
    }
    return null;
  };
  const path = walk(a, b) ?? walk(b, a) ?? [];
  return { nodes: new Set(path.flatMap((e) => [e.from, e.to])), edges: new Set(path.map(edgeKey)) };
}

export const edgeKey = (e: GEdge) => `${e.from}>${e.to}`;

/** A name clipped to fit a node (the whole of it on hover). */
export const clip = (name: string, max = 22) => (name.length > max ? `${name.slice(0, max - 1)}…` : name);

/** The SVG path of an edge: from the dependent's left side to its dependency's right side, a smooth S. */
export function edgePath(from: GNode, to: GNode): string {
  const x1 = from.x, y1 = from.y + NODE_H / 2;
  const x2 = to.x + NODE_W, y2 = to.y + NODE_H / 2;
  const dx = Math.max(24, (x1 - x2) / 2);
  return `M${x1},${y1} C${x1 - dx},${y1} ${x2 + dx},${y2} ${x2},${y2}`;
}
