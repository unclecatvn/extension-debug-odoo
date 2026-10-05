// Security tab: who can do what, and why, as permission tables. A bar (security.bar.ts: the user, their companies, the
// user compared, the groups being tried), then one of five views:
//   Record      security.record.ts   the checks Odoo runs on the record (ACL, rules) × the operations, and the result
//   By model    security.models.ts   the user's rights across the database, one row per model, by module
//   This model  security.model.ts    the model's ACLs, rules, restricted fields, configuration check
//   Groups      security.groups.ts   the groups by application, per user; try, remove, copy
//   System      security.system.ts   session, system parameters, instance check
// security.data.ts reads and simulates, security.logic.ts decides (pure), security.state.ts keeps what the user chose.
// An AccessError comes from the RPC tab ("Why?") or is pasted in the Record view. 18.0 / 19.0: odoo/adapter.ts.
import { _t } from '../../i18n/i18n.ts';
import { takeAccessProblem } from '../../odoo/access-error.ts';
import { sessionInfo } from '../../odoo/reads.ts';
import { segmented } from '../../ui/parts.ts';
import type { TabModule } from '../registry.ts';
import { securityBar } from './security.bar.ts';
import { assess, modelSecurity, readAllAcls, simulate, type ModelSecurity, type Simulated } from './security.data.ts';
import { groupsView } from './security.groups.ts';
import type { AclRow } from './security.logic.ts';
import { modelView } from './security.model.ts';
import { modelsView } from './security.models.ts';
import { recordView } from './security.record.ts';
import { forgetAll, stateOf, type SecurityCtx, type Subject, type View } from './security.state.ts';
import { systemView } from './security.system.ts';
import { tpl } from './security.ui.ts';

const RENDER: Record<View, (body: HTMLElement, c: SecurityCtx) => void> = {
  record: recordView, models: modelsView, model: modelView, groups: groupsView, system: systemView,
};

export const securityTab: TabModule = {
  render(section, page, odoo) {
    const a = odoo.adapter;
    const s = stateOf(page.origin);
    const problem = takeAccessProblem(); // from the RPC tab: the call refused, as you
    if (problem?.model) {
      s.subject = { model: problem.model, resId: problem.ids[0] ?? null, ids: problem.ids, mode: problem.mode, problem };
      s.uid = null; // the call was refused to you
      s.compare = null;
      s.tried.clear();
      s.baseline = null;
      s.view = 'record';
    }
    const draw = () => {
      section.replaceChildren();
      const subject: Subject | null = s.subject ?? (page.model ? { model: page.model, resId: page.resId ?? null, ids: page.resId ? [page.resId] : [], mode: null, problem: null } : null);
      const sim = sessionInfo().then((i) => simulate(s.uid ?? i.uid, s.tried, s.companies, a));
      const other = s.compare != null ? simulate(s.compare, new Set(), null, a) : null;
      const sec = subject ? modelSecurity(subject.model, a) : null;
      const assessOf = (u: Promise<Simulated>, m: Promise<ModelSecurity>) => Promise.all([u, m]).then(([x, y]) => assess(subject!.model, subject!.resId, x, y, a));
      let acls: Promise<AclRow[] | null> | null = null;
      const c: SecurityCtx = {
        page, a, s, subject, sim, sec, other,
        assessment: sec ? assessOf(sim, sec) : null,
        otherAssessment: sec && other ? assessOf(other, sec) : null,
        allAcls: () => (acls ??= readAllAcls(c.a)),
        rerender: draw,
      };
      securityBar(section, c);

      const views: [View, string][] = [
        ...(subject ? [['record', subject.resId ? _t('Record #%s', subject.resId) : _t('Record')] as [View, string]] : []),
        ['models', _t('By model')],
        ...(subject ? [['model', subject.model] as [View, string]] : []),
        ['groups', _t('Groups')],
        ['system', _t('System')],
      ];
      const fallback: View = subject?.resId || subject?.problem ? 'record' : subject ? 'model' : 'models';
      const shown = views.some(([v]) => v === s.view) ? s.view! : fallback;
      const r = tpl('view', { view: HTMLDivElement, head: HTMLDivElement, body: HTMLDivElement }).refs;
      const show = (v: View) => { s.view = v; r.body.replaceChildren(); RENDER[v](r.body, c); };
      r.head.append(segmented(views, shown, show));
      section.append(r.view);
      show(shown);
    };
    draw();
  },
  reset: forgetAll,
};
