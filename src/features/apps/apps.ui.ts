// Apps tab: the pieces its views share. Markup: apps.tpl.html. Tables: ui/matrix.ts.
import { N_, translateDom, _t } from '../../i18n/i18n.ts';
import { fill, rememberedOpen } from '../../ui/cards.ts';
import { errBox, pill } from '../../ui/components.ts';
import { templates } from '../../ui/template.ts';
import { tip } from '../../ui/tooltip.ts';
import { stateKind, type Filters, type ModuleState } from './apps.logic.ts';
import html from './apps.tpl.html';

export const tpl = templates(html, translateDom);

export function button(text: string, onClick: () => void, kind: 'btn' | 'chip' = 'btn', title = ''): HTMLButtonElement {
  const { button: b } = tpl(kind === 'btn' ? 'button' : 'chip', { button: HTMLButtonElement }).refs;
  b.textContent = text;
  if (title) tip(b, title);
  b.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
  return b;
}

export function box(...nodes: (Node | string | null | undefined | false)[]): HTMLDivElement {
  const { box: b } = tpl('box', { box: HTMLDivElement }).refs;
  b.append(...nodes.filter((n): n is Node | string => !!n));
  return b;
}

export function row(...nodes: (Node | string | null | undefined | false)[]): HTMLDivElement {
  const { row: r } = tpl('row', { row: HTMLDivElement }).refs;
  r.append(...nodes.filter((n): n is Node | string => !!n));
  return r;
}

export const title = (text: string) => { const { title: t } = tpl('sub-title', { title: HTMLHeadingElement }).refs; t.textContent = text; return t; };

export function text(value: string, cls = '', hint = ''): HTMLSpanElement {
  const { text: t } = tpl('text', { text: HTMLSpanElement }).refs;
  t.textContent = value;
  if (cls) t.className = cls;
  if (hint) tip(t, hint);
  return t;
}

/** A link opening `href` (on the inspected Odoo) in a new tab. */
export function link(label: string, href: string, hint = ''): HTMLAnchorElement {
  const { link: a } = tpl('link', { link: HTMLAnchorElement }).refs;
  a.href = href;
  a.textContent = label;
  if (hint) tip(a, hint);
  return a;
}

export function plainList(items: readonly (string | Node)[]): HTMLUListElement {
  const { list } = tpl('plain-list', { list: HTMLUListElement }).refs;
  for (const x of items) { const { item } = tpl('plain-item', { item: HTMLLIElement }).refs; item.append(x); list.append(item); }
  return list;
}

/** A part of the module opened: folded unless the user left it open last time (remembered per part), built on the first
 * opening. `open`: its default. */
export function fold(key: string, name: string, count: string, build: () => Node | Promise<Node>, open = false): HTMLDetailsElement {
  const r = tpl('fold', { title: HTMLSpanElement, count: HTMLSpanElement, body: HTMLDivElement }).refs;
  const d = r.title.closest('details')!;
  r.title.textContent = name;
  r.count.textContent = count ? ` · ${count}` : '';
  const state = rememberedOpen(`apps:module-${key}`, open);
  let built = false;
  const load = () => { if (d.open && !built) { built = true; fill(r.body, build); } };
  d.addEventListener('toggle', () => { state.remember(d.open); load(); });
  d.open = state.open;
  load();
  return d;
}

/** A log of steps, each with its outcome on the right (Running… → ✓ or error). */
export function stepLog(log: HTMLUListElement) {
  return {
    clear: () => log.replaceChildren(),
    step(label: string) {
      const r = tpl('step', { item: HTMLLIElement, text: HTMLSpanElement, outcome: HTMLSpanElement }).refs;
      r.text.textContent = label;
      log.append(r.item);
      return {
        done: (outcome = '✓', kind: 'ok' | 'med' = 'ok') => r.outcome.replaceWith(pill(outcome, kind)),
        fail: () => r.outcome.replaceWith(pill(_t('error'), 'err')),
      };
    },
    error(e: unknown) { const { item } = tpl('plain-item', { item: HTMLLIElement }).refs; item.append(errBox(e)); log.append(item); },
  };
}
export type StepLog = ReturnType<typeof stepLog>;

/**
 * Odoo's search bar: the active filters as facets inside it (× or Backspace in an empty input removes one), the input,
 * the count, and ▾ opening the filters (Installed / Not Installed, Apps / Extra) and the categories. `f` is changed in
 * place; onChange() after each change.
 */
export function searchBar(f: Filters, cats: readonly string[], onChange: () => void) {
  const r = tpl('searchbar', { root: HTMLDivElement, facets: HTMLSpanElement, input: HTMLInputElement, count: HTMLSpanElement, toggle: HTMLButtonElement, panel: HTMLDivElement }).refs;
  type Key = 'installed' | 'notInstalled' | 'apps' | 'extra';
  const GROUPS: [Key, string][][] = [ // a group is one facet, its ticked options joined by "or" (as in Odoo)
    [['installed', _t('Installed')], ['notInstalled', _t('Not Installed')]],
    [['apps', _t('Apps')], ['extra', _t('Extra')]],
  ];
  const open = (on: boolean) => { r.panel.hidden = !on; r.toggle.setAttribute('aria-expanded', String(on)); if (on) redraw(); };
  r.toggle.addEventListener('click', () => open(!!r.panel.hidden));
  const changed = () => { redraw(); onChange(); };

  const facet = (label: string, remove: () => void) => {
    const x = tpl('facet', { facet: HTMLSpanElement, label: HTMLSpanElement, x: HTMLButtonElement }).refs;
    x.label.textContent = label;
    x.x.addEventListener('click', () => { remove(); changed(); });
    return x.facet;
  };
  const item = (on: boolean, label: string, click: () => void) => {
    const { item: b } = tpl('search-item', { item: HTMLButtonElement }).refs;
    b.textContent = label;
    b.setAttribute('aria-pressed', String(on));
    b.addEventListener('click', () => { click(); changed(); });
    return b;
  };
  const column = (head: string, ...items: HTMLElement[]) => {
    const c = tpl('search-col', { col: HTMLDivElement, head: HTMLDivElement }).refs;
    c.head.textContent = head;
    c.col.append(...items);
    return c.col;
  };
  function redraw() {
    r.facets.replaceChildren(...GROUPS.flatMap((g) => {
      const on = g.filter(([k]) => f[k]);
      return on.length ? [facet(on.map(([, label]) => label).join(_t(' or ')), () => { for (const [k] of g) f[k] = false; })] : [];
    }), ...(f.category ? [facet(`${_t('Category')}: ${f.category}`, () => { f.category = null; })] : []));
    if (r.panel.hidden) return;
    const cats2 = column(_t('Category'), item(!f.category, _t('All Categories'), () => { f.category = null; }),
      ...cats.map((name) => item(f.category === name, name, () => { f.category = f.category === name ? null : name; })));
    cats2.classList.add('cats');
    r.panel.replaceChildren(
      column(_t('Filters'), ...GROUPS.flatMap((g, i) => [...(i ? [tpl('search-sep', { sep: HTMLHRElement }).refs.sep] : []),
        ...g.map(([k, label]) => item(!!f[k], label, () => { f[k] = !f[k]; }))])),
      cats2);
  }
  r.input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Backspace' && !r.input.value && r.facets.lastElementChild) { ev.preventDefault(); r.facets.lastElementChild.querySelector<HTMLButtonElement>('.facet-x')?.click(); }
    if (ev.key === 'Escape' && !r.panel.hidden) { ev.preventDefault(); ev.stopPropagation(); open(false); }
  });
  const outside = (ev: PointerEvent) => {
    if (!r.root.isConnected) { document.removeEventListener('pointerdown', outside); return; } // re-rendered away
    if (!r.panel.hidden && !r.root.contains(ev.target as Node)) open(false);
  };
  document.addEventListener('pointerdown', outside);
  redraw();
  return { root: r.root, input: r.input, count: r.count };
}

const STATE_LABEL: Record<ModuleState, string> = {
  uninstallable: N_('Not installable'), uninstalled: N_('Not installed'), installed: N_('Installed'),
  'to upgrade': N_('To upgrade'), 'to remove': N_('To uninstall'), 'to install': N_('To install'),
};
export const stateLabel = (s: ModuleState) => _t(STATE_LABEL[s]);
export const statePill = (s: ModuleState) => pill(stateLabel(s), stateKind(s));
