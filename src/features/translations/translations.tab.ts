// Translations tab: where a text comes from and how it is translated, as tables. Five views:
//   Find       translations.find.ts     a text typed or clicked on the page → its source: code (module .po), a field
//                                        label, a selection, a menu, the action, the record, the view
//   Record     translations.record.ts   the record's translated fields × the languages; edit them
//   View       translations.view.ts     the terms of the views building the screen × the languages; edit them
//   Modules    translations.modules.ts  coverage of the modules' .po per language; export .pot / .po; import a .po
//   Languages  translations.langs.ts    every language: active, yours, users; activate, update, use one
// translations.data.ts reads and writes, translations.logic.ts is pure. 18.0 / 19.0: the code translations' route
// (odoo/adapter.ts → i18n), the rest is the same.
import { _t } from '../../i18n/i18n.ts';
import { segmented } from '../../ui/parts.ts';
import type { TabModule } from '../registry.ts';
import { readLangs } from './translations.data.ts';
import { findView } from './translations.find.ts';
import { langsView } from './translations.langs.ts';
import { modulesView } from './translations.modules.ts';
import { recordView } from './translations.record.ts';
import { forgetAll, stateOf, type TranslationsCtx, type View } from './translations.state.ts';
import { tpl } from './translations.ui.ts';
import { viewView } from './translations.view.ts';

const RENDER: Record<View, (body: HTMLElement, c: TranslationsCtx) => void> = {
  find: findView, record: recordView, view: viewView, modules: modulesView, langs: langsView,
};

export const translationsTab: TabModule = {
  render(section, page, odoo) {
    const s = stateOf(page.origin);
    const draw = () => {
      section.replaceChildren();
      const langs = readLangs();
      const columns = langs.then((ls) => ['en_US', ...ls.filter((l) => l.active && l.code !== 'en_US').map((l) => l.code)]);
      const c: TranslationsCtx = { page, a: odoo.adapter, s, langs, columns, rerender: draw };
      const views: [View, string][] = [
        ['find', _t('Find a Text')],
        ...(page.model && page.resId ? [['record', _t('Record #%s', page.resId)] as [View, string]] : []),
        ...(page.model && page.viewType ? [['view', _t('View (%s)', page.viewType)] as [View, string]] : []),
        ['modules', _t('Modules (.po)')],
        ['langs', _t('Languages')],
      ];
      const shown = views.some(([v]) => v === s.view) ? s.view! : 'find';
      const r = tpl('view', { view: HTMLDivElement, head: HTMLDivElement, body: HTMLDivElement }).refs;
      const show = (v: View) => { s.view = v; r.body.replaceChildren(); RENDER[v](r.body, c); };
      r.head.append(segmented(views, shown, show));
      section.append(r.view);
      show(shown);
    };
    draw();
  },
  reset: forgetAll,
};
