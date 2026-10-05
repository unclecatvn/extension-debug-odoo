// Translations tab, view "Find a text": a text typed or clicked on the page, and where it comes from, as a table —
// what it is, its English source, where to change it. Looked for in your language among:
//   code       the webclient's code translations (_t), per module      → <module>/i18n/<lang>.po
//   field      the labels and selection values of the screen's model     → ir.model.fields (the module's .po)
//   menu       menus named so                                            → the menu's translated name
//   action     the action the screen was opened with
//   record     the translated fields of the page's record                → view "Record"
//   view       the terms of the views building the screen (Settings)     → view "View"
// Nothing found: said, with what it may be (a code text without translation shows in English).
import { exec } from '../../extension/run-in-tab.ts';
import { _t } from '../../i18n/i18n.ts';
import { call } from '../../odoo/rpc.ts';
import { fill } from '../../ui/cards.ts';
import { pill } from '../../ui/components.ts';
import { matrix, type MxRow } from '../../ui/matrix.ts';
import { frag, note } from '../../ui/parts.ts';
import { fieldLabels, menusNamed, myLang, translatableFields, viewsOf, viewTerms, webTerms } from './translations.data.ts';
import { pagePickText } from './translations.injected.ts';
import { findWebTerms, normalize } from './translations.logic.ts';
import type { TranslationsCtx } from './translations.state.ts';
import { box, text, tpl } from './translations.ui.ts';

export function findView(body: HTMLElement, c: TranslationsCtx) {
  const r = tpl('find-bar', { form: HTMLFormElement, input: HTMLInputElement, pick: HTMLButtonElement }).refs;
  const results = box();
  const run = (q: string) => {
    c.s.query = q;
    if (!normalize(q)) { results.replaceChildren(note(_t('Type a text shown on the page, or pick it: its source, its English text and where to change it are listed.'))); return; }
    fill(results, () => search(normalize(q), c));
  };
  r.input.value = c.s.query;
  r.form.addEventListener('submit', (e) => { e.preventDefault(); run(r.input.value); });
  r.pick.addEventListener('click', async () => {
    r.pick.disabled = true;
    r.pick.textContent = _t('Click a text on the page… (Esc to cancel)');
    const got = await exec(pagePickText);
    r.pick.disabled = false;
    r.pick.textContent = _t('⌖ Pick on Page');
    if (typeof got === 'string' && got) { r.input.value = got; run(got); }
  });
  body.append(r.form, results);
  run(c.s.query);
}

const kind = (label: string, k: '' | 'ok' | 'info' | 'accent' | 'med' = 'accent') => pill(label, k);

async function search(q: string, c: TranslationsCtx): Promise<Node> {
  const lang = await myLang();
  const { model, resId, viewType, viewId, action } = c.page;
  const safe = <T>(p: Promise<T>, fallback: T) => p.catch(() => fallback);
  const [code, labels, menus, record, views] = await Promise.all([
    safe(webTerms(c.a, lang).then((m) => findWebTerms(m, q)), []),
    model ? safe(labelsMatching(model, lang, q), []) : [],
    safe(menusNamed(q), []),
    model && resId ? safe(recordMatching(model, resId, lang, q), []) : [],
    model && viewType ? safe(viewsMatching(model, viewType, viewId || false, lang, q), null) : [],
  ]);
  const rows: MxRow[] = [];
  for (const t of code) rows.push({ label: [kind(_t('Code')), t.module], sub: t.exact ? undefined : _t('contains the text'),
    cells: [text(t.msgid, 'mono'), text(`${t.module}/i18n/${lang}.po`, 'mono')] });
  for (const l of labels) rows.push({ label: [kind(l.selection ? _t('Selection') : _t('Field label'), 'info'), `${model}.${l.field}`],
    cells: [text(l.en), text(_t('Field %s: its module\'s .po (model:ir.model.fields…), or Settings › Technical › Fields', l.field))] });
  for (const m of menus) rows.push({ label: [kind(_t('Menu'), 'info'), m.complete_name], cells: [text(m.en), text(_t('The menu\'s name (translated in Odoo, or the module\'s .po)'))] });
  if (action && typeof action.name === 'string' && normalize(action.name) === q) {
    const en = typeof action.id === 'number' && typeof action.type === 'string'
      ? await call<{ name: string }[]>(action.type, 'read', [[action.id], ['name']], { context: { lang: 'en_US' } }).then((r) => r[0]?.name ?? '', () => '') : '';
    rows.push({ label: [kind(_t('Action'), 'info'), String(action.xml_id || action.id || '')], cells: [text(en || '—'), text(_t('The action\'s name (translated in Odoo, or the module\'s .po)'))] });
  }
  for (const f of record) rows.push({ label: [kind(_t('Record'), 'ok'), `${model} #${resId}`], sub: f.field, cells: [text(f.en || '—'), text(_t('Translations › Record: edit it there'))] });
  for (const v of views ?? []) rows.push({ label: [kind(_t('View'), 'ok'), v.view], cells: [text(v.source), text(_t('Translations › View: edit it there'))] });

  const out: (Node | null)[] = [];
  out.push(rows.length ? matrix(_t('Source'), [_t('English (source)'), _t('Where to change it')], [{ rows }], -1, true)
    : note(_t('Not found in %s. It may be a code text with no translation (it then shows in English), data of a record not on this screen, or a text built from several parts: pick a smaller piece.', lang)));
  if (views === null) out.push(note(_t('The views\' terms were not searched: reading views needs Settings rights (base.group_system).')));
  if (lang === 'en_US') out.push(note(_t('Your language is English: code texts have no translation to find. Switch language in Translations › Languages to look for one.')));
  return frag(...out);
}

/** The model's field labels and selection values that read `q` in your language, with their English text. */
async function labelsMatching(model: string, lang: string, q: string) {
  const [mine, en] = await Promise.all([fieldLabels(model, lang), fieldLabels(model, 'en_US')]);
  const out: { field: string; en: string; selection: boolean }[] = [];
  for (const [name, f] of Object.entries(mine)) {
    if (normalize(f.string) === q) out.push({ field: name, en: en[name]?.string ?? '', selection: false });
    for (const [value, label] of f.selection ?? []) {
      if (normalize(label) === q) out.push({ field: `${name} = ${value}`, en: en[name]?.selection?.find(([v]) => v === value)?.[1] ?? '', selection: true });
    }
  }
  return out;
}

/** The record's translated fields whose value (in your language) is `q`, with their English value. */
async function recordMatching(model: string, id: number, lang: string, q: string) {
  const fields = (await translatableFields(model)).map((f) => f.name);
  if (!fields.length) return [];
  const read = (l: string) => call<Record<string, unknown>[]>(model, 'read', [[id], fields], { context: { lang: l } }).then((r) => r[0] ?? {});
  const [mine, en] = await Promise.all([read(lang), read('en_US')]);
  return fields.filter((f) => typeof mine[f] === 'string' && normalize(mine[f] as string).includes(q)).map((f) => ({ field: f, en: String(en[f] ?? '') }));
}

/** The terms of the screen's views that read `q` in your language (or are it, in English). */
async function viewsMatching(model: string, viewType: string, viewId: number | false, lang: string, q: string) {
  const views = await viewsOf(model, viewType, viewId);
  const found: { view: string; source: string }[] = [];
  await Promise.all(views.map(async (v) => {
    for (const t of await viewTerms(v.id, [lang])) {
      if (normalize(String(t.value || '')) === q || normalize(t.source) === q) found.push({ view: v.xml_id || v.name, source: t.source });
    }
  }));
  return found;
}
