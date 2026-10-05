// Perf tab: what it reads from and writes to the server. Odoo's profiler (base/models/ir_profile.py and
// web/controllers/profiling.py, the same in 18.0 and 19.0 but for the columns and speedscope: odoo/adapter.ts):
// /web/set_profiling switches it for the session (cookie): every request of the session then writes one ir.profile row,
// named after its path, the panel's own reads too. Settings rights (base.group_system).
import { exec, isExecError } from '../../extension/run-in-tab.ts';
import { pageSend } from '../../injected/json-rpc.ts';
import { _t } from '../../i18n/i18n.ts';
import type { Json } from '../../contracts/json.ts';
import type { OdooAdapter } from '../../odoo/adapter.ts';
import { call, rpc } from '../../odoo/rpc.ts';
import { pageGet } from './perf.injected.ts';
import { parseSamples, parseSql, type ProfileRow, type Sample, type SqlEntry } from './perf.logic.ts';

/** Profiling is not allowed on the database (base.profiling_enabled_until passed or unset): allowProfiling() first. */
export class NotAllowedError extends Error {
  constructor() { super(_t('Profiling is not allowed on this database: allow it first.')); this.name = 'NotAllowedError'; }
}

/** The collectors the profiler can run: SQL always; Python stacks (sampled, cheap) and QWeb on request. traces_sync
 * (every call, slow) is left out: the sampled stacks answer the same question. */
export const COLLECTORS = ['sql', 'traces_async', 'qweb'] as const;
export type Collector = (typeof COLLECTORS)[number];

/** The session's profiling: its profile session ("<date time> <user>", null: off) and collectors. Read fresh (it
 * changes with Start / Stop; the cached session info would be stale). */
export const profilingState = () => rpc<{ profile_session?: string | null }>('/web/session/get_session_info', {}).then((i) => i.profile_session ?? null);

/** Until when profiling is allowed on the database (ir.config_parameter base.profiling_enabled_until), null: not. */
export async function enabledUntil(a: OdooAdapter): Promise<string | null> {
  const v = await call<string | false>('ir.config_parameter', a.profiler.paramGetter, ['base.profiling_enabled_until', '']);
  return v && v > new Date().toISOString().replace('T', ' ').slice(0, 19) ? v : null;
}

/** Odoo's own wizard: profiling allowed on the database for `duration` (writes base.profiling_enabled_until). */
export async function allowProfiling(duration: 'minutes_5' | 'hours_1' | 'days_1') {
  const id = await call<number>('base.enable.profiling.wizard', 'create', [{ duration }]);
  await call('base.enable.profiling.wizard', 'submit', [[id]]);
}

/** /web/set_profiling: on (with these collectors) or off. → the profile session, or 'not-allowed' when the database
 * doesn't allow it (Odoo answers with its "enable profiling" wizard). */
export async function setProfiling(on: boolean, collectors: readonly Collector[] = ['sql', 'traces_async']): Promise<string | null | 'not-allowed'> {
  const r = await exec(pageGet, `/web/set_profiling?profile=${on ? 1 : 0}&collectors=${collectors.join(',')}`);
  if (!r || isExecError(r)) throw new Error(r?.error || _t('Cannot call /web/set_profiling'));
  if (r.status !== 200) throw new Error(r.text.replace(/^error: /, '') || `HTTP ${r.status}`);
  const st = JSON.parse(r.text) as { session?: string | null; type?: string };
  return st.type ? 'not-allowed' : st.session ?? null;
}

/** The profiled requests, newest first: of `session`, or of every session. */
export const readProfiles = (a: OdooAdapter, session: string | null, limit = 200) =>
  call<ProfileRow[]>('ir.profile', 'search_read', [session ? [['session', '=', session]] : []], { fields: [...a.profiler.listFields], limit, order: 'id desc' });

/** The sessions that profiled something, with how many requests each (newest first). */
export async function readSessions(a: OdooAdapter): Promise<{ session: string; count: number }[]> {
  const rows = await (a.orm.groupMethod === 'formatted_read_group'
    ? call<{ session: string | false; session_count?: number; __count?: number }[]>('ir.profile', 'formatted_read_group', [[], ['session'], ['__count']], { order: 'session desc' })
    : call<{ session: string | false; session_count?: number; __count?: number }[]>('ir.profile', 'read_group',
      [[], ['session'], ['session']], { orderby: 'session desc', lazy: true }));
  return rows.flatMap((r) => (r.session ? [{ session: r.session, count: r.session_count ?? r.__count ?? 0 }] : []));
}

/** One request's SQL entries (ir.profile.sql: JSON, read on demand). */
export async function readSql(id: number): Promise<SqlEntry[]> {
  const [r] = await call<{ sql: string | false }[]>('ir.profile', 'read', [[id], ['sql']]);
  return parseSql(r?.sql);
}

/** One request's Python samples (ir.profile.traces_async: JSON, read on demand; [] when not collected). */
export async function readSamples(id: number): Promise<Sample[]> {
  const [r] = await call<{ traces_async: string | false }[]>('ir.profile', 'read', [[id], ['traces_async']]);
  return parseSamples(r?.traces_async);
}

export const deleteProfiles = (ids: readonly number[]) => call('ir.profile', 'unlink', [[...ids]]);
export const profileIdsOf = (domain: Json[]) => call<number[]>('ir.profile', 'search', [domain]);

/** The speedscope flame graph of these profiles (19.0: several side by side). */
export const speedscopeUrl = (origin: string, ids: readonly number[]) => `${origin}/web/speedscope/${ids.join(',')}`;

/**
 * Sends `body` to `route` again with the profiler on, and finds the profile it wrote: profiling switched on just for it
 * (back off after, unless it was on already), the call posted with the page's session, then the newest profile of the
 * session named after the route. → the profile, and the call's answer (HTTP status, ms).
 */
export async function profileCall(route: string, body: string, collectors: readonly Collector[]): Promise<{ row: ProfileRow | null; status: number; ms: number; session: string }> {
  const was = await profilingState();
  const session = was ?? await setProfiling(true, collectors);
  if (session === 'not-allowed' || !session) throw new NotAllowedError();
  try {
    // the newest profile before sending: the page's own call of that route may be profiled too (profiling already on)
    const [last] = await call<number[]>('ir.profile', 'search', [[]], { limit: 1, order: 'id desc' });
    const r = await exec(pageSend, route, body);
    if (!r || isExecError(r)) throw new Error(r?.error || _t('No response — is this an Odoo page?'));
    const rows = await call<ProfileRow[]>('ir.profile', 'search_read', [[['session', '=', session], ['name', '=like', `${route}%`], ['id', '>', last ?? 0]]],
      { fields: ['name', 'session', 'duration', 'sql_count', 'create_date'], limit: 1, order: 'id desc' });
    return { row: rows[0] ?? null, status: r.status, ms: r.ms, session };
  } finally {
    if (!was) await setProfiling(false).catch(() => null);
  }
}
