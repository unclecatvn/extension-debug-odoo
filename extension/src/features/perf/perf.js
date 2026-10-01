// Perf tab: Odoo's built-in server profiler (/web/set_profiling → ir.profile rows), read back per request.
import { sqlSummary, appFrame, isAsset, diagnose, shortPath, describeQuery, hotspots } from './logic.js';
import { pageFetch } from '../../shared/page.js';
import { execOrThrow, rpc, call, fieldsOf } from '../../shared/bridge.js';
import { localTime } from '../../shared/odoo.js';
import { el, pre, pill, details, empty, card, errBox, expandable, filterBox, masterDetail, copyable } from '../../shared/ui.js';
import { _t, N_ } from '../../shared/i18n.js';

const COLLECTORS = 'sql,traces_async';
const ms = (s) => `${Math.round((s || 0) * 1000)} ms`;

async function setProfiling(on) {
  const r = await execOrThrow(pageFetch, N_('Cannot call /web/set_profiling'), `/web/set_profiling?profile=${on ? 1 : 0}&collectors=${COLLECTORS}`);
  if (r.status !== 200) throw new Error(r.text.replace(/^error: /, '') || `HTTP ${r.status}`);
  return JSON.parse(r.text);
}

async function enable() {
  let st = await setProfiling(true);
  if (st.type) { // an ir.actions.act_window = Odoo's "enable profiling for…" wizard: not enabled on this database yet
    if (!confirm(_t('Profiling is not enabled on this database.\nEnable it for 5 minutes? (writes ir.config_parameter base.profiling_enabled_until)'))) return;
    const [id] = await call('base.enable.profiling.wizard', 'create', [[{ duration: 'minutes_5' }]]);
    await call('base.enable.profiling.wizard', 'submit', [[id]]);
    st = await setProfiling(true);
    if (st.type) throw new Error(_t('Profiling could not be enabled.'));
  }
}

export function renderPerf(s, state) {
  const rerender = () => { s.replaceChildren(); renderPerf(s, state); };

  // One card: the recording switch on top, the requests it recorded below.
  card(s, async () => { // the tab's only card: no title to open it by
    // not sessionInfo(): profile_session changes with the button
    const { profile_session: session } = await rpc('/web/session/get_session_info', {});
    const btn = el('button', {
      class: session ? 'btn sm' : 'btn solid',
      onclick: async () => {
        btn.disabled = true;
        try { session ? await setProfiling(false) : await enable(); rerender(); } catch (e) { btn.disabled = false; head.after(errBox(e)); }
      },
    }, session ? _t('Stop Profiling') : _t('Start Profiling'));
    const head = session
      ? el('div', { class: 'pad row perf-head' },
        pill(_t('RECORDING'), 'ok'),
        el('span', { class: 'grow muted', title: session }, _t('since %s', localTime(session))),
        el('button', { class: 'btn sm', onclick: rerender }, _t('⟳ Refresh List')), btn)
      : el('div', { class: 'pad perf-intro' },
        el('h4', {}, _t('Find out why a screen is slow')),
        el('ol', {},
          el('li', {}, _t('Start profiling (Odoo\'s built-in profiler, administrators only).')),
          el('li', {}, _t('Do the slow action on the Odoo page: open the record, save, confirm…')),
          el('li', {}, _t('Come back and refresh: the requests show slowest first; click one to see why it is slow.'))),
        el('div', { class: 'row' }, btn, el('span', { class: 'muted' }, _t('Profiling slows Odoo down a little: stop it when you are done.'))));
    const list = await requests(session, state, rerender);
    // off: the last session's requests stay one click away, under the steps
    return el('div', {}, head, session || !list.rows ? list : details(_t('Previous Session (%s requests)', list.rows), list));
  });
}

// The panel's own requests: reading the profiles, and the session info (the webclient never asks for it: it is in the page).
const OWN = ['/ir.profile/', '/web/session/get_session_info'];

/** The profiled requests of `session` (else of the latest one), slowest first, without the panel's own nor (unless
 * asked) the static files. → an element, its `rows` count on it. */
async function requests(session, state, rerender) {
  const known = await fieldsOf('ir.profile');
  const all = (await call('ir.profile', 'search_read', [session ? [['session', '=', session]] : []],
    { fields: ['name', 'session', 'duration', 'cpu_duration', 'sql_count', 'create_date'].filter((f) => f in known), limit: 100 })) // cpu_duration: 19+ only
    .filter((r) => !OWN.some((own) => r.name.includes(own)));
  const assets = all.filter((r) => isAsset(r.name)).length;
  const rows = (state.perfAssets ? all : all.filter((r) => !isAsset(r.name))).sort((a, b) => b.duration - a.duration);
  const toggle = assets ? el('button', { class: 'chip', 'aria-pressed': String(!!state.perfAssets), title: _t('Scripts, images, manifest…: nothing to optimise in a module'),
    onclick: () => { state.perfAssets = !state.perfAssets; rerender(); } }, _t('Static Files (%s)', assets)) : null;
  if (!rows.length) return el('div', { class: 'pad-bottom' }, empty(session ? _t('No request yet: do the slow action on the Odoo page, then press ⟳ Refresh List.') : _t('No profile data yet.')), toggle);
  const max = rows[0].duration || 1;
  const items = rows.map((r) => profileItem(r, max, state.origin));
  const ul = el('ul', { class: 'list' }, items);
  return Object.assign(el('div', {},
    el('div', { class: 'toolbar' }, filterBox(items, _t('Filter %s requests', rows.length)), toggle),
    masterDetail(ul, _t('Click a request to see where its time goes.'))), { rows: rows.length });
}

/** "/web/dataset/call_kw/res.users/web_read" → method + model, like the RPC tab; any other route as it is. */
function requestName(name) {
  const m = /\/web\/dataset\/call_kw\/([^/?]+)\/([^/?]+)/.exec(name);
  return m ? [el('span', { class: 'name' }, m[2]), el('span', { class: 'muted' }, m[1])] : [el('span', { class: 'name' }, name.replace(/\?$/, ''))];
}

const slowness = (s) => (s >= 1 ? 'err' : s >= 0.3 ? 'med' : '');

/** A request: its name, SQL count and duration on one line, a bar against the slowest one under it. */
function profileItem(r, max, origin) {
  const li = el('li', { title: [`#${r.id}`, localTime(r.create_date), 'cpu_duration' in r && `CPU ${ms(r.cpu_duration)}`].filter(Boolean).join(' · ') },
    el('div', { class: 'row' }, el('span', { class: 'row grow' }, requestName(r.name)),
      el('span', { class: `ms${r.sql_count > 50 ? ' bad' : ''}` }, _t('%s SQL', r.sql_count)),
      el('span', { class: `ms dur ${slowness(r.duration)}` }, ms(r.duration)),
      el('span', { class: `perf-bar ${slowness(r.duration)}` }, el('i', { style: `width:${Math.max(1, (r.duration / max) * 100)}%` }))));
  li.dataset.q = r.name.toLowerCase();
  return expandable(li, async () => sqlDetail(r, origin, await call('ir.profile', 'read', [[r.id], ['sql', 'traces_async']])));
}

const json = (text) => { try { return JSON.parse(text || '[]'); } catch { return []; } };

/** _t(msgid) with nodes (code…) in place of its %s, as a list of children for el(). */
function tNodes(msgid, ...nodes) {
  const parts = _t(msgid, ...nodes.map(() => '\0')).split('\0');
  return parts.flatMap((t, i) => (i < nodes.length ? [t, nodes[i]] : [t]));
}

/** A frame of the profiler's stacks, as code: function() then module/path.py:line, which a click copies (for the editor). */
function codeRef(f) {
  if (!f) return null;
  const at = `${shortPath(f[0])}:${f[1]}`;
  return copyable(at, 'loc', [el('b', {}, `${f[2]}()`), ' ', at]);
}
/** The source line of a frame (the profiler records it), as code. */
const codeLine = (f) => (f?.[3]?.trim() ? el('pre', { class: 'code-line' }, f[3].trim()) : null);

const OPS = { read: N_('Reads %s'), create: N_('Creates in %s'), write: N_('Updates %s'), delete: N_('Deletes from %s') };
/** What a query does, in words: "Reads res_partner". */
function querySays(query) {
  const { op, table: t } = describeQuery(query);
  return el('span', { class: 'says' }, OPS[op] && t ? tNodes(OPS[op], el('code', {}, t)) : _t('Runs a SQL query'));
}

/** A row of a request's detail: `main` and its time on the first line, `sub` (muted) under it; open: `more`. */
const line = (main, time, sub, ...more) => expandable(el('li', {},
  el('div', { class: 'row' }, el('span', { class: 'grow row' }, main), el('span', { class: 'ms' }, ms(time)), el('div', { class: 'sub' }, sub)), ...more));

/** A query: what it does (how many times), the code that ran it; open: that code line, the SQL. */
function queryRow(e, count) {
  const f = appFrame(e.stack);
  return line([count ? pill(`${count}×`, count >= 5 ? 'err' : 'med') : null, querySays(e.query)], e.time, codeRef(f),
    codeLine(f),
    details(_t('SQL + Full Stack'), pre(e.full_query || e.query),
      e.stack?.length ? pre(e.stack.map((x) => `${shortPath(x[0])}:${x[1]} ${x[2]}()`).join('\n')) : null));
}

/** A function of the modules the request spent time in; open: its code line, its callers. */
function hotRow(h) {
  return line(codeRef(h.frame), h.time,
    h.count ? _t('≈ %s in Python, %s in %s SQL queries', ms(Math.max(0, h.time - h.sql)), ms(h.sql), h.count) : _t('≈ %s in Python, no SQL', ms(h.time)),
    codeLine(h.frame),
    h.path.length ? el('div', { class: 'meta calls' }, _t('Called by'), h.path.slice(-3).reverse().map(codeRef)) : null);
}

/** Views side by side, one shown at a time: [label, node] pairs, `on` the index shown first. */
function views(pairs, on) {
  const btns = pairs.map(([label], i) => el('button', { type: 'button', onclick: () => show(i) }, label));
  const show = (i) => pairs.forEach(([, node], j) => { node.hidden = i !== j; btns[j].classList.toggle('on', i === j); });
  show(on);
  return [el('div', { class: 'seg' }, btns), ...pairs.map(([, node]) => node)];
}

/** A request's diagnosis: what to look at first, where its time goes (SQL / Python), then by code, repeated or slowest query. */
function sqlDetail(r, origin, [p]) {
  const entries = json(p?.sql), samples = json(p?.traces_async);
  const flame = el('a', { class: 'btn sm', href: `${origin}/web/speedscope/${r.id}`, target: '_blank', rel: 'noopener',
    title: _t('Every Python function of the request and the time it took (speedscope)') }, _t('Flame Graph ↗'));
  if (!entries.length && !samples.length) return el('div', {}, el('div', { class: 'row' }, el('span', { class: 'grow' }), flame), empty(_t('Nothing recorded.')));
  const sum = sqlSummary(entries);
  const py = Math.max(0, r.duration - sum.time), pct = (t) => `${(t / (r.duration || 1)) * 100}%`;
  const kind = diagnose(r.duration, sum);
  const n1 = sum.dups[0];
  const [tone, title, advice] = {
    n1: ['err', _t('N+1: one query runs %s× in this request', n1?.count),
      [...tNodes(N_('%s runs it once per record: read them all at once instead (a recordset, mapped(), read_group…).'), codeRef(appFrame(n1?.first.stack))), codeLine(appFrame(n1?.first.stack))]],
    sql: ['med', _t('Most of the time is in the database (%s of %s)', ms(sum.time), ms(r.duration)), [_t('See the slowest queries below: a missing index, a large join, a search on a non-stored field…')]],
    python: ['info', _t('Most of the time is in Python (≈ %s of %s)', ms(py), ms(r.duration)), [_t('The SQL is not the problem: see which code takes the time below, or every function in the Flame Graph.')]],
    fast: ['ok', _t('✓ Fast request (%s)', ms(r.duration)), [_t('Nothing to optimise here.')]],
  }[kind];

  const spots = hotspots(samples, entries);
  const slowest = sum.slow[0]?.time || 0;
  const tab = (intro, rows) => el('div', { class: 'perf-view' }, intro, rows?.length ? el('ul', { class: 'list' }, rows) : null);
  return el('div', { class: 'perf-detail' },
    el('div', { class: `diag ${tone}` }, el('strong', {}, title), el('div', {}, advice)),
    el('div', { class: 'row perf-time' },
      el('span', { class: 'key sql' }, _t('SQL %s', ms(sum.time))),
      el('span', { class: 'perf-split grow', role: 'img', 'aria-label': _t('SQL %s, Python ≈ %s', ms(sum.time), ms(py)) },
        el('i', { class: 'sql', style: `width:${pct(sum.time)}` }), el('i', { class: 'py', style: `width:${pct(py)}` })),
      el('span', { class: 'key py' }, _t('Python ≈ %s', ms(py))), flame),
    ...views([
      [_t('By Code'), tab(el('div', { class: 'note' }, spots.length
        ? _t('The functions of the modules (outside the ORM and the server) the time went to, SQL they ran included. Sampled every 10 ms or so: approximate.')
        : samples.length ? _t('No time in the modules\' code: the server itself (routing, ORM) took it.') : _t('No Python samples: this request was recorded without them.')),
      spots.map(hotRow))],
      [_t('Repeated Queries (%s)', sum.dups.length), tab(sum.dups.length
        ? el('div', { class: 'note' }, _t('The same SQL sent several times. If a count follows the number of records shown (10 records → 10×), it is an N+1: the code reads records one by one where one query could read them all.'))
        : el('div', { class: 'okline' }, _t('✓ No repeated query.')),
      sum.dups.map((g) => queryRow({ ...g.first, time: g.time }, g.count)))],
      [_t('Slowest Queries'), tab(slowest < 0.01
        ? el('div', { class: 'okline' }, _t('✓ No slow query (the slowest took %s): the database is not the problem here.', ms(slowest)))
        : el('div', { class: 'note' }, _t('The slowest took %s. Check the columns it filters or joins on have an index, and that it does not read more rows than needed.', ms(slowest))),
      sum.slow.map((e) => queryRow(e)))],
    ], { n1: 1, sql: 2 }[kind] ?? 0));
}
