// Perf tab: the pieces its parts share. Markup: perf.tpl.html. Tables: ui/matrix.ts.
import { _t, translateDom } from '../../i18n/i18n.ts';
import { fill, rememberedOpen } from '../../ui/cards.ts';
import { copyButton } from '../../ui/components.ts';
import { templates } from '../../ui/template.ts';
import { tip } from '../../ui/tooltip.ts';
import { frameText, type Frame, type SqlEntry } from './perf.logic.ts';
import html from './perf.tpl.html';

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

export function text(value: string, cls = '', hint = ''): HTMLSpanElement {
  const { text: t } = tpl('text', { text: HTMLSpanElement }).refs;
  t.textContent = value;
  if (cls) t.className = cls;
  if (hint) tip(t, hint);
  return t;
}

export function link(label: string, href: string, hint = ''): HTMLAnchorElement {
  const { link: a } = tpl('link', { link: HTMLAnchorElement }).refs;
  a.href = href;
  a.textContent = label;
  if (hint) tip(a, hint);
  return a;
}

export const title = (value: string) => { const { title: t } = tpl('sub-title', { title: HTMLHeadingElement }).refs; t.textContent = value; return t; };

/** A total of a request: its value, what it is. */
export function total(value: string, label: string, hint = ''): HTMLSpanElement {
  const r = tpl('total', { box: HTMLSpanElement, value: HTMLElement, label: HTMLSpanElement }).refs;
  r.value.textContent = value;
  r.label.textContent = label;
  if (hint) tip(r.box, hint);
  return r.box;
}

/** A part of the request opened: folded unless the user left it open (remembered per part), built when first opened. */
export function fold(key: string, name: string, count: string, build: () => Node | Promise<Node>, open = false): HTMLDetailsElement {
  const r = tpl('fold', { title: HTMLSpanElement, count: HTMLSpanElement, body: HTMLDivElement }).refs;
  const d = r.title.closest('details')!;
  r.title.textContent = name;
  r.count.textContent = count ? ` · ${count}` : '';
  const state = rememberedOpen(`perf:${key}`, open);
  let built = false;
  const load = () => { if (d.open && !built) { built = true; fill(r.body, build); } };
  d.addEventListener('toggle', () => { state.remember(d.open); load(); });
  d.open = state.open;
  load();
  return d;
}

/** A query opened: as run (its values in), then its stack, innermost last. */
export function queryDetail(e: SqlEntry): HTMLElement {
  const r = tpl('query', { box: HTMLDivElement, sqlbox: HTMLDivElement, sql: HTMLPreElement, stack: HTMLPreElement }).refs;
  r.sql.textContent = e.full_query || e.query;
  r.sqlbox.append(copyButton(() => r.sql.textContent ?? '', _t('Copy the query')));
  if (e.stack?.length) r.stack.textContent = e.stack.map((f: Frame) => frameText(f)).join('\n');
  else r.stack.remove();
  return r.box;
}

/** A <select> of [value, label]; `onPick` when another is chosen. */
export function select(options: readonly [string, string][], current: string, onPick: (v: string) => void, label: string): HTMLSelectElement {
  const { select: s } = tpl('select', { select: HTMLSelectElement }).refs;
  s.setAttribute('aria-label', label);
  for (const [value, text_] of options) {
    const { option } = tpl('option', { option: HTMLOptionElement }).refs;
    option.value = value;
    option.textContent = text_;
    s.append(option);
  }
  s.value = current;
  s.addEventListener('change', () => onPick(s.value));
  return s;
}
