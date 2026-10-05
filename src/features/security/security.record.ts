// Security tab, view "Record": one table, the checks Odoo runs in rows, the operations in columns.
//   ACL                  any one granting it is enough      (● the user has its group, ○ not)
//   global rules         the record must match every one
//   group rules          the record must match one of the user's
//   parent rules         an _inherits parent's rules, through its link, as one more global rule
//   result               what the user gets; the user compared; the server's own answer (yourself)
// A rule opens its domain, as written and as evaluated for the user. Under the table, the groups that would allow what
// is refused (fewest first, what each allows, what else it opens), and an error message to paste.
import { parseAccessError } from '../../odoo/access-error.ts';
import { MODES } from '../../odoo/models.ts';
import { sessionInfo } from '../../odoo/reads.ts';
import { _t } from '../../i18n/i18n.ts';
import { fill } from '../../ui/cards.ts';
import { copyable, pill } from '../../ui/components.ts';
import { frag, note } from '../../ui/parts.ts';
import { aclRows, groupGraph, type Assessment, type GroupGraph, type Simulated } from './security.data.ts';
import { fixes, groupRulesVerdict, newGrants, rulesFor, rulesVerdict, type Rule, type Tri } from './security.logic.ts';
import { tryGroup, type SecurityCtx, type Subject } from './security.state.ts';
import { matrix, type Cell, type MxRow, type MxSection } from '../../ui/matrix.ts';
import { box, button, domainDetail, mark, modeHeads, modeLabel, plainList, title, tpl } from './security.ui.ts';

const SHOWN_FIXES = 4;
const SHOWN_MODELS = 40;

export function recordView(body: HTMLElement, c: SecurityCtx) {
  const subject = c.subject!;
  body.append(subjectLine(c, subject));
  const tables = box();
  body.append(tables, paste(c));
  fill(tables, async () => {
    const [sim, x, graph, other, ox] = await Promise.all([c.sim, c.assessment!, groupGraph(c.a), c.other, c.otherAssessment]);
    const focus = subject.mode ? MODES.indexOf(subject.mode) : -1;
    if (!x.rights || !x.input) {
      const rows: MxRow[] = x.server ? [{ label: [_t('Server (has_access)')], cells: x.server.map((v) => ({ v, title: v ? _t('Odoo says: allowed') : _t('Odoo says: refused') })), kind: 'result' }] : [];
      return frag(rows.length ? matrix('', modeHeads(), [{ rows }], focus) : null,
        note(x.server ? _t('Reading the ACLs and record rules needs Access Rights (base.group_erp_manager): this is the server\'s answer for you, without the why.')
          : _t('Reading the ACLs and record rules needs Access Rights (base.group_erp_manager): nothing can be said for another user.')));
    }
    return frag(matrix(subject.resId ? `${subject.model} #${subject.resId}` : subject.model, modeHeads(), sections(sim, x, graph, other, ox), focus),
      legend(sim, other), fixList(sim, x, graph, c));
  });
}

function subjectLine(c: SecurityCtx, subject: Subject) {
  const r = tpl('subject', { line: HTMLDivElement, meta: HTMLDivElement }).refs;
  const ids = subject.ids.length > 1 ? subject.ids : subject.resId ? [subject.resId] : [];
  r.line.append(...[
    subject.problem ? pill(_t('From an error'), 'err') : pill(_t('This page'), 'accent'),
    copyable(subject.model, 'name'),
    ids.length > 0 && `#${ids.join(', #')}`,
    subject.mode && pill(modeLabel(subject.mode), 'err'),
    subject.problem && button(_t('Back to this page'), () => { c.s.subject = null; c.rerender(); }, 'chip'),
  ].filter((n): n is HTMLElement | string => !!n));
  const pr = subject.problem;
  r.meta.textContent = pr ? [
    ids.length > 1 && _t('the first record is checked'),
    pr.rules.length > 0 && _t('rules blamed: %s', pr.rules.join(', ')),
    pr.groups.length > 0 && _t('groups allowed: %s', pr.groups.join(', ')),
    !pr.mode && _t('operation not named in the message'),
    !pr.ids.length && pr.kind === 'rule' && _t('no record in the message: debug mode adds them'),
  ].filter(Boolean).join(' · ') : !subject.resId ? _t('No record open: the ACLs only, the rules are checked on a record.') : '';
  if (!r.meta.textContent) r.meta.remove();
  return r.line.parentElement!;
}

const has = (sim: Simulated, groups: number[]) => groups.some((g) => sim.groupIds.has(g));

/** The record's rows, section by section. */
function sections(sim: Simulated, x: Assessment, graph: GroupGraph, other: Simulated | null, ox: Assessment | null): MxSection[] {
  const input = x.input!;
  const passed = input.passed;
  const resId = input.resId;
  const out: MxSection[] = [];
  const marks = (groups: number[], global = false) => (global ? [] : [
    mark(has(sim, groups) ? 'has' : 'no', has(sim, groups) ? _t('%s has this group', sim.user.name) : _t('%s doesn\'t have this group', sim.user.name)),
    ...(other ? [mark(has(other, groups) ? 'has' : 'no', has(other, groups) ? _t('%s has this group', other.user.name) : _t('%s doesn\'t have this group', other.user.name))] : []),
  ]);

  // ACLs: any one granting the operation
  const acls = input.acls.filter((a) => MODES.some((m) => a[`perm_${m}`]));
  const aclSum = MODES.map((m) => {
    const ok = x.verdicts.find((v) => v.mode === m)!.grants.length > 0 || input.superuser;
    return { v: ok, title: ok ? _t('An ACL of the user\'s groups grants it') : _t('No ACL of the user\'s groups grants it: refused') };
  });
  out.push({ title: _t('Access rights (ACL)'), note: _t('one is enough'), rows: [
    ...acls.map((a): MxRow => ({
      label: [...marks(a.group_id ? [a.group_id[0]] : [], !a.group_id), a.group_id ? a.group_id[1] : _t('every user')],
      sub: a.name,
      cells: MODES.map((m) => (a[`perm_${m}`] ? { v: true, title: _t('This ACL grants it') } : { v: 'na' as const, title: _t('This ACL doesn\'t grant it') })),
      kind: !a.group_id || sim.groupIds.has(a.group_id[0]) ? undefined : 'off',
    })),
    ...(acls.length ? [] : [{ label: [_t('No ACL: only the superuser')], cells: MODES.map(() => ({ v: 'na' as const })), kind: 'off' as const }]),
    { label: [_t('→ for the user')], cells: aclSum, kind: 'sum' },
  ] });

  if (resId == null) return [...out, result(sim, x, other, ox)];

  const own = input.rules.filter((r) => !r.via);
  const cellsOf = (r: Rule): Cell[] => MODES.map((m) => {
    if (!r[`perm_${m}`]) return { v: 'na' as const, title: _t('The rule doesn\'t cover this operation') };
    const v = x.notes.has(r.id) || 'error' in (x.evaluated.get(r.id) ?? {}) ? null : passed.get(r.id) ?? null;
    return { v, title: v === true ? _t('The record matches this rule') : v === false ? _t('The record doesn\'t match this rule') : _t('Could not be checked: open the rule') };
  });
  const ruleRow = (r: Rule, applies: boolean): MxRow => ({
    label: [...marks(r.groups, r.global), r.name],
    sub: r.global ? _t('every user') : r.groups.map((g) => graph.name(g)).join(', '),
    cells: cellsOf(r),
    kind: applies ? undefined : 'off',
    detail: () => domainDetail(r.domain_force || '[]', x.evaluated.get(r.id), x.notes.get(r.id)),
  });

  const globals = own.filter((r) => r.global);
  if (globals.length) out.push({ title: _t('Global rules'), note: _t('the record must match every one'), rows: globals.map((r) => ruleRow(r, true)) });

  const groupRules = own.filter((r) => !r.global);
  if (groupRules.length) {
    out.push({ title: _t('Group rules'), note: _t('the record must match one of the user\'s'), rows: [
      ...groupRules.map((r) => ruleRow(r, has(sim, r.groups))),
      { label: [_t('→ for the user')], kind: 'sum', cells: MODES.map((m) => {
        const mine = rulesFor(groupRules, input.groupIds, m);
        const v = mine.length ? groupRulesVerdict(mine, passed) : true;
        return { v, title: !mine.length ? _t('No group rule of the user for this operation: no restriction from them')
          : v === true ? _t('One of the user\'s group rules matches: enough') : v === false ? _t('None of the user\'s group rules matches: refused') : _t('Could not be checked') };
      }) },
    ] });
  }

  // _inherits parents: their own combination counts as one global rule
  const parents = new Map<string, Rule[]>();
  for (const r of input.rules) if (r.via) parents.set(r.via.model, [...(parents.get(r.via.model) ?? []), r]);
  for (const [model, rs] of parents) {
    const link = rs[0]!.via!.link;
    out.push({ title: _t('Rules of %s, through %s', model, link), note: _t('counted as one global rule'), rows: [
      ...rs.map((r) => ruleRow(r, r.global || has(sim, r.groups))),
      { label: [_t('→ for the user')], kind: 'sum', cells: MODES.map((m) => { const v = rulesVerdict(rulesFor(rs.map(({ via: _, ...r }) => r), input.groupIds, m), passed, input.groupRulesRequired);
        return { v, title: v === true ? _t('The parent record passes its rules') : v === false ? _t('The parent record doesn\'t pass its rules: refused') : _t('Could not be checked') }; }) },
    ] });
  }
  return [...out, result(sim, x, other, ox)];
}

function result(sim: Simulated, x: Assessment, other: Simulated | null, ox: Assessment | null): MxSection {
  const res = (ok: Tri, who: string) => ({ v: ok, title: ok === true ? _t('%s can do it', who) : ok === false ? _t('%s is refused', who) : _t('Not certain: a rule could not be checked') });
  const rows: MxRow[] = [{ label: [_t('Result'), other ? `(${sim.user.name})` : ''], cells: x.verdicts.map((v) => res(v.ok, sim.user.name)), kind: 'result' }];
  if (other && ox?.verdicts.length) rows.push({ label: [_t('Result'), `(${other.user.name})`], cells: ox.verdicts.map((v) => res(v.ok, other.user.name)), kind: 'result' });
  if (x.server) rows.push({ label: [_t('Server (has_access)')], sub: _t('Odoo\'s own answer for you, same companies'), kind: 'sum',
    cells: x.server.map((v, i) => ({ v, title: v !== x.verdicts[i]?.ok ? _t('The server disagrees with the simulation') : v ? _t('Odoo says: allowed') : _t('Odoo says: refused') })) });
  return { title: _t('Result'), rows };
}

function legend(sim: Simulated, other: Simulated | null) {
  const n = note(`${_t('✓ allowed / matches · ✗ refused / no match · · does not apply · ? unknown · ● the user has the group · ○ not. Click a rule for its domain.')}${
    other ? ` ${_t('Marks: %s, then %s.', sim.user.name, other.user.name)}` : ''}`);
  n.classList.add('legend');
  return n;
}

/** The groups that would allow what is refused, as a table: what each allows; Try; what else it opens. */
function fixList(sim: Simulated, x: Assessment, graph: GroupGraph, c: SecurityCtx): Node | null {
  if (!x.verdicts.some((v) => v.ok === false)) return null;
  const found = fixes(x.input!, (id) => graph.closure(id));
  if (!found.length) return frag(title(_t('To allow it')), note(_t('No single group allows it.')));
  const rows: MxRow[] = found.slice(0, SHOWN_FIXES).map((f) => {
    const extra = f.adds.filter((g) => g !== f.id);
    return {
      label: [graph.name(f.id), button(_t('Try'), () => void tryGroup(c, f.id), 'chip', _t('Simulate this group in every view, nothing is written'))],
      sub: extra.length ? _t('also adds: %s', extra.map((g) => graph.name(g)).join(', ')) : undefined,
      cells: MODES.map((m) => (f.allows.includes(m) ? { v: true, plus: true, title: _t('Adding this group allows it') }
        : (x.verdicts.find((v) => v.mode === m)!.ok as Tri) === true ? { v: true, title: _t('Already allowed') } : { v: 'na' as const, title: _t('Still refused with this group') })),
      detail: async () => {
        const gained = newGrants((await aclRows([...sim.groupIds, ...f.adds], c.a)) ?? [], sim.groupIds, f.adds);
        if (!gained.length) return note(_t('No new right on other models.'));
        const lines = gained.slice(0, SHOWN_MODELS).map((g) => `${g.model}: ${g.modes.map(modeLabel).join(', ')}`);
        if (gained.length > SHOWN_MODELS) lines.push(_t('… and %s more', gained.length - SHOWN_MODELS));
        return frag(note(_t('Also opens, on %s other models:', gained.length)), plainList(lines));
      },
    };
  });
  return frag(title(_t('To allow it')), matrix(_t('Group to add'), modeHeads(), [{ rows }]),
    note(found.length > SHOWN_FIXES ? _t('Fewest new groups first; %s more not shown. Click a group for what else it opens.', found.length - SHOWN_FIXES)
      : _t('Fewest new groups first. Click a group for what else it opens.')));
}

/** An AccessError pasted from a user's screen: its model, records, operation and user become what the tab checks. */
function paste(c: SecurityCtx): HTMLElement {
  const { root, refs } = tpl('paste', { text: HTMLTextAreaElement, go: HTMLButtonElement, error: HTMLSpanElement });
  refs.go.addEventListener('click', async () => {
    const pr = parseAccessError(refs.text.value);
    if (!pr?.model) { refs.error.textContent = _t('No model found in this message: is it an access error?'); return; }
    const me = (await sessionInfo()).uid;
    c.s.subject = { model: pr.model, resId: pr.ids[0] ?? (c.page.model === pr.model ? c.page.resId ?? null : null), ids: pr.ids, mode: pr.mode, problem: pr };
    if (pr.user) c.s.uid = pr.user.id === me ? null : pr.user.id;
    c.s.tried.clear();
    c.s.baseline = null;
    c.s.companies = null;
    c.s.view = 'record';
    c.rerender();
  });
  return root;
}

