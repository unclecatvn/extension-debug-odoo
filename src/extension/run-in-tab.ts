// The inspected tab, and running injected functions (src/injected/, features/*/*.injected.ts) in its MAIN world, with
// its Odoo session. The panel binds to the tab it is embedded in (entrypoints/panel).
import type { Json } from '../contracts/json.ts';
import { _t } from '../i18n/i18n.ts';

export let tabId: number | null = null;
export const setTab = (t: chrome.tabs.Tab | undefined) => { tabId = t?.id ?? null; };

/** What exec() gives back when the function could not run in the tab (closed, not scriptable, threw). */
export interface ExecError { error: string }
export const isExecError = (r: unknown): r is ExecError =>
  typeof r === 'object' && r !== null && typeof (r as { error?: unknown }).error === 'string';

/** Runs an injected function in the tab. Its arguments cross as JSON, hence `Json`. null: it ran but returned nothing. */
export async function exec<A extends Json[], R>(func: (...args: A) => R, ...args: A): Promise<Awaited<R> | ExecError | null> {
  if (tabId == null) return { error: _t('No tab is open.') };
  try {
    const [r] = await chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', func, args });
    return (r?.result as Awaited<R> | undefined) ?? null;
  } catch (e) {
    return { error: String((e as Error)?.message || e) };
  }
}

/** exec() for injected functions returning { error } with an N_-marked msgid: throws the translated message. */
export async function execOrThrow<A extends Json[], R>(func: (...args: A) => R, fallback: string, ...args: A): Promise<Exclude<Awaited<R>, ExecError>> {
  const r = await exec(func, ...args);
  if (r == null) throw new Error(_t(fallback));
  if (isExecError(r)) throw new Error(_t(r.error || fallback));
  return r as Exclude<Awaited<R>, ExecError>;
}
