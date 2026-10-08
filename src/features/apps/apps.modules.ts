// Apps tab, view "Modules": Odoo's search bar (filters Installed / Not Installed, Apps / Extra, category, as facets),
// the modules as a table (state, version installed; ⚠ when the manifest on disk is newer), the module opened beside it
// (apps.module.ts). Modules are picked by their box, by typing names then Enter (sale; stock), or as "this screen's
// modules"; the picked ones get Activate (Update Apps List, then install with dependencies), Upgrade, Open Forms.
import { _t } from '../../i18n/i18n.ts';
import { fill } from '../../ui/cards.ts';
import { odooLink } from '../../ui/components.ts';
import { filterMatrix, matrix, type MxRow } from '../../ui/matrix.ts';
import { note } from '../../ui/parts.ts';
import { tip } from '../../ui/tooltip.ts';
import { modulesOfModel } from './apps.data.ts';
import { isInstalled, moduleFilter, moduleGraph, pendingOf, searchText, simulateInstall, splitNames, versionDrift, type AppModule } from './apps.logic.ts';
import { moduleDetail, type ModuleEnv } from './apps.module.ts';
import { activate, formPath, openModuleForms, run, upgrade } from './apps.ops.ts';
import { keepForm, loadForm, type AppsCtx } from './apps.state.ts';
import { box, button, searchBar, statePill, stepLog, text, tpl } from './apps.ui.ts';

export function modulesView(body: HTMLElement, c: AppsCtx) {
  fill(body, async () => {
    const [mods, deps, disk, countries] = await Promise.all([c.modules, c.deps, c.disk, c.countries]);
    const graph = moduleGraph(mods, deps);
    const simulate = (names: readonly string[]) => simulateInstall(names, mods, deps, countries);
    const byId = new Map(mods.map((m) => [m.id, m]));
    const byName = new Map(mods.map((m) => [m.name, m]));
    const form = loadForm();
    const f = form.filters;
    const picked = new Set(form.picked);
    const cats = [...new Set(mods.flatMap((m) => (m.category_id ? [m.category_id[1]] : [])))].sort((a, b) => a.localeCompare(b));
    let keep = moduleFilter(f);
    const bar = searchBar(f, cats, () => { keep = moduleFilter(f); save(); apply(); });
    bar.input.value = form.query;
    const save = () => keepForm({ query: bar.input.value, filters: f, picked: [...picked] });

    // ---------- the list, the module opened beside it ----------
    const md = tpl('apps-md', { root: HTMLDivElement, list: HTMLDivElement, pane: HTMLElement }).refs;
    md.pane.append(note(_t('Choose a module: its description, dependencies and data show here.')));
    const boxes = new Map<string, HTMLInputElement>();
    const opened = c.s.module != null && byId.has(c.s.module) ? c.s.module : null;
    const drifted = mods.filter((m) => isInstalled(m) && versionDrift(m.latest_version, disk.get(m.id)) === 'disk-newer');
    const env: ModuleEnv = {
      c, graph, byName, byId, disk, simulate,
      isPicked: (n) => picked.has(n),
      togglePick: (n) => setPicked(n, !picked.has(n)),
      open: (n) => openModule(n),
    };
    const rows: MxRow[] = mods.map((m) => {
      const { box: cb } = tpl('pick', { box: HTMLInputElement }).refs;
      cb.checked = picked.has(m.name);
      cb.setAttribute('aria-label', _t('Pick %s', m.name));
      cb.addEventListener('change', () => setPicked(m.name, cb.checked));
      boxes.set(m.name, cb);
      return {
        id: String(m.id),
        label: [cb, m.shortdesc || m.name],
        sub: m.author ? `${m.name} · ${m.author}` : m.name,
        q: searchText(m),
        kind: isInstalled(m) ? undefined : 'off',
        cells: [statePill(m.state), versionCell(m, disk.get(m.id)), odooLink(c.page.origin, formPath(m.id))],
        open: m.id === opened,
        detail: () => { c.s.module = m.id; return moduleDetail(m, env); },
      };
    });
    const table = matrix(_t('Module'), [_t('State'), _t('Version'), ''], [{ rows }], -1, false, md.pane);
    md.list.append(table);

    /** Typing names (sale; stock) shows them; a word searches names, titles, summaries, authors. Picked ones always show. */
    function apply() {
      const q = bar.input.value.trim();
      const names = /[;,]/.test(q) ? new Set(splitNames(q)) : null;
      const n = filterMatrix(table, names ? '' : q, (tr) => {
        const m = byId.get(Number(tr.dataset.id));
        return !!m && (picked.has(m.name) || (names ? names.has(m.name) : keep(m)));
      });
      bar.count.textContent = _t('%s/%s modules', n, mods.length);
    }
    bar.input.addEventListener('input', () => { save(); apply(); });
    bar.input.addEventListener('keydown', (ev) => {
      if (ev.key !== 'Enter') return;
      ev.preventDefault();
      const q = bar.input.value.trim();
      const typed = splitNames(q);
      const shown = [...table.querySelectorAll<HTMLTableRowElement>('tr[data-id]:not([hidden])')].map((tr) => byId.get(Number(tr.dataset.id))!);
      // names typed (known or not: Activate runs Update Apps List first), an exact name, or the only module shown
      const add = /[;,]/.test(q) ? typed : byName.has(q) ? [q] : shown.length === 1 ? [shown[0]!.name] : [];
      if (!add.length) return;
      for (const n of add) setPicked(n, true, false);
      bar.input.value = '';
      save();
      drawPicked();
      apply();
    });

    function setPicked(name: string, on: boolean, redraw = true) {
      if (on) picked.add(name); else picked.delete(name);
      const cb = boxes.get(name);
      if (cb) cb.checked = on;
      if (redraw) { save(); drawPicked(); apply(); }
    }

    /** Opens another module (from a link in a detail): shown in the list first if filtered out. */
    function openModule(name: string) {
      const m = byName.get(name);
      const tr = m && table.querySelector<HTMLTableRowElement>(`tr[data-id="${m.id}"]`);
      if (!tr) return;
      if (tr.hidden) { bar.input.value = name; save(); apply(); }
      if (tr.hidden) { f.installed = f.notInstalled = f.apps = f.extra = false; f.category = null; keep = moduleFilter(f); save(); apply(); }
      tr.click();
      tr.scrollIntoView({ block: 'nearest' });
    }

    // ---------- the modules picked, the actions ----------
    const p = tpl('pickbar', { bar: HTMLDivElement, chips: HTMLDivElement, actions: HTMLDivElement, log: HTMLUListElement }).refs;
    const log = stepLog(p.log);
    const ops: HTMLButtonElement[] = [];
    const op = (label: string, hint: string, fn: (list: string[], begin: Parameters<Parameters<typeof run>[2]>[0]) => Promise<void>) => {
      const b = button(label, () => {
        const list = [...picked];
        if (!list.length) { log.clear(); log.error(new Error(_t('Pick at least one module.'))); return; }
        void run(log, ops, (begin) => fn(list, begin));
      }, 'btn', hint);
      ops.push(b);
      return b;
    };
    p.actions.append(
      op(_t('Activate'), _t('Update Apps List, then install the picked modules with their dependencies'), (list, begin) => activate(list, c.a, simulate, begin)),
      op(_t('Upgrade'), _t('Upgrade the picked modules (must be installed)'), (list, begin) => upgrade(list, c.a, begin)),
      op(_t('Open Forms ↗'), _t('Open each picked module\'s form in a new tab'), (list, begin) => openModuleForms(list, c.page.origin, begin)),
    );
    const clear = button(_t('Clear'), () => { for (const n of [...picked]) setPicked(n, false, false); save(); drawPicked(); apply(); }, 'chip', _t('Unpick every module'));
    p.actions.append(clear);
    // the modules defining or extending the screen's model not by Odoo S.A.: the ones being worked on, usually
    const screen = c.page.model ? modulesOfModel(c.page.model).catch(() => []) : Promise.resolve([]);
    void screen.then((names) => {
      const custom = names.filter((n) => { const x = byName.get(n); return !!x && !/\bOdoo S\.?A\.?/i.test(x.author || ''); });
      if (!custom.length) return;
      p.actions.append(button(_t('+ This screen: %s', custom.length > 3 ? _t('%s modules', custom.length) : custom.join(', ')), () => {
        for (const n of custom) setPicked(n, true, false);
        save(); drawPicked(); apply();
      }, 'chip', _t('Pick the non-Odoo S.A. modules defining or extending %s: %s (all: %s)', c.page.model ?? '', custom.join(', '), names.join(', '))));
    });
    if (drifted.length) {
      p.actions.append(button(_t('+ Upgrade needed (%s)', drifted.length), () => {
        for (const m of drifted) setPicked(m.name, true, false);
        save(); drawPicked(); apply();
      }, 'chip', _t('Pick the installed modules whose manifest on disk is newer than the database: %s', drifted.map((m) => m.name).join(', '))));
    }
    function drawPicked() {
      p.chips.replaceChildren(...(picked.size ? [text(_t('Picked:'), 'muted')] : [text(_t('Tick modules, or type names then Enter, to act on them.'), 'muted')]),
        ...[...picked].map((n) => {
          const x = tpl('picked', { chip: HTMLSpanElement, label: HTMLSpanElement, x: HTMLButtonElement }).refs;
          x.label.textContent = n;
          if (!byName.has(n)) tip(x.label, _t('Not in the list yet: Activate runs Update Apps List first'));
          x.x.addEventListener('click', () => setPicked(n, false));
          return x.chip;
        }));
      clear.hidden = !picked.size;
    }
    drawPicked();
    apply();

    const pending = pendingOf(mods);
    const warn = pending.length ? waitingLine(pending, c) : null;
    const { bar: tools } = tpl('toolbar', { bar: HTMLDivElement }).refs;
    tools.append(bar.root);
    return box(tools, warn, md.root, p.bar);
  });
}

/** The version installed; ⚠ when the manifest on disk is newer (the code changed, not upgraded) or older. */
function versionCell(m: AppModule, disk: string | false | undefined): Node | string {
  if (!isInstalled(m)) return m.latest_version || '';
  const drift = versionDrift(m.latest_version, disk);
  if (!drift) return m.latest_version || '';
  return tip(text(`⚠ ${m.latest_version || ''}`, 'drift'), drift === 'disk-newer'
    ? _t('Newer on disk (%s): Upgrade applies it', disk || '')
    : _t('Older on disk (%s)', disk || ''));
}

function waitingLine(pending: readonly AppModule[], c: AppsCtx): HTMLElement {
  const r = tpl('warn', { bar: HTMLDivElement, text: HTMLSpanElement }).refs;
  r.text.textContent = _t('%s modules wait for an operation (%s): Odoo runs them at its next one.', pending.length, pending.map((m) => m.name).join(', '));
  r.bar.append(button(_t('Pending →'), () => c.show('pending'), 'chip'));
  return r.bar;
}
