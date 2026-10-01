// Panel UI helpers: a tiny DOM builder, the panel's widgets (cards, filtered lists, expandable rows), what was typed in the forms.
import { _t } from './i18n.js';

export const $ = (s) => document.querySelector(s);

// ---------- what was typed in a tab's form: kept across re-renders and reloads, forgotten on ⟳ Reload Data ----------
const FORM = 'odoo-debug-form:'; // localStorage of the panel (every instance): a per-viewer convenience only
export const formValues = (key) => { try { return JSON.parse(localStorage.getItem(FORM + key)) || {}; } catch { return {}; } };
export const saveForm = (key, values) => { try { localStorage.setItem(FORM + key, JSON.stringify(values)); } catch { /* storage off */ } };
export function clearForms() {
  try { for (const k of Object.keys(localStorage)) if (k.startsWith(FORM)) localStorage.removeItem(k); } catch { /* storage off */ }
}

// DOM builder: text only goes through textContent, Odoo data never touches innerHTML.
export function el(tag, props = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || (v === false && k !== 'spellcheck')) continue; // spellcheck: the one property on by default
    if (k === 'class') n.className = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (k.startsWith('data-') || k.startsWith('aria-') || k === 'role') n.setAttribute(k, v);
    else n[k] = v;
  }
  for (const k of kids.flat()) if (k != null && k !== false) n.append(k instanceof Node ? k : String(k));
  return n;
}
export const pre = (o) => el('pre', {}, typeof o === 'string' ? o : JSON.stringify(o, null, 2));
/** Collapsible section, closed until its summary is clicked. */
export const details = (summary, ...kids) => el('details', {}, el('summary', {}, summary), ...kids);
export const errBox = (e) => el('div', { class: 'error' }, e.message, e.traceback ? details(_t('Traceback'), pre(e.traceback)) : null);
export const pill = (text, kind = '') => el('span', { class: `pill ${kind}` }, text);
/** true / false / anything else (unknown) → green / red / `unknownKind` pill with the matching label. */
export const triPill = (v, [yes, no, unknown] = ['✓', '✗', '?'], unknownKind = '') =>
  v === true ? pill(yes, 'ok') : v === false ? pill(no, 'err') : pill(unknown, unknownKind);
export const empty = (msg) => el('div', { class: 'empty' }, msg);
export const kv = (obj) => el('dl', { class: 'kv' }, Object.entries(obj).flatMap(([k, v]) =>
  [el('dt', {}, k), el('dd', {}, v !== null && typeof v === 'object' ? JSON.stringify(v) : String(v ?? ''))]));

/** Opens /odoo/<path> (e.g. res.partner/7) of the inspected Odoo in a new tab (the inspected tab stays put). */
export const odooLink = (origin, path, text = '↗') => el('a', {
  class: 'btn', href: `${origin}/odoo/${path}`, target: '_blank', rel: 'noopener', title: _t('Open /odoo/%s', path),
}, text);

/** A list row in two columns: `info` on the left (wraps as needed), `actions` (↗ buttons…) on the right, lined up on every row. */
export const splitRow = (info, ...actions) => el('div', { class: 'row split' },
  el('div', { class: 'row grow' }, info), el('div', { class: 'actions' }, actions));

/** Column names of a .list, shown only when the list is laid out as a table (wide panel, see ui.css). */
export const listHead = (main, desc) => el('div', { class: 'list-head', 'aria-hidden': 'true' }, el('span', {}, main), el('span', {}, desc));

// Cards start closed; the ones opened stay open across re-renders and reloads (localStorage of the panel, every instance).
const OPEN_CARDS = 'odoo-debug-open-cards';
const openCards = () => { try { return new Set(JSON.parse(localStorage.getItem(OPEN_CARDS)) || []); } catch { return new Set(); } };
function rememberCard(id, open) {
  const ids = openCards();
  if (open) ids.add(id); else ids.delete(id);
  try { localStorage.setItem(OPEN_CARDS, JSON.stringify([...ids])); } catch { /* storage off: every card starts closed */ }
}

/** ⓘ next to a title: `text` (what the title leaves out: model, legend…) shows on hover / keyboard focus. A popover, in
 * the top layer: the card's overflow would clip a tooltip drawn inside it, the card being closed or not. */
export function infoTip(text) {
  const tip = el('span', { class: 'tip', popover: 'manual', role: 'tooltip' }, text);
  const show = () => {
    tip.showPopover();
    const r = i.getBoundingClientRect();
    Object.assign(tip.style, { left: `${Math.max(8, Math.min(r.left - 8, innerWidth - tip.offsetWidth - 8))}px`, top: `${r.bottom + 6}px` });
  };
  const hide = () => tip.hidePopover();
  const i = el('span', { class: 'info-tip', role: 'img', tabIndex: 0, 'aria-label': text,
    onmouseenter: show, onmouseleave: hide, onfocus: show, onblur: hide,
    onclick: (e) => e.preventDefault() }, tip); // in a <summary>: hovering it is enough, a click must not fold the card
  return i;
}

/** A collapsible card of the tab `parent`, remembered as `<tab>:<key>` (key: stable, the title is translated / dynamic).
 * Its body is built the first time it opens (`fn` may be async); a failing card (e.g. no ACL on ir.rule) doesn't blank the others.
 * `hint`: an ⓘ after the title, see infoTip(). */
export function block(parent, key, title, fn, hint) {
  const id = `${parent.id}:${key}`;
  const body = el('div', { class: 'card-body' });
  const c = el('details', { class: 'card', 'data-key': key }, el('summary', {}, el('h3', {}, title), hint && infoTip(hint)), body); // data-key: the full-screen layout places some side by side
  let loaded = false;
  const load = () => {
    if (loaded) return;
    loaded = true;
    fill(body, fn);
  };
  c.addEventListener('toggle', () => { rememberCard(id, c.open); if (c.open) load(); });
  c.open = openCards().has(id);
  if (c.open) load();
  parent.append(c);
}

/** A card without a title, always open, its body built right away (`fn` may be async). */
export function card(parent, fn) {
  const body = el('div', { class: 'card-body' });
  parent.append(el('div', { class: 'card' }, body));
  fill(body, fn);
}

/** `body` shows Loading…, then what `fn` builds, or its error (a failing card doesn't blank the others). */
function fill(body, fn) {
  body.replaceChildren(el('div', { class: 'loading' }, _t('Loading…')));
  Promise.resolve().then(fn).then((n) => body.replaceChildren(...[n].filter(Boolean)), (e) => body.replaceChildren(errBox(e)));
}

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); } catch { // clipboard API refused (focus, permissions policy)
    const ta = el('textarea', { value: text });
    document.body.append(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
}

/** `text` (a field name, xmlid…) as a button copying it to the clipboard; ✓ for a second after. `label`: shown instead (e.g. masked). */
export function copyable(text, cls = 'name', label = text) {
  const b = el('button', {
    class: `${cls} copy`, title: _t('Click to copy'),
    onclick: async () => {
      await copyText(text);
      b.classList.add('copied');
      setTimeout(() => b.classList.remove('copied'), 1000);
    },
  }, label);
  return b;
}

/** Filterable list with a count. items: <li> with data-q. total / visible: N_ msgids with %s and %s/%s. head: listHead(). */
export function filteredList(items, placeholder, total, visible, head) {
  const count = el('span', { class: 'muted' }, _t(total, items.length));
  return el('div', {},
    el('div', { class: 'toolbar' }, filterBox(items, placeholder, (n) => { count.textContent = _t(visible, n, items.length); }), count, head),
    el('ul', { class: 'list' }, items));
}

/** Search box hiding the `items` whose data-q doesn't contain its text; onCount(visible) after each change. */
export function filterBox(items, placeholder, onCount) {
  const input = el('input', { type: 'search', placeholder });
  input.addEventListener('input', () => {
    const q = input.value.toLowerCase();
    for (const li of items) li.hidden = !li.dataset.q.includes(q);
    onCount?.(items.filter((li) => !li.hidden).length);
  });
  return input;
}

/** List item that toggles open on click / Enter / Space (open shows everything below its .row, see ui.css)
 * and builds its detail pane the first time (`detail` may be async, or omitted: the row only unfolds).
 * In a masterDetail() list on a wide panel, the detail shows in the pane beside the list instead, one row at a time. */
export function expandable(li, detail) {
  li.tabIndex = 0;
  li.addEventListener('keydown', (ev) => {
    if (ev.target === li && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); li.click(); }
  });
  li.addEventListener('click', (ev) => {
    const own = ev.target.closest('.detail, details, a, button, input, select');
    if (own && li.contains(own)) return; // not an ancestor: a row nested in another row's .detail still toggles
    const list = li.parentElement;
    const pane = WIDE.matches && list.pane;
    if (pane) for (const o of list.children) if (o !== li) o.classList.remove('open');
    const open = li.classList.toggle('open');
    if (detail && !li.detail) {
      const d = li.detail = el('div', { class: 'detail' }, el('div', { class: 'loading' }, _t('Loading…')));
      Promise.resolve().then(detail).then((x) => d.replaceChildren(...[x].filter(Boolean)), (e) => d.replaceChildren(errBox(e)));
    }
    if (pane) pane.replaceChildren(open && li.detail ? li.detail : pane.hint);
    else if (li.detail && li.detail.parentNode !== li) li.append(li.detail);
  });
  return li;
}

export const WIDE = matchMedia('(min-width: 900px)'); // the full-screen layout of ui.css

/** `list` (of expandable rows) with a pane beside it: on a wide panel a clicked row's detail shows there, like the
 * Network tab of the devtools; narrow, the pane hides and rows unfold in place. → the wrapper to put where `list` was. */
export function masterDetail(list, hint) {
  const pane = list.pane = el('aside', { class: 'pane' });
  pane.hint = empty(hint);
  const sync = () => { // the layout changed (full screen on / off): the open detail moves between its row and the pane
    if (sync.ran && !wrap.isConnected) return WIDE.removeEventListener('change', sync); // re-rendered away
    sync.ran = true;
    const open = [...list.children].filter((li) => li.classList.contains('open'));
    if (WIDE.matches) {
      for (const li of open.slice(1)) li.classList.remove('open');
      pane.replaceChildren(open[0]?.detail || pane.hint);
    } else for (const li of open) if (li.detail) li.append(li.detail);
  };
  const wrap = el('div', { class: 'master-detail' }, list, pane);
  WIDE.addEventListener('change', sync);
  sync();
  return wrap;
}
