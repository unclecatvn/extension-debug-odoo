// Perf tab, the request opened beside the list (wide panel) or under its row: its name, when, its tools (flame graph,
// baseline, delete); its totals (queries, SQL time, total, Python ≈ the rest, CPU on 19.0); what to look at first (N+1,
// the database, Python, or nothing: perf.logic.ts → diagnose) and the time split SQL / Python; against the baseline when
// one is set (before / after a fix: counts, durations, the repeated statements gone, new, still there); then:
//   By code         the functions of the modules the time went to (Python samples + the SQL they ran)
//   Lines of code   the lines of the addons sending the most queries (the frame under the ORM): where to fix
//   Repeated        the statements run more than once, the most first: N+1 suspects, and which lines run them
//   Slowest         the queries that took longest
// A query says what it does ("Reads res_partner") and opens as run (its values in) with its stack; code shows as
// function() module/path.py:line, which a click copies.
import { N_, _t } from '../../i18n/i18n.ts';
import type { OdooAdapter } from '../../odoo/adapter.ts';
import { call } from '../../odoo/rpc.ts';
import { copyable, pill } from '../../ui/components.ts';
import { matrix, type MxRow } from '../../ui/matrix.ts';
import { frag, note } from '../../ui/parts.ts';
import { deleteProfiles, speedscopeUrl } from './perf.data.ts';
import {
  appFrame, callerOf, compare, delta, describeQuery, diagnose, FRAMEWORK_CALLER, frameText, hotspots, ms, normalizeQuery, requestName, shortFile, sqlSummary,
  type Frame, type Hotspot, type ProfileRow, type SqlEntry, type SqlSummary,
} from './perf.logic.ts';
import { samplesOf, sqlOf, type PerfState } from './perf.state.ts';
import { box, button, fold, link, queryDetail, text, total, tpl } from './perf.ui.ts';

/** Over this many queries a request is worth a look (the RPC tab and the list mark it). */
export const MANY_SQL = 50;

export interface RequestEnv {
  s: PerfState;
  a: OdooAdapter;
  origin: string;
  /** whether profiling is allowed on the database now (18.0's flame graph needs it) */
  allowed: boolean;
  rows: ReadonlyMap<number, ProfileRow>;
  rerender(): void;
}

/** The name of a request: method and model for a call_kw, else its route. */
export function nameNodes(name: string): Node[] {
  const n = requestName(name);
  return 'method' in n ? [text(n.method, 'name'), text(` ${n.model}`, 'muted')] : [text(n.route, 'name mono')];
}

export async function requestDetail(r: ProfileRow, e: RequestEnv): Promise<Node> {
  const entries = await sqlOf(e.s, r.id);
  const sum = sqlSummary(entries);
  const h = tpl('req-head', { box: HTMLDivElement, name: HTMLHeadingElement, meta: HTMLDivElement, actions: HTMLDivElement, totals: HTMLDivElement }).refs;
  h.name.append(...nameNodes(r.name));
  h.meta.textContent = [`#${r.id}`, r.create_date ? r.create_date.slice(11, 19) : '', r.session, r.name].filter(Boolean).join(' · ');

  const isBase = e.s.baseline === r.id;
  const flame = link(_t('Flame Graph ↗'), speedscopeUrl(e.origin, [r.id]),
    e.a.profiler.speedscopeNeedsEnabled && !e.allowed ? _t('Odoo 18 shows it only while profiling is allowed on the database') : _t('Odoo\'s speedscope view of this request'));
  h.actions.append(flame,
    button(isBase ? _t('Baseline ✓') : _t('Set as Baseline'), () => { e.s.baseline = isBase ? null : r.id; e.rerender(); }, 'chip',
      isBase ? _t('Stop comparing with this request') : _t('Compare the other requests with this one (before a fix)')));
  if (e.s.baseline != null && !isBase && e.a.profiler.speedscopeMany) {
    h.actions.append(link(_t('Side by Side ↗'), speedscopeUrl(e.origin, [e.s.baseline, r.id]), _t('Both flame graphs in speedscope')));
  }
  h.actions.append(button(_t('Delete'), () => {
    if (!confirm(_t('Delete this profile (#%s)?', r.id))) return;
    void deleteProfiles([r.id]).then(() => { if (e.s.selected === r.id) e.s.selected = null; if (isBase) e.s.baseline = null; e.rerender(); });
  }, 'chip', _t('Delete this ir.profile record')));

  const python = Math.max(0, r.duration - sum.time);
  h.totals.append(
    total(String(r.sql_count || sum.count), _t('queries'), _t('SQL queries of the request')),
    total(ms(sum.time), _t('in SQL'), _t('Time spent in the database')),
    total(ms(r.duration), _t('total'), _t('Real time of the request on the server')),
    total(`≈ ${ms(python)}`, _t('Python'), _t('The rest: Python, waiting, and the profiler itself')),
    ...(r.cpu_duration !== undefined ? [total(ms(r.cpu_duration), 'CPU', _t('CPU time of the server process (Odoo 19)'))] : []));

  const parts: Node[] = [h.box, diagnosis(r, sum), split(r.duration, sum.time)];
  if (e.s.baseline != null && !isBase) parts.push(await comparison(r, sum, e));
  parts.push(fold('bycode', _t('By code: where the time goes'), '', () => byCode(r, entries, e), true));
  if (!entries.length) parts.push(note(_t('No SQL recorded for this request (the SQL collector was off?).')));
  else {
    parts.push(fold('callers', _t('Lines of code sending queries'), String(sum.callers.length), () => callersTable(entries, sum), true));
    parts.push(fold('repeated', _t('Repeated queries: N+1 suspects'), String(sum.repeated.length), () => (sum.repeated.length
      ? frag(matrix(_t('Statement'), [_t('Runs'), _t('Time')], [{ rows: sum.repeated.map((g): MxRow => ({
        label: [querySays(g.query)], sub: g.callers.map((x) => (x === FRAMEWORK_CALLER ? _t('Odoo itself') : x)).join(' · '), q: g.query,
        cells: [pill(`${g.count}×`, g.count >= 5 ? 'err' : 'med'), ms(g.time)], detail: () => queryDetail(g.first),
      })) }], -1), note(_t('The same SQL sent several times. If the count matches the records shown (10 records → 10×), it is an N+1: one query could read them all.')))
      : note(_t('✓ No statement runs twice.'))), true));
    const slowest = sum.slowest[0]?.time ?? 0;
    parts.push(fold('slowest', _t('Slowest queries'), String(sum.slowest.length), () => frag(matrix(_t('Statement'), [_t('Time')], [{
      rows: sum.slowest.map((x): MxRow => ({ label: [querySays(x.query)], sub: frameText(appFrame(x.stack)), q: normalizeQuery(x.query), cells: [ms(x.time)], detail: () => queryDetail(x) })),
    }], -1), note(slowest < 0.01
      ? _t('✓ No slow query (the slowest took %s): the database is not the problem here.', ms(slowest))
      : _t('The slowest took %s. Check that its filter and join columns are indexed and it reads no more rows than needed.', ms(slowest))))));
  }
  return box(...parts);
}

/** _t(msgid) with nodes (code…) in place of its %s. */
function tNodes(msgid: string, ...nodes: (Node | null)[]): (Node | string)[] {
  const parts = _t(msgid, ...nodes.map(() => '\0')).split('\0');
  return parts.flatMap((t, i) => (i < nodes.length && nodes[i] ? [t, nodes[i]!] : [t]));
}

/** A frame as code: function() then module/path.py:line, which a click copies (for the editor's Go to File). */
function codeRef(f: Frame | null): HTMLElement | null {
  if (!f) return null;
  const at = `${shortFile(f[0])}:${f[1]}`;
  return copyable(at, 'perf-loc', `${f[2]}() ${at}`);
}
/** The source line of a frame, as the profiler recorded it. */
function codeLine(f: Frame | null): HTMLElement | null {
  const src = f?.[3]?.trim();
  if (!src) return null;
  const { pre } = tpl('code-line', { pre: HTMLPreElement }).refs;
  pre.textContent = src;
  return pre;
}

const OPS = { read: N_('Reads %s'), create: N_('Creates in %s'), write: N_('Updates %s'), delete: N_('Deletes from %s') };
/** What a query does, in words: "Reads res_partner"; its SQL shows when the row is opened. */
function querySays(query: string): HTMLElement {
  const { op, table } = describeQuery(query);
  if (op === 'other' || !table) return text(_t('Runs a SQL query'));
  const r = tpl('says', { box: HTMLSpanElement, before: HTMLSpanElement, table: HTMLElement, after: HTMLSpanElement }).refs;
  const [before = '', after = ''] = _t(OPS[op], '\0').split('\0');
  r.before.textContent = before;
  r.table.textContent = table;
  r.after.textContent = after;
  return r.box;
}

/** What to look at first: N+1 (and the line running the statement), the database, Python, or nothing. */
function diagnosis(r: ProfileRow, sum: SqlSummary): HTMLElement {
  const python = Math.max(0, r.duration - sum.time);
  const kind = diagnose(r.duration, sum);
  const at = appFrame(sum.repeated[0]?.first.stack);
  const [tone, title, advice]: [string, string, (Node | string | null)[]] = {
    n1: ['err', _t('N+1: one query runs %s× in this request', sum.repeated[0]?.count ?? 0),
      [...tNodes(N_('%s runs it once per record: read them all at once (recordset, mapped(), read_group…).'), codeRef(at)), codeLine(at)]],
    sql: ['med', _t('Most of the time is in the database (%s of %s)', ms(sum.time), ms(r.duration)),
      [_t('See the slowest queries below: a missing index, a large join, a search on a non-stored field…')]],
    python: ['info', _t('Most of the time is in Python (≈ %s of %s)', ms(python), ms(r.duration)),
      [_t('Not the SQL: see which code takes the time below, or the Flame Graph.')]],
    fast: ['ok', _t('✓ Fast request (%s)', ms(r.duration)), [_t('Nothing to optimise here.')]],
  }[kind] as [string, string, (Node | string | null)[]];
  const d = tpl('diag', { box: HTMLDivElement, title: HTMLElement, advice: HTMLDivElement }).refs;
  d.box.classList.add(tone);
  d.title.textContent = title;
  d.advice.append(...advice.filter((x): x is Node | string => !!x));
  return d.box;
}

/** The request's time: SQL, then Python ≈ the rest, as a bar. */
function split(duration: number, sqlTime: number): HTMLElement {
  const python = Math.max(0, duration - sqlTime);
  const pct = (t: number) => `${(t / (duration || 1)) * 100}%`;
  const s = tpl('split', { row: HTMLDivElement, sql: HTMLSpanElement, bar: HTMLSpanElement, sqlBar: HTMLElement, pyBar: HTMLElement, py: HTMLSpanElement }).refs;
  s.sql.textContent = _t('SQL %s', ms(sqlTime));
  s.py.textContent = _t('Python ≈ %s', ms(python));
  s.sqlBar.style.width = pct(Math.min(sqlTime, duration));
  s.pyBar.style.width = pct(python);
  s.bar.setAttribute('aria-label', _t('SQL %s, Python ≈ %s', ms(sqlTime), ms(python)));
  return s.row;
}

/** Where the time goes, per function of the modules (outside the ORM and the server): the Python samples, read now. */
async function byCode(r: ProfileRow, entries: readonly SqlEntry[], e: RequestEnv): Promise<Node> {
  const samples = await samplesOf(e.s, r.id);
  const spots = hotspots(samples, entries);
  const intro = note(spots.length
    ? _t('Module functions (outside the ORM and server) taking the time, their SQL included. Sampled every ~10 ms: approximate.')
    : samples.length ? _t('No time in the modules\' code: the server itself (routing, ORM) took it.')
      : _t('No Python samples: turn on Python stacks (Collect) and record it again.'));
  if (!spots.length) return intro;
  return frag(matrix(_t('Function'), [_t('Time'), 'SQL'], [{ rows: spots.map((h): MxRow => ({
    label: [codeRef(h.frame)!],
    sub: h.count ? _t('≈ %s in Python, %s in %s SQL queries', ms(Math.max(0, h.time - h.sql)), ms(h.sql), h.count) : _t('≈ %s in Python, no SQL', ms(h.time)),
    q: frameText(h.frame),
    cells: [ms(h.time), h.count ? `${h.count}×` : '—'],
    detail: () => hotDetail(h),
  })) }], -1), intro);
}

/** A function opened: its line of code, the module functions that called it (innermost first). */
function hotDetail(h: Hotspot): HTMLElement {
  const d = tpl('hot-detail', { box: HTMLDivElement, calls: HTMLDivElement }).refs;
  const line = codeLine(h.frame);
  if (line) d.box.prepend(line);
  const callers = h.path.slice(-3).reverse().map(codeRef).filter((x): x is HTMLElement => !!x);
  if (callers.length) d.calls.append(text(_t('Called by'), 'muted'), ...callers);
  else d.calls.remove();
  return d.box;
}

/** The lines of code sending queries: how many, how many statements, how long; a line opens its statements. */
function callersTable(entries: readonly SqlEntry[], sum: SqlSummary): Node {
  return frag(
    matrix(_t('Line of code'), [_t('Queries'), _t('Statements'), _t('Time')], [{ rows: sum.callers.map((c): MxRow => ({
      label: [c.caller === FRAMEWORK_CALLER || !c.frame ? text(_t('Odoo itself (no addon line in the stack)'), 'muted') : codeRef(c.frame)!], q: c.caller,
      cells: [c.count >= 20 ? pill(String(c.count), c.count >= 100 ? 'err' : 'med') : String(c.count), String(c.queries), ms(c.time)],
      detail: () => {
        const mine = entries.filter((x) => callerOf(x.stack) === c.caller);
        const groups = new Map<string, { n: number; first: SqlEntry }>();
        for (const x of mine) { const k = normalizeQuery(x.query); const g = groups.get(k); if (g) g.n++; else groups.set(k, { n: 1, first: x }); }
        return matrix(_t('Statement'), [_t('Runs')], [{ rows: [...groups].sort((a, b) => b[1].n - a[1].n).map(([q, g]): MxRow => ({
          label: [querySays(q)], q, cells: [`${g.n}×`], detail: () => queryDetail(g.first),
        })) }], -1);
      },
    })) }], -1),
    note(_t('The addon line (just under the ORM) that sent the queries. Many queries, one statement repeated: a record-by-record loop (N+1).')));
}

/** This request against the baseline: counts and durations, then the repeated statements gone, new, still there. */
async function comparison(r: ProfileRow, sum: SqlSummary, e: RequestEnv): Promise<Node> {
  const baseId = e.s.baseline!;
  const baseRow = e.rows.get(baseId) ?? (await call<ProfileRow[]>('ir.profile', 'read', [[baseId], [...e.a.profiler.listFields]]))[0];
  if (!baseRow) { e.s.baseline = null; return note(_t('The baseline was deleted.')); }
  const c = compare({ row: baseRow, sum: sqlSummary(await sqlOf(e.s, baseId)) }, { row: r, sum });
  const better = (a: number, b: number) => (b < a ? 'ok' : b > a ? 'err' : '');
  const line = (label: string, [a, b]: [number, number], fmt: (x: number) => string): MxRow => ({
    label: [label], cells: [fmt(a), fmt(b), pill(delta(a, b, fmt), better(a, b))],
  });
  const groups: Node[] = [];
  if (c.gone.length) groups.push(text(_t('✓ Gone: %s', c.gone.map((g) => `${g.count}× ${g.query.slice(0, 60)}`).join(' · ')), 'ok-text'));
  if (c.added.length) groups.push(text(_t('✗ New: %s', c.added.map((g) => `${g.count}× ${g.query.slice(0, 60)}`).join(' · ')), 'err-text'));
  for (const k of c.kept) if (k.before !== k.after) groups.push(text(_t('%s× → %s×: %s', k.before, k.after, k.query.slice(0, 80)), 'muted'));
  const head = box(text(_t('Against the baseline #%s', baseId), 'strong'), ' ', ...nameNodes(baseRow.name));
  head.className = 'row';
  return box(head,
    matrix('', [_t('Baseline'), _t('This one'), _t('Change')], [{ rows: [
      line(_t('Queries'), c.sql, String), line(_t('Total'), c.duration, ms), line(_t('In SQL'), c.sqlTime, ms),
    ] }], -1),
    ...(groups.length ? groups : [note(_t('Same repeated statements as the baseline.'))]));
}
