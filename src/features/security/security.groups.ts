// Security tab, view "Groups": the groups as a list (under their application: 18 the category, 19 the privilege) and
// the group opened beside it (wide panel) or under it:
//   list     each user's relation to it (● set on them, ◐ implied, + being tried, ○ not), how many models its ACLs
//            open, how many rules it carries, how many users it has. The users' groups only, or all of them.
//   opened   who it is (xmlid, description), where each user stands and what to do (Try, Add, Remove); the groups it
//            brings and the ones bringing it; its ACLs (model × operations); its record rules (a rule opens its domain
//            as written and as evaluated for the user); its users (a click looks at that user); what adding it to the
//            user would open on other models.
// Below the list: copying the compared user's groups (previewed) and the user's risks. Writing groups needs Access
// Rights (base.group_erp_manager): asked to confirm, a refusal shows here.
import type { Json } from '../../contracts/json.ts';
import { _t } from '../../i18n/i18n.ts';
import { MODES } from '../../odoo/models.ts';
import { fill, filterBox, rememberedOpen } from '../../ui/cards.ts';
import { copyable, pill } from '../../ui/components.ts';
import { filterMatrix, matrix, type Cell, type MxRow } from '../../ui/matrix.ts';
import { frag, note, segmented } from '../../ui/parts.ts';
import {
  aclRows, evaluateFor, groupDetail, groupGraph, readAllRules, readModels, usersPerGroup, writeGroups, type GroupGraph, type Simulated,
} from './security.data.ts';
import { byApp, copyGroups, directGroups, impliedBy, newGrants, shortGroupName, userRisks, type AclRow } from './security.logic.ts';
import { afterWrite, stopTrying, tryGroup, type SecurityCtx } from './security.state.ts';
import { box, button, domainDetail, errBoxTo, findings, mark, modeHeads, modeLabel, plainList, title, tpl } from './security.ui.ts';

const SHOWN_USERS = 60;

export function groupsView(body: HTMLElement, c: SecurityCtx) {
  fill(body, async () => {
    const [sim, other, graph, acls, rules, users] = await Promise.all([c.sim, c.other, groupGraph(c.a), c.allAcls(), readAllRules(c.a), usersPerGroup(c.a)]);
    const out = box();
    const people = [sim, ...(other ? [other] : [])];
    const status = people.map((u) => statusOf(u, graph, c));
    const aclModels = acls ? modelsPerGroup(acls) : null;
    const rulesPer = new Map<number, number>();
    for (const r of rules ?? []) for (const g of r.groups) rulesPer.set(g, (rulesPer.get(g) ?? 0) + 1);
    const held = (id: number) => people.some((u) => u.groupIds.has(id));
    const opened = c.s.group != null && graph.byId.has(c.s.group) ? c.s.group
      : graph.all.find((g) => directOf(sim, graph, c).has(g.id))?.id ?? graph.all[0]?.id;

    const md = tpl('groups-md', { root: HTMLDivElement, list: HTMLDivElement, pane: HTMLElement }).refs;
    md.pane.append(note(_t('Choose a group: its rights, rules and users show here.')));
    const num = (n: number | undefined) => (n ? String(n) : '·');
    // applications folded (but the one holding the group opened): their title says how many groups, how many the user has
    const table = matrix(_t('Group'), [...people.map((u) => u.user.name), 'ACL', _t('Rules'), _t('Users')], byApp(graph.all).map(({ app, groups }) => ({
      title: app || _t('Other'),
      note: [_t('%s groups', groups.length), ...people.map((u) => {
        const n = groups.filter((g) => u.groupIds.has(g.id)).length;
        return n ? _t('%s has %s', u.user.name, n) : '';
      })].filter(Boolean).join(' · '),
      folded: !groups.some((g) => g.id === opened),
      rows: groups.map((g): MxRow => ({
        id: String(g.id),
        label: [shortGroupName(g)],
        q: g.full_name,
        tags: held(g.id) ? ['held'] : [],
        kind: sim.groupIds.has(g.id) ? undefined : 'off',
        cells: [...status.map((s): Cell => s(g.id)), num(aclModels?.get(g.id)), num(rulesPer.get(g.id)), num(users.get(g.id))],
        open: g.id === opened,
        detail: () => detail(g.id),
      })),
    })), -1, false, md.pane);
    md.list.append(table);

    // filter: the users' groups, or all of them
    const { bar } = tpl('toolbar', { bar: HTMLDivElement }).refs;
    const { text: count } = tpl('count', { text: HTMLSpanElement }).refs;
    const f = filterBox([], _t('Filter groups…'));
    const apply = () => {
      const q = f.input.value.trim();
      const n = filterMatrix(table, q, (r) => c.s.allGroups || !!q || r.dataset.tags === 'held');
      count.textContent = _t('%s groups', n);
    };
    f.input.addEventListener('input', apply);
    const scope = () => segmented([['mine', other ? _t('Their groups') : _t('Groups of %s', sim.user.name)], ['all', _t('All groups')]],
      c.s.allGroups ? 'all' : 'mine', (v) => { c.s.allGroups = v === 'all'; apply(); });
    let seg = scope();
    bar.append(f.input, seg, count);
    apply();

    /** Opens another group (from a link in a detail): shown in the list first if filtered out. */
    const openGroup = (id: number) => {
      const tr = table.querySelector<HTMLTableRowElement>(`tr[data-id="${id}"]`);
      if (!tr) return;
      if (tr.hidden || tr.closest('tbody')?.hidden) { // filtered out: every group shows
        c.s.allGroups = true;
        f.input.value = '';
        const next = scope();
        seg.replaceWith(next);
        seg = next;
        apply();
      }
      tr.closest('tbody')?.classList.remove('folded'); // its application unfolds
      tr.click();
      tr.scrollIntoView({ block: 'nearest' });
    };

    async function detail(id: number): Promise<Node> {
      c.s.group = id;
      const g = graph.byId.get(id)!;
      const d = await groupDetail(id, c.a);
      const h = tpl('group-head', { box: HTMLDivElement, name: HTMLHeadingElement, meta: HTMLDivElement, comment: HTMLDivElement, status: HTMLDivElement, actions: HTMLDivElement }).refs;
      h.name.textContent = g.full_name;
      h.meta.append(...[d.xmlid && copyable(d.xmlid, 'name'), g.app && pill(g.app)].filter((x): x is HTMLElement => !!x));
      if (d.comment) h.comment.textContent = d.comment;
      else h.comment.remove();
      for (const [i, u] of people.entries()) {
        const { line } = tpl('status-line', { line: HTMLDivElement }).refs;
        line.append(status[i]!(id), `${u.user.name}: ${statusText(u, id, graph, c)}`);
        h.status.append(line);
      }
      h.actions.append(...actions(sim, id, graph, c, out));

      const parts: Node[] = [h.box];
      // every part folded (its title and how many), built when opened; the parts left open are remembered
      const brings = [...g.implies].map((x) => graph.byId.get(x)).filter((x) => !!x);
      const broughtBy = graph.all.filter((x) => x.implies.has(id));
      const links = (ids: { id: number; full_name: string }[]) => (ids.length ? ids.map((x) => button(x.full_name, () => openGroup(x.id), 'chip', _t('Open this group'))) : [_t('none')]);
      const inheritance = fold('inheritance', _t('Inheritance'), _t('brings %s · brought by %s', brings.length, broughtBy.length), () => box(
        title(_t('Brings (implied groups)')), box(...links(brings)),
        title(_t('Brought by (groups implying it)')), box(...links(broughtBy))));

      // its ACLs
      parts.push(fold('acl', _t('Access rights (ACL)'), d.acls ? _t('%s models', d.acls.length) : '', async () => {
        if (!d.acls) return note(_t('Reading the ACLs needs Access Rights (base.group_erp_manager).'));
        if (!d.acls.length) return note(_t('This group grants no ACL of its own.'));
        const tech = new Map(((await readModels([...new Set(d.acls.flatMap((a) => (a.model_id ? [a.model_id[0]] : [])))])) ?? []).map((m) => [m.id, m.model]));
        const rows: MxRow[] = d.acls.filter((a) => a.model_id).sort((x, y) => (x.model_id ? x.model_id[1] : '').localeCompare(y.model_id ? y.model_id[1] : ''))
          .map((a) => ({ label: [a.model_id ? a.model_id[1] : '?'], sub: a.model_id ? tech.get(a.model_id[0]) : undefined,
            cells: MODES.map((m) => (a[`perm_${m}`] ? { v: true, title: _t('This group may %s', modeLabel(m).toLowerCase()) } : { v: 'na' as const, title: _t('Not granted by this group') })) }));
        return matrix(_t('Model'), modeHeads(), [{ rows }]);
      }));

      // its record rules, their domains evaluated for the user
      parts.push(fold('rules', _t('Record rules'), d.rules ? _t('%s rules', d.rules.length) : '', async () => {
        if (!d.rules) return note(_t('Reading the rules needs Access Rights (base.group_erp_manager).'));
        if (!d.rules.length) return note(_t('This group carries no record rule.'));
        const evaluated = await evaluateFor(sim, d.rules, c.a);
        const rows: MxRow[] = d.rules.map((r) => ({
          label: [r.name], sub: r.model_id ? r.model_id[1] : undefined,
          cells: MODES.map((m) => (r[`perm_${m}`] ? { v: true, title: _t('The rule covers this operation') } : { v: 'na' as const, title: _t('The rule doesn\'t cover this operation') })),
          detail: () => domainDetail(r.domain_force || '[]', evaluated.get(r.id)),
        }));
        return frag(matrix(_t('Rule'), modeHeads(), [{ rows }]),
          legend(_t('A group\'s rules: the user sees a record if any of their group rules matches (and every global rule). Click a rule for its domain, evaluated for %s.', sim.user.name)));
      }));

      // its users
      parts.push(fold('users', _t('Users'), _t('%s users', d.users.length), () => (d.users.length ? box(
        box(...d.users.slice(0, SHOWN_USERS).map((u) => button(u.name, () => { c.s.uid = u.id; c.s.tried.clear(); c.s.baseline = null; c.s.companies = null; c.rerender(); }, 'chip',
          _t('%s · look at this user', u.login)))),
        d.users.length > SHOWN_USERS && note(_t('… and %s more', d.users.length - SHOWN_USERS))) : note(_t('No user.')))));

      // what adding it to the user would open
      if (!sim.groupIds.has(id) && d.acls) {
        parts.push(fold('if-added', _t('If added to %s', sim.user.name), '', async () => {
          const adds = [...graph.closure(id)].filter((x) => !sim.groupIds.has(x));
          const gained = newGrants((await aclRows([...sim.groupIds, ...adds], c.a)) ?? [], sim.groupIds, adds);
          return gained.length ? plainList(gained.map((x) => `${x.model}: ${x.modes.map(modeLabel).join(', ')}`)) : note(_t('No new right on any model.'));
        }));
      }
      parts.push(inheritance); // last: how it relates to other groups, after what it grants
      return box(...parts);
    }

    return frag(bar, md.root,
      legend(_t('● set on the user · ◐ implied by another group · + being tried · ○ not. ACL: models its ACLs open · Rules: rules it carries · Users: users in it. Click a group for the details.')),
      out, other && copyBlock(sim, other, graph, c, out), title(_t('Risks of %s', sim.user.name)), findings(userRisks(sim.user, sim.has)));
  });
}

const legend = (text: string) => { const n = note(text); n.classList.add('legend'); return n; };

/** A part of the group opened: folded unless the user left it open last time (remembered per part), its content
 * built on the first opening. */
function fold(key: string, name: string, count: string, build: () => Node | Promise<Node>): HTMLElement {
  const r = tpl('fold', { title: HTMLSpanElement, count: HTMLSpanElement, body: HTMLDivElement }).refs;
  const d = r.title.closest('details')!;
  r.title.textContent = name;
  r.count.textContent = count ? ` · ${count}` : '';
  const state = rememberedOpen(`security:group-${key}`, false);
  let built = false;
  const load = () => { if (d.open && !built) { built = true; fill(r.body, build); } };
  d.addEventListener('toggle', () => { state.remember(d.open); load(); });
  d.open = state.open;
  load();
  return d;
}

const directOf = (u: Simulated, graph: GroupGraph, c: SecurityCtx) =>
  (c.a.users.writeGroupsField !== c.a.users.allGroupsField ? new Set(u.user.write) : directGroups(u.real, (id) => graph.implied(id)));

/** A user's relation to a group, as a mark. */
function statusOf(u: Simulated, graph: GroupGraph, c: SecurityCtx): (id: number) => HTMLSpanElement {
  const direct = directOf(u, graph, c);
  const by = impliedBy(u.groupIds, (id) => graph.implied(id));
  return (id) => {
    if (u.tried.has(id)) return mark('tried', _t('Being tried'));
    if (u.real.has(id) && direct.has(id) && !by.has(id)) return mark('has', _t('Set on %s', u.user.name));
    if (u.groupIds.has(id)) return mark('implied', _t('Implied by %s', (by.get(id) ?? []).map((h) => graph.name(h)).join(', ')));
    return mark('no', _t('%s doesn\'t have this group', u.user.name));
  };
}

/** The same, in words. */
function statusText(u: Simulated, id: number, graph: GroupGraph, c: SecurityCtx): string {
  if (u.tried.has(id)) return _t('being tried (simulated, nothing written)');
  const by = impliedBy(u.groupIds, (x) => graph.implied(x)).get(id);
  if (u.real.has(id) && directOf(u, graph, c).has(id) && !by) return _t('set on them');
  if (u.groupIds.has(id)) return _t('has it through %s', (by ?? []).map((h) => graph.name(h)).join(', '));
  return _t('doesn\'t have it');
}

/** Writes the user's groups (asked to confirm before); a refusal (Access Rights needed) shows in `out`. */
const write = (c: SecurityCtx, out: HTMLElement, uid: number, commands: Json[]) =>
  afterWrite(c, uid, () => writeGroups(uid, commands, c.a)).catch((e: unknown) => errBoxTo(out, e));

/** What to do with the group opened, for the user. */
function actions(sim: Simulated, id: number, graph: GroupGraph, c: SecurityCtx, out: HTMLElement): Node[] {
  const name = graph.name(id);
  if (sim.tried.has(id)) return [button(_t('Stop trying it'), () => stopTrying(c, id), 'chip')];
  if (sim.real.has(id)) {
    const implied = impliedBy(sim.real, (g) => graph.implied(g)).has(id);
    if (!directOf(sim, graph, c).has(id) || implied) return [note(_t('To take it away, remove the group bringing it.'))];
    return [button(_t('Remove from %s', sim.user.name), () => { if (confirm(_t('Remove %s from %s?', name, sim.user.name))) write(c, out, sim.user.id, [[3, id]]); })];
  }
  if (sim.groupIds.has(id)) return [];
  return [
    button(_t('Try on %s', sim.user.name), () => void tryGroup(c, id), 'chip', _t('Simulate this group in every view, nothing is written')),
    button(_t('Add to %s', sim.user.name), () => { if (confirm(_t('Add %s to %s?', name, sim.user.name))) write(c, out, sim.user.id, [[4, id]]); }),
  ];
}

/** The models each group's own ACLs grant something on. */
function modelsPerGroup(rows: readonly AclRow[]): Map<number, number> {
  const sets = new Map<number, Set<number>>();
  for (const r of rows) {
    if (!r.group_id || !r.model_id || !(r.perm_read || r.perm_write || r.perm_create || r.perm_unlink)) continue;
    sets.set(r.group_id[0], (sets.get(r.group_id[0]) ?? new Set()).add(r.model_id[0]));
  }
  return new Map([...sets].map(([g, s]) => [g, s.size]));
}

/** The compared user's groups copied onto this one, previewed as a table: what is added, what is removed. */
function copyBlock(sim: Simulated, other: Simulated, graph: GroupGraph, c: SecurityCtx, out: HTMLElement): Node | null {
  const add = copyGroups(sim.user.write, other.user.write, 'add');
  const same = copyGroups(sim.user.write, other.user.write, 'same');
  if (!same.adds.length && !same.removes.length) return frag(title(_t('Copy the groups of %s', other.user.name)), note(_t('Same groups set on both.')));
  const rows: MxRow[] = [
    ...same.adds.map((id): MxRow => ({ label: [graph.name(id)], cells: [{ v: true, plus: true, title: _t('Added') }] })),
    ...same.removes.map((id): MxRow => ({ label: [graph.name(id)], cells: [{ v: false, title: _t('Removed by "the same"; kept by "add only"') }] })),
  ];
  const confirmText = (plan: ReturnType<typeof copyGroups>) => [
    _t('Change the groups of %s?', sim.user.name), '',
    plan.adds.length > 0 && _t('Add: %s', plan.adds.map((g) => graph.name(g)).join(', ')),
    plan.removes.length > 0 && _t('Remove: %s', plan.removes.map((g) => graph.name(g)).join(', ')),
    sim.user.share !== other.user.share && _t('Warning: one is a portal user, the other is not: the user type changes.'),
  ].filter((x) => x !== false).join('\n');
  const actionsRow = box(
    add.adds.length > 0 && button(_t('Add only the missing ones (%s)', add.adds.length), () => { if (confirm(confirmText(add))) write(c, out, sim.user.id, add.commands); }),
    button(_t('Make them the same (+%s, −%s)', same.adds.length, same.removes.length), () => { if (confirm(confirmText(same))) write(c, out, sim.user.id, same.commands); }),
  );
  actionsRow.className = 'row';
  return frag(title(_t('Copy the groups of %s onto %s', other.user.name, sim.user.name)), matrix(_t('Group set on the user'), [_t('Change')], [{ rows }]), actionsRow);
}
