// Translations tab: the pieces its views share. Markup: translations.tpl.html. Tables: ui/matrix.ts (wide: values in
// the columns); a missing translation is a ✗ that says so on hover.
import { translateDom, _t } from '../../i18n/i18n.ts';
import { errBox } from '../../ui/components.ts';
import { filterBox } from '../../ui/cards.ts';
import { filterMatrix, symbol, type MxRow } from '../../ui/matrix.ts';
import { templates } from '../../ui/template.ts';
import { tip } from '../../ui/tooltip.ts';
import html from './translations.tpl.html';

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

export function plainList(items: readonly string[]): HTMLUListElement {
  const { list } = tpl('plain-list', { list: HTMLUListElement }).refs;
  for (const text of items) { const { item } = tpl('plain-item', { item: HTMLLIElement }).refs; item.textContent = text; list.append(item); }
  return list;
}

const CLIP = 90;

/** A text in a cell: clipped, the whole of it on hover. */
export function text(value: string, cls = ''): HTMLSpanElement {
  const { text: t } = tpl('text', { text: HTMLSpanElement }).refs;
  const flat = value.replace(/\s+/g, ' ').trim();
  t.textContent = flat.length > CLIP ? `${flat.slice(0, CLIP)}…` : flat;
  if (cls) t.className = cls;
  if (flat.length > CLIP) tip(t, flat.slice(0, 600));
  return t;
}

/** A translation in a table: its text, or ✗ when missing. */
export const valueCell = (v: string | null | undefined, lang: string): Node => (v == null ? symbol(false, false, _t('Not translated in %s', lang)) : text(v));

/**
 * The editor of a row: the source, then one input per language (prefilled), Save writes the ones changed (asked to
 * confirm). `save` gets language → new value ('' = remove the translation).
 */
export function editor(source: string, langs: readonly string[], values: ReadonlyMap<string, string | null>,
  save: (changed: Map<string, string>) => Promise<unknown>): HTMLElement {
  const r = tpl('editor', { form: HTMLFormElement, source: HTMLDivElement, fields: HTMLDivElement, save: HTMLButtonElement, error: HTMLSpanElement }).refs;
  r.source.append(text(source, 'mono'));
  const inputs = new Map<string, HTMLTextAreaElement>();
  for (const lang of langs) {
    const f = tpl('editor-field', { lang: HTMLSpanElement, input: HTMLTextAreaElement }).refs;
    f.lang.textContent = lang;
    f.input.value = values.get(lang) ?? '';
    f.input.rows = Math.min(6, Math.max(1, Math.ceil(f.input.value.length / 80)));
    if (lang === 'en_US') f.input.disabled = true; // the source language: change the record itself
    inputs.set(lang, f.input);
    r.fields.append(f.lang.parentElement!);
  }
  r.form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const changed = new Map([...inputs].filter(([l, i]) => !i.disabled && i.value !== (values.get(l) ?? '')).map(([l, i]) => [l, i.value]));
    if (!changed.size) { r.error.textContent = _t('Nothing changed.'); return; }
    if (!confirm(_t('Save the translations in %s?', [...changed.keys()].join(', ')))) return;
    r.save.disabled = true;
    r.error.textContent = '';
    try { await save(changed); } catch (err) { r.error.replaceChildren(errBox(err)); } finally { r.save.disabled = false; }
  });
  r.form.addEventListener('click', (e) => e.stopPropagation()); // typing in a row's detail doesn't fold it
  return r.form;
}

/** The rows of a field's translations (one per term, or one for the whole value): its cells, the languages; opened,
 * the editor. `save`: language → new value, for this row's source. */
export function translationMxRows(rows: { source: string; values: Map<string, string | null> }[], langs: readonly string[],
  label: (r: { source: string }) => (Node | string)[], sub: (r: { source: string }) => string | undefined,
  save: (source: string, changed: Map<string, string>) => Promise<unknown>): MxRow[] {
  return rows.map((r) => {
    const missing = langs.filter((l) => l !== 'en_US' && r.values.get(l) == null);
    return {
      label: label(r),
      sub: sub(r),
      q: [r.source, ...r.values.values()].filter(Boolean).join(' '),
      tags: missing.length ? ['missing'] : [],
      cells: langs.map((l) => valueCell(l === 'en_US' ? r.values.get(l) ?? r.source : r.values.get(l), l)),
      detail: () => editor(r.source, langs, new Map(langs.map((l) => [l, l === 'en_US' ? r.values.get(l) ?? r.source : r.values.get(l) ?? null])),
        (changed) => save(r.source, changed)),
    };
  });
}

/** The filter of a translations table: a text, and "only missing". → the toolbar. */
export function tableFilter(table: HTMLTableElement, total: number, unit: [string, string]): HTMLElement {
  const { bar } = tpl('toolbar', { bar: HTMLDivElement }).refs;
  const { text: count } = tpl('count', { text: HTMLSpanElement }).refs;
  const f = filterBox([], _t('Filter the texts…'));
  let onlyMissing = false;
  const apply = () => {
    const n = filterMatrix(table, f.input.value, (r) => !onlyMissing || (r.dataset.tags ?? '').includes('missing'));
    count.textContent = onlyMissing && !n ? _t('Everything is translated.') : n === total ? _t(unit[0], total) : _t(unit[1], n, total);
  };
  const missing = button(_t('Only missing translations'), () => { onlyMissing = !onlyMissing; missing.setAttribute('aria-pressed', String(onlyMissing)); apply(); }, 'chip');
  missing.setAttribute('aria-pressed', 'false');
  f.input.addEventListener('input', apply);
  bar.append(f.input, missing, count);
  apply();
  return bar;
}
