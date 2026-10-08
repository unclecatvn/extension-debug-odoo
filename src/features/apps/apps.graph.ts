// Apps tab, the dependency diagram of the module opened (a part of apps.module.ts), drawn in SVG from the layout of
// apps.graph.logic.ts. Three ways to look at it:
//   Needs           everything it stands on, transitively
//   Install brings  (not installed) what installing it sets to install: its dependencies and the modules Odoo
//                   auto-installs with them, plugged into the installed modules they stand on
//   Used by         the modules depending on it, one level or more
// The hubs (base, web, mail…: most modules stand on them) are left out unless asked. A click on a module highlights the
// chain linking it to the one opened and says why it is there; a double click opens it. Ctrl + wheel or − / + zoom.
import { N_, _t } from '../../i18n/i18n.ts';
import { segmented } from '../../ui/parts.ts';
import { clip, depLayout, edgeKey, edgePath, NODE_H, NODE_W, pathBetween, type GraphMode, type Layout, type NodeKind } from './apps.graph.logic.ts';
import { isInstalled, type AppModule, type ModuleGraph } from './apps.logic.ts';
import type { ModuleEnv } from './apps.module.ts';
import { button, stateLabel, text, tpl } from './apps.ui.ts';

/** A module nearly everything stands on (base, web, mail, bus, portal…: more than this share of the database depends on
 * it, transitively): left out by default, unless the install brings it. account or product (about 60%) stay. */
const HUB_SHARE = 0.75;
const hubCache = new WeakMap<ModuleGraph, Map<string, boolean>>();

function isHub(name: string, e: ModuleEnv): boolean {
  let cache = hubCache.get(e.graph);
  if (!cache) hubCache.set(e.graph, cache = new Map());
  let hub = cache.get(name);
  if (hub === undefined) cache.set(name, hub = e.graph.downstream([name]).length > e.byName.size * HUB_SHARE);
  return hub;
}

const KIND_TIP: Record<NodeKind, string> = {
  center: N_('The module opened'), installed: N_('Installed'), new: N_('Installed with it, as a dependency'),
  auto: N_('Auto-installed with it'), missing: N_('Not on this server'), other: N_('Not installed'),
};

export function dependencyDiagram(m: AppModule, e: ModuleEnv): Node {
  const r = tpl('graph', { root: HTMLDivElement, bar: HTMLDivElement, scroll: HTMLDivElement, svg: SVGSVGElement, edges: SVGGElement, nodes: SVGGElement, info: HTMLDivElement }).refs;
  const sim = m.state === 'uninstalled' ? e.simulate([m.name]) : undefined;
  const why = new Map(sim?.brought.map((b) => [b.name, b.reason === 'auto'
    ? _t('auto-installed: %s all installed or being installed', b.via.join(', '))
    : b.via.length ? _t('a dependency of %s', b.via.join(', ')) : '']) ?? []);
  const modes: [GraphMode, string][] = [['needs', _t('Needs')], ...(sim ? [['install', _t('Install brings')] as [GraphMode, string]] : []), ['used-by', _t('Used by')]];
  let mode: GraphMode = sim ? 'install' : 'needs';
  let hideHubs = true;
  let installedOnly = isInstalled(m); // what uninstalling it removes
  let depth = 1;
  let scale = 1;
  let layout: Layout;
  const shapes = new Map<string, SVGGElement>();
  const lines = new Map<string, SVGPathElement>();

  // ---------- tools ----------
  const { label: hubLabel, box: hubBox, text: hubText } = tpl('check', { label: HTMLLabelElement, box: HTMLInputElement, text: HTMLSpanElement }).refs;
  hubText.textContent = _t('Hide the hubs (base, web, mail…)');
  hubBox.checked = hideHubs;
  hubBox.addEventListener('change', () => { hideHubs = hubBox.checked; draw(); });
  const { label: instLabel, box: instBox, text: instText } = tpl('check', { label: HTMLLabelElement, box: HTMLInputElement, text: HTMLSpanElement }).refs;
  instText.textContent = _t('Installed only');
  instBox.checked = installedOnly;
  instBox.addEventListener('change', () => { installedOnly = instBox.checked; draw(); });
  const depthSeg = segmented([['1', _t('1 level')], ['2', _t('2 levels')], ['9', _t('All')]], '1', (v) => { depth = Number(v); draw(); });
  const zoom = (f: number | 'fit') => {
    scale = f === 'fit' ? Math.min(1, (r.scroll.clientWidth - 2) / layout.width) : Math.min(2, Math.max(0.2, scale * f));
    size();
  };
  /** The diagram over the whole tab (Esc or ⤢ again: back in its part). */
  const expand = (on: boolean) => {
    r.root.classList.toggle('full', on);
    full.setAttribute('aria-pressed', String(on));
    if (on) document.addEventListener('keydown', onEsc, true); else document.removeEventListener('keydown', onEsc, true);
    requestAnimationFrame(showCenter);
  };
  const onEsc = (ev: KeyboardEvent) => { if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); expand(false); } };
  const full = button('⤢', () => expand(!r.root.classList.contains('full')), 'chip', _t('Expand to the whole tab (Esc to exit)'));
  const count = text('', 'muted');
  r.bar.append(segmented(modes, mode, (v) => { mode = v; draw(); }), depthSeg, instLabel, hubLabel,
    button('−', () => zoom(1 / 1.25), 'chip', _t('Zoom out (Ctrl + wheel)')), button('+', () => zoom(1.25), 'chip', _t('Zoom in (Ctrl + wheel)')),
    button(_t('Fit'), () => zoom('fit'), 'chip', _t('Fit the diagram to the width')), full, count);
  r.scroll.addEventListener('wheel', (ev) => {
    if (!ev.ctrlKey && !ev.metaKey) return;
    ev.preventDefault();
    zoom(ev.deltaY < 0 ? 1.1 : 1 / 1.1);
  }, { passive: false });

  const size = () => {
    r.svg.setAttribute('width', String(Math.round(layout.width * scale)));
    r.svg.setAttribute('height', String(Math.round(layout.height * scale)));
  };

  // ---------- drawing ----------
  function draw() {
    depthSeg.hidden = instLabel.hidden = mode !== 'used-by';
    layout = depLayout({
      center: m.name, mode, graph: e.graph, sim, depth, cap: 80,
      state: (n) => e.byName.get(n)?.state,
      keep: installedOnly ? (n) => { const x = e.byName.get(n); return !!x && isInstalled(x); } : undefined,
      hide: hideHubs ? new Set(candidates().filter((n) => isHub(n, e))) : undefined,
    });
    const at = new Map(layout.nodes.map((n) => [n.name, n]));
    r.svg.setAttribute('viewBox', `0 0 ${layout.width} ${layout.height}`);
    shapes.clear();
    lines.clear();
    r.edges.replaceChildren(...layout.edges.map((x) => {
      const { edge } = tpl('g-edge', { edge: SVGPathElement }).refs;
      edge.setAttribute('d', edgePath(at.get(x.from)!, at.get(x.to)!));
      lines.set(edgeKey(x), edge);
      return edge;
    }));
    r.nodes.replaceChildren(...layout.nodes.map((n) => {
      const g = tpl('g-node', { node: SVGGElement, box: SVGRectElement, label: SVGTextElement }).refs;
      g.node.classList.add(n.kind);
      g.node.setAttribute('transform', `translate(${n.x},${n.y})`);
      g.box.setAttribute('width', String(NODE_W));
      g.box.setAttribute('height', String(NODE_H));
      g.label.setAttribute('x', '10');
      g.label.setAttribute('y', String(NODE_H / 2));
      g.label.textContent = clip(n.name);
      const x = e.byName.get(n.name);
      g.node.dataset.tip = [n.name, x?.shortdesc, x ? stateLabel(x.state) : _t(KIND_TIP.missing), why.get(n.name)].filter(Boolean).join(' · ');
      g.node.setAttribute('aria-label', g.node.dataset.tip);
      g.node.addEventListener('click', () => select(n.name));
      g.node.addEventListener('dblclick', () => { if (x && n.name !== m.name) e.open(n.name); });
      g.node.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); select(n.name); } });
      shapes.set(n.name, g.node);
      return g.node;
    }));
    count.textContent = _t('%s modules', layout.nodes.length);
    size();
    describe(null);
    if (r.root.isConnected) requestAnimationFrame(showCenter);
  }

  /** The modules the mode starts from, before the hubs are left out. */
  function candidates(): string[] {
    if (mode === 'needs') return e.graph.upstream([m.name]);
    if (mode === 'install') return [...new Set((sim?.brought ?? []).flatMap((b) => [b.name, ...e.graph.depends(b.name)]))];
    return e.graph.downstream([m.name]); // the hubs among them: modules depending on it can't be hubs of it, rarely any
  }

  /** Highlights the chain between the module opened and `name`, and says what `name` is there for. */
  function select(name: string) {
    const p = pathBetween(layout.edges, m.name, name);
    for (const [n, g] of shapes) { g.classList.toggle('hl', p.nodes.has(n) || n === name); g.classList.toggle('picked', n === name); }
    for (const [k, l] of lines) l.classList.toggle('hl', p.edges.has(k));
    r.root.classList.toggle('focused', name !== m.name);
    describe(name);
  }

  function describe(name: string | null) {
    const parts: (Node | string)[] = [];
    if (name && name !== m.name) {
      const x = e.byName.get(name);
      const kind = layout.nodes.find((n) => n.name === name)?.kind ?? 'other';
      parts.push(text(name, 'mono'), text(_t(KIND_TIP[kind]), 'muted'));
      if (why.get(name)) parts.push(text(why.get(name)!, 'muted'));
      if (x) parts.push(button(_t('Open'), () => e.open(name), 'chip', _t('Open this module')));
    } else {
      parts.push(text(_t('Arrows point to dependencies. Click a module for its chain to %s; double-click to open it.', m.name), 'muted'));
    }
    if (layout.hidden.length) parts.push(text(_t('Hidden hubs: %s', layout.hidden.join(', ')), 'muted'));
    if (layout.more) parts.push(text(_t('… and %s more not drawn', layout.more), 'muted'));
    r.info.replaceChildren(...parts);
  }

  /** Readable first: fitted to the width, but never below 70% (over the whole tab: to the width and height, up to
   * 140%); the module opened scrolled into view. */
  function showCenter() {
    const w = r.scroll.clientWidth;
    if (!w) return;
    const fit = r.root.classList.contains('full')
      ? Math.min(1.4, (w - 2) / layout.width, (r.scroll.clientHeight - 2) / layout.height)
      : Math.min(1, (w - 2) / layout.width);
    scale = Math.max(0.7, fit);
    size();
    const c = layout.nodes.find((n) => n.name === m.name);
    if (c) {
      r.scroll.scrollLeft = Math.max(0, (c.x + NODE_W / 2) * scale - w / 2);
      r.scroll.scrollTop = Math.max(0, (c.y + NODE_H / 2) * scale - r.scroll.clientHeight / 2);
    }
  }

  draw();
  requestAnimationFrame(showCenter);
  return r.root;
}
