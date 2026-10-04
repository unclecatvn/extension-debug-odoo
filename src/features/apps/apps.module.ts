// Apps tab, the module opened beside the list (wide panel) or under its row: who it is (icon, title, technical name,
// state, versions in the database and on disk) and what to do (install, upgrade, uninstall, pick, open its form), then
// its parts, each folded but the description:
//   Description   Odoo's description_html: static/description/index.html when the module has one, else its RST
//                 description; shown in a sandboxed frame (no script runs, its own styles)
//   Manifest      what the manifest gave ir.module.module
//   Depends       what it declares, what it needs in all, what installing it also installs, what is missing
//   Diagram       the same, drawn: what it needs, what installing it brings, what uses it (apps.graph.ts)
//   Used by       the modules depending on it: what uninstalling it also removes
//   Data          its xmlids by kind (views, menus, actions, groups, ACLs…), each record ↗
//   Models        the models it creates and the ones it extends (and who created them)
//   Uninstall     Odoo's own preview (base.module.uninstall): the modules removed with it, the models whose data is
//                 dropped; then confirm, then type its name
import { N_, _t } from '../../i18n/i18n.ts';
import { copyable, kv, odooLink, pill } from '../../ui/components.ts';
import { matrix, type MxRow } from '../../ui/matrix.ts';
import { frag, note } from '../../ui/parts.ts';
import { tip } from '../../ui/tooltip.ts';
import { dependencyDiagram } from './apps.graph.ts';
import { hasIndexHtml, readDetail, readModels, readXmlIds, uninstallPreview, type ModuleDetail } from './apps.data.ts';
import { byKind, definingModule, descriptionDoc, isInstalled, versionDrift, type AppModule, type InstallSim, type ModuleGraph, type XmlIdRow } from './apps.logic.ts';
import { activate, formPath, run, uninstall, upgrade } from './apps.ops.ts';
import type { AppsCtx } from './apps.state.ts';
import { box, button, fold, link, plainList, row, stateLabel, statePill, stepLog, text, title, tpl } from './apps.ui.ts';

const SHOWN_XMLIDS = 300;

/** What the Modules view gives the module opened. */
export interface ModuleEnv {
  c: AppsCtx;
  graph: ModuleGraph;
  byName: ReadonlyMap<string, AppModule>;
  byId: ReadonlyMap<number, AppModule>;
  disk: ReadonlyMap<number, string | false>;
  /** what installing `names` would set to install, as Odoo's button_install */
  simulate(names: readonly string[]): InstallSim;
  isPicked(name: string): boolean;
  togglePick(name: string): void;
  /** opens another module (shown in the list first) */
  open(name: string): void;
}

const KIND_LABEL: Record<string, string> = {
  'ir.model': N_('Models'), 'ir.model.fields': N_('Fields'), 'ir.model.fields.selection': N_('Selection values'),
  'ir.ui.view': N_('Views'), 'ir.ui.menu': N_('Menus'), 'ir.actions.act_window': N_('Window actions'),
  'ir.actions.server': N_('Server actions'), 'ir.actions.report': N_('Reports'), 'ir.actions.client': N_('Client actions'),
  'ir.actions.act_url': N_('URL actions'), 'ir.cron': N_('Scheduled actions'), 'res.groups': N_('Groups'),
  'ir.access': N_('Accesses'), 'ir.model.access': N_('Access rights (ACL)'), 'ir.rule': N_('Record rules'), 'ir.model.constraint': N_('Constraints'),
  'ir.model.relation': N_('Many2many tables'), 'ir.module.category': N_('Categories'), 'ir.asset': N_('Assets'),
};

export async function moduleDetail(m: AppModule, e: ModuleEnv): Promise<Node> {
  const { c, graph } = e;
  const origin = c.page.origin;
  const installed = isInstalled(m);
  const detail = readDetail(m.id);
  let xmlids: Promise<XmlIdRow[]> | null = null;
  const ownData = () => (xmlids ??= readXmlIds(m.name));

  // ---------- head ----------
  const h = tpl('module-head', { box: HTMLDivElement, icon: HTMLImageElement, name: HTMLHeadingElement, meta: HTMLDivElement, summary: HTMLDivElement, status: HTMLDivElement, actions: HTMLDivElement }).refs;
  h.name.textContent = m.shortdesc || m.name;
  h.icon.hidden = true;
  h.icon.addEventListener('load', () => { h.icon.hidden = false; });
  void detail.then((d) => { if (d.icon) h.icon.src = new URL(d.icon, origin).href; }, () => {});
  h.meta.append(...[copyable(m.name), statePill(m.state), m.application && pill(_t('App'), 'accent'), m.category_id && pill(m.category_id[1]),
    m.auto_install && tip(pill(_t('auto-install')), _t('Installed by itself once every module it depends on is')),
    m.to_buy && pill(_t('Enterprise'), 'info')].filter((x): x is HTMLElement => !!x));
  if (m.summary) h.summary.textContent = m.summary;
  else h.summary.remove();
  const line = (...nodes: (Node | string | false | null | undefined)[]) => { const { line: l } = tpl('line', { line: HTMLDivElement }).refs; l.append(...nodes.filter((n): n is Node | string => !!n)); h.status.append(l); };
  const explained = stateExplained(m);
  if (explained) line(explained);
  if (installed || m.latest_version) {
    const disk = e.disk.get(m.id);
    const drift = versionDrift(m.latest_version, disk);
    line(text(_t('Installed: %s', m.latest_version || '—'), 'mono', _t('ir.module.module.latest_version: the version in the database, written by the last install or upgrade')),
      text('·', 'muted'),
      text(_t('On disk: %s', disk || '—'), 'mono', _t('installed_version: the version in the manifest on the server\'s addons path')),
      drift && pill(drift === 'disk-newer' ? _t('upgrade needed') : _t('older on disk'), 'med'));
    if (drift === 'disk-newer') line(text(_t('The code on disk is newer than the database: Upgrade applies it.'), 'muted'));
    if (drift === 'disk-older') line(text(_t('The code on disk is older than the database: another branch, or a version bumped back?'), 'muted'));
  }
  const missing = graph.missing(m.name);
  if (missing.length) line(pill(_t('missing'), 'err'), _t('Depends on modules this server doesn\'t have: %s', missing.join(', ')));

  const { log: ul } = tpl('steps', { log: HTMLUListElement }).refs;
  const log = stepLog(ul);
  const ops: HTMLButtonElement[] = [];
  const op = (label: string, hint: string, fn: (begin: Parameters<Parameters<typeof run>[2]>[0]) => Promise<void>) => {
    const b = button(label, () => void run(log, ops, fn), 'btn', hint);
    ops.push(b);
    return b;
  };
  const pickChip = button(e.isPicked(m.name) ? _t('Picked ✓') : _t('Pick'), () => {
    e.togglePick(m.name);
    pickChip.textContent = e.isPicked(m.name) ? _t('Picked ✓') : _t('Pick');
  }, 'chip', _t('Add to / remove from the modules picked for an action'));
  const uninstallPart = installed ? uninstallFold() : null;
  h.actions.append(...[
    m.state === 'uninstalled' && op(_t('Install'), _t('Update Apps List, then install it with its dependencies'), (begin) => activate([m.name], c.a, e.simulate, begin)),
    (m.state === 'installed' || m.state === 'to upgrade') && op(_t('Upgrade'), _t('Upgrade it now (and the modules depending on it)'), (begin) => upgrade([m.name], c.a, begin)),
    uninstallPart && button(_t('Uninstall…'), () => { uninstallPart.open = true; uninstallPart.scrollIntoView({ block: 'nearest' }); }, 'btn', _t('What it would remove, then confirm')),
    pickChip,
    odooLink(origin, formPath(m.id), _t('Form ↗')),
  ].filter((x): x is HTMLButtonElement | HTMLAnchorElement => !!x));
  h.box.append(ul);

  // ---------- parts ----------
  const parts: Node[] = [h.box];
  parts.push(fold('desc', _t('Description'), '', async () => {
    const [d, own] = await Promise.all([detail, hasIndexHtml(m.name)]);
    const page = `${origin}/${m.name}/static/description/index.html`;
    const source = row(text(own ? _t('From static/description/index.html') : _t('From the manifest\'s description (RST) or the README'), 'muted'),
      own && link(_t('Open the page ↗'), page));
    if (!d.description_html) return box(source, note(_t('No description.')));
    return box(source, descriptionFrame(origin, d.description_html));
  }, true));

  parts.push(fold('manifest', _t('Manifest'), '', async () => manifestFacts(m, await detail, e)));

  const depends = graph.depends(m.name);
  parts.push(fold('depends', _t('Depends'), _t('%s declared', depends.length), () => {
    const all = graph.upstream([m.name]);
    const sim = m.state === 'uninstalled' ? e.simulate([m.name]) : null;
    const added = (reason: 'depends' | 'auto') => sim?.brought.filter((b) => b.reason === reason && b.name !== m.name) ?? [];
    const why = new Map(sim?.brought.map((b) => [b.name, b.reason === 'auto' ? _t('auto-installed: %s all installed or being installed', b.via.join(', ')) : _t('a dependency of %s', b.via.join(', '))]));
    return box(
      title(_t('Declared in its manifest')), depends.length ? chips(depends, e) : note(_t('Nothing: it depends on no module.')),
      title(_t('Needs in all (%s)', all.length)), all.length ? chips(all, e) : note(_t('Nothing.')),
      sim && frag(
        title(_t('Installing it also installs (%s)', added('depends').length)),
        added('depends').length ? chips(added('depends').map((b) => b.name), e, why) : note(_t('Nothing: every dependency is installed.')),
        title(_t('And auto-installs (%s)', added('auto').length)),
        added('auto').length ? chips(added('auto').map((b) => b.name), e, why) : note(_t('Nothing.')),
        sim.missing.length > 0 && note(_t('Odoo will refuse it: %s', sim.missing.map((x) => _t('%s depends on %s, not on this server', x.module, x.dependency)).join('; '))),
        sim.uninstallable.length > 0 && note(_t('Not installable, the install will fail: %s', sim.uninstallable.join(', '))),
        note(_t('As Odoo\'s button_install computes it: the dependencies not installed, then every auto_install module whose triggers are all installed or being installed (and, for a localization, a company in its countries).'))),
      legend());
  }));

  parts.push(fold('graph', _t('Dependency diagram'), '', () => dependencyDiagram(m, e)));

  const usedBy = graph.dependents(m.name);
  const removed = graph.downstream([m.name]).filter((n) => { const x = e.byName.get(n); return !!x && isInstalled(x); });
  parts.push(fold('used-by', _t('Used by'), installed ? _t('%s installed depend on it', removed.length) : _t('%s modules', usedBy.length), () => box(
    title(_t('Declaring it in their depends (%s)', usedBy.length)), usedBy.length ? chips(usedBy, e) : note(_t('No module depends on it.')),
    installed && frag(title(_t('Uninstalling it also removes (%s)', removed.length)), removed.length ? chips(removed, e) : note(_t('No other module.'))),
    legend())));

  parts.push(fold('data', _t('Data (xmlids)'), '', async () => {
    const rows = await ownData();
    if (!rows.length) return note(installed ? _t('No xmlid: the module brings no data.') : _t('Not installed: its data is known once it is.'));
    const tableRows: MxRow[] = byKind(rows).map((k) => {
      const label = KIND_LABEL[k.model];
      const noupdate = k.rows.filter((r) => r.noupdate).length;
      return {
        label: [label ? _t(label) : k.model], sub: label ? k.model : undefined, q: k.model,
        cells: [String(k.rows.length), noupdate ? tip(text(String(noupdate)), _t('noupdate: an upgrade doesn\'t overwrite them')) : '·'],
        detail: () => xmlidList(m.name, k.model, k.rows, origin),
      };
    });
    return frag(note(_t('%s xmlids. Click a kind for its records.', rows.length)), matrix(_t('Kind'), [_t('Records'), 'noupdate'], [{ rows: tableRows }]));
  }));

  parts.push(fold('models', _t('Models'), '', async () => {
    const ids = (await ownData()).filter((r) => r.model === 'ir.model').map((r) => r.res_id);
    if (!ids.length) return note(installed ? _t('It creates or extends no model.') : _t('Not installed: its models are known once it is.'));
    const models = await readModels(ids);
    const creates: MxRow[] = [];
    const extendsRows: MxRow[] = [];
    for (const x of models) {
      const by = definingModule(x.modules, graph);
      const others = x.modules.filter((n) => n !== m.name);
      const r: MxRow = { label: [copyable(x.model)], sub: x.name, q: `${x.model} ${x.name}`,
        cells: [tip(text(String(x.modules.length)), _t('Installed modules defining or extending it: %s', x.modules.join(', ')))] };
      if (by === m.name) creates.push(r);
      else { r.sub = by ? _t('%s · created by %s', x.name, by) : _t('%s · also in %s', x.name, others.join(', ')); extendsRows.push(r); }
    }
    return matrix(_t('Model'), [_t('Modules')], [
      { title: _t('Creates (%s)', creates.length), rows: creates },
      { title: _t('Extends (%s)', extendsRows.length), rows: extendsRows },
    ].filter((s) => s.rows.length));
  }));

  if (uninstallPart) parts.push(uninstallPart);
  return box(...parts);

  function uninstallFold(): HTMLDetailsElement {
    return fold('uninstall', _t('Uninstall'), '', async () => {
      const p = await uninstallPreview(m.id, c.a);
      const names = p.modules.map((id) => e.byId.get(id)?.name ?? `#${id}`).filter((n) => n !== m.name).sort();
      const { log: out } = tpl('steps', { log: HTMLUListElement }).refs;
      const ulog = stepLog(out);
      const go = button(_t('Uninstall %s…', m.name), () => {
        const lines = [_t('Uninstall %s?', m.name), '',
          names.length ? _t('Removed with it: %s', names.join(', ')) : _t('No other module is removed.'),
          _t('Models whose data is deleted for good: %s', p.models.length), '', _t('This cannot be undone.')];
        if (!confirm(lines.join('\n'))) return;
        const typed = prompt(_t('Type %s to uninstall it.', m.name));
        if (typed == null) return;
        if (typed.trim() !== m.name) { ulog.clear(); ulog.error(new Error(_t('Not the module\'s name: nothing was uninstalled.'))); return; }
        void run(ulog, [go, ...ops], (begin) => uninstall(m, c.a, begin));
      }, 'btn', _t('Asks to confirm, then to type its name'));
      go.classList.add('danger');
      return box(
        note(_t('What Odoo\'s uninstall wizard computes: every module depending on it goes too, and the models only these modules define lose their table and data.')),
        title(_t('Modules removed with it (%s)', names.length)), names.length ? chips(names, e) : note(_t('No other module.')),
        title(_t('Models whose data is deleted (%s)', p.models.length)),
        p.models.length ? plainList(p.models.map((x) => row(copyable(x.model), text(x.name, 'muted')))) : note(_t('None: no model loses its data.')),
        row(go), out);
    });
  }
}

/** What the state pill can't say: why it can't be installed, or that it waits. */
function stateExplained(m: AppModule): string | null {
  switch (m.state) {
    case 'uninstallable': return _t('Not installable: its manifest says installable: False, or it is not on this server\'s addons path any more.');
    case 'to install': case 'to upgrade': case 'to remove': return _t('%s: waiting for Odoo\'s next module operation (see Pending).', stateLabel(m.state));
    default: return null;
  }
}

/** Modules as chips: ● installed, ○ not, ✗ unknown here; a click opens it. */
function chips(names: readonly string[], e: ModuleEnv, why?: ReadonlyMap<string, string>): HTMLDivElement {
  return box(...names.map((n) => {
    const x = e.byName.get(n);
    const mark = !x ? '✗' : isInstalled(x) ? '●' : '○';
    const hint = x ? [x.shortdesc, stateLabel(x.state), why?.get(n)].filter(Boolean).join(' · ') : _t('Not on this server');
    const b = button(`${mark} ${n}`, () => { if (x) e.open(n); }, 'chip', hint);
    if (!x) b.disabled = true;
    return b;
  }));
}

const legend = () => { const n = note(_t('● installed · ○ not installed · ✗ not on this server. Click a module to open it.')); n.classList.add('legend'); return n; };

function manifestFacts(m: AppModule, d: ModuleDetail, e: ModuleEnv): HTMLElement {
  return kv({
    [_t('Technical name')]: m.name,
    [_t('Title (name)')]: m.shortdesc,
    [_t('Version on disk')]: e.disk.get(m.id) || '—',
    [_t('Version installed')]: m.latest_version || '—',
    [_t('Summary')]: m.summary || '—',
    [_t('Author')]: m.author || '—',
    [_t('Maintainer')]: d.maintainer || '—',
    [_t('Contributors')]: d.contributors || '—',
    [_t('Website')]: d.website || '—',
    [_t('License')]: d.license || '—',
    [_t('Category')]: m.category_id ? m.category_id[1] : '—',
    [_t('Depends')]: e.graph.depends(m.name).join(', ') || '—',
    [_t('Application')]: m.application ? _t('yes') : _t('no'),
    [_t('Auto-install')]: m.auto_install ? _t('yes') : _t('no'),
    [_t('Demo data loaded')]: d.demo ? _t('yes') : _t('no'),
  });
}

/** The description in a sandboxed frame: no script runs in it (no allow-scripts); same origin only so its height can
 * be read to fit it. */
function descriptionFrame(origin: string, html: string): HTMLIFrameElement {
  const { frame } = tpl('description', { frame: HTMLIFrameElement }).refs;
  frame.addEventListener('load', () => {
    const doc = frame.contentDocument;
    if (doc) frame.style.height = `${doc.documentElement.scrollHeight + 4}px`;
  });
  frame.srcdoc = descriptionDoc(origin, html);
  return frame;
}

/** A kind's records: their xmlids (click to copy), each opening in Odoo. */
function xmlidList(module: string, model: string, rows: readonly XmlIdRow[], origin: string): Node {
  return frag(
    plainList(rows.slice(0, SHOWN_XMLIDS).map((r) => row(copyable(`${module}.${r.name}`), odooLink(origin, `${model}/${r.res_id}`)))),
    rows.length > SHOWN_XMLIDS && note(_t('… and %s more', rows.length - SHOWN_XMLIDS)));
}
