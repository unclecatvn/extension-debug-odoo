// Apps tab: the pure part (no chrome.*, no DOM), unit-tested. The modules as ir.module.module reads them, their
// dependencies (ir.module.module.dependency), Odoo's Apps filters, and what each action would do with a list of names.
import type { Many2one } from '../../odoo/models.ts';

export const STATES = ['uninstallable', 'uninstalled', 'installed', 'to upgrade', 'to remove', 'to install'] as const;
export type ModuleState = (typeof STATES)[number];

/** ir.module.module, the columns of the list. */
export interface AppModule {
  id: number;
  name: string;
  shortdesc: string;
  summary: string | false;
  state: ModuleState;
  /** the version installed in the database: Odoo labels it "Installed Version" (installed_version, "Latest Version",
   * is the manifest's on disk) */
  latest_version: string | false;
  author: string | false;
  application: boolean;
  category_id: Many2one;
  auto_install: boolean;
  /** an Enterprise module (not on this server's addons path when it is Community) */
  to_buy: boolean;
  /** a localization's countries: auto-installed only when a company is in one of them */
  country_ids: number[];
}

/** Odoo's "Installed" filter of the Apps menu (base/views/ir_module_views.xml); "Not Installed" is the rest. */
export const INSTALLED: readonly ModuleState[] = ['installed', 'to upgrade', 'to remove'];
/** Waiting for an operation: what Odoo runs at its next module operation (or refuses one for, 19.0). */
export const PENDING: readonly ModuleState[] = ['to install', 'to upgrade', 'to remove'];

export const isInstalled = (m: { state: ModuleState }) => INSTALLED.includes(m.state);
export const pendingOf = <M extends { state: ModuleState }>(mods: readonly M[]): M[] => mods.filter((m) => PENDING.includes(m.state));

/** ir.module.module state → pill kind. */
const KINDS: Partial<Record<ModuleState, 'ok' | 'med' | 'err'>> = { installed: 'ok', 'to upgrade': 'med', 'to install': 'med', 'to remove': 'med', uninstallable: 'err' };
export const stateKind = (state: ModuleState): '' | 'ok' | 'med' | 'err' => KINDS[state] ?? '';

/** "sale; stock, my_module" → the names, once each, in order. */
export const splitNames = (text: string): string[] => [...new Set(text.split(/[\s,;]+/).filter(Boolean))];

// ---------- what an action does with a list of names ----------

type Named = { id: number; name: string; state: ModuleState };

/** Names + their rows → what "Activate" does with each. */
export function planInstall<M extends Named>(names: readonly string[], rows: readonly M[]) {
  const byName = new Map(rows.map((m) => [m.name, m]));
  const plan = { install: [] as M[], installed: [] as M[], uninstallable: [] as M[], missing: [] as string[], busy: [] as M[] };
  for (const name of names) {
    const m = byName.get(name);
    if (!m) plan.missing.push(name);
    else if (m.state === 'uninstalled' || m.state === 'to install') plan.install.push(m);
    else if (m.state === 'installed' || m.state === 'to upgrade') plan.installed.push(m);
    else if (m.state === 'uninstallable') plan.uninstallable.push(m);
    else plan.busy.push(m); // to remove: a pending uninstall, left alone
  }
  return plan;
}

/** Names + their rows → what "Upgrade" does with each: only installed modules can be upgraded. */
export function planUpgrade<M extends Named>(names: readonly string[], rows: readonly M[]) {
  const byName = new Map(rows.map((m) => [m.name, m]));
  const plan = { upgrade: [] as M[], notInstalled: [] as M[], missing: [] as string[] };
  for (const name of names) {
    const m = byName.get(name);
    if (!m) plan.missing.push(name);
    else if (m.state === 'installed' || m.state === 'to upgrade') plan.upgrade.push(m);
    else plan.notInstalled.push(m);
  }
  return plan;
}

// ---------- Odoo's Apps filters ----------

/** The filters of Odoo's Apps search bar; category: an ir.module.category name (several categories share one). */
export interface Filters { installed?: boolean; notInstalled?: boolean; apps?: boolean; extra?: boolean; category?: string | null }

/** The filters as a predicate: in a group (Installed / Not Installed, Apps / Extra) the ticked facets are OR'ed, none
 * or both ticked is no filter; the groups and the category are AND'ed. */
export function moduleFilter(f: Filters): (m: Pick<AppModule, 'state' | 'application' | 'category_id'>) => boolean {
  return (m) => {
    const installed = isInstalled(m);
    if (!!f.installed !== !!f.notInstalled && installed !== !!f.installed) return false;
    if (!!f.apps !== !!f.extra && m.application !== !!f.apps) return false;
    return !f.category || (m.category_id !== false && m.category_id[1] === f.category);
  };
}

/** The text a search finds a module by: its name, title, summary, author. */
export const searchText = (m: Pick<AppModule, 'name' | 'shortdesc' | 'summary' | 'author'>) =>
  [m.name, m.shortdesc, m.summary, m.author].filter(Boolean).join(' ').toLowerCase();

// ---------- versions ----------

/** Odoo versions ("18.0.1.2.0", "1.0"), part by part, numerically; a missing part counts as 0. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((x) => parseInt(x, 10) || 0);
  const pb = b.split('.').map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return Math.sign(d);
  }
  return 0;
}

/** The manifest's version on disk against the installed one: disk-newer = the code changed, not upgraded yet. */
export type Drift = 'disk-newer' | 'disk-older' | null;
export function versionDrift(db: string | false | undefined, disk: string | false | undefined): Drift {
  if (!db || !disk) return null;
  const c = compareVersions(disk, db);
  return c > 0 ? 'disk-newer' : c < 0 ? 'disk-older' : null;
}

// ---------- dependencies ----------

/** ir.module.module.dependency: `module_id` declares `name` in its manifest's depends (module_id's label is the
 * module's title, not its name: the graph goes by its id). */
export interface DepRow {
  name: string;
  module_id: Many2one;
  /** an auto_install module's trigger: the manifest's auto_install list, or every depends when it is True */
  auto_install_required?: boolean;
}

export interface ModuleGraph {
  /** what `name` declares in its depends */
  depends(name: string): string[];
  /** the modules declaring `name` in their depends */
  dependents(name: string): string[];
  /** every module `names` need, transitively, themselves left out, nearest first */
  upstream(names: readonly string[]): string[];
  /** every module depending on `names`, transitively, themselves left out, nearest first */
  downstream(names: readonly string[]): string[];
  /** depends naming a module this database doesn't know (not on the addons path, or not in the list yet) */
  missing(name: string): string[];
}

export function moduleGraph(known: readonly { id: number; name: string }[], deps: readonly DepRow[]): ModuleGraph {
  const names = new Set(known.map((m) => m.name));
  const nameOf = new Map(known.map((m) => [m.id, m.name]));
  const down = new Map<string, string[]>();
  const up = new Map<string, string[]>();
  const push = (map: Map<string, string[]>, k: string, v: string) => { const l = map.get(k); if (l) { if (!l.includes(v)) l.push(v); } else map.set(k, [v]); };
  for (const d of deps) {
    const by = d.module_id ? nameOf.get(d.module_id[0]) : undefined;
    if (!by) continue;
    push(up, by, d.name);
    push(down, d.name, by);
  }
  for (const l of [...up.values(), ...down.values()]) l.sort();
  const walk = (map: Map<string, string[]>, start: readonly string[]) => {
    const seen = new Set(start);
    const out: string[] = [];
    let level = [...start];
    while (level.length) {
      const next: string[] = [];
      for (const n of level) for (const x of map.get(n) ?? []) if (!seen.has(x)) { seen.add(x); out.push(x); next.push(x); }
      level = next;
    }
    return out;
  };
  return {
    depends: (n) => up.get(n) ?? [],
    dependents: (n) => down.get(n) ?? [],
    upstream: (ns) => walk(up, ns),
    downstream: (ns) => walk(down, ns),
    missing: (n) => (up.get(n) ?? []).filter((x) => !names.has(x)),
  };
}

/** Of the modules touching a model (ir.model.modules), the one creating it: every other one depends on it (a module
 * can only extend a model it depends on). null: none or several (the list is incomplete). */
export function definingModule(touching: readonly string[], g: ModuleGraph): string | null {
  const hits = touching.filter((m) => touching.every((o) => o === m || g.upstream([o]).includes(m)));
  return hits.length === 1 ? hits[0]! : null;
}

// ---------- what an install brings ----------

/** A module an install adds, and why: a dependency of `via`, or auto-installed because `via` (its triggers) are all
 * installed or being installed. */
export interface Brought { name: string; reason: 'depends' | 'auto'; via: string[] }

export interface InstallSim {
  /** every module the install sets to install, `names` first, in the order Odoo marks them */
  brought: Brought[];
  /** depends naming a module this server doesn't have: Odoo refuses the install */
  missing: { module: string; dependency: string }[];
  /** dependencies that cannot be installed (installable: False): the install fails when it loads them */
  uninstallable: string[];
}

/**
 * What Odoo's button_install (base/models/ir_module.py, the same in 18.0 and 19.0) would set to install for `names`:
 * the modules and their dependencies not installed yet, then, again and again, the auto_install modules whose triggers
 * are all installed or to install, one at least to install, and whose countries (if any) hold a company.
 */
export function simulateInstall(names: readonly string[], mods: readonly Pick<AppModule, 'id' | 'name' | 'state' | 'auto_install' | 'country_ids'>[],
  deps: readonly DepRow[], companyCountries: readonly number[]): InstallSim {
  const byName = new Map(mods.map((m) => [m.name, m]));
  const nameOf = new Map(mods.map((m) => [m.id, m.name]));
  const depsOf = new Map<string, DepRow[]>();
  for (const d of deps) {
    const by = d.module_id ? nameOf.get(d.module_id[0]) : undefined;
    if (by) { const l = depsOf.get(by); if (l) l.push(d); else depsOf.set(by, [d]); }
  }
  const state = new Map(mods.map((m) => [m.name, m.state as string]));
  const out: InstallSim = { brought: [], missing: [], uninstallable: [] };
  const INSTALL = new Set(['installed', 'to install', 'to upgrade']);

  /** _state_update('to install', ['uninstalled']): its dependencies first, then itself. */
  const mark = (name: string, reason: Brought['reason'], via: string[], seen = new Set<string>()) => {
    if (state.get(name) !== 'uninstalled' || seen.has(name)) return;
    seen.add(name);
    for (const d of depsOf.get(name) ?? []) {
      if (!byName.has(d.name)) { out.missing.push({ module: name, dependency: d.name }); continue; }
      if (state.get(d.name) === 'uninstallable' && !out.uninstallable.includes(d.name)) out.uninstallable.push(d.name);
      mark(d.name, 'depends', [name], seen);
    }
    state.set(name, 'to install');
    out.brought.push({ name, reason, via });
  };
  for (const n of names) mark(n, 'depends', []);

  const companies = new Set(companyCountries);
  for (;;) {
    const auto = mods.filter((m) => {
      if (state.get(m.name) !== 'uninstalled' || !m.auto_install) return false;
      const triggers = (depsOf.get(m.name) ?? []).filter((d) => d.auto_install_required);
      const states = new Set(triggers.map((d) => state.get(d.name) ?? 'unknown'));
      return [...states].every((x) => INSTALL.has(x)) && states.has('to install')
        && (!m.country_ids.length || m.country_ids.some((c) => companies.has(c)));
    });
    if (!auto.length) break;
    for (const m of auto) mark(m.name, 'auto', (depsOf.get(m.name) ?? []).filter((d) => d.auto_install_required).map((d) => d.name));
  }
  return out;
}

// ---------- the data a module brings ----------

/** ir.model.data, the columns the Data part reads. */
export interface XmlIdRow { id: number; model: string; name: string; res_id: number; noupdate: boolean }

/** The kinds of data, in the order a developer looks for them; the rest after, the biggest first. */
const KIND_ORDER = [
  'ir.model', 'ir.model.fields', 'ir.model.fields.selection', 'ir.ui.view', 'ir.ui.menu', 'ir.actions.act_window',
  'ir.actions.server', 'ir.actions.report', 'ir.actions.client', 'ir.actions.act_url', 'ir.cron', 'res.groups',
  'ir.access', 'ir.model.access', 'ir.rule', 'ir.model.constraint', 'ir.model.relation', 'ir.module.category', 'ir.asset',
];

/** The xmlids of a module, by model, in KIND_ORDER then by size. */
export function byKind(rows: readonly XmlIdRow[]): { model: string; rows: XmlIdRow[] }[] {
  const groups = new Map<string, XmlIdRow[]>();
  for (const r of rows) { const l = groups.get(r.model); if (l) l.push(r); else groups.set(r.model, [r]); }
  const rank = (m: string) => { const i = KIND_ORDER.indexOf(m); return i < 0 ? KIND_ORDER.length : i; };
  return [...groups].map(([model, rs]) => ({ model, rows: rs }))
    .sort((a, b) => rank(a.model) - rank(b.model) || b.rows.length - a.rows.length || a.model.localeCompare(b.model));
}

// ---------- the description ----------

/** Its own styles: Odoo's description pages expect a white page (and Bootstrap, absent here: columns stack). */
const DESC_CSS = ':root{color-scheme:light}body{margin:0;padding:16px;font:14px/1.5 system-ui,sans-serif;color:#212529;background:#fff;'
  + 'overflow-wrap:anywhere}img,video{max-width:100%;height:auto}table{max-width:100%}pre{white-space:pre-wrap}a{color:#017e84}';

/** The page shown in the sandboxed frame: Odoo's description_html (sanitized by the server), relative links and images
 * resolved against the Odoo it comes from, links opening in a new tab. */
export function descriptionDoc(origin: string, html: string): string {
  const base = origin.replace(/[&"<>]/g, (c) => `&#${c.charCodeAt(0)};`);
  return `<!doctype html><html><head><meta charset="utf-8"><base href="${base}/" target="_blank"><style>${DESC_CSS}</style></head><body>${html}</body></html>`;
}
