// View tab, part ② How the view is built: the views Odoo combines (the view on screen, or its search view), in the
// order it applies them, each with its module and what it does in one line; opened, the list of what it does
// (spec by spec) and its own arch. The inspected field (part ③) brings forward the views touching it.
import { _t } from '../../i18n/i18n.ts';
import { groupsLabel, parseGroups } from '../../odoo/groups.ts';
import { groupNames } from '../../odoo/reads.ts';
import { fill } from '../../ui/cards.ts';
import { xmlCode, xmlInline, type CodeBlock, type LineMark } from '../../ui/code.ts';
import { copyable, copyText, details, odooLink, pill } from '../../ui/components.ts';
import { expandable, masterDetail } from '../../ui/lists.ts';
import { fieldSteps, moduleOf, specsOf, type ViewSummary } from './arch.logic.ts';
import type { ComposedView, Composition } from './view.data.ts';
import { inspectedField, onInspect, setRevealer } from './view.state.ts';
import { frag, note, part, segmented } from '../../ui/parts.ts';
import { shortName, tpl } from './view.ui.ts';

export function compositionPart(parent: HTMLElement, origin: string, comps: { type: string; promise: Promise<Composition | null> }[]) {
  const p = part(parent, 'composition', '2', _t('How the view is built'));
  let shown = comps[0]!.type;
  const codes = new Map<number, CodeBlock>(); // view id → its own arch, once its detail is built
  const rows = new Map<number, HTMLLIElement>();
  const draw = () => {
    codes.clear();
    rows.clear();
    fill(p.body, () => body(comps.find((c) => c.type === shown)!.promise));
  };
  if (comps.length > 1) p.tools.append(segmented(comps.map((c) => [c.type, c.type] as [string, string]), shown, (t) => { shown = t; draw(); }));

  // part ③ shows a line of a view's own arch here: switch to its composition, open the view, then the line
  setRevealer(async (type, viewId, line) => {
    if (type !== shown) {
      shown = type;
      p.tools.replaceChildren(segmented(comps.map((c) => [c.type, c.type] as [string, string]), shown, (t) => { shown = t; draw(); }));
      draw();
      await comps.find((c) => c.type === type)!.promise;
      await new Promise((r) => setTimeout(r, 0));
    }
    p.open(); // folded: unfolds, which builds it
    for (let i = 0; i < 40 && !rows.has(viewId); i++) await new Promise((r) => setTimeout(r, 25));
    const row = rows.get(viewId);
    if (!row) return;
    p.part.scrollIntoView({ block: 'start', behavior: 'smooth' });
    if (!row.classList.contains('open')) row.click();
    for (let i = 0; i < 20 && !codes.has(viewId); i++) await new Promise((r) => setTimeout(r, 25)); // the detail builds async
    codes.get(viewId)?.reveal(line);
  });
  p.lazy(draw);

  async function body(promise: Promise<Composition | null>) {
    const comp = await promise;
    if (!comp) return note(_t('No %s view.', shown));
    if (!comp.views) return note(_t('The inheritance tree needs Settings rights (base.group_system).'));
    const active = comp.views.filter((v) => v.view.active);
    const modules = new Set(active.map((v) => moduleOf(v.view.xml_id) ?? '—'));
    p.sub.textContent = _t('%s views · %s modules', active.length, modules.size);
    const names = await groupNames([...new Set(comp.views.flatMap((v) => v.restricted.flatMap((r) => parseGroups(r.groups).map((g) => g.xmlid))))]);

    const items = comp.views.map((cv) => {
      const r = tpl('view-row', { row: HTMLLIElement, head: HTMLDivElement, branch: HTMLSpanElement, does: HTMLDivElement, meta: HTMLDivElement }).refs;
      const { view, depth } = cv;
      r.row.style.paddingInlineStart = `${10 + depth * 14}px`;
      if (!depth) r.branch.remove();
      if (view.id === comp.view.id) r.row.classList.add('current');
      if (!view.active) r.row.classList.add('inactive');
      const touches = pill('', 'accent');
      touches.hidden = true;
      r.head.append(pill(moduleOf(view.xml_id) ?? '—'), view.xml_id ? copyable(view.xml_id, 'name', shortName(view.xml_id, view.id)) : `#${view.id}`,
        ...(view.mode === 'primary' ? [pill(_t('primary'), 'accent')] : []),
        ...(cv.restricted.length ? [lock(`🔒 ${cv.restricted.length}`, _t('%s elements restricted to groups', cv.restricted.length))] : []),
        ...(view.active ? [] : [pill(_t('inactive'))]), touches);
      r.does.textContent = describe(cv.summary);
      r.meta.textContent = [view.name, `#${view.id}`, view.arch_fs, `prio ${view.priority}`].filter(Boolean).join(' · ');
      r.meta.append(' ', odooLink(origin, `ir.ui.view/${view.id}`));
      rows.set(view.id, r.row);
      expandable(r.row, () => detail(cv, names));
      return { cv, row: r.row, touches };
    });

    // the inspected field: the views touching it come forward
    const follow = (field: string) => {
      for (const { cv, row, touches } of items) {
        const n = field ? fieldSteps(cv.arch, field).length : 0;
        touches.textContent = n ? `${field} ×${n}` : '';
        touches.hidden = !n;
        row.classList.toggle('untouched', !!field && !n);
      }
    };
    onInspect(follow);
    follow(inspectedField());

    const { list } = tpl('list', { list: HTMLUListElement }).refs;
    list.append(...items.map((i) => i.row));
    return masterDetail(list, _t('Select a view to see what it does and its own arch.'));
  }

  /** A view opened: what it does, spec by spec; its elements restricted to groups; its own arch (as written: the
   * line numbers are the arch_db's). */
  function detail(cv: ComposedView, names: ReadonlyMap<string, string>) {
    const field = inspectedField();
    const steps = field ? fieldSteps(cv.arch, field) : [];
    const marks = new Map<number, LineMark>([...cv.restricted.map((n) => [n.line, 'lock'] as const), ...steps.map((s) => [s.line, 'touch'] as const)]);
    const code = xmlCode(cv.arch, marks);
    codes.set(cv.view.id, code);
    const lineLink = (button: HTMLButtonElement, line: number) => {
      button.textContent = `L${line}`;
      button.addEventListener('click', (ev) => { ev.stopPropagation(); code.reveal(line); });
    };

    const specs = specsOf(cv.arch);
    const out: Node[] = [];
    if (specs.length) {
      const { list } = tpl('sub-list', { list: HTMLUListElement }).refs;
      for (const s of specs) {
        const r = tpl('spec', { line: HTMLButtonElement, position: HTMLSpanElement, target: HTMLSpanElement, adds: HTMLDivElement }).refs;
        lineLink(r.line, s.line);
        r.position.replaceWith(pill(s.position, s.position === 'replace' ? 'med' : 'accent'));
        r.target.append(xmlInline(s.target.label));
        if (s.position === 'replace' && !s.adds.length) r.adds.textContent = _t('removed');
        for (const a of s.adds) r.adds.append(xmlInline(`${a.moved ? '↕' : '+'} <${a.tag}${a.name ? ` name="${a.name}"` : ''}>`), ' ');
        for (const a of s.attributes) r.adds.append(xmlInline(`${a.name}="${a.value}"`), ' ');
        list.append(r.line.closest('li')!);
      }
      out.push(open(details(_t('What it does (%s)', specs.length), list)));
    }
    if (cv.restricted.length) {
      const { list } = tpl('sub-list', { list: HTMLUListElement }).refs;
      for (const n of cv.restricted) {
        const r = tpl('restricted', { line: HTMLButtonElement, text: HTMLSpanElement, groups: HTMLDivElement }).refs;
        lineLink(r.line, n.line);
        r.text.append(xmlInline(n.text));
        r.groups.append(lock(groupsLabel(n.groups, names), `groups ${n.groups}`));
        list.append(r.line.closest('li')!);
      }
      out.push(open(details(_t('Restricted to groups (%s)', cv.restricted.length), list)));
    }
    const { button } = tpl('copy-arch', { button: HTMLButtonElement }).refs;
    button.addEventListener('click', async () => {
      await copyText(cv.arch);
      button.classList.add('copied');
      setTimeout(() => button.classList.remove('copied'), 1000);
    });
    out.push(details(_t('Own arch (view #%s)', cv.view.id), button, code.root));
    return frag(...out);
  }
}

/** What a view does, in one line. */
function describe(s: ViewSummary): string {
  if (s.base) return _t('base view · %s fields', s.fields);
  const parts = [
    s.fields > 0 && _t('+%s fields', s.fields),
    s.moved > 0 && _t('%s moved', s.moved),
    s.attributes > 0 && _t('%s attributes changed', s.attributes),
    s.removed > 0 && _t('%s removed', s.removed),
    s.others > 0 && _t('+%s elements', s.others),
  ].filter(Boolean);
  return parts.join(' · ') || _t('changes nothing visible');
}

function lock(text: string, title: string) {
  const p = pill(text, 'info');
  p.classList.add('lock');
  p.title = title;
  return p;
}

const open = (d: HTMLDetailsElement) => { d.open = true; return d; };
