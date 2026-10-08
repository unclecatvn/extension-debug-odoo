// Code tab: what a run leaves, kept while the panel lives: the tab is rebuilt on every panel refresh (Odoo navigation,
// the soft_reload Auto Refresh triggers), which must not drop the result nor switch writes back on or off. The mode is
// never stored (writes are chosen again in each panel); the language and Auto Refresh are preferences (localStorage of
// the panel, every origin); the code is kept per Odoo and language (code.logic.ts → codeKey). ⟳ Reload Data forgets the
// run (forgetRun), as the other tabs forget their forms.
import type { RunResult } from './code.injected.ts';
import type { Lang, RunMode } from './code.logic.ts';
import { createHistory } from './code.history.logic.ts';
import type { Fmt } from './code.result.ts';

const LANG_KEY = 'odoo-debug-code-lang';
const REFRESH_KEY = 'odoo-debug-auto-refresh';
const read = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* storage off */ } };

export interface CodeState {
  scope: string | null;
  runningScope: string | null;
  historyId: number | null;
  lang: Lang;
  /** per language: JS read-only by default, Python a dry run (it can't refuse a write before it runs) */
  mode: Record<Lang, RunMode>;
  autoRefresh: boolean;
  running: boolean;
  result: { r: RunResult; lang: Lang; code: string; fmt: Fmt; refreshed: { ok: true } | { error: string } | null } | null;
  error: unknown;
  /** the panel under the editor: the guide, the snippets, the history, or none */
  aside: 'guide' | 'snippets' | 'history' | null;
}

export const history = createHistory();

export const last: CodeState = {
  scope: null,
  runningScope: null,
  historyId: null,
  lang: read(LANG_KEY) === 'python' ? 'python' : 'js',
  mode: { js: 'read', python: 'dry' },
  autoRefresh: read(REFRESH_KEY) === '1',
  running: false,
  result: null,
  error: null,
  aside: null,
};
export const keepLang = (l: Lang) => { last.lang = l; write(LANG_KEY, l); };
export const keepAutoRefresh = (on: boolean) => { last.autoRefresh = on; write(REFRESH_KEY, on ? '1' : '0'); };

export function forgetRun() {
  if (last.running) return; // the run in flight still ends where it should
  last.mode = { js: 'read', python: 'dry' };
  last.result = null;
  last.error = null;
}

export const loadCode = (key: string) => read(key);
export const saveCode = (key: string, code: string) => write(key, code);

/** Results and write choices belong to the identity they were made with, not another database/user. */
export function selectScope(scope: string) {
  if (last.scope === scope) return;
  last.scope = scope;
  last.mode = { js: 'read', python: 'dry' };
  last.result = null;
  last.error = null;
  last.historyId = null;
}
