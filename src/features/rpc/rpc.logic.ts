// RPC tab, pure part: recorded calls parsed for the log, answers parsed, requests turned into cURL commands for the
// version's external API (odoo/adapter.ts → ExternalApi). Tested by tests/unit/features/rpc/rpc.logic.test.ts.
import type { RawRpc } from '../../contracts/messages.ts';
import { _t } from '../../i18n/i18n.ts';
import type { ExternalApi, MethodSignature } from '../../odoo/adapter.ts';

/** An answer: the result, or the server error with its traceback and exception class ('network': no answer at all). */
export type RpcAnswer =
  | { result: unknown; error?: undefined; traceback?: undefined; errorType?: undefined }
  | { error: string; traceback?: string; errorType?: string; result?: undefined };

/** A row of the log. */
export type RpcEntry = {
  id?: string;
  /** unavailable is local: the page was replaced, not evidence of server failure/cancellation. */
  phase: 'pending' | 'complete' | 'unavailable';
  path: string;
  /** path + query: what Edit & Resend posts to */
  route: string;
  /** the request body as sent (cut at 200 KB by the recorder) */
  body: string;
  ms: number;
  status: number;
  at: string;
  model: string;
  method: string;
  args: unknown;
  kwargs: unknown;
  /** the recorder cut the request body / the answer (over CUT_AT): not JSON any more, shown as text */
  bodyCut: boolean;
  answerCut: boolean;
} & RpcAnswer;

/** What entrypoints/rpc-recorder keeps of a body or an answer. */
export const CUT_AT = 200_000;

export type RpcFilter = 'all' | 'pending' | 'slow' | 'errors';
export const SLOW_MS = 1000;

/** Wall time is available across page/panel contexts; completed durations retain the recorder's monotonic clock. */
export function elapsedRpc(e: RpcEntry, now = Date.now()): number {
  const start = Date.parse(e.at);
  return e.phase === 'pending' && Number.isFinite(start) ? Math.max(0, now - start) : e.ms;
}

export function matchesRpc(e: RpcEntry, query: string, filter: RpcFilter, now = Date.now()): boolean {
  return `${e.model} ${e.method}`.toLowerCase().includes(query.toLowerCase()) &&
    (filter === 'all' || (filter === 'pending' ? e.phase === 'pending' : filter === 'slow' ? elapsedRpc(e, now) >= SLOW_MS : e.error !== undefined));
}

/** Keeps row objects stable during completion. After Clear, only a seen start may complete: no tombstone growth. */
export class RpcLog {
  readonly entries: RpcEntry[] = [];
  private requireStart = false;
  private documentStart = 0;
  private observedAt = 0;
  private readonly max: number;
  constructor(max = 300) { this.max = max; }

  add(e: RpcEntry): RpcEntry | null {
    const old = e.id ? this.entries.find((x) => x.id === e.id) : undefined;
    if (old) {
      if (old.phase === 'complete' || e.phase === 'pending') return null;
      return Object.assign(old, e);
    }
    this.endObservation(e, this.observedAt);
    if (this.requireStart && e.id && e.phase !== 'pending') return null;
    this.entries.push(e);
    this.entries.sort((a, b) => a.at.localeCompare(b.at));
    if (this.entries.length > this.max && this.entries.shift() === e) return null;
    return e;
  }

  clear(): void { this.entries.length = 0; this.requireStart = true; }

  /** BFCache can restore an older origin. Compare request time to snapshot capture, not document age. */
  observeDocument(loadedAt: number, observedAt = Date.now()): RpcEntry[] {
    if (!Number.isFinite(loadedAt) || loadedAt <= 0 || !Number.isFinite(observedAt) || observedAt < this.observedAt) return [];
    this.documentStart = loadedAt;
    this.observedAt = observedAt;
    return this.entries.filter((e) => this.endObservation(e, observedAt));
  }

  private endObservation(e: RpcEntry, now: number): boolean {
    // The recorder's ID is performance.timeOrigin:documentNonce:sequence, shared with PageState.loadedAt.
    const origin = Number(e.id?.split(':')[0]);
    const start = Date.parse(e.at);
    // A same-millisecond/newer start may belong to a replacement page whose refresh is still in flight.
    if (e.phase !== 'pending' || !Number.isFinite(origin) || origin <= 0 || origin === this.documentStart ||
      !Number.isFinite(start) || start >= this.observedAt) return false;
    e.ms = elapsedRpc(e, now);
    e.phase = 'unavailable';
    return true;
  }
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Raw entry from the recorder → log entry (request + answer parsed), or null if it isn't an Odoo RPC. */
export function parseRpc(raw: RawRpc): RpcEntry | null {
  if (raw.method !== 'POST') return null;
  const u = new URL(raw.url);
  const path = u.pathname;
  let body: unknown = null;
  try { body = JSON.parse(raw.body || ''); } catch { /* not JSON, or cut by the recorder (> 200 KB) */ }
  const phase = raw.phase === 'pending' ? 'pending' as const : 'complete' as const;
  const answer: RpcAnswer = phase === 'pending' ? { result: undefined } : raw.error ? { error: raw.error, errorType: 'network' } : parseRpcResponse(raw.response ?? '', raw.status);
  const base = { id: typeof raw.id === 'string' ? raw.id : undefined, phase, path, route: path + u.search, body: raw.body, ms: raw.ms || 0, status: raw.status || 0, at: typeof raw.at === 'string' ? raw.at : '', ...answer,
    bodyCut: (raw.body?.length ?? 0) >= CUT_AT && body == null, answerCut: (raw.response?.length ?? 0) >= CUT_AT && typeof answer.result === 'string' };
  // A cut body can't be parsed: show its beginning, take model/method from the URL.
  const head = typeof raw.body === 'string' ? `${raw.body.slice(0, 2000)}…` : null;

  const j2 = path.match(/^\/json\/2\/([^/]+)\/([^/]+)/); // Odoo 19 JSON-2: named arguments, ids and context in one object
  if (j2) {
    if (!isObject(body)) return { ...base, model: j2[1]!, method: j2[2]!, args: head, kwargs: null };
    const { ids, ...named } = body;
    return { ...base, model: j2[1]!, method: j2[2]!, args: ids ?? null, kwargs: named };
  }

  const kw = path.match(/\/call_(?:kw|button)\/([^/]+)\/([^/]+)/);
  if (!isObject(body)) return kw ? { ...base, model: kw[1]!, method: kw[2]!, args: head, kwargs: null } : null;
  if (body.jsonrpc !== '2.0') return null;
  const p = isObject(body.params) ? body.params : {};
  if (typeof p.model === 'string' && typeof p.method === 'string') return { ...base, model: p.model, method: p.method, args: p.args, kwargs: p.kwargs };
  return { ...base, model: '', method: path, args: p, kwargs: null }; // other JSON routes: show raw params
}

/** Response body text → answer: JSON-RPC (result / error), JSON-2 (the value, or { name, message, debug } on 4xx/5xx). */
export function parseRpcResponse(text: string, status: number): RpcAnswer {
  let j: unknown;
  try { j = JSON.parse(text); } catch { return status >= 400 ? { error: `HTTP ${status}` } : { result: text }; }
  if (isObject(j) && j.jsonrpc) {
    const err = isObject(j.error) ? j.error : null;
    if (!err) return { result: j.result };
    const data = isObject(err.data) ? err.data : {};
    return { error: String(data.message ?? err.message ?? ''), traceback: data.debug as string | undefined, errorType: data.name as string | undefined };
  }
  if (status >= 400) { // JSON-2 error object (documentation/19.0 external_api → Response)
    const e = isObject(j) ? j : {};
    return { error: String(e.message ?? `HTTP ${status}`), traceback: e.debug as string | undefined, errorType: e.name as string | undefined };
  }
  return { result: j };
}

/** JSON text pretty-printed for editing; left as is when it isn't JSON (e.g. cut by the recorder). */
export function prettyJson(text: string | null | undefined): string {
  try { return JSON.stringify(JSON.parse(text ?? ''), null, 2); } catch { return text ?? ''; }
}

const isIdList = (v: unknown) => Array.isArray(v) && v.every((x) => Number.isInteger(x));

/**
 * call_kw arguments → a JSON-2 body: ids (unless @api.model), context, every argument named. Positional arguments are
 * named from `sig`; without a name they are kept as "__arg<n>__" and listed in `unnamed` (1-based positions). Unknown
 * signature: the first argument is taken as the ids when it is a list of integers, as call_kw does for a method that
 * isn't @api.model.
 */
export function json2Body(args: unknown, kwargs: unknown, sig: MethodSignature | null): { body: Record<string, unknown>; unnamed: number[] } {
  const list = Array.isArray(args) ? args : [];
  const { context, ...named } = isObject(kwargs) ? kwargs : {};
  const model = sig ? sig.model : !isIdList(list[0]);
  const body: Record<string, unknown> = {};
  if (!model) body.ids = list[0] ?? [];
  if (context !== undefined) body.context = context;
  const unnamed: number[] = [];
  (model ? list : list.slice(1)).forEach((v, i) => {
    const name = sig?.params[i];
    if (name) body[name] = v;
    else { unnamed.push(i + 1); body[`__arg${i + 1}__`] = v; }
  });
  return { body: { ...body, ...named }, unnamed };
}

/** The model and method a call_kw / call_button request targets (to look its signature up), else null. */
export function callTarget(route: string, body: string): { model: string; method: string } | null {
  if (!/^\/web\/dataset\/call_(kw|button)\b/.test(route)) return null;
  try {
    const p = (JSON.parse(body) as { params?: { model?: unknown; method?: unknown } })?.params;
    return typeof p?.model === 'string' && typeof p.method === 'string' ? { model: p.model, method: p.method } : null;
  } catch { return null; }
}

export interface CurlRequest {
  origin: string;
  /** path + query as sent */
  route: string;
  /** JSON text as sent */
  body: string;
  db?: string;
  uid?: number;
  api: ExternalApi;
  /** the method's signature (JSON-2 only), null when unknown */
  signature?: MethodSignature | null;
}

const sh = (s: string) => `'${s.replaceAll("'", "'\\''")}'`; // single-quoted for the shell
const command = (url: string, ...opts: string[]) => [`curl ${sh(url)}`, ...opts].join(' \\\n  ');

/**
 * A request as a cURL command for the external API, authenticated by an API key of the user in $ODOO_API_KEY (no
 * session to copy, works from anywhere):
 *   call_kw / call_button on 18 → /jsonrpc execute_kw (positional and keyword arguments as they are)
 *   call_kw / call_button on 19 → /json/2/<model>/<method> (named arguments, see json2Body)
 *   a JSON-2 call → itself, with the key
 * Any other route is kept as is, with the session cookie read from $ODOO_SESSION.
 * `warnings`: also written in the command, as shell comments above it.
 */
export function toCurl({ origin, route, body, db, uid, api, signature = null }: CurlRequest): { text: string; warnings: string[] } {
  let p: Record<string, unknown> | null = null;
  try { const j = JSON.parse(body) as { params?: unknown }; p = isObject(j?.params) ? j.params : null; } catch { /* not JSON: sent as is */ }
  const json = '-H \'Content-Type: application/json\'';
  const bearer = '--oauth2-bearer "$ODOO_API_KEY"';
  const database = db ? [`-H ${sh(`X-Odoo-Database: ${db}`)}`] : [];

  if (/^\/json\/2\//.test(route)) {
    return { text: command(origin + route, '-X POST', bearer, ...database, json, `-d ${sh(body)}`), warnings: [] };
  }
  if (p && typeof p.model === 'string' && typeof p.method === 'string' && /^\/web\/dataset\/call_(kw|button)\b/.test(route)) {
    if (api.kind === 'jsonrpc') {
      const data = JSON.stringify({ jsonrpc: '2.0', method: 'call', params: { service: 'object', method: 'execute_kw',
        args: [db, uid, '__ODOO_API_KEY__', p.model, p.method, p.args ?? [], p.kwargs ?? {}] } });
      return { text: command(`${origin}/jsonrpc`, json, `--data-raw ${sh(data).replace('"__ODOO_API_KEY__"', `"'"$ODOO_API_KEY"'"`)}`), warnings: [] };
    }
    const { body: named, unnamed } = json2Body(p.args, p.kwargs, signature);
    const warnings = [
      !signature && _t('Signature of %s.%s unknown: ids and argument names are guessed.', p.model, p.method),
      unnamed.length && _t('JSON-2 takes named arguments only: rename %s.', unnamed.map((n) => `"__arg${n}__"`).join(', ')),
    ].filter((w): w is string => !!w);
    const url = `${origin}/json/2/${p.model}/${p.method}`;
    const text = [...warnings.map((w) => `# ⚠ ${w}`), command(url, '-X POST', bearer, ...database, json, `-d ${sh(JSON.stringify(named))}`)].join('\n');
    return { text, warnings };
  }
  return { text: command(origin + route, json, '-b "session_id=$ODOO_SESSION"', `--data-raw ${sh(body)}`), warnings: [] };
}
