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
import { openDepthFor } from '../../ui/json.ts';
import { jsonView } from '../../ui/json-view.ts';
import { expandable, masterDetail, resetPane } from '../../ui/lists.ts';
import { templates } from '../../ui/template.ts';
import type { PanelContext, TabModule } from '../registry.ts';
import { pageRpcLog } from './rpc.injected.ts';
import { callTarget, parseRpc, parseRpcResponse, prettyJson, toCurl, type RpcEntry } from './rpc.logic.ts';
import html from './rpc.tpl.html';

const tpl = templates(html, translateDom);
const MAX = 300; // rows kept, as the recorder's buffer

let panel: PanelContext;
let rows: HTMLUListElement;
let filter: HTMLInputElement;
let emptyLog: HTMLElement;
let onlyErrors = false;

export const rpcTab: TabModule = {
  async mount(section, ctx) {
    panel = ctx;
    const bar = tpl('toolbar', { bar: HTMLDivElement, filter: HTMLInputElement, errors: HTMLButtonElement, clear: HTMLButtonElement, compose: HTMLButtonElement }).refs;
    filter = bar.filter;
    filter.addEventListener('input', () => { for (const li of rows.children) applyFilter(li as HTMLElement); });
    bar.errors.addEventListener('click', () => {
      onlyErrors = !onlyErrors;
      bar.errors.setAttribute('aria-pressed', String(onlyErrors));
      for (const li of rows.children) applyFilter(li as HTMLElement);
    });
    bar.clear.addEventListener('click', () => { rows.replaceChildren(); resetPane(rows); count(); });
    const draft = tpl('draft-slot', { slot: HTMLDivElement }).refs.slot; // holds the New Request card while it is open
    bar.compose.addEventListener('click', () => toggleDraft(draft, bar.compose));
    bar.bar.append(listHead(_t('Method · model · duration'), _t('Time · route')));

    rows = tpl('rows', { list: HTMLUListElement }).refs.list;
    emptyLog = tpl('empty-log').root;
    section.append(bar.bar, draft, masterDetail(rows, _t('Select a call to edit its parameters, send it again and see its result.')), emptyLog);
    await reload();
  },
  onMessage(msg: ExtMessage) {
    if (msg.type === 'odoo-rpc') add(msg.raw);
    return null;
  },
};

/** Fills the log with what the page recorded before the panel opened. */
async function reload() {
  const buf = await exec(pageRpcLog);
  rows.replaceChildren(); // after the await: live messages received meanwhile are in the buffer too
  if (Array.isArray(buf)) for (const raw of buf) add(raw);
  count();
}

/** raw: a recorded call, as an object (page buffer) or its JSON text (live message). Malformed: skipped. */
function add(raw: unknown) {
  let e: RpcEntry | null;
  try { e = parseRpc(typeof raw === 'string' ? JSON.parse(raw) : raw); } catch { return; }
  if (!e) return;
  rows.prepend(row(e)); // newest first
  if (rows.children.length > MAX) rows.lastElementChild?.remove();
  count();
}

function count() {
  const n = rows.children.length;
  emptyLog.hidden = n > 0;
}

function applyFilter(li: HTMLElement) {
  li.hidden = !(li.dataset.q || '').includes(filter.value.toLowerCase()) || (onlyErrors && !li.classList.contains('is-err'));
}

const isAccessDenied = (e: RpcEntry) => !!e.errorType?.endsWith('AccessError');

function row(e: RpcEntry): HTMLLIElement {
  const { row: li, line, method, model, ms, meta } = tpl('call', {
    row: HTMLLIElement, line: HTMLDivElement, method: HTMLSpanElement, model: HTMLSpanElement, ms: HTMLSpanElement, meta: HTMLDivElement,
  }).refs;
  method.textContent = e.method;
  model.textContent = e.model;
  ms.textContent = `${e.ms} ms`;
  meta.textContent = `${(e.at || '').slice(11, 19)} · ${e.path}`;
  if (e.error) {
    li.classList.add('is-err');
    line.insertBefore(pill(isAccessDenied(e) ? '🔒 AccessError' : e.errorType?.split('.').pop() || _t('error'), 'err'), ms);
  }
  li.dataset.q = `${e.model} ${e.method}`.toLowerCase();
  expandable(li, () => detail(e));
  applyFilter(li);
  return li;
}

/** A call opened: its request, editable right away (Send posts it again), then its answer: the recorded one until sent
 * again. Its actions beside Send: Copy as cURL, ⏱ Profile, and for a refused call, why (Security). */
function detail(e: RpcEntry): HTMLElement {
  const profile = tpl('profile', { button: HTMLButtonElement }).refs.button;
  profile.addEventListener('click', (ev) => { // the Perf tab sends it again with the profiler on, and opens its profile
    ev.stopPropagation();
    reportCallToProfile({ route: e.route, body: e.body, label: `${e.method} ${e.model}`.trim() });
    panel.rerender('perf');
  });
  if (e.bodyCut) { profile.disabled = true; profile.title = _t('Cut at 200 KB by the recorder: its body is not whole, it cannot be profiled.'); }
  const extra: HTMLElement[] = [profile];
  if (isAccessDenied(e)) {
    const why = tpl('why', { button: HTMLButtonElement }).refs.button;
    why.addEventListener('click', () => { // the Security tab diagnoses it: the error's model, records, operation
      const p = parseAccessError(e.error ?? '');
      reportAccessProblem({ kind: p?.kind ?? null, user: p?.user ?? null, rules: p?.rules ?? [], groups: p?.groups ?? [],
        model: e.model || p?.model || null, ids: p?.ids.length ? p.ids : idsOfCall(e.args), mode: modeOfCall(e.method, e.args) ?? p?.mode ?? null });
      panel.rerender('security');
    });
    extra.unshift(why);
  }
  const head = tpl('sent-head', { pill: HTMLSpanElement, info: HTMLSpanElement });
  head.refs.pill.replaceWith(e.error ? pill(e.errorType?.split('.').pop() || _t('error'), 'err') : pill('ok', 'ok'));
  head.refs.info.textContent = _t('Recorded at %s · %s ms', (e.at || '').slice(11, 19), e.ms);
  const answer = e.error ? [errBox({ message: e.error, traceback: e.traceback })] : [...cutNote(e.answerCut), readable(e.result)];
  const form = composer(e.route, e.body, [head.root, ...answer], extra);
  form.prepend(...cutNote(e.bodyCut));
  return form;
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
      model: panel.state().model || 'res.partner', method: 'search_read', args: [[]], kwargs: { fields: ['display_name'], limit: 5 } } })));
    slot.replaceChildren(root);
    slot.querySelector('textarea')?.focus();
  } else slot.replaceChildren();
  button.setAttribute('aria-pressed', String(on));
}

/** A request as sent, editable (route, JSON body): Send (or Ctrl/⌘ + Enter) posts it with the page's session, the answer
 * shows below in place of `answer` (the recorded one, if any). `extra`: more actions, after Copy as cURL. */
function composer(route: string, body: string, answer: Node[] = [], extra: HTMLElement[] = []): HTMLFormElement {
  const json = prettyJson(body);
  const { form, route: path, text, send, out } = tpl('composer', {
    form: HTMLFormElement, route: HTMLInputElement, text: HTMLTextAreaElement, send: HTMLButtonElement, out: HTMLDivElement,
  }).refs;
  path.value = route;
  text.value = json;
  text.rows = Math.min(18, Math.max(6, json.split('\n').length));
  send.after(curlButton(() => ({ route: path.value.trim(), body: text.value })), ...extra);
  out.append(...answer);
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
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
  return form;
}

/** Copies the request `req()` as a cURL command for this Odoo's external API (rpc.logic.ts → toCurl). On 19, the
 * method's signature names its arguments (JSON-2); what can't be named is written as a warning in the command. */
function curlButton(req: () => { route: string; body: string }): HTMLButtonElement {
  const { button } = tpl('curl', { button: HTMLButtonElement }).refs;
  void odoo().then((c) => {
    button.title = c.adapter.api.kind === 'json2'
      ? _t('call_kw: the JSON-2 API (/json/2, named arguments), with an API key of this user in $ODOO_API_KEY. Other routes: the session_id cookie in $ODOO_SESSION.')
      : _t('call_kw: the external API (execute_kw), with an API key of this user in $ODOO_API_KEY. Other routes: the session_id cookie in $ODOO_SESSION.');
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
