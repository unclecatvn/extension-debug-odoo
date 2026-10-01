// Perf tab: Odoo's built-in server profiler (/web/set_profiling → ir.profile rows), read back per request.
import { sqlSummary, appFrame } from './logic.js';
import { pageFetch } from '../../shared/page.js';
import { execOrThrow, rpc, call, fieldsOf } from '../../shared/bridge.js';
import { el, pre, pill, details, empty, card, errBox, expandable, filteredList, listHead, splitRow, masterDetail } from '../../shared/ui.js';
import { _t, N_ } from '../../shared/i18n.js';

const COLLECTORS = 'sql,traces_async';
const ms = (s) => `${Math.round((s || 0) * 1000)} ms`;
const short = (file) => file.replace(/^.*?\/((odoo\/)?addons\/|odoo\/)/, '$1');
const frame = (f) => (f ? `${short(f[0])}:${f[1]} ${f[2]}()` : '');

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
      class: 'btn',
      onclick: async () => {
        btn.disabled = true;
        try { session ? await setProfiling(false) : await enable(); rerender(); } catch (e) { btn.disabled = false; head.after(errBox(e)); }
      },
    }, session ? _t('Stop Profiling') : _t('Start Profiling'));
    const head = el('div', { class: 'pad row' },
      pill(session ? _t('RECORDING') : _t('off'), session ? 'ok' : ''),
      el('span', { class: 'grow muted', title: session || '' }, session ? _t('since %s', session.slice(11, 19)) : ''),
      btn);
    const note = el('div', { class: 'pad-bottom note mt0' }, session
      ? _t('Each request of this session writes one ir.profile row; ⟳ reloads the list.')
      : _t('Records the SQL + Python stacks of every request of this session (Odoo\'s built-in profiler, base.group_system).'));
    return el('div', {}, head, note, await requests(session, state.origin));
  });
}

// The panel's own requests: reading the profiles, and the session info (the webclient never asks for it: it is in the page).
const OWN = ['/ir.profile/', '/web/session/get_session_info'];

/** The profiled requests of `session` (else of the latest one), newest first, without the panel's own. */
async function requests(session, origin) {
  const known = await fieldsOf('ir.profile');
  const rows = (await call('ir.profile', 'search_read', [session ? [['session', '=', session]] : []],
    { fields: ['name', 'session', 'duration', 'cpu_duration', 'sql_count', 'create_date'].filter((f) => f in known), limit: 100 })) // cpu_duration: 19+ only
    .filter((r) => !OWN.some((own) => r.name.includes(own)));
  if (!rows.length) return el('div', { class: 'pad-bottom' }, empty(session ? _t('No request yet: use the Odoo page, then press ⟳.') : _t('No profile data yet.')));
  const list = filteredList(rows.map((r) => profileItem(r, origin)), _t('Filter request'), N_('%s requests'), N_('%s/%s requests'),
    listHead(_t('Request · SQL · duration'), _t('Id · time · CPU')));
  list.append(masterDetail(list.lastElementChild, _t('Select a request to see its SQL queries.'))); // the <ul>, moved beside its pane
  return el('div', {},
    session ? null : el('div', { class: 'pad-bottom muted' }, _t('Latest session: %s', rows[0].session)),
    list);
}

/** "/web/dataset/call_kw/res.users/web_read" → method + model, like the RPC tab; any other route as it is. */
function requestName(name) {
  const m = /\/web\/dataset\/call_kw\/([^/?]+)\/([^/?]+)/.exec(name);
  return m ? [el('span', { class: 'name' }, m[2]), el('span', { class: 'muted' }, m[1])] : [el('span', { class: 'name' }, name.replace(/\?$/, ''))];
}

function profileItem(r, origin) {
  const slowSql = r.sql_count > 50;
  const li = el('li', {},
    splitRow([el('span', { class: 'row grow' }, requestName(r.name)),
      pill(`${r.sql_count} SQL`, slowSql ? 'err' : ''), el('span', { class: 'ms' }, ms(r.duration))],
    el('a', { class: 'btn', href: `${origin}/web/speedscope/${r.id}`, target: '_blank', rel: 'noopener', title: _t('Flame Graph (speedscope)') }, '↗')),
    el('div', { class: 'meta', title: r.name }, [`#${r.id}`, r.create_date?.slice(11), 'cpu_duration' in r && `CPU ${ms(r.cpu_duration)}`].filter(Boolean).join(' · ')));
  li.dataset.q = r.name.toLowerCase();
  return expandable(li, async () => sqlDetail(r, await call('ir.profile', 'read', [[r.id], ['sql']])));
}

function sqlDetail(r, [p]) {
  let entries = [];
  try { entries = JSON.parse(p?.sql || '[]'); } catch { /* not JSON */ }
  if (!entries.length) return empty(_t('No SQL recorded.'));
  const sum = sqlSummary(entries);
  const q = (e, extra) => expandable(el('li', {},
    el('div', { class: 'row' }, extra, el('span', { class: 'grow meta' }, frame(appFrame(e.stack))), el('span', { class: 'ms' }, ms(e.time))),
    el('div', { class: 'mono muted' }, e.query.length > 200 ? `${e.query.slice(0, 200)}…` : e.query),
    details(_t('Full SQL + stack'), pre(e.full_query || e.query), e.stack?.length ? pre(e.stack.map(frame).join('\n')) : null)));
  return el('div', {},
    el('div', { class: 'muted' }, _t('%s queries · SQL %s / total %s · Python ≈ %s', sum.count, ms(sum.time), ms(r.duration), ms(Math.max(0, r.duration - sum.time)))),
    sum.dups.length
      ? details(_t('Repeated queries — N+1 suspects (%s)', sum.dups.length), listHead(_t('Count · caller · time'), _t('Query')), el('ul', { class: 'list' },
        sum.dups.map((g) => q({ ...g.first, time: g.time }, pill(`${g.count}×`, g.count >= 5 ? 'err' : 'med')))))
      : el('div', { class: 'okline' }, _t('✓ No repeated query.')),
    details(_t('Slowest queries (%s)', sum.slow.length), listHead(_t('Caller · time'), _t('Query')), el('ul', { class: 'list' }, sum.slow.map((e) => q(e, null)))));
}
