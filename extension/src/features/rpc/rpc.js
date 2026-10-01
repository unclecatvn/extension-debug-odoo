// RPC tab: live log of the page's JSON-RPC calls, recorded by content/hook.js; any of them edited and sent again, or a new one.
import { parseRpc, parseRpcResponse, prettyJson, toCurl } from './logic.js';
import { pageRpcLog, pageSend } from './page.js';
import { exec, sessionInfo } from '../../shared/bridge.js';
import { el, pre, errBox, pill, details, empty, expandable, listHead, masterDetail, copyText, WIDE } from '../../shared/ui.js';
import { _t } from '../../shared/i18n.js';

const MAX = 300;
let onlyErrors = false;
let rows, filter, emptyMsg, onWhyBlocked, pageState;

/** Builds the tab once. `whyBlocked()` jumps to the Security tab for an AccessError; `page()`: the page's state (origin, model). */
export function mountRpc(section, whyBlocked, page) {
  onWhyBlocked = whyBlocked;
  pageState = page;
  filter = el('input', { type: 'search', placeholder: _t('Filter model / method') });
  filter.addEventListener('input', () => { for (const li of rows.children) applyFilter(li); });
  const errBtn = el('button', { class: 'chip', 'aria-pressed': 'false' }, _t('Errors Only'));
  errBtn.addEventListener('click', () => {
    onlyErrors = !onlyErrors;
    errBtn.setAttribute('aria-pressed', onlyErrors);
    for (const li of rows.children) applyFilter(li);
  });
  const clear = el('button', { class: 'chip', onclick: () => { rows.replaceChildren(); rows.pane.replaceChildren(rows.pane.hint); showEmpty(); } }, _t('Clear'));
  // New Request: a card above the log, a search_read on the page's model to start from
  const draft = el('div', {});
  const toggleDraft = () => {
    const on = !draft.firstChild;
    draft.replaceChildren(...(on ? [el('div', { class: 'rpc-draft' },
      el('div', { class: 'row' }, el('h3', { class: 'grow' }, _t('New Request')), el('button', { class: 'icon-btn close', type: 'button', title: _t('Close'), 'aria-label': _t('Close'), onclick: toggleDraft })),
      composer('/web/dataset/call_kw', JSON.stringify({ jsonrpc: '2.0', method: 'call', params: {
        model: pageState().model || 'res.partner', method: 'search_read', args: [[]], kwargs: { fields: ['display_name'], limit: 5 } } })))] : []));
    newBtn.setAttribute('aria-pressed', on);
    if (on) draft.querySelector('textarea').focus();
  };
  const newBtn = el('button', { class: 'chip', 'aria-pressed': 'false', onclick: toggleDraft }, _t('New Request'));
  rows = el('ul', { class: 'list' });
  emptyMsg = empty(_t('No RPC yet. Use the Odoo page to record some.'));
  section.append(el('div', { class: 'toolbar' }, filter, errBtn, clear, newBtn, listHead(_t('Method · model · duration'), _t('Time · route'))),
    draft, masterDetail(rows, _t('Select a call to see its parameters and result.')), emptyMsg);
}

function applyFilter(li) {
  li.hidden = !li.dataset.q.includes(filter.value.toLowerCase()) || (onlyErrors && !li.classList.contains('is-err'));
}

function item(e) {
  const denied = e.errorType?.endsWith('AccessError');
  const li = el('li', { class: e.error ? 'is-err' : '' },
    el('div', { class: 'row' }, el('span', { class: 'dot' }), el('span', { class: 'name' }, e.method),
      el('span', { class: 'grow muted' }, e.model), e.error ? pill(denied ? '🔒 AccessError' : e.errorType?.split('.').pop() || _t('error'), 'err') : null,
      el('span', { class: 'ms' }, `${e.ms} ms`)),
    el('div', { class: 'meta' }, `${(e.at || '').slice(11, 19)} · ${e.path}`));
  li.dataset.q = `${e.model} ${e.method}`.toLowerCase();
  // detail: the actions, then the request (Parameters), then the answer (Result, or the error first). Edit & Resend turns the
  // request into its editor in place, which has its own Copy as cURL (of what is typed).
  expandable(li, () => {
    const shown = (d) => Object.assign(d, { open: WIDE.matches }); // in the pane beside the list there is room: unfolded
    const params = shown(details(_t('Parameters'), pre({ args: e.args, kwargs: e.kwargs })));
    const curl = curlBtn(() => e);
    const edit = el('button', { class: 'btn', onclick: (ev) => {
      ev.stopPropagation(); // removed, the button is out of the row: the row would take the click as its own and close
      edit.remove();
      curl.remove();
      params.replaceWith(composer(e.route, e.body));
    } }, _t('Edit & Resend'));
    const bar = el('div', { class: 'row actions-bar' }, edit, curl, denied && el('button', { class: 'btn', onclick: onWhyBlocked }, _t('Why was it blocked? → Security')));
    if (e.error) return el('div', {}, bar, errBox({ message: e.error, traceback: e.traceback }), params);
    return el('div', {}, bar, params, shown(details(_t('Result'), resultPre(e.result))));
  });
  applyFilter(li);
  return li;
}

const resultPre = (result) => {
  const res = JSON.stringify(result, null, 2) ?? '';
  return pre(res.length > 50000 ? `${res.slice(0, 50000)}\n${_t('… (%s characters)', res.length)}` : res);
};

/** A request as sent, editable (route, JSON body): Send (or Ctrl/⌘ + Enter) posts it with the page's session, the answer shows below. */
function composer(route, body) {
  const json = prettyJson(body);
  const path = el('input', { type: 'text', value: route, spellcheck: false, 'aria-label': _t('Route') });
  const text = el('textarea', { value: json, spellcheck: false, rows: Math.min(18, Math.max(6, json.split('\n').length)), 'aria-label': _t('Body (JSON)') });
  const send = el('button', { class: 'btn primary', type: 'submit' }, _t('Send'));
  const out = el('div', {});
  const form = el('form', { class: 'composer', onsubmit: async (ev) => {
    ev.preventDefault();
    try { JSON.parse(text.value); } catch (err) { return out.replaceChildren(errBox({ message: _t('Invalid JSON: %s', err.message) })); }
    send.disabled = true;
    out.replaceChildren(el('div', { class: 'loading' }, _t('Loading…')));
    const r = await exec(pageSend, path.value.trim(), text.value);
    send.disabled = false;
    if (!r || r.error) return out.replaceChildren(errBox({ message: r?.error || _t('No response — is this an Odoo page?') }));
    const a = parseRpcResponse(r.text, r.status);
    const head = el('div', { class: 'row' }, a.error ? pill(a.errorType?.split('.').pop() || _t('error'), 'err') : pill('ok', 'ok'),
      el('span', { class: 'muted' }, `HTTP ${r.status} · ${r.ms} ms`));
    out.replaceChildren(head, a.error ? errBox({ message: a.error, traceback: a.traceback }) : resultPre(a.result));
  } }, path, text, el('div', { class: 'row actions-bar' }, send, curlBtn(() => ({ route: path.value.trim(), body: text.value })),
    el('span', { class: 'muted' }, _t('Ctrl/⌘ + Enter'))), out);
  text.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey)) { ev.preventDefault(); form.requestSubmit(); }
  });
  return form;
}

/** Copies the request `req()` ({ route, body }) as a cURL command, to replay it outside the browser (see toCurl). */
function curlBtn(req) {
  const b = el('button', {
    class: 'btn', type: 'button',
    title: _t('call_kw: the external API (execute_kw), with an API key of this user in $ODOO_API_KEY. Other routes: the session_id cookie in $ODOO_SESSION.'),
    onclick: async (ev) => {
      ev.stopPropagation();
      const { db, uid } = await sessionInfo().catch(() => ({}));
      await copyText(toCurl({ origin: pageState().origin, ...req(), db, uid }));
      b.classList.add('copied');
      setTimeout(() => b.classList.remove('copied'), 1000);
    },
  }, _t('Copy as cURL'));
  return b;
}

function showEmpty() {
  emptyMsg.hidden = rows.children.length > 0;
}

/** raw: an entry of hook.js, as an object (page buffer) or its JSON text (live message). */
export function addRpc(raw) {
  let e;
  try { e = parseRpc(typeof raw === 'string' ? JSON.parse(raw) : raw); } catch { return; } // malformed: skip it, keep the log going
  if (!e) return;
  rows.prepend(item(e)); // newest first
  if (rows.children.length > MAX) rows.lastElementChild.remove();
  showEmpty();
}

/** Fills the log with what the page recorded before the panel opened. */
export async function reloadRpc() {
  const buf = await exec(pageRpcLog);
  rows.replaceChildren(); // after the await: live messages received meanwhile are in the buffer too
  if (Array.isArray(buf)) for (const raw of buf) addRpc(raw);
  showEmpty();
}
