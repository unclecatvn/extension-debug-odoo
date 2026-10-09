// Translations tab, view "Record": the page's record, its translated fields (translate=True) × the active languages.
// A field translated whole is one row; an html / xml field translated by terms (translate=html_translate…) has a
// section, one row per term. ✗: not translated in that language (Odoo shows the English value). A row opens its
// editor: update_field_translations, the record's write rights. get_field_translations needs only read rights.
import { _t } from '../../i18n/i18n.ts';
import { fill } from '../../ui/cards.ts';
import { matrix, type MxSection } from '../../ui/matrix.ts';
import { frag, note } from '../../ui/parts.ts';
import { fieldTranslations, translatableFields, updateTranslations } from './translations.data.ts';
import { translationRows } from './translations.logic.ts';
import type { TranslationsCtx } from './translations.state.ts';
import { tableFilter, translationMxRows } from './translations.ui.ts';

export function recordView(body: HTMLElement, c: TranslationsCtx) {
  const { model, resId } = c.page;
  if (!model || !resId) { body.append(note(_t('Open a record to see its translations.'))); return; }
  fill(body, async () => {
    const [langs, fields] = await Promise.all([c.columns, translatableFields(model)]);
    if (!fields.length) return note(_t('%s has no translatable field.', model));
    const all = await Promise.all(fields.map(async (f) => ({ f, ...(await fieldTranslations(model, resId, f.name, langs)) })));
    const save = (field: string, byTerm: boolean) => async (source: string, changed: Map<string, string>) => {
      const translations = Object.fromEntries([...changed].map(([l, v]) => [l, byTerm ? { [source]: v } : v || false]));
      await updateTranslations(model, resId, field, translations);
      c.rerender();
    };
    const whole = all.filter((x) => !x.byTerm);
    const sections: MxSection[] = [];
    if (whole.length) {
      sections.push({ title: _t('Fields translated whole'), rows: whole.flatMap((x) => translationMxRows(translationRows(x.list, false), langs,
        () => [x.f.string], () => x.f.name, save(x.f.name, false))) });
    }
    for (const x of all.filter((y) => y.byTerm)) {
      const rows = translationRows(x.list, true);
      sections.push({ title: x.f.string, note: _t('%s · translated term by term (%s terms)', x.f.name, rows.length), folded: false,
        rows: translationMxRows(rows, langs, (r) => [r.source], () => undefined, save(x.f.name, true)) });
    }
    const total = sections.reduce((n, s) => n + s.rows.length, 0);
    const table = matrix(`${model} #${resId}`, langs, sections, -1, true);
    const legend = note(_t('✗ not translated: Odoo shows the English value. Click a row to edit.'));
    legend.classList.add('legend');
    return frag(tableFilter(table, total), table, legend);
  });
}
