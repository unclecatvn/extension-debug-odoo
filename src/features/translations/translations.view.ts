// Translations tab, view "View": the terms of the views building the screen (the view shown, what it inherits from,
// its active extensions) × the active languages, one section per view. ✗: not translated. A row opens its editor
// (update_field_translations on ir.ui.view.arch_db). Reading and writing views needs Settings (base.group_system).
import { _t } from '../../i18n/i18n.ts';
import { isAccessError } from '../../odoo/rpc.ts';
import { fill } from '../../ui/cards.ts';
import { matrix, type MxSection } from '../../ui/matrix.ts';
import { frag, note } from '../../ui/parts.ts';
import { updateTranslations, viewsOf, viewTerms } from './translations.data.ts';
import { translationRows } from './translations.logic.ts';
import type { TranslationsCtx } from './translations.state.ts';
import { tableFilter, translationMxRows } from './translations.ui.ts';

export function viewView(body: HTMLElement, c: TranslationsCtx) {
  const { model, viewType, viewId } = c.page;
  if (!model || !viewType) { body.append(note(_t('This screen has no view.'))); return; }
  fill(body, async () => {
    const langs = await c.columns;
    const views = await viewsOf(model, viewType, viewId || false).catch((e: unknown) => { if (isAccessError(e)) return null; throw e; });
    if (!views) return note(_t('Reading the views needs Settings rights (base.group_system).'));
    const terms = await Promise.all(views.map(async (v) => ({ v, rows: translationRows(await viewTerms(v.id, langs), true) })));
    const sections: MxSection[] = terms.filter((t) => t.rows.length).map(({ v, rows }) => ({
      title: v.xml_id || v.name,
      note: _t('%s · %s terms', v.mode === 'primary' ? _t('view') : _t('extension'), rows.length),
      folded: false,
      rows: translationMxRows(rows, langs, (r) => [r.source], () => undefined, async (source, changed) => {
        await updateTranslations('ir.ui.view', v.id, 'arch_db', Object.fromEntries([...changed].map(([l, val]) => [l, { [source]: val }])));
        c.rerender();
      }),
    }));
    if (!sections.length) return note(_t('The views of this screen have no translatable text.'));
    const total = sections.reduce((n, s) => n + s.rows.length, 0);
    const table = matrix(_t('%s views', views.length), langs, sections, -1, true);
    const legend = note(_t('✗ not translated: the screen shows the English text. Click a row to edit.'));
    legend.classList.add('legend');
    return frag(tableFilter(table, total, ['%s texts', '%s of %s texts']), table, legend);
  });
}
