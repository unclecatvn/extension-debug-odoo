// View tab, part ③ One field: the question asked most while debugging a screen, "why does this field look like that".
// Who it is; how it is now (each modifier with the values its expression read, form views); its story through the
// views, in the order Odoo applies them (each step links to its line in part ②); the groups it is limited to. Below,
// the fields of the view, to pick one (or type it, or pick it on the page).
import { exec } from '../../extension/run-in-tab.ts';
import { _t, N_ } from '../../i18n/i18n.ts';
import { groupsLabel, parseGroups } from '../../odoo/groups.ts';
import type { FieldsGet } from '../../odoo/models.ts';
import { fieldsOf, groupNames } from '../../odoo/reads.ts';
import { countText, fill, filterBox } from '../../ui/cards.ts';
import { xmlInline } from '../../ui/code.ts';
import { copyable, empty, pill } from '../../ui/components.ts';
import { archFields, fieldSteps, moduleOf, type Step } from './arch.logic.ts';
import type { Composition } from './view.data.ts';
import { pagePick, type FormField, type FormFields, type Modifier } from './view.injected.ts';
import { inspect, inspectedField, onInspect, revealLine } from './view.state.ts';
import { frag, note, part } from '../../ui/parts.ts';
import { shortName, tpl } from './view.ui.ts';

const MODIFIERS = ['invisible', 'readonly', 'required'] as const;

export function fieldPart(parent: HTMLElement, model: string, comps: { type: string; promise: Promise<Composition | null> }[], form: Promise<FormFields | null> | null) {
  const p = part(parent, 'field', '3', _t('One field'));
  const tools = tpl('field-tools', { input: HTMLInputElement, options: HTMLDataListElement, pick: HTMLButtonElement }).refs;
  p.tools.append(tools.input.parentElement!);
  tools.input.value = inspectedField();
  tools.input.addEventListener('change', () => inspect(tools.input.value.trim()));
  tools.input.addEventListener('keydown', (e) => { if (e.key === 'Enter') inspect(tools.input.value.trim()); });
  tools.pick.addEventListener('click', () => { tools.pick.textContent = _t('Picking… (Esc to cancel)'); void exec(pagePick); });
  if (!form) tools.pick.remove(); // the page picker reads form fields

  const holder = tpl('padded-slot', { slot: HTMLDivElement }).refs.slot; // the inspection
  const listHolder = tpl('slot', { slot: HTMLDivElement }).refs.slot; // the fields of the view
  p.body.append(holder, listHolder);

  const loaded = Promise.all([fieldsOf(model).catch(() => ({}) as FieldsGet), form?.catch(() => null) ?? null,
    ...comps.map((c) => c.promise.catch(() => null))]) as Promise<[FieldsGet, FormFields | null, ...(Composition | null)[]]>;

  const show = (field: string) => {
    tools.input.value = field;
    fill(holder, async () => {
      if (!field) return note(_t('Type a field name, or pick one on the page or in the list below.'));
      const [fields, formFields, ...composed] = await loaded;
      return inspectionOf(field, fields, formFields && 'fields' in formFields ? formFields.fields : null,
        composed.map((c, i) => ({ type: comps[i]!.type, comp: c })));
    });
  };
  // a field inspected from elsewhere (part ②, the page picker): this part unfolds to tell its story
  onInspect((f) => {
    if (p.part.open) show(f); else p.open(); // unfolding builds it, with the field
    p.part.scrollIntoView({ block: 'start', behavior: 'smooth' });
  });

  // the fields of the view, to pick one
  const fieldsList = () => fill(listHolder, async () => {
    const [fields, formFields, first] = await loaded;
    const nodes = formFields && 'fields' in formFields ? formFields.fields : null;
    const names = nodes ? nodes.map((f) => f.name) : first ? archFields(first.view.arch) : [];
    tools.options.replaceChildren(...[...new Set(names)].map((n) => {
      const { option } = tpl('field-option', { option: HTMLOptionElement }).refs;
      option.value = n;
      option.label = fields[n]?.string ?? '';
      return option;
    }));
    return fieldList(nodes, names, fields);
  });
  p.lazy(() => { show(inspectedField()); fieldsList(); }); // last: show and fieldsList are defined by now
}

/** The inspected field: identity, now, story, groups. */
async function inspectionOf(field: string, fields: FieldsGet, nodes: FormField[] | null, composed: { type: string; comp: Composition | null }[]) {
  const r = tpl('inspection', { id: HTMLDivElement, nowTitle: HTMLElement, now: HTMLDivElement, story: HTMLOListElement, groupsTitle: HTMLElement, groups: HTMLDivElement }).refs;
  const def = fields[field];
  const node = nodes?.find((n) => n.name === field) ?? null;
  r.id.append(copyable(field), ...(def ? [pill(def.type), def.string] : [pill(_t('not a field of this model'), 'med')]),
    ...(def?.relation ? [`→ ${def.relation}`] : []), ...(node?.widget ? [pill(node.widget)] : []));

  // now: the modifiers as the webclient evaluates them, on this record
  if (node) {
    const notShown = !node.invisible.value && !node.inDom;
    r.now.append(...MODIFIERS.map((k) => modifierRow(k, node[k], node.vars)));
    if (notShown) r.now.append(note(_t('Not on screen: it is on another notebook page, or a parent (group/page/div) is invisible.')));
  } else {
    r.nowTitle.remove();
    if (nodes) r.now.append(note(_t('Not on this form.')));
  }

  // its story through the views, in the order Odoo applies them
  const restricts: { who: string; spec: string }[] = [];
  let no = 0;
  const unreadable = composed.some(({ comp }) => comp && !comp.views); // ir.ui.view: Settings only
  if (unreadable) r.story.replaceWith(note(_t('The story through the views needs Settings rights (base.group_system).')));
  for (const { type, comp } of composed) {
    if (!comp?.views) continue;
    for (const cv of comp.views) {
      const steps = fieldSteps(cv.arch, field);
      if (!steps.length) continue;
      const v = tpl('story-view', { no: HTMLSpanElement, who: HTMLSpanElement, steps: HTMLUListElement }).refs;
      v.no.textContent = String(++no);
      v.who.append(pill(moduleOf(cv.view.xml_id) ?? '—'), shortName(cv.view.xml_id, cv.view.id), ...(type !== composed[0]!.type ? [pill(type)] : []),
        ...(cv.view.active ? [] : [pill(_t('inactive'))]));
      for (const s of steps) {
        const st = tpl('story-step', { line: HTMLButtonElement, text: HTMLSpanElement }).refs;
        st.line.textContent = `L${s.line}`;
        st.line.addEventListener('click', () => revealLine(type, cv.view.id, s.line));
        st.text.append(...sentence(s));
        v.steps.append(st.line.parentElement!);
        if (s.kind === 'restricts') restricts.push({ who: `${shortName(cv.view.xml_id, cv.view.id)} L${s.line}`, spec: s.detail });
      }
      r.story.append(v.no.closest('li')!);
    }
  }
  if (!unreadable && !no) r.story.replaceWith(note(_t('No view of this screen places or changes it.')));

  // its groups: on the field itself (Python), and from the views
  const specs = [...(def?.groups ? [def.groups] : []), ...restricts.map((x) => x.spec)];
  const names = await groupNames([...new Set(specs.flatMap((s) => parseGroups(s).map((g) => g.xmlid)))]);
  if (def?.groups) r.groups.append(groupRow(_t('on the field'), def.groups, names));
  for (const x of restricts) r.groups.append(groupRow(x.who, x.spec, names));
  if (unreadable) r.groups.append(note(_t('Needs Settings rights (base.group_system) to see the groups set by the views.')));
  else if (!r.groups.childElementCount) r.groups.append(note(_t('None: every user who sees the view sees it.')));
  return r.id.parentElement!;
}

function modifierRow(name: (typeof MODIFIERS)[number], m: Modifier, vars: Record<string, unknown>) {
  const r = tpl('modifier', { name: HTMLSpanElement, expr: HTMLSpanElement, value: HTMLSpanElement }).refs;
  r.name.replaceWith(pill(name));
  if (m.expr) {
    r.expr.append(xmlInline(m.expr));
    const read = Object.entries(vars).filter(([k]) => new RegExp(`\\b${k}\\b`).test(m.expr!));
    if (read.length) r.expr.append('  ', ...read.map(([k, v]) => pill(`${k} = ${JSON.stringify(v)}`)));
  } else r.expr.textContent = _t('never');
  r.value.replaceWith(m.error ? pill(_t('error: %s', m.error), 'med') : m.value ? pill(_t('yes'), name === 'invisible' ? 'err' : 'info') : pill(_t('no')));
  return r.expr.parentElement!;
}

function groupRow(where: string, spec: string, names: ReadonlyMap<string, string>) {
  const { root, refs } = tpl('story-step', { line: HTMLButtonElement, text: HTMLSpanElement });
  refs.line.replaceWith(pill(where));
  const p = pill(groupsLabel(spec, names), 'info');
  p.classList.add('lock');
  p.title = `groups ${spec}`;
  refs.text.append(p);
  return root;
}

/** A step of the story as a sentence. */
function sentence(s: Step): (Node | string)[] {
  const code = (t: string) => xmlInline(t);
  switch (s.kind) {
    case 'places': return [_t('placed'), ...(s.detail ? [' ', _t('in'), ' ', code(s.detail)] : [])];
    case 'adds': return [_t('added'), ' ', code(s.detail)];
    case 'moves': return [_t('moved'), ' ', code(s.detail)];
    case 'changes': return [_t('attributes changed:'), ' ', code(s.detail)];
    case 'restricts': return [_t('restricted to groups'), ' ', code(s.detail)];
    case 'neighbour': { // "after: team_id, state"
      const [position = '', names = ''] = s.detail.split(': ');
      const where: Record<string, string> = { after: _t('right after it'), before: _t('right before it'), inside: _t('inside it') };
      return [_t('adds'), ' ', code(names), ' ', where[position] ?? position];
    }
    case 'replaces': return [_t('replaced by'), ' ', code(s.detail)];
    case 'removes': return [_t('removed')];
    case 'reads': { // "invisible of field ref"
      const [attrs = '', of = ''] = s.detail.split(' of ');
      return [_t('used in'), ' ', code(attrs), ' ', _t('of'), ' ', code(of)];
    }
  }
}

type FieldFilter = 'hidden' | 'notShown' | 'readonly' | 'required' | 'error';
const FILTERS: Record<FieldFilter, (f: FormField) => boolean> = {
  hidden: (f) => !!f.invisible.value,
  notShown: (f) => !f.invisible.value && !f.inDom,
  readonly: (f) => !!f.readonly.value,
  required: (f) => !!f.required.value,
  error: (f) => !!(f.invisible.error || f.readonly.error || f.required.error),
};

/** The fields of the view (with their state on a form), filterable; a click inspects one. */
function fieldList(nodes: FormField[] | null, names: string[], fields: FieldsGet) {
  if (!names.length) return empty(_t('No field in this view.'));
  const byName = new Map(nodes?.map((n) => [n.name, n]));
  const items = names.map((name) => {
    const r = tpl('field-row', { row: HTMLLIElement, line: HTMLDivElement, meta: HTMLDivElement }).refs;
    const n = byName.get(name);
    const { label } = tpl('field-label', { label: HTMLSpanElement }).refs;
    label.textContent = fields[name]?.string ?? n?.string ?? '';
    const flag = (m: Modifier | undefined, text: string, kind: 'err' | 'info') => (m?.error ? pill(`${text}?`, 'med') : m?.value ? pill(text, kind) : null);
    r.line.append(copyable(name), ...(n?.widget ? [pill(n.widget)] : []), label,
      ...[flag(n?.invisible, _t('hidden'), 'err'), n && !n.invisible.value && !n.inDom && pill(_t('not shown'), 'med'),
        flag(n?.readonly, 'readonly', 'info'), flag(n?.required, 'required', 'info')].filter((x): x is HTMLSpanElement => !!x));
    if (n) r.meta.textContent = MODIFIERS.filter((k) => n[k].expr).map((k) => `${k}="${n[k].expr}"`).join(' · ');
    r.row.dataset.q = `${name} ${label.textContent} ${n?.widget ?? ''}`.toLowerCase();
    r.row.dataset.name = name;
    r.row.tabIndex = 0;
    r.row.addEventListener('click', (e) => { if (!(e.target as Element).closest('button')) inspect(name); });
    r.row.addEventListener('keydown', (e) => { if (e.key === 'Enter') inspect(name); });
    return r.row;
  });
  const head = tpl('field-list-head', { bar: HTMLDivElement, chips: HTMLSpanElement, count: HTMLSpanElement }).refs;
  const on = new Set<FieldFilter>();
  const setCount = (v: number) => { head.count.textContent = countText(v, items.length, N_('%s fields'), N_('%s/%s fields')); };
  const search = filterBox(items, _t('Filter name / label / widget'), setCount, (li) => {
    const n = byName.get(li.dataset.name!);
    return !on.size || (!!n && [...on].every((k) => FILTERS[k](n)));
  });
  for (const chip of head.chips.querySelectorAll<HTMLButtonElement>('[data-filter]')) {
    const key = chip.dataset.filter as FieldFilter;
    chip.addEventListener('click', () => {
      if (on.has(key)) on.delete(key); else on.add(key);
      chip.setAttribute('aria-pressed', String(on.has(key)));
      search.refresh();
    });
  }
  if (!nodes) head.chips.remove(); // states: form views only
  head.bar.prepend(search.input);
  setCount(items.length);
  const { list } = tpl('list', { list: HTMLUListElement }).refs;
  list.append(...items);
  return frag(head.bar, list);
}

