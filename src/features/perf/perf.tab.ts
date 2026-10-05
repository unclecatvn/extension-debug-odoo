// Perf tab: Odoo's own profiler (ir.profile), read back per request.
//   Recorder   on / off for this session, what it collects (SQL; Python stacks; QWeb), until when the database allows it
//              (Odoo's "enable profiling" wizard when it doesn't)
//   A call     handed by the RPC tab ("Profile"): sent again with the profiler on just for it, its profile opened
//   Requests   of the session recording (or another one, or all), the panel's own left out; the one opened beside them
//              (perf.request.ts): totals, the lines sending queries, N+1 suspects, the slowest, against a baseline
//   Clean up   delete the profiles of the session shown, yours, or all
// perf.data.ts reads and writes, perf.logic.ts is pure. Settings rights (base.group_system). 18.0 / 19.0: the CPU column
// and speedscope (odoo/adapter.ts → profiler).
import type { Json } from '../../contracts/json.ts';
import { exec, isExecError } from '../../extension/run-in-tab.ts';
import { _t } from '../../i18n/i18n.ts';
import type { PageState } from '../../injected/page-state.ts';
import type { OdooContext } from '../../odoo/detect.ts';
import { takeCallToProfile, type CallToProfile } from '../../odoo/profile-call.ts';
import { sessionInfo } from '../../odoo/reads.ts';
import { fill, filterBox } from '../../ui/cards.ts';
import { errBox, pill } from '../../ui/components.ts';
import { filterMatrix, matrix, type MxRow } from '../../ui/matrix.ts';
import { frag, note } from '../../ui/parts.ts';
import type { TabModule } from '../registry.ts';
import {
  allowProfiling, deleteProfiles, NotAllowedError, enabledUntil, profileCall, profileIdsOf, profilingState, readProfiles, readSessions, setProfiling, type Collector,
} from './perf.data.ts';
import { pageGet } from './perf.injected.ts';
import { isAsset, isOwnRequest, isSessionOf, ms, sessionLabel, type ProfileRow } from './perf.logic.ts';
import { MANY_SQL, nameNodes, requestDetail, type RequestEnv } from './perf.request.ts';
import { collectors, forgetAll, keepCollectors, stateOf, type PerfState } from './perf.state.ts';
import { box, button, row, select, text, tpl } from './perf.ui.ts';

export const perfTab: TabModule = {
  render(section, page, odoo) {
    const s = stateOf(page.origin);
    const handed = takeCallToProfile();
    const draw = (call: CallToProfile | null = null) => {
      section.replaceChildren();
      const { box: root } = tpl('box', { box: HTMLDivElement }).refs;
      root.className = 'subview';
      section.append(root);
      fill(root, () => build(page, odoo, s, call, () => draw()));
    };
    draw(handed);
  },
  reset: forgetAll,
};

async function build(page: PageState, odoo: OdooContext, s: PerfState, handed: CallToProfile | null, redraw: () => void): Promise<Node> {
  const info = await sessionInfo();
  if (!info.is_system) return note(_t('The Perf tab needs Settings rights (base.group_system): the profiles are ir.profile records.'));
  const a = odoo.adapter;
  const [recording, until] = await Promise.all([profilingState(), enabledUntil(a).catch(() => null)]);
  const out = box();
  out.className = 'subview-body';
  out.append(recorder(recording, until, redraw));

  if (handed) {
    const slot = box();
    out.append(slot);
    await profileHanded(handed, s, slot, redraw);
  } else if (s.profiled) { // profiled after allowing profiling, the tab drawn again: what came of it
    out.append(profiledLine(s.profiled.label, s.profiled.text));
    s.profiled = null;
  }

  // ---------- which session ----------
  const sessions = await readSessions(a).catch(() => []);
  const today = new Date().toISOString().slice(0, 10);
  const mine = sessions.filter((x) => isSessionOf(x.session, info.name));
  const chosen = s.session === 'all' ? 'all'
    : s.session && sessions.some((x) => x.session === s.session) ? s.session
      : recording ?? mine[0]?.session ?? sessions[0]?.session ?? null;
  const options: [string, string][] = sessions.map((x) => [x.session,
    `${x.session === recording ? '● ' : ''}${sessionLabel(x.session, today)} · ${x.session.split(' ').slice(2).join(' ')} (${x.count})`]);
  if (recording && !sessions.some((x) => x.session === recording)) options.unshift([recording, `● ${sessionLabel(recording, today)} (0)`]);
  options.push(['all', _t('Every session')]);

  const read = chosen ? (await readProfiles(a, chosen === 'all' ? null : chosen)).filter((r) => !isOwnRequest(r.name)) : [];
  // the slowest first; static files (scripts, images…: nothing to optimise in a module) only when asked
  const assets = read.filter((r) => isAsset(r.name)).length;
  const rows = (s.assets ? read : read.filter((r) => !isAsset(r.name))).sort((x, y) => y.duration - x.duration);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const env: RequestEnv = { s, a, origin: page.origin, allowed: !!until, rows: byId, rerender: redraw };

  const { bar } = tpl('toolbar', { bar: HTMLDivElement }).refs;
  const count = text('', 'muted');
  if (options.length > 1) bar.append(select(options, chosen ?? 'all', (v) => { s.session = v; s.selected = null; redraw(); }, _t('Profile session')));
  const f = filterBox([], _t('Filter requests…'));
  bar.append(f.input, count, button('⟳', redraw, 'chip', _t('Read the profiles again')));
  if (assets) {
    const toggle = button(_t('Static Files (%s)', assets), () => { s.assets = !s.assets; redraw(); }, 'chip', _t('Scripts, images, manifest…: nothing to optimise in a module'));
    toggle.setAttribute('aria-pressed', String(s.assets));
    bar.append(toggle);
  }

  if (!rows.length) {
    out.append(bar, note(recording
      ? _t('Recording: do the slow action on the Odoo page, then ⟳. Every request of this session writes a profile.')
      : chosen ? _t('No request in this session.') : _t('No profile yet: Start, use the Odoo page, then come back here.')));
    return frag(out, cleanup(chosen, info.name, rows, s, redraw));
  }

  // ---------- the requests, the one opened beside them ----------
  const md = tpl('perf-md', { root: HTMLDivElement, list: HTMLDivElement, pane: HTMLElement }).refs;
  md.pane.append(note(_t('Click a request to see where its time goes.')));
  const cpu = rows.some((r) => r.cpu_duration !== undefined);
  const tableRows: MxRow[] = rows.map((r) => ({
    id: String(r.id),
    label: [...(s.baseline === r.id ? [pill(_t('baseline'), 'accent')] : []), ...nameNodes(r.name)],
    sub: `#${r.id}${chosen === 'all' ? ` · ${r.session}` : ''}`,
    q: `${r.name} ${r.id}`,
    cells: [r.sql_count > MANY_SQL ? pill(String(r.sql_count), 'err') : String(r.sql_count),
      r.duration >= 0.3 ? pill(ms(r.duration), r.duration >= 1 ? 'err' : 'med') : ms(r.duration), // slow: ≥ 300 ms, very: ≥ 1 s
      ...(cpu ? [ms(r.cpu_duration)] : []), r.create_date ? r.create_date.slice(11, 19) : ''],
    open: r.id === s.selected,
    detail: () => { s.selected = r.id; return requestDetail(r, env); },
  }));
  const table = matrix(_t('Request'), ['SQL', _t('Time'), ...(cpu ? ['CPU'] : []), _t('At')], [{ rows: tableRows }], -1, false, md.pane);
  md.list.append(table);
  const apply = () => { count.textContent = _t('%s requests', filterMatrix(table, f.input.value)); };
  f.input.addEventListener('input', apply);
  apply();
  out.append(bar, md.root);
  return frag(out, cleanup(chosen, info.name, rows, s, redraw));
}

/** On / off, what it collects, until when the database allows it. */
function recorder(recording: string | null, until: string | null, redraw: () => void): HTMLElement {
  const r = tpl('recorder', { root: HTMLDivElement, pill: HTMLSpanElement, since: HTMLSpanElement, actions: HTMLSpanElement, collectors: HTMLDivElement, note: HTMLDivElement, steps: HTMLOListElement, out: HTMLDivElement }).refs;
  r.steps.hidden = !!recording; // off: how to find out why a screen is slow
  r.pill.replaceWith(pill(recording ? _t('RECORDING') : _t('off'), recording ? 'ok' : ''));
  r.since.textContent = recording ? _t('since %s', recording.slice(11, 19)) : '';
  const fail = (e: unknown) => r.out.replaceChildren(errBox(e));
  const start = async () => {
    const st = await setProfiling(true, collectors());
    if (st === 'not-allowed') { r.out.replaceChildren(allowRow(async () => { await setProfiling(true, collectors()); redraw(); }, fail)); return; }
    redraw();
  };
  const toggle = button(recording ? _t('Stop Profiling') : _t('Start Profiling'), () => {
    toggle.disabled = true;
    (recording ? setProfiling(false).then(redraw) : start()).catch((e: unknown) => { toggle.disabled = false; fail(e); });
  });
  r.actions.append(toggle);

  // what it collects: SQL always; the rest saved, and applied at once while recording
  const chosen = new Set<Collector>(collectors());
  const chip = (c: Collector, label: string, hint: string) => {
    const b = button(label, () => {
      if (c === 'sql') return;
      if (chosen.has(c)) chosen.delete(c); else chosen.add(c);
      b.setAttribute('aria-pressed', String(chosen.has(c)));
      keepCollectors([...chosen]);
      if (recording) void setCollectors([...chosen]).catch(fail);
    }, 'chip', hint);
    b.setAttribute('aria-pressed', String(chosen.has(c)));
    if (c === 'sql') b.disabled = true;
    return b;
  };
  r.collectors.append(text(_t('Collect:'), 'muted'),
    chip('sql', 'SQL', _t('Every query, its time and stack: always')),
    chip('traces_async', _t('Python stacks'), _t('The Python stack sampled every few ms: the flame graph')),
    chip('qweb', 'QWeb', _t('The QWeb directives rendered and their time (reports, website pages)')));
  r.note.textContent = [
    recording ? _t('Every request of this session writes one profile (ir.profile); the panel\'s own are left out of the list.')
      : _t('Odoo\'s own profiler: SQL and Python of every request of this session, read back here (Settings rights).'),
    until ? _t('Allowed on this database until %s.', until) : _t('Not allowed on this database yet: Start asks for how long.'),
  ].join(' ');
  return r.root;
}

/** The collectors of the session recording, changed without stopping it. */
async function setCollectors(cs: readonly Collector[]) {
  const r = await exec(pageGet, `/web/set_profiling?collectors=${cs.join(',')}`);
  if (!r || isExecError(r) || r.status !== 200) throw new Error(_t('Cannot change what the profiler collects.'));
}

/** Profiling not allowed on the database: for how long to allow it (Odoo's wizard, base.profiling_enabled_until). */
function allowRow(then: () => Promise<void>, fail: (e: unknown) => void): HTMLElement {
  const go = (d: 'minutes_5' | 'hours_1' | 'days_1') => () => { void allowProfiling(d).then(then).catch(fail); };
  return row(text(_t('Profiling is not allowed on this database. Allow it for:'), 'muted'),
    button(_t('5 minutes'), go('minutes_5'), 'chip'), button(_t('1 hour'), go('hours_1'), 'chip'), button(_t('1 day'), go('days_1'), 'chip'),
    text(_t('(writes base.profiling_enabled_until)'), 'muted'));
}

/** The call handed by the RPC tab: sent again with the profiler on, its profile opened in the list. */
async function profileHanded(c: CallToProfile, s: PerfState, slot: HTMLElement, redraw: () => void) {
  const head = row(pill(_t('Profiling'), 'accent'), text(c.label, 'name'));
  slot.replaceChildren(head);
  const fail = (e: unknown) => slot.replaceChildren(head, errBox(e));
  const run = async () => {
    const r = await profileCall(c.route, c.body, collectors());
    if (!r.row) throw new Error(_t('Sent (HTTP %s), but no profile of it was found.', r.status));
    s.session = r.session;
    s.selected = r.row.id;
    s.profiled = { label: c.label, text: _t('HTTP %s · %s · %s queries · opened below', r.status, ms(r.row.duration), r.row.sql_count) };
    slot.replaceChildren(profiledLine(s.profiled.label, s.profiled.text));
  };
  try {
    await run();
    s.profiled = null; // shown in the slot already
  } catch (e) {
    if (e instanceof NotAllowedError) slot.replaceChildren(head, allowRow(async () => { await run(); redraw(); }, fail));
    else fail(e);
  }
}

const profiledLine = (label: string, what: string) => row(pill(_t('Profiled'), 'ok'), text(label, 'name'), text(what, 'muted'));

/** Deleting profiles: of the session shown, yours, all. Each counted and confirmed. */
function cleanup(chosen: string | null, userName: string, rows: readonly ProfileRow[], s: PerfState, redraw: () => void): HTMLElement {
  const out = box();
  const del = (label: string, domain: Json[]) => async () => {
    const ids = await profileIdsOf(domain);
    if (!ids.length) { out.replaceChildren(note(_t('Nothing to delete.'))); return; }
    if (!confirm(_t('%s: delete %s profiles (ir.profile)? The panel\'s own reads, not listed, are among them.', label, ids.length))) return;
    await deleteProfiles(ids);
    if (s.selected && ids.includes(s.selected)) s.selected = null;
    if (s.baseline && ids.includes(s.baseline)) s.baseline = null;
    redraw();
  };
  const wrap = (fn: () => Promise<void>) => () => { void fn().catch((e: unknown) => out.replaceChildren(errBox(e))); };
  const r = row(text(_t('Clean up:'), 'muted'),
    chosen && chosen !== 'all' && rows.length > 0 && button(_t('This session (%s)', rows.length), wrap(del(_t('This session'), [['session', '=', chosen]])), 'chip'),
    button(_t('Mine'), wrap(del(_t('Your sessions'), [['session', '=like', `% ${userName}`]])), 'chip', _t('Every session of %s', userName)),
    button(_t('All'), wrap(del(_t('Every session'), [])), 'chip', _t('Every profile of the database (Odoo deletes them after 30 days anyway)')));
  r.classList.add('perf-cleanup');
  return box(r, out);
}
