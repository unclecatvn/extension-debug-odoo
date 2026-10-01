// Code tab: JS with an ORM-like `env` (env['sale.order'].search(...), .read(), .write()…), run in the Odoo page through
// /web/dataset/call_kw with the logged-in session, so the server applies that user's rights to every call.
// Read-only unless "Allow Writes" is ticked (kept only while the panel lives): every call is committed at once.
import { pageRunCode, pageSoftReload } from './page.js';
import { codeKey, formatValue, printText, toTable, callStats, MAX_ROWS } from './logic.js';
import { codeEditor, replaceRange, smartKey } from './editor.js';
import { suggester } from './suggest.js';
import { help } from './help.js';
import { exec, sessionInfo } from '../../shared/bridge.js';
import { el, pill, pre, details, card } from '../../shared/ui.js';
import { _t } from '../../shared/i18n.js';

// The code is kept in the panel's localStorage, one per Odoo origin (codeKey): a snippet written for one server is not
// what opens on another. ⟳ Reload Data does not clear it: a snippet is work, not a filter.
const loadCode = (key) => { try { return localStorage.getItem(key); } catch { return null; } };
const saveCode = (key, code) => { try { localStorage.setItem(key, code); } catch { /* storage off */ } };
// "Auto Refresh" is a preference, kept (every origin): it only acts once Allow Writes is ticked, which is never stored.
const REFRESH_KEY = 'odoo-debug-auto-refresh';
const loadRefresh = () => { try { return localStorage.getItem(REFRESH_KEY) === '1'; } catch { return false; } };
const saveRefresh = (on) => { try { localStorage.setItem(REFRESH_KEY, on ? '1' : '0'); } catch { /* storage off */ } };

// What a run leaves, kept while this panel lives: the tab is rebuilt on every panel refresh (Odoo navigation, and the
// soft_reload that Auto Refresh triggers), which must not untick Allow Writes nor drop the result and calls.
// ⟳ Reload Data forgets it (forgetRun), like the other tabs' forms; a page reload recreates the panel, so it starts over.
const last = { writes: false, autoRefresh: loadRefresh(), running: false, result: null, refreshed: null, guide: false };
let view = null; // the console on screen: a run that ends after a rebuild is shown in the new one
export function forgetRun() {
  if (last.running) return; // the run in flight still ends where it should
  Object.assign(last, { writes: false, result: null, refreshed: null });
}

/** Shows `last` in the console on screen: Running…, then the result (and whether the page was refreshed). */
function paint() {
  if (!view) return;
  view.run.disabled = last.running;
  if (last.running && !last.result) return view.output.replaceChildren(el('div', { class: 'loading' }, _t('Running…')));
  if (!last.result) return view.output.replaceChildren();
  const parts = result(last.result);
  if (last.refreshed) parts[0].append(refreshPill(last.refreshed));
  view.output.replaceChildren(...parts);
}

export function renderCode(s, state) {
  card(s, async () => { // the tab's only card: no title to open it by
    const info = await sessionInfo();
    const key = codeKey(state.origin);
    const { root: editorBox, ta: editor, body } = codeEditor(loadCode(key) ?? '', _t('Code'));
    editor.placeholder = _t('// JavaScript with env, print, Command. ⌘/Ctrl+Enter runs it.');
    const writes = el('input', { type: 'checkbox', checked: last.writes });
    const autoRefresh = el('input', { type: 'checkbox', checked: last.autoRefresh });
    autoRefresh.addEventListener('change', () => { last.autoRefresh = autoRefresh.checked; saveRefresh(autoRefresh.checked); });
    const refreshBox = el('label', { class: 'check', title: _t('After writes, reload the data of the view on screen (Odoo\'s soft_reload), without reloading the page') },
      autoRefresh, _t('Auto Refresh'));
    const run = el('button', { class: 'btn primary', type: 'button', title: _t('Run (⌘/Ctrl+Enter)') }, `▶ ${_t('Run')}`);
    const output = el('div', { class: 'output' });

    const go = async () => {
      if (last.running) return;
      Object.assign(last, { running: true, result: null, refreshed: null });
      paint();
      try {
        const r = await exec(pageRunCode, editor.value, { readonly: !last.writes, context: info.user_context || {}, uid: info.uid });
        last.result = r;
        paint();
        // what the page shows is stale: reload the view's data, if asked to (the panel is rebuilt meanwhile: see `last`)
        if (last.writes && last.autoRefresh && callStats(r?.calls).written) {
          last.refreshed = await exec(pageSoftReload) || { error: 'No response — is this an Odoo page?' };
        }
      } finally {
        last.running = false;
        paint();
      }
    };
    run.addEventListener('click', go);
    const hints = suggester(editor);
    body.append(hints.box); // floats under the caret
    editor.addEventListener('input', () => { saveCode(key, editor.value); hints.update(); });
    let escaped = false; // Esc, then Tab: leaves the editor (keyboard users are not trapped by the indenting Tab)
    editor.addEventListener('keydown', (ev) => {
      if (hints.key(ev)) { escaped = false; return; } // the suggestion list took the key
      const wasEscaped = escaped;
      escaped = ev.key === 'Escape';
      if (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey)) { ev.preventDefault(); go(); }
      else if (ev.key === 'Tab' && !wasEscaped && !ev.shiftKey && !ev.altKey && !ev.metaKey && !ev.ctrlKey) {
        ev.preventDefault(); // indent instead of leaving the editor (Shift+Tab or Esc then Tab still leave it)
        replaceRange(editor, editor.selectionStart, editor.selectionEnd, '  ');
      } else if (smartKey(editor, ev)) hints.update(); // pairs, indent on Enter…; skipping a closer moves the caret without an input event
    });

    // the guide is hidden behind a button: the editor and the result are what the tab is for
    const guide = help();
    const guideBtn = el('button', { class: 'btn ghost round', type: 'button', 'aria-pressed': 'false', 'aria-label': _t('Guide'),
      title: `${_t('Guide')}: ${_t('Available variables, recordset API, examples')}` }, '?');
    const showGuide = (on) => { last.guide = on; guide.hidden = !on; guideBtn.setAttribute('aria-pressed', String(on)); };
    guideBtn.addEventListener('click', () => showGuide(!last.guide));
    showGuide(last.guide);

    const root = el('div', { class: 'console' },
      el('div', { class: 'row console-bar' },
        run,
        el('label', { class: 'check writes-check', title: `${_t('Lets the code call write, create, unlink and any other method that is not a read')} ${_t('Read-only by default. With writes allowed, each call is committed at once: there is no rollback.')}` },
          writes, _t('Allow Writes')),
        refreshBox,
        el('span', { class: 'muted who', title: _t('Runs as %s (uid %s): their access rights, record rules and companies apply.', info.username || info.name || '?', info.uid) },
          `${info.username || info.name || '?'} · uid ${info.uid}`),
        guideBtn),
      editorBox,
      guide,
      output);
    const flag = () => {
      last.writes = writes.checked;
      root.classList.toggle('writes-on', writes.checked);
      refreshBox.hidden = !writes.checked; // nothing to refresh after a read-only run
    };
    writes.addEventListener('change', flag);
    flag();
    view = { run, output };
    paint(); // the last result, when the tab was rebuilt after (or during) a run
    return root;
  });
}

/** Outcome of Auto Refresh (pageSoftReload: { ok } or { error }) for the result header. */
function refreshPill(r) {
  if (r.ok) return pill(_t('page refreshed'), 'info');
  return el('span', { class: 'pill', title: _t(r.error) }, _t('page not refreshed'));
}

/** The run's outcome: prints, error or return value, then the calls made. */
function result(r) {
  if (!r || (r.error && !('ok' in r))) return [el('div', { class: 'error' }, r?.error || _t('No response — is this an Odoo page?'))];
  const stats = callStats(r.calls);
  const parts = [el('div', { class: 'row result-head' },
    r.ok ? pill(_t('ok'), 'ok') : pill(_t('error'), 'err'),
    pill(r.readonly ? _t('read-only') : _t('writes allowed'), r.readonly ? '' : 'med'),
    el('span', { class: 'ms' }, _t('%s ms', r.ms)),
    el('span', { class: 'ms' }, _t('%s calls', stats.total)),
    stats.writes ? pill(_t('%s write calls', stats.writes), 'med') : null)];
  if (r.out.length) parts.push(el('pre', { class: 'prints' }, r.out.map(printText).join('\n')));
  if (!r.ok) parts.push(errorBox(r.error));
  else if (r.hasValue) parts.push(value(r.value));
  else parts.push(el('div', { class: 'note' }, _t('No return value: end with return … to see one.')));
  if (r.calls.length) parts.push(callList(r.calls));
  return parts;
}

function errorBox(e) {
  const where = e.line ? ` ${_t('(line %s)', e.line)}` : '';
  const message = e.msgid ? _t(e.msgid, ...e.args) : e.message;
  return el('div', { class: 'error mt' },
    e.type ? el('div', { class: 'muted' }, e.type) : e.name && !e.server ? el('div', { class: 'muted' }, e.name) : null,
    message + where,
    e.name === 'EvalError' ? el('div', { class: 'note' }, _t('This page\'s Content-Security-Policy forbids running code (a proxy in front of Odoo adds script-src).')) : null,
    e.traceback ? details(_t('Traceback'), pre(e.traceback)) : null);
}

function value(v) {
  const t = toTable(v);
  if (!t) return el('pre', { class: 'mt' }, formatValue(v));
  return el('div', { class: 'mt' },
    el('div', { class: 'muted' }, t.total > t.rows.length ? _t('%s rows (first %s shown)', t.total, MAX_ROWS) : _t('%s rows', t.total)),
    el('div', { class: 'table-wrap' }, el('table', {},
      el('thead', {}, el('tr', {}, t.columns.map((c) => el('th', {}, c)))),
      el('tbody', {}, t.rows.map((row) => el('tr', {}, row.map((c) => el('td', {}, c))))))),
    details(_t('JSON'), pre(formatValue(v))));
}

function callList(calls) {
  return details(_t('Calls (%s)', calls.length), el('ul', { class: 'steps' }, calls.map((c) => el('li', {},
    el('div', { class: 'row' },
      el('span', { class: 'name grow' }, `${c.model}.${c.method}`),
      c.write ? pill(_t('write'), 'med') : null,
      c.error ? pill(_t('error'), 'err') : null,
      el('span', { class: 'ms' }, _t('%s ms', c.ms))),
    el('div', { class: 'meta mono' }, `args ${c.args} · kwargs ${c.kwargs}`),
    c.error ? el('div', { class: 'meta error' }, c.error) : null))));
}
