// Code history is deliberately memory-only: a panel session, never localStorage or chrome.storage. Only completed
// runs enter it. Each Odoo/database/user has its own 20 entries; large outputs are omitted, never silently truncated.
import type { PageState } from '../../injected/page-state.ts';
import type { Screen } from './code.data.ts';
import type { RunResult } from './code.injected.ts';
import type { Lang, RunMode } from './code.logic.ts';
import type { Fmt } from './code.result.ts';

export const HISTORY_LIMIT = 20;
/** Maximum serialized UTF-16 code units per output snapshot (at most ~256 KiB of string storage). */
export const MAX_RESULT_CHARS = 128 * 1024;

export const historyScope = (origin: string, database: string, uid: number) => JSON.stringify([origin, database, uid]);
export const restoreMode = (lang: Lang, mode: RunMode): RunMode => lang === 'python' ? 'dry' : mode === 'dry' ? 'dry' : 'read';

export interface RunSnapshot {
  scope: string;
  code: string;
  lang: Lang;
  mode: RunMode;
  screen: Screen;
  fmt: Fmt;
  startedAt: number;
}
export interface SavedError { message: string; traceback?: string }
export type SavedOutcome =
  | { kind: 'result'; result: RunResult }
  | { kind: 'error'; error: SavedError; clipped: boolean }
  | { kind: 'omitted'; reason: 'size' | 'serialization'; ok: boolean; error?: SavedError; clipped?: boolean };
export interface HistoryEntry extends RunSnapshot {
  id: number;
  completedAt: number;
  durationMs: number;
  outcome: SavedOutcome;
  refreshed: { ok: true } | { error: string } | null;
}
export interface CompletedRun extends RunSnapshot {
  completedAt: number;
  durationMs: number;
  outcome: { result: RunResult } | { error: unknown };
  refreshed: HistoryEntry['refreshed'];
}

function freeze<T>(value: T): T {
  const pending: unknown[] = [value];
  const seen = new Set<object>();
  while (pending.length) {
    const item = pending.pop();
    if (!item || typeof item !== 'object' || seen.has(item)) continue;
    seen.add(item);
    for (const child of Object.values(item)) pending.push(child);
    Object.freeze(item);
  }
  return value;
}

/** Call before any await: editor, language and execution mode can change while the selection is read. */
export function captureRun(run: RunSnapshot): RunSnapshot {
  return freeze({ scope: run.scope, code: run.code, lang: run.lang, mode: run.mode, startedAt: run.startedAt,
    screen: { ...run.screen, ids: [...run.screen.ids] }, fmt: { ...run.fmt } });
}

function savedError(value: unknown): { error: SavedError; clipped: boolean } {
  const e = value as { message?: unknown; traceback?: unknown } | null;
  const message = typeof e?.message === 'string' ? e.message : String(value);
  const traceback = typeof e?.traceback === 'string' ? e.traceback : '';
  return {
    error: { message: message.slice(0, 4000), ...(traceback ? { traceback: traceback.slice(0, MAX_RESULT_CHARS - 8000) } : {}) },
    clipped: message.length > 4000 || traceback.length > MAX_RESULT_CHARS - 8000,
  };
}

function savedOutcome(outcome: CompletedRun['outcome']): SavedOutcome {
  if ('error' in outcome) return { kind: 'error', ...savedError(outcome.error) };
  const result = outcome.result;
  const tooLarge = new Error('history size limit');
  let minimumLength = 0;
  try {
    // Abort early for huge strings/collections instead of making another full-size copy first. The final length
    // check includes JSON punctuation/escaping; the replacer's lower bound only needs to reject obvious excess.
    const json = JSON.stringify(result, (key: string, value: unknown) => {
      minimumLength += key.length + (typeof value === 'string' ? value.length : 1);
      if (minimumLength > MAX_RESULT_CHARS) throw tooLarge;
      return value;
    });
    if (json.length > MAX_RESULT_CHARS) throw tooLarge;
    return { kind: 'result', result: JSON.parse(json) as RunResult };
  } catch (error) {
    return { kind: 'omitted', reason: error === tooLarge ? 'size' : 'serialization', ok: result.ok,
      ...(!result.ok && result.error ? savedError(result.error) : {}) };
  }
}

/** A factory keeps tests independent and makes the absence of cross-panel persistence explicit. */
export function createHistory() {
  const entries = new Map<string, readonly HistoryEntry[]>();
  let nextId = 1;
  return {
    add(run: CompletedRun): HistoryEntry {
      const entry = freeze({ ...captureRun(run), id: nextId++, completedAt: run.completedAt, durationMs: run.durationMs,
        outcome: savedOutcome(run.outcome),
        refreshed: run.refreshed ? { ...run.refreshed } : null });
      entries.set(run.scope, [entry, ...(entries.get(run.scope) ?? [])].slice(0, HISTORY_LIMIT));
      return entry;
    },
    list(scope: string): readonly HistoryEntry[] { return [...(entries.get(scope) ?? [])]; },
    clear(scope: string) { entries.delete(scope); },
  };
}

/** Panel refresh also updates hidden tabs' context; a render counter alone misses navigation while Code is hidden. */
export function sameRunPage(before: Pick<PageState, 'origin' | 'url' | 'loadedAt' | 'model' | 'resId'>, after: Pick<PageState, 'origin' | 'url' | 'loadedAt' | 'model' | 'resId'>): boolean {
  return before.origin === after.origin && before.url === after.url && before.loadedAt === after.loadedAt
    && (before.model ?? null) === (after.model ?? null) && (before.resId ?? null) === (after.resId ?? null);
}
