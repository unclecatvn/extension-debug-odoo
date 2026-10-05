// Security tab, view "This model": the model's access table as Odoo configures it. ACLs (group × operation, then
// whether the user — and the user compared — has the group), record rules (who they apply to, on which operations;
// a rule opens its domain), _inherits parents, fields restricted to groups (visible or hidden for each user), and an
// audit of risky configuration. ACLs and rules need Access Rights (base.group_erp_manager); fields don't.
import { _t } from '../../i18n/i18n.ts';
import { groupsLabel, parseGroups } from '../../odoo/groups.ts';
import { MODES } from '../../odoo/models.ts';
import { groupIds, groupNames } from '../../odoo/reads.ts';
import { fill } from '../../ui/cards.ts';
import { copyable } from '../../ui/components.ts';
import { frag, note } from '../../ui/parts.ts';
import { groupGraph, keyGroups, type Simulated } from './security.data.ts';
import { auditModel, groupsSpecAllows, type Rule } from './security.logic.ts';
import type { SecurityCtx } from './security.state.ts';
import { matrix, type Cell, type MxRow } from '../../ui/matrix.ts';
import { domainDetail, findings, mark, modeHeads, title } from './security.ui.ts';

export function modelView(body: HTMLElement, c: SecurityCtx) {
  fill(body, async () => {
    const [sim, other, sec, x, graph, keys] = await Promise.all([c.sim, c.other, c.sec!, c.assessment!, groupGraph(c.a), keyGroups()]);
    const users = [sim, ...(other ? [other] : [])];
    const userHeads = users.map((u) => u.user.name);
    const marks = (groups: number[], global: boolean): Cell[] => users.map((u) => (global ? '—' : groups.some((g) => u.groupIds.has(g))
      ? mark('has', _t('%s has this group', u.user.name)) : mark('no', _t('%s doesn\'t have this group', u.user.name))));
    const out: (Node | null)[] = [];

    if (!sec.acls || !sec.rules) out.push(note(_t('Reading the ACLs and record rules needs Access Rights (base.group_erp_manager).')));
    else {
      out.push(title(_t('Access rights (ACL)')));
      out.push(sec.acls.length ? matrix(_t('Group'), [...modeHeads(), ...userHeads], [{
        rows: sec.acls.map((a): MxRow => ({
          label: [a.group_id ? a.group_id[1] : _t('every user')],
          sub: a.name,
          cells: [...MODES.map((m) => (a[`perm_${m}`] ? { v: true, title: _t('This ACL grants it') } : { v: 'na' as const, title: _t('This ACL doesn\'t grant it') })),
            ...marks(a.group_id ? [a.group_id[0]] : [], !a.group_id)],
          kind: !a.group_id || sim.groupIds.has(a.group_id[0]) ? undefined : 'off',
        })),
      }]) : note(_t('No ACL: only the superuser can access this model.')));

      out.push(title(_t('Record rules')));
      const ruleRow = (r: Rule): MxRow => ({
        label: [r.name],
        sub: r.via ? _t('of %s, through %s', r.via.model, r.via.link) : r.global ? _t('global: every user') : r.groups.map((g) => graph.name(g)).join(', '),
        cells: [...MODES.map((m) => (r[`perm_${m}`] ? { v: true, title: _t('The rule covers this operation') } : { v: 'na' as const, title: _t('The rule doesn\'t cover this operation') })),
          ...marks(r.groups, r.global)],
        kind: r.global || r.groups.some((g) => sim.groupIds.has(g)) ? undefined : 'off',
        detail: () => domainDetail(r.domain_force || '[]', x.evaluated.get(r.id), x.notes.get(r.id)),
      });
      out.push(sec.rules.length ? matrix(_t('Rule'), [...modeHeads(), ...userHeads], [{ rows: sec.rules.map(ruleRow) }]) : note(_t('This model has no record rule.')));
      for (const p of sec.parents) out.push(note(p.counted ? _t('Rules of %s (through %s) count as one more global rule.', p.model, p.link)
        : _t('Rules of %s are not counted: %s is not stored (Odoo %s).', p.model, p.link, c.a.major)));
      const legend = note(_t('✓ the rule applies to this operation · ● the user has one of its groups · ○ not · — every user. Click a rule for its domain.'));
      legend.classList.add('legend');
      out.push(legend);
    }

    out.push(title(_t('Fields restricted to groups')), await fieldsTable(sec.fields, users));

    if (sec.acls && sec.rules) {
      out.push(title(_t('Configuration check')));
      out.push(findings(auditModel(sec.fields, sec.acls, sec.rules.filter((r) => !r.via), new Map([...keys].map(([xmlid, id]) => [id, xmlid])))));
    }
    return frag(...out);
  });
}

/** The fields with groups="…", visible or hidden for each user (has_groups' rule on the simulated groups). */
async function fieldsTable(fields: Record<string, { string: string; groups?: string }>, users: Simulated[]): Promise<Node> {
  const restricted = Object.entries(fields).filter(([, f]) => f.groups).sort(([a], [b]) => a.localeCompare(b));
  if (!restricted.length) return note(_t('No field is restricted to groups.'));
  const xmlids = [...new Set(restricted.flatMap(([, f]) => parseGroups(f.groups!).map((g) => g.xmlid)))];
  const [ids, names] = await Promise.all([groupIds(xmlids), groupNames(xmlids)]);
  const idOf = new Map(xmlids.map((x, i) => [x, ids[i]]));
  const sees = (u: Simulated, spec: string) => groupsSpecAllows(spec, (xmlid) => { const id = idOf.get(xmlid); return id != null && u.groupIds.has(id); });
  return matrix(_t('Field'), users.map((u) => u.user.name), [{
    rows: restricted.map(([name, f]): MxRow => ({
      label: [copyable(name)],
      sub: `${f.string} · ${groupsLabel(f.groups!, names)}`,
      cells: users.map((u) => ({ v: sees(u, f.groups!), title: sees(u, f.groups!) ? _t('%s sees this field', u.user.name) : _t('Hidden from %s', u.user.name) })),
    })),
  }]);
}
