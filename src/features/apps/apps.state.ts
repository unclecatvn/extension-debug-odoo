// Apps tab: what the tab keeps between renders, per Odoo: the view shown, the module opened. The search, the filters and
// the modules picked are kept as a form (ui/form-state.ts: across reloads, as the Apps menu keeps its facets). Forgotten
// on ⟳ Reload Data.
import type { PageState } from '../../injected/page-state.ts';
import type { OdooAdapter } from '../../odoo/adapter.ts';
import { formValues, saveForm } from '../../ui/form-state.ts';
import type { AppModule, DepRow, Filters } from './apps.logic.ts';

export const VIEWS = ['modules', 'pending'] as const;
export type View = (typeof VIEWS)[number];

export interface AppsState {
  view: View | null;
  /** the module opened beside the list */
  module: number | null;
}

const states = new Map<string, AppsState>();
export function stateOf(origin: string): AppsState {
  let s = states.get(origin);
  if (!s) states.set(origin, s = { view: null, module: null });
  return s;
}
export const forgetAll = () => states.clear();

/** The form of the Modules view, kept across reloads: the search, Odoo's filters (the list opens on the installed
 * modules, as the Apps menu opens on Apps), the modules picked for an action. */
export interface AppsForm { query: string; filters: Filters; picked: string[] }
const FORM = 'apps';
export function loadForm(): AppsForm {
  const f = formValues<AppsForm & { modules?: string }>(FORM);
  return { query: f.query ?? '', filters: f.filters ?? { installed: true }, picked: f.picked ?? [] };
}
export const keepForm = (f: AppsForm) => saveForm(FORM, f);

/** What a render gives each view: the reads it started once, shared. */
export interface AppsCtx {
  page: PageState;
  a: OdooAdapter;
  s: AppsState;
  modules: Promise<AppModule[]>;
  deps: Promise<DepRow[]>;
  /** the companies' countries (a localization auto-installs for them only) */
  countries: Promise<number[]>;
  /** the installed modules' manifest versions on disk, read once per render after the list */
  disk: Promise<Map<number, string | false>>;
  show(view: View): void;
  rerender(): void;
}
