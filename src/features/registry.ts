// The panel's tabs: what each one is, and the contract between it and the panel shell (entrypoints/panel).
// A feature is ported by writing features/<tab>/<tab>.tab.ts exporting a TabModule and putting it here; null = not yet.
import type { ExtMessage } from '../contracts/messages.ts';
import type { PageState } from '../injected/page-state.ts';
import type { OdooContext } from '../odoo/detect.ts';
import { appsTab } from './apps/apps.tab.ts';
import { codeTab } from './code/code.tab.ts';
import { menusTab } from './menus/menus.tab.ts';
import { perfTab } from './perf/perf.tab.ts';
import { recordTab } from './record/record.tab.ts';
import { rpcTab } from './rpc/rpc.tab.ts';
import { securityTab } from './security/security.tab.ts';
import { translationsTab } from './translations/translations.tab.ts';
import { viewTab } from './view/view.tab.ts';

/** In the order of the tab bar (entrypoints/panel/index.html). */
export const TAB_NAMES = ['record', 'view', 'rpc', 'security', 'translations', 'apps', 'menus', 'perf', 'code'] as const;
export type TabName = (typeof TAB_NAMES)[number];
export const isTabName = (s: unknown): s is TabName => (TAB_NAMES as readonly unknown[]).includes(s);

/** What the shell gives a tab mounted at startup (the RPC log listens before any render). */
export interface PanelContext {
  state(): PageState;
  odoo(): OdooContext | null;
  showTab(name: TabName): void;
  /** Shows the tab `name`, rendered anew (something was handed to it). */
  rerender(name: TabName): void;
}

export interface TabModule {
  /** null: works on this Odoo. A string: why not (shown instead of the tab). Version differences a tab can absorb go in
   * the adapter (odoo/adapter.ts); this is for what has no equivalent at all on a version. */
  supports?(odoo: OdooContext): string | null;
  /** Fills the tab, lazily: when it is shown, once per refresh. `section` is empty. */
  render?(section: HTMLElement, state: PageState, odoo: OdooContext): void;
  /** Once, at startup, before anything renders (for a tab that records in the background). */
  mount?(section: HTMLElement, ctx: PanelContext): void | Promise<void>;
  /** A message from the page (RPC recorded, field picked). Returns the tab to show, if any. */
  onMessage?(msg: ExtMessage): TabName | null;
  /** A confirmed page snapshot; consumers distinguish document replacement from SPA navigation by loadedAt. */
  pageObserved?(previous: PageState, next: PageState): void;
  /** ⟳ Reload Data: forget what is kept between renders (last run, picks…). */
  reset?(): void;
}

export const TABS: Readonly<Record<TabName, TabModule | null>> = {
  record: recordTab,
  view: viewTab,
  rpc: rpcTab,
  security: securityTab,
  translations: translationsTab,
  apps: appsTab,
  menus: menusTab,
  perf: perfTab,
  code: codeTab,
};
