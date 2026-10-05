// Perf tab: what the tab keeps between renders, per Odoo: the session shown, the request opened, the baseline the
// others are compared with, the SQL already read. The collectors are kept as a form (ui/form-state.ts). Forgotten on
// ⟳ Reload Data.
import { formValues, saveForm } from '../../ui/form-state.ts';
import { COLLECTORS, readSamples, readSql, type Collector } from './perf.data.ts';
import type { Sample, SqlEntry } from './perf.logic.ts';

export interface PerfState {
  /** the session listed; null: the recording one, else the latest; 'all': every session */
  session: string | null;
  /** the request opened */
  selected: number | null;
  /** the request the others are compared with (before a fix) */
  baseline: number | null;
  sql: Map<number, Promise<SqlEntry[]>>;
  samples: Map<number, Promise<Sample[]>>;
  /** static files (scripts, images…) listed too */
  assets: boolean;
  /** a call the RPC tab handed, profiled: what came of it, shown once after the tab is drawn again */
  profiled: { label: string; text: string } | null;
}

const states = new Map<string, PerfState>();
export function stateOf(origin: string): PerfState {
  let s = states.get(origin);
  if (!s) states.set(origin, s = { session: null, selected: null, baseline: null, sql: new Map(), samples: new Map(), assets: false, profiled: null });
  return s;
}
export const forgetAll = () => states.clear();

/** A request's SQL, read once. */
export function sqlOf(s: PerfState, id: number): Promise<SqlEntry[]> {
  let p = s.sql.get(id);
  if (!p) { s.sql.set(id, p = readSql(id)); p.catch(() => s.sql.delete(id)); }
  return p;
}

/** A request's Python samples, read once (only when where its time goes is asked: they can be big). */
export function samplesOf(s: PerfState, id: number): Promise<Sample[]> {
  let p = s.samples.get(id);
  if (!p) { s.samples.set(id, p = readSamples(id)); p.catch(() => s.samples.delete(id)); }
  return p;
}

const FORM = 'perf';
/** The collectors chosen (SQL always), kept across reloads. */
export function collectors(): Collector[] {
  const saved = formValues<{ collectors: string[] }>(FORM).collectors ?? ['sql', 'traces_async'];
  return COLLECTORS.filter((c) => c === 'sql' || saved.includes(c));
}
export const keepCollectors = (cs: readonly Collector[]) => saveForm(FORM, { collectors: [...cs] });
