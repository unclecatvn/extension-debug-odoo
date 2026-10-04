// Security tab, view "By model": what the user can do across the database, one row per model (the ACLs of every
// module merged), under the module that creates it (its oldest xmlid: security.logic.ts → definingModules), each module
// folded and summed up in words (how many models with every operation, read only, some, limited by rules). A last
// column counts the record rules restricting which records. Groups being tried show what they add (+✓); a user compared
// shows beside (✓|·), "only differences" keeps the rows where they differ. A model opens what decides it: a sentence,
// the ACLs granting each operation (group by group), the record rules limiting the records (for whom, which operations,
// their domain). Needs Access Rights (base.group_erp_manager).
import { _t } from '../../i18n/i18n.ts';
import { MODES, type Mode } from '../../odoo/models.ts';
import { fill, filterBox } from '../../ui/cards.ts';
import { note } from '../../ui/parts.ts';
import { tip } from '../../ui/tooltip.ts';
import { groupGraph, readAllRules, readDefiningModules, readModels, readModuleTitles, type GroupGraph, type Simulated } from './security.data.ts';
import { accessLevel, accessSummary, firstModule, modelRights, type AclRow, type ModelRights } from './security.logic.ts';
import type { SecurityCtx } from './security.state.ts';
import { filterMatrix, matrix, type MxRow, type MxSection } from '../../ui/matrix.ts';
import { box, button, domainDetail, modeHeads, modeLabel, title, tpl } from './security.ui.ts';

type RuleRow = NonNullable<Awaited<ReturnType<typeof readAllRules>>>[number];

export function modelsView(body: HTMLElement, c: SecurityCtx) {
  fill(body, async () => {
    const [sim, other, acls, rules, graph] = await Promise.all([c.sim, c.other, c.allAcls(), readAllRules(c.a), groupGraph(c.a)]);
    if (!acls || !rules) return note(_t('The rights across models need Access Rights (base.group_erp_manager).'));
    const mine = modelRights(acls, sim.groupIds);
    const real = sim.tried.size ? modelRights(acls, sim.real) : mine;
    const theirs = other ? modelRights(acls, other.groupIds) : null;
    const ids = [...new Set([...mine.keys(), ...(theirs?.keys() ?? [])])];
    const [modelRows, creators] = await Promise.all([readModels(ids), readDefiningModules(ids)]);
    const models = new Map((modelRows ?? []).map((m) => [m.id, m]));
    const moduleOf = (id: number) => {
      const m = models.get(id);
      return creators?.get(id) ?? (m?.model.startsWith('x_') ? '' : firstModule(m?.modules));
    };
    const titles = await readModuleTitles([...new Set(ids.map(moduleOf).filter(Boolean))]).catch(() => null);

    const restricting = (u: Simulated, modelId: number) => rules.filter((r) => r.model_id && r.model_id[0] === modelId && (r.global || r.groups.some((g) => u.groupIds.has(g))));
    const byModule = new Map<string, { rows: MxRow[]; levels: { level: ReturnType<typeof accessLevel>; rules: number }[] }>();
    for (const id of ids) {
      const m = models.get(id);
      const a = mine.get(id), b = theirs?.get(id), was = real.get(id);
      const name = m?.name ?? a?.model[1] ?? b?.model[1] ?? `#${id}`;
      const tech = m?.model ?? '';
      const rs = restricting(sim, id);
      const mod = moduleOf(id);
      const changed = MODES.some((x) => a?.modes.has(x) && !was?.modes.has(x));
      const differs = !!theirs && MODES.some((x) => !!a?.modes.has(x) !== !!b?.modes.has(x));
      const row: MxRow = {
        label: [name],
        sub: tech,
        q: `${name} ${tech} ${mod} ${titles?.get(mod) ?? ''}`,
        tags: [changed && 'added', differs && 'differs'].filter((t): t is string => !!t),
        cells: [
          ...MODES.map((x) => {
            const has = (u: string, ok: boolean) => (ok ? _t('%s may %s: an ACL grants it', u, modeLabel(x).toLowerCase()) : _t('%s may not %s: no ACL grants it', u, modeLabel(x).toLowerCase()));
            return {
              v: a?.modes.has(x) ? true : 'na' as const,
              title: has(sim.user.name, !!a?.modes.has(x)),
              ...(theirs ? { b: b?.modes.has(x) ? true : 'na' as const, titleB: has(other!.user.name, !!b?.modes.has(x)) } : {}),
              plus: !!a?.modes.has(x) && !was?.modes.has(x),
            };
          }),
          rs.length ? tip(box(String(rs.length)), rs.length === 1 ? _t('1 record rule decides which records %s sees', sim.user.name)
            : _t('%s record rules decide which records %s sees', rs.length, sim.user.name)) : '',
        ],
        detail: () => detail({ name, tech }, a, b, rs, sim, other, graph),
      };
      const key = mod || '';
      const group = byModule.get(key) ?? { rows: [], levels: [] };
      group.rows.push(row);
      group.levels.push({ level: accessLevel(a?.modes), rules: rs.length });
      byModule.set(key, group);
    }
    const label = (mod: string) => (mod ? titles?.get(mod) ?? mod : _t('Custom models (no module)'));
    const sections: MxSection[] = [...byModule].sort(([x], [y]) => (!x ? 1 : !y ? -1 : label(x).localeCompare(label(y)))).map(([mod, g]) => ({
      title: label(mod),
      note: [mod && titles?.get(mod) ? mod : '', summaryText(g.rows.length, accessSummary(g.levels))].filter(Boolean).join(' · '),
      folded: true,
      rows: g.rows.sort((x, y) => String(x.label[0]).localeCompare(String(y.label[0]))),
    }));
    const table = matrix(_t('Model'), [...modeHeads(), _t('Rules')], sections);
    table.classList.add('by-model');

    // filter, fold / unfold every module, only differences / only what the tried groups add
    const { bar } = tpl('toolbar', { bar: HTMLDivElement }).refs;
    const { text: count } = tpl('count', { text: HTMLSpanElement }).refs;
    let only = '';
    const apply = () => {
      const n = filterMatrix(table, f.input.value, (r) => !only || (r.dataset.tags ?? '').split(' ').includes(only));
      count.textContent = _t('%s of %s models', n, ids.length);
      if (only) foldAll(false); // what the chip keeps shows at once
    };
    const f = filterBox([], _t('Filter models or modules…'));
    f.input.addEventListener('input', apply);
    const foldAll = (fold: boolean) => { for (const t of table.tBodies) if (t.classList.contains('foldable')) t.classList.toggle('folded', fold); };
    const toggle = (mark: 'added' | 'differs', text: string) => {
      const b = button(text, () => { only = only === mark ? '' : mark; for (const x of bar.querySelectorAll('.chip[aria-pressed]')) x.setAttribute('aria-pressed', 'false'); b.setAttribute('aria-pressed', String(only === mark)); apply(); }, 'chip');
      b.setAttribute('aria-pressed', 'false');
      return b;
    };
    bar.append(f.input,
      button(_t('Expand All'), () => foldAll(false), 'chip', _t('Show the models of every module')),
      button(_t('Collapse All'), () => foldAll(true), 'chip', _t('Fold every module back to its line')),
      ...(sim.tried.size ? [toggle('added', _t('Only what the tried groups add'))] : []), ...(theirs ? [toggle('differs', _t('Only differences'))] : []), count);
    apply();
    // module titles stay in sight while scrolling, under the sticky toolbar
    new ResizeObserver(() => table.style.setProperty('--mx-sticky-top', `${bar.offsetHeight}px`)).observe(bar);
    const legend = note(theirs ? _t('Each cell: %s | %s. ✓ an ACL grants the operation, · none does. Rules: how many record rules limit which records. Click a module to open it, a model for what decides it.', sim.user.name, other!.user.name)
      : _t('✓ an ACL grants the operation, · none does; +✓ added by the tried groups. Rules: how many record rules limit which records. Click a module to open it, a model for what decides it.'));
    legend.classList.add('legend');
    return box(bar, table, legend);
  });
}

/** "76 models · 60 every operation · 10 read only · 6 some operations · 4 limited by rules". */
function summaryText(n: number, s: ReturnType<typeof accessSummary>): string {
  return [n === 1 ? _t('1 model') : _t('%s models', n), s.full && _t('%s every operation', s.full), s.read && _t('%s read only', s.read),
    s.partial && _t('%s some operations', s.partial), s.ruled && _t('%s limited by rules', s.ruled)].filter(Boolean).join(' · ');
}

const listModes = (modes: readonly Mode[]) => modes.map((m) => modeLabel(m).toLowerCase()).join(', ');

/** What decides a model for the user: a sentence, the ACLs granting it, the record rules limiting it. */
function detail(model: { name: string; tech: string }, a: ModelRights | undefined, b: ModelRights | undefined, rules: readonly RuleRow[],
  sim: Simulated, other: Simulated | null, graph: GroupGraph): Node {
  const can = MODES.filter((m) => a?.modes.has(m));
  const cannot = MODES.filter((m) => !a?.modes.has(m));
  const sentence = [
    can.length ? _t('%s can %s %s.', sim.user.name, listModes(can), model.name) : _t('%s has no access to %s.', sim.user.name, model.name),
    can.length && cannot.length ? _t('Not %s.', listModes(cannot)) : '',
    can.length ? (rules.length === 1 ? _t('1 record rule decides which records: only the ones it allows.')
      : rules.length ? _t('%s record rules decide which records: only the ones they allow.', rules.length) : _t('No record rule: every record.')) : '',
    other ? _t('%s: %s.', other.user.name, MODES.filter((m) => b?.modes.has(m)).map((m) => modeLabel(m).toLowerCase()).join(', ') || _t('no access')) : '',
  ].filter(Boolean).join(' ');

  const aclRows: MxRow[] = (a?.acls ?? []).map((r: AclRow) => {
    const tried = !!r.group_id && sim.tried.has(r.group_id[0]);
    return {
      label: [r.group_id ? graph.name(r.group_id[0]) : _t('Every user (an ACL without a group)')],
      sub: [r.name, tried ? _t('being tried') : ''].filter(Boolean).join(' · '),
      cells: MODES.map((m) => (r[`perm_${m}`] ? { v: true, plus: tried, title: _t('This ACL grants %s', modeLabel(m).toLowerCase()) } : { v: 'na' as const, title: _t('Not granted by this ACL') })),
    };
  });
  const ruleRows: MxRow[] = rules.map((r) => {
    const mine = r.groups.filter((g) => sim.groupIds.has(g)).map((g) => graph.name(g));
    return {
      label: [r.name],
      sub: r.global ? _t('global: applies to every user') : _t('for the group %s', mine.join(', ')),
      cells: MODES.map((m) => (r[`perm_${m}`] ? { v: true, title: _t('Limits the records for %s', modeLabel(m).toLowerCase()) } : { v: 'na' as const, title: _t('Doesn\'t apply to %s', modeLabel(m).toLowerCase()) })),
      detail: () => domainDetail(r.domain_force || '[]', undefined),
    };
  });
  const head = note(sentence);
  head.classList.add('model-sentence');
  const out = box(head,
    title(_t('Access rights (ACL): who grants what')),
    aclRows.length ? matrix(_t('Granted by'), modeHeads(), [{ rows: aclRows }]) : note(_t('No ACL of this user\'s groups grants anything on this model.')),
    note(_t('An operation is allowed when at least one of these ACLs grants it.')),
    ...(ruleRows.length ? [title(_t('Record rules: which records')), matrix(_t('Rule'), modeHeads(), [{ rows: ruleRows }]),
      note(_t('For an operation, a record must match every global rule and at least one of the group rules. Click a rule for its domain; the Record view evaluates them on a record.'))] : []));
  out.className = 'model-detail';
  return out;
}
