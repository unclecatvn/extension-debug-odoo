// RPC tab: the live log of the page's JSON-RPC calls (recorded by entrypoints/rpc-recorder from page load, relayed
// as they happen), any of them edited and sent again, a new one, or copied as a cURL command for the external API of
// the Odoo version (odoo/adapter.ts → api). Markup: rpc.tpl.html; pure part: rpc.logic.ts.
import type { ExtMessage } from '../../contracts/messages.ts';
import { exec, isExecError } from '../../extension/run-in-tab.ts';
import { _t, translateDom } from '../../i18n/i18n.ts';
import { idsOfCall, modeOfCall, parseAccessError, reportAccessProblem } from '../../odoo/access-error.ts';
import { odoo } from '../../odoo/detect.ts';
import { pageSend } from '../../injected/json-rpc.ts';
import { methodSignature } from '../../odoo/method-doc.ts';
import { reportCallToProfile } from '../../odoo/profile-call.ts';
import { sessionInfo } from '../../odoo/reads.ts';
import { copyText, errBox, listHead, loading, pill, pre } from '../../ui/components.ts';
import { editor } from '../../ui/editor.ts';
import { jsonTokens, openDepthFor } from '../../ui/json.ts';
import { segmented } from '../../ui/parts.ts';
import { jsonView } from '../../ui/json-view.ts';
import { expandable, masterDetail, resetPane } from '../../ui/lists.ts';
import { templates } from '../../ui/template.ts';
import type { PanelContext, TabModule } from '../registry.ts';
import { pageRpcLog } from './rpc.injected.ts';
import { callTarget, elapsedRpc, matchesRpc, parseRpc, parseRpcResponse, prettyJson, RpcLog, toCurl, type RpcEntry, type RpcFilter } from './rpc.logic.ts';
import html from './rpc.tpl.html';

const tpl = templates(html, translateDom);
const log = new RpcLog();
const views = new Map<RpcEntry, { li: HTMLLIElement; update(now: number): void }>();

let panel: PanelContext;
let rows: HTMLUListElement;
let filter: HTMLInputElement;
let emptyLog: HTMLElement;
let status: RpcFilter = 'all';
let timer: ReturnType<typeof setInterval> | undefined;
let clearGeneration = 0;

export const rpcTab: TabModule = {
  async mount(section, ctx) {
    panel = ctx;
    const bar = tpl('toolbar', { bar: HTMLDivElement, filter: HTMLInputElement, clear: HTMLButtonElement, compose: HTMLButtonElement }).refs;
    filter = bar.filter;
    filter.addEventListener('input', refreshFilters);
    // one status at a time: a segmented control, under the search box when narrow (panel.css)
    const statusSeg = segmented<RpcFilter>([['all', _t('All')], ['pending', _t('Pending')], ['slow', _t('Slow (≥ 1 s)')], ['errors', _t('Errors')]],
      status, (v) => { status = v; refreshFilters(); });
    statusSeg.setAttribute('aria-label', _t('RPC status'));
    filter.after(statusSeg);
    bar.clear.addEventListener('click', () => {
      clearGeneration++;
      log.clear();
      views.clear();
      rows.replaceChildren();
      resetPane(rows);
      count();
      clock();
    });
    const draft = tpl('draft-slot', { slot: HTMLDivElement }).refs.slot; // holds the New Request card while it is open
    bar.compose.addEventListener('click', () => toggleDraft(draft, bar.compose));
    bar.bar.append(listHead(_t('Method · model · duration'), _t('Time · route')));

    rows = tpl('rows', { list: HTMLUListElement }).refs.list;
    emptyLog = tpl('empty-log').root;
    section.append(bar.bar, draft, masterDetail(rows, _t('Select a call to edit it, resend it and see its result.')), emptyLog);
    await reload();
  },
  onMessage(msg: ExtMessage) {
    if (msg.type === 'odoo-rpc') add(msg.raw);
    return null;
  },
  pageObserved(_previous, next) {
    const now = Date.now();
    for (const e of log.observeDocument(next.loadedAt, next.observedAt ?? now)) views.get(e)?.update(now);
    clock();
  },
};

/** Merge the initial buffer with live events instead of resetting newer state received during the await. */
async function reload() {
  const generation = clearGeneration;
  const buf = await exec(pageRpcLog);
  if (generation !== clearGeneration) return; // Clear while the initial snapshot was in flight
  if (Array.isArray(buf)) for (const raw of buf) add(raw);
  count();
}

/** raw: an object from the page buffer or its JSON text from a live message. Malformed entries are skipped. */
function add(raw: unknown) {
  let e: RpcEntry | null;
  try { e = parseRpc(typeof raw === 'string' ? JSON.parse(raw) : raw); } catch { return; }
  if (!e || !(e = log.add(e))) return;
  let view = views.get(e);
  if (!view) {
    view = row(e);
    views.set(e, view);
    const newer = log.entries[log.entries.indexOf(e) + 1];
    const before = newer && views.get(newer);
    if (before) before.li.after(view.li); else rows.prepend(view.li);
  }
  view.update(Date.now());
  for (const [entry, old] of views) if (!log.entries.includes(entry)) {
    if (old.li.classList.contains('open')) resetPane(rows);
    old.li.remove();
    views.delete(entry);
  }
  count();
  clock();
}

function count() { emptyLog.hidden = log.entries.length > 0; }

function applyFilter(e: RpcEntry, li: HTMLElement, now = Date.now()) {
  li.hidden = !matchesRpc(e, filter.value, status, now);
}

function refreshFilters() { for (const [e, view] of views) applyFilter(e, view.li); }

/** One clock for the bounded log, never a timer per request; no work remains after completion or Clear. */
function clock() {
  if (!log.entries.some((e) => e.phase === 'pending')) {
    if (timer !== undefined) clearInterval(timer);
    timer = undefined;
  } else if (timer === undefined) timer = setInterval(() => {
    if (!rows.isConnected) { clearInterval(timer); timer = undefined; return; }
    const now = Date.now();
    for (const [e, view] of views) if (e.phase === 'pending') view.update(now);
  }, 250);
}

const isAccessDenied = (e: RpcEntry) => !!e.errorType?.endsWith('AccessError');

function row(e: RpcEntry) {
  const { row: li, method, model, ms, meta, state } = tpl('call', {
    row: HTMLLIElement, method: HTMLSpanElement, model: HTMLSpanElement, ms: HTMLSpanElement, meta: HTMLDivElement, state: HTMLSpanElement,
  }).refs;
  method.textContent = e.method;
  model.textContent = e.model;
  meta.textContent = `${(e.at || '').slice(11, 19)} · ${e.path}`;
  let lastPhase: RpcEntry['phase'] | undefined;
  let opened: ReturnType<typeof detail> | undefined;
  expandable(li, () => { opened = detail(e); return opened.form; });
  return { li, update(now: number) {
    ms.textContent = `${elapsedRpc(e, now)} ms`;
    if (lastPhase !== e.phase) {
      lastPhase = e.phase;
      li.classList.toggle('is-err', e.error !== undefined);
      state.replaceChildren(...(e.phase !== 'complete' ? [pill(e.phase === 'pending' ? _t('Pending') : _t('Response unavailable'), 'med')] : e.error !== undefined
        ? [pill(isAccessDenied(e) ? '🔒 AccessError' : e.errorType?.split('.').pop() || _t('error'), 'err')] : []));
    }
    opened?.update(now);
    applyFilter(e, li, now);
  } };
}

/** Updating a completed recording touches only its answer/actions: edited route/body and a manual resend stay intact. */
function detail(e: RpcEntry) {
  const profile = tpl('profile', { button: HTMLButtonElement }).refs.button;
  profile.addEventListener('click', (ev) => {
    ev.stopPropagation();
    reportCallToProfile({ route: e.route, body: e.body, label: `${e.method} ${e.model}`.trim() });
    panel.rerender('perf');
  });
  if (e.bodyCut) { profile.disabled = true; profile.title = _t('Body cut at 200 KB by the recorder: it cannot be profiled.'); }
  const why = tpl('why', { button: HTMLButtonElement }).refs.button;
  why.addEventListener('click', () => {
    const p = parseAccessError(e.error ?? '');
    reportAccessProblem({ kind: p?.kind ?? null, user: p?.user ?? null, rules: p?.rules ?? [], groups: p?.groups ?? [],
      model: e.model || p?.model || null, ids: p?.ids.length ? p.ids : idsOfCall(e.args), mode: modeOfCall(e.method, e.args) ?? p?.mode ?? null });
    panel.rerender('security');
  });
  const c = composer(e.route, e.body, [], [why, profile]);
  c.form.prepend(...cutNote(e.bodyCut));
  let lastPhase: RpcEntry['phase'] | undefined;
  let info: HTMLSpanElement;
  const update = (now: number) => {
    why.hidden = !isAccessDenied(e);
    if (lastPhase !== e.phase) {
      lastPhase = e.phase;
      const head = tpl('sent-head', { pill: HTMLSpanElement, info: HTMLSpanElement });
      info = head.refs.info;
      head.refs.pill.replaceWith(e.phase !== 'complete' ? pill(e.phase === 'pending' ? _t('Pending') : _t('Response unavailable'), 'med')
        : e.error !== undefined ? pill(e.errorType?.split('.').pop() || _t('error'), 'err') : pill('ok', 'ok'));
      let answer: Node[] = e.phase !== 'complete' ? [] : e.error !== undefined
        ? [errBox({ message: e.error, traceback: e.traceback })] : [...cutNote(e.answerCut), readable(e.result)];
      if (e.phase === 'unavailable') {
        const note = tpl('cut-note', { text: HTMLDivElement });
        note.refs.text.textContent = _t('The page changed before the response arrived; the server result is unknown.');
        answer = [note.root];
      }
      c.recorded([head.root, ...answer]);
    }
    info.textContent = e.phase === 'pending' ? _t('Waiting for response · %s ms', elapsedRpc(e, now))
      : e.phase === 'unavailable' ? _t('Observed wait · %s ms', e.ms) : _t('Recorded at %s · %s ms', (e.at || '').slice(11, 19), e.ms);
  };
  update(Date.now());
  return { form: c.form, update };
}

/** Over 200 KB, the recorder keeps the start of a body / an answer only: say so, and how to get it whole. */
function cutNote(cut: boolean): Node[] {
  if (!cut) return [];
  const { root, refs } = tpl('cut-note', { text: HTMLDivElement });
  refs.text.textContent = _t('Cut at 200 KB by the recorder: only its start is kept.');
  return [root];
}

/** A request's parameters or an answer, as fits it: a JSON tree (opening less for a big one), or text when it isn't
 * JSON (a body cut by the recorder, an HTML error page). */
function readable(v: unknown): Node {
  return typeof v === 'string' ? pre(v) : jsonView(v, openDepthFor(v));
}

/** New Request: a card above the log, a search_read on the page's model to start from. */
function toggleDraft(slot: HTMLElement, button: HTMLButtonElement) {
  const on = !slot.firstChild;
  if (on) {
    const { root, refs } = tpl('draft', { close: HTMLButtonElement, body: HTMLDivElement });
    refs.close.addEventListener('click', () => toggleDraft(slot, button));
    refs.body.append(composer('/web/dataset/call_kw', JSON.stringify({ jsonrpc: '2.0', method: 'call', params: {
      model: panel.state().model || 'res.partner', method: 'search_read', args: [[]], kwargs: { fields: ['display_name'], limit: 5 } } })).form);
    slot.replaceChildren(root);
    slot.querySelector('textarea')?.focus();
  } else slot.replaceChildren();
  button.setAttribute('aria-pressed', String(on));
}

/** A request as sent, editable (route, JSON body): Send (or Ctrl/⌘ + Enter) posts it with the page's session, the answer
 * shows below in place of `answer` (the recorded one, if any). `extra`: more actions, after Copy as cURL. */
function composer(route: string, body: string, answer: Node[] = [], extra: HTMLElement[] = []) {
  const json = prettyJson(body);
  const { form, route: path, text: slot, send, out } = tpl('composer', {
    form: HTMLFormElement, route: HTMLInputElement, text: HTMLDivElement, send: HTMLButtonElement, out: HTMLDivElement,
  }).refs;
  path.value = route;
  const field = editor(json, _t('Body (JSON)'), jsonTokens); // coloured like the answer below it
  slot.replaceWith(field.root);
  const text = field.ta;
  text.rows = Math.min(18, Math.max(6, json.split('\n').length));
  send.after(curlButton(() => ({ route: path.value.trim(), body: text.value })), ...extra);
  out.append(...answer);
  let ownAnswer = false;
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (send.disabled) return;
    ownAnswer = true;
    try { JSON.parse(text.value); } catch (err) { out.replaceChildren(errBox({ message: _t('Invalid JSON: %s', (err as Error).message) })); return; }
    send.disabled = true;
    out.replaceChildren(loading());
    const r = await exec(pageSend, path.value.trim(), text.value);
    send.disabled = false;
    if (!r || isExecError(r)) { out.replaceChildren(errBox({ message: r?.error || _t('No response — is this an Odoo page?') })); return; }
    const a = parseRpcResponse(r.text, r.status);
    const head = tpl('sent-head', { pill: HTMLSpanElement, info: HTMLSpanElement });
    head.refs.pill.replaceWith(a.error ? pill(a.errorType?.split('.').pop() || _t('error'), 'err') : pill('ok', 'ok'));
    head.refs.info.textContent = `HTTP ${r.status} · ${r.ms} ms`;
    out.replaceChildren(head.root, a.error ? errBox({ message: a.error, traceback: a.traceback }) : readable(a.result));
  });
  text.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey)) { ev.preventDefault(); form.requestSubmit(); }
  });
  return { form, recorded(nodes: Node[]) { if (!ownAnswer) out.replaceChildren(...nodes); } };
}

/** Copies the request `req()` as a cURL command for this Odoo's external API (rpc.logic.ts → toCurl). On 19, the
 * method's signature names its arguments (JSON-2); what can't be named is written as a warning in the command. */
function curlButton(req: () => { route: string; body: string }): HTMLButtonElement {
  const { button } = tpl('curl', { button: HTMLButtonElement }).refs;
  void odoo().then((c) => {
    button.title = c.adapter.api.kind === 'json2'
      ? _t('call_kw: JSON-2 API (/json/2), this user\'s API key in $ODOO_API_KEY. Other routes: session_id cookie in $ODOO_SESSION.')
      : _t('call_kw: external API (execute_kw), this user\'s API key in $ODOO_API_KEY. Other routes: session_id cookie in $ODOO_SESSION.');
  }, () => {});
  button.addEventListener('click', async (ev) => {
    ev.stopPropagation();
    try {
      const [{ adapter }, { db, uid }] = await Promise.all([odoo(), sessionInfo()]);
      const r = req();
      const target = callTarget(r.route, r.body);
      const signature = target ? await methodSignature(adapter, target.model, target.method) : null;
      const { text, warnings } = toCurl({ origin: panel.state().origin, ...r, db, uid, api: adapter.api, signature });
      await copyText(text);
      button.classList.toggle('warn', warnings.length > 0);
      if (warnings.length) button.title = warnings.join('\n');
      button.classList.add('copied');
      setTimeout(() => button.classList.remove('copied'), 1000);
    } catch (e) {
      button.title = String((e as Error)?.message ?? e);
    }
  });
  return button;
}
