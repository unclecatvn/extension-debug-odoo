// Code tab: the pieces its parts share. Markup: code.tpl.html.
import { translateDom } from '../../i18n/i18n.ts';
import { templates } from '../../ui/template.ts';
import { tip } from '../../ui/tooltip.ts';
import html from './code.tpl.html';

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

/** A link opening `href` (a record of the inspected Odoo) in a new tab. */
export function link(label: string, href: string, hint = ''): HTMLAnchorElement {
  const { link: a } = tpl('link', { link: HTMLAnchorElement }).refs;
  a.href = href;
  a.textContent = label;
  if (hint) tip(a, hint);
  return a;
}

export function check(label: string, checked: boolean, onChange: (on: boolean) => void, hint = ''): HTMLLabelElement {
  const r = tpl('check', { label: HTMLLabelElement, box: HTMLInputElement, text: HTMLSpanElement }).refs;
  r.text.textContent = label;
  r.box.checked = checked;
  r.box.addEventListener('change', () => onChange(r.box.checked));
  if (hint) tip(r.label, hint);
  return r.label;
}
