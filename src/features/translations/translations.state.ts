// Translations tab: what the tab keeps between renders, per Odoo: the view shown, the text searched, the language you
// had before trying another (to come back to it). The modules and languages of the export are kept as a form
// (ui/form-state.ts). Forgotten on ⟳ Reload Data.
import type { PageState } from '../../injected/page-state.ts';
import type { OdooAdapter } from '../../odoo/adapter.ts';
import type { Lang } from './translations.data.ts';

export const VIEWS = ['find', 'record', 'view', 'modules', 'langs'] as const;
export type View = (typeof VIEWS)[number];

export interface TranslationsState {
  view: View | null;
  query: string;
  /** your language before "Use" switched it */
  previousLang: string | null;
}

const states = new Map<string, TranslationsState>();
export function stateOf(origin: string): TranslationsState {
  let s = states.get(origin);
  if (!s) states.set(origin, s = { view: null, query: '', previousLang: null });
  return s;
}
export const forgetAll = () => states.clear();

/** What a render gives each view. */
export interface TranslationsCtx {
  page: PageState;
  a: OdooAdapter;
  s: TranslationsState;
  /** every language (active first), read once per render */
  langs: Promise<Lang[]>;
  /** the active ones' codes, en_US first: the columns of the tables */
  columns: Promise<string[]>;
  rerender(): void;
}
