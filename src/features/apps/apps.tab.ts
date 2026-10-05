// Apps tab: the modules of the database, as Odoo's Apps menu has them and as a developer needs them. Two views:
//   Modules   apps.modules.ts   Odoo's search bar, the list (⚠ code on disk newer than the database), the modules picked
//                               → Activate / Upgrade / Open Forms; the module opened beside it (apps.module.ts):
//                               description, manifest, dependencies both ways, its data and models, uninstall previewed
//   Pending   apps.pending.ts   the operations waiting (to install / upgrade / remove): apply or cancel them
// apps.data.ts reads and writes, apps.ops.ts runs the operations, apps.logic.ts is pure. Settings rights
// (base.group_system), as the Apps menu. 18.0 / 19.0: the uninstall wizard and the waiting modules (odoo/adapter.ts).
import { _t } from '../../i18n/i18n.ts';
import { sessionInfo } from '../../odoo/reads.ts';
import { fill } from '../../ui/cards.ts';
import { note, segmented } from '../../ui/parts.ts';
import type { TabModule } from '../registry.ts';
import { readCompanyCountries, readDependencies, readDiskVersions, readModules } from './apps.data.ts';
import { isInstalled, pendingOf } from './apps.logic.ts';
import { modulesView } from './apps.modules.ts';
import { pendingView } from './apps.pending.ts';
import { forgetAll, stateOf, type AppsCtx, type View } from './apps.state.ts';
import { box, tpl } from './apps.ui.ts';

const RENDER: Record<View, (body: HTMLElement, c: AppsCtx) => void> = { modules: modulesView, pending: pendingView };

export const appsTab: TabModule = {
  render(section, page, odoo) {
    const s = stateOf(page.origin);
    const draw = () => {
      section.replaceChildren();
      const r = tpl('view', { view: HTMLDivElement, head: HTMLDivElement, body: HTMLDivElement }).refs;
      section.append(r.view);
      fill(r.body, async () => {
        if (!(await sessionInfo()).is_system) return note(_t('The Apps tab needs Settings rights (base.group_system), as Odoo\'s Apps menu.'));
        const modules = readModules();
        const c: AppsCtx = {
          page, a: odoo.adapter, s, modules,
          deps: readDependencies(),
          countries: readCompanyCountries().catch(() => []),
          disk: modules.then((ms) => readDiskVersions(ms.filter(isInstalled).map((m) => m.id))),
          show: (v) => { s.view = v; draw(); },
          rerender: draw,
        };
        const waiting = pendingOf(await modules).length;
        const views: [View, string][] = [['modules', _t('Modules')], ['pending', waiting ? _t('Pending (%s)', waiting) : _t('Pending')]];
        const out = box();
        out.className = 'subview-body';
        const show = (v: View) => { s.view = v; out.replaceChildren(); RENDER[v](out, c); };
        r.head.append(segmented(views, s.view ?? 'modules', show));
        show(s.view ?? 'modules');
        return out;
      });
    };
    draw();
  },
  reset: forgetAll,
};
