// Automatic run history: inspect a saved result, restore its code without running, or save it as a named snippet.
// Historical rendering makes no server calls: older values must not be mixed with today's records or metadata.
import { _t } from '../../i18n/i18n.ts';
import { errBox, loading } from '../../ui/components.ts';
import type { HistoryEntry } from './code.history.logic.ts';
import { resultView } from './code.result.ts';
import { button, text, tpl } from './code.ui.ts';

export interface HistoryActions {
  select(id: number): void;
  restore(entry: HistoryEntry): void;
  save(entry: HistoryEntry): void;
  clear(): void;
}

const language = (entry: HistoryEntry) => entry.lang === 'python' ? 'Python' : 'JavaScript';
const mode = (entry: HistoryEntry) => entry.mode === 'read' ? _t('Read-only') : entry.mode === 'dry' ? _t('Dry run') : _t('Allow writes');
const ok = (entry: HistoryEntry) => entry.outcome.kind === 'error' ? false : entry.outcome.kind === 'result' ? entry.outcome.result.ok : entry.outcome.ok;
/** When it completed, in the user's language and time zone; `day`: with the date (a list line shows the time only). */
function when(entry: HistoryEntry, day = true) {
  try {
    return new Intl.DateTimeFormat(entry.fmt.lang.replace('_', '-'), { ...(day ? { dateStyle: 'short' } : {}), timeStyle: 'medium', timeZone: entry.fmt.tz || undefined }).format(entry.completedAt);
  } catch { return new Date(entry.completedAt).toISOString(); }
}

export function historyPane(entries: readonly HistoryEntry[], selected: number | null, actions: HistoryActions): HTMLElement {
  const r = tpl('history', { root: HTMLDivElement, clear: HTMLButtonElement, list: HTMLDivElement, detail: HTMLDivElement }).refs;
  r.clear.disabled = !entries.length;
  r.clear.addEventListener('click', () => {
    if (confirm(_t('Clear run history for this database and user? Saved snippets are kept.'))) actions.clear();
  });
  if (!entries.length) r.list.append(text(_t('No completed runs yet.'), 'muted'));
  const picked = entries.find((entry) => entry.id === selected);
  for (const entry of entries) {
    // one line: ✓ / ✗, the time, the code's first line (cut to the room left), how it ran
    const line = tpl('history-entry', { pick: HTMLButtonElement, mark: HTMLSpanElement, time: HTMLSpanElement, code: HTMLElement, meta: HTMLSpanElement }).refs;
    line.mark.textContent = ok(entry) ? '✓' : '✗';
    line.mark.className = ok(entry) ? 'ok-text' : 'err-text';
    line.time.textContent = when(entry, false);
    line.code.textContent = entry.code.split('\n')[0]!.slice(0, 80);
    line.meta.textContent = `${language(entry)} · ${mode(entry)} · ${_t('%s ms', entry.durationMs)}`;
    line.pick.setAttribute('aria-pressed', String(picked === entry));
    line.pick.addEventListener('click', () => actions.select(entry.id));
    r.list.append(line.pick);
  }
  if (picked) {
    r.detail.hidden = false;
    r.detail.append(historyDetail(picked, actions));
  } else if (entries.length) r.detail.append(text(_t('Choose a run to inspect its code and result.'), 'muted'));
  r.detail.hidden = !entries.length;
  return r.root;
}

function historyDetail(entry: HistoryEntry, actions: HistoryActions): HTMLElement {
  const r = tpl('history-detail', { root: HTMLDivElement, head: HTMLDivElement, screen: HTMLDivElement, actions: HTMLDivElement, code: HTMLPreElement, output: HTMLDivElement }).refs;
  r.head.textContent = `${when(entry)} · ${language(entry)} · ${mode(entry)} · ${_t('%s ms', entry.durationMs)}`;
  r.screen.textContent = entry.screen.model
    ? `${entry.screen.model} · ${entry.screen.resId ? _t('record #%s', entry.screen.resId) : _t('no record opened')}${entry.screen.ids.length ? ` · ${_t('%s selected', entry.screen.ids.length)}: ${entry.screen.ids.join(', ')}` : ''}`
    : _t('no model on this screen');
  r.code.textContent = entry.code;
  r.actions.append(button(_t('Restore code'), () => actions.restore(entry)), button(_t('Save as snippet…'), () => actions.save(entry), 'chip'));
  const outcome = entry.outcome;
  if (outcome.kind === 'error') {
    r.output.append(errBox(outcome.error));
    if (outcome.clipped) r.output.append(text(_t('This error was cut short to fit in the history.'), 'muted'));
  } else if (outcome.kind === 'omitted') {
    r.output.append(text(outcome.reason === 'size'
      ? _t('Result too large to keep in history; the code and run details are kept.')
      : _t('Result could not be saved in history; the code and run details are kept.'), 'muted'));
    if (outcome.error) r.output.append(errBox(outcome.error));
    if (outcome.clipped) r.output.append(text(_t('This error was cut short to fit in the history.'), 'muted'));
  } else {
    r.output.append(loading());
    void resultView(outcome.result, entry.fmt, { lang: entry.lang, refreshed: entry.refreshed, snapshot: true })
      .then((nodes) => r.output.replaceChildren(...nodes))
      .catch((error: unknown) => r.output.replaceChildren(errBox(error)));
  }
  return r.root;
}
