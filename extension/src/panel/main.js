// Panel shell (in an iframe inside the Odoo page): header (status), tab switching, binding to its tab.
// The debug mode switch and the settings live in the toolbar popup (src/popup/); each tab's content in src/features/<tab>/.
import { lang, loadLang, translateDom, _t } from '../shared/i18n.js';
import { tabId, setTab, exec, clearCache } from '../shared/bridge.js';
import { $, el, pill, empty, clearForms, copyable } from '../shared/ui.js';
import { pageState } from '../shared/page.js';
import { renderRecord } from '../features/record/record.js';
import { renderView, setPicked } from '../features/view/view.js';
import { mountRpc, addRpc, reloadRpc } from '../features/rpc/rpc.js';
import { renderSecurity } from '../features/security/security.js';
import { renderPerf } from '../features/perf/perf.js';
import { renderTranslations } from '../features/translations/translations.js';
import { renderApps } from '../features/apps/apps.js';
import { renderCode, forgetRun } from '../features/code/code.js';
import { renderMenus } from '../features/menus/menus.js';
import { loadSettings } from '../shared/settings.js';

const settings = await loadSettings();
await loadLang(settings.lang); // before anything renders: every _t() below needs the catalog
document.documentElement.lang = lang;
translateDom();
for (const b of document.querySelectorAll('.tabs button')) b.title = b.textContent.trim(); // narrow panel: icons only, the name on hover

let state = {};
const TAB_KEY = 'odoo-debug-tab'; // sessionStorage (one per browser tab): the panel comes back on this tab after a reload
let active = 'record';
const RENDER = { record: renderRecord, view: renderView, security: renderSecurity, perf: renderPerf, translations: renderTranslations, apps: renderApps, code: renderCode, menus: renderMenus };
const rendered = new Set(); // tabs are rendered lazily, once per refresh

function renderActive() {
  if (!(active in RENDER) || rendered.has(active)) return;
  rendered.add(active);
  const s = $('#' + active);
  s.replaceChildren();
  if (!state.odoo) return s.append(empty(state.error ? _t('Cannot read this tab: %s', state.error) : _t('The current tab is not an Odoo page.')));
  RENDER[active](s, state);
}

// ---------- each tab's scroll position, back after a reload / re-render (sessionStorage, like the tab) ----------
const SCROLL_KEY = 'odoo-debug-scroll';
const main = $('main');
let scrolls = {};
try { scrolls = JSON.parse(sessionStorage.getItem(SCROLL_KEY)) || {}; } catch { /* storage off or bad value */ }
let restoring = null; // { tab, y, until }: cards load async, so the target is re-applied as the content grows
function restoreScroll(tab) {
  restoring = { tab, y: scrolls[tab] || 0, until: Date.now() + 10_000 };
  applyScroll();
}
function applyScroll() {
  if (!restoring) return;
  if (restoring.tab !== active || Date.now() > restoring.until) { restoring = null; return; }
  main.scrollTop = restoring.y; // clamped by the browser until the content is tall enough
}
const grows = new ResizeObserver(applyScroll); // a card loaded / opened: the content got taller
for (const sec of document.querySelectorAll('.tab')) grows.observe(sec);
for (const type of ['wheel', 'touchstart', 'keydown', 'pointerdown']) main.addEventListener(type, () => { restoring = null; }, { passive: true });
main.addEventListener('scroll', () => {
  if (restoring) return; // our own scrolling (or the content shrinking during a re-render) is not a position to keep
  scrolls[active] = main.scrollTop;
  try { sessionStorage.setItem(SCROLL_KEY, JSON.stringify(scrolls)); } catch { /* storage off */ }
}, { passive: true });

/** render = false: only select it (at startup, before the first refresh() has anything to render). */
function showTab(name, render = true) {
  active = name;
  try { sessionStorage.setItem(TAB_KEY, name); } catch { /* storage off: back to Record after a reload */ }
  for (const b of document.querySelectorAll('.tabs button')) {
    b.classList.toggle('active', b.dataset.tab === name);
    b.setAttribute('aria-selected', b.dataset.tab === name);
  }
  for (const s of document.querySelectorAll('.tab')) s.classList.toggle('active', s.id === name);
  restoreScroll(name);
  if (render) renderActive();
}

let seq = 0; // a slow refresh must not overwrite a newer one (fast navigation, ⟳)
async function refresh() {
  const n = ++seq;
  $('#refresh').classList.add('spin');
  const next = (await exec(pageState)) || {};
  if (n !== seq) return;
  $('#refresh').classList.remove('spin');
  if (next.loadedAt !== state.loadedAt) clearCache(); // another page load: cached reads are stale
  state = next;
  const { model, resId, viewType } = state;
  $('#status').replaceChildren(...(!state.odoo
    ? [el('span', {}, _t('Not an Odoo page'))]
    : [model ? copyable(model, 'model') : el('span', { class: 'model' }, '—'), resId && pill(`#${resId}`, 'accent'), viewType && pill(viewType),
      state.action?.name && el('span', {}, state.action.name)].filter(Boolean))); // replaceChildren would print null/undefined
  rendered.clear();
  restoreScroll(active); // the re-render empties the tab first: keep where it was
  renderActive();
}

// ---------- header ----------
mountRpc($('#rpc'), () => showTab('security'), () => state);
let saved = null;
try { saved = sessionStorage.getItem(TAB_KEY); } catch { /* storage off */ }
if ([...document.querySelectorAll('.tabs button')].some((b) => b.dataset.tab === saved)) showTab(saved, false);
for (const b of document.querySelectorAll('.tabs button')) b.addEventListener('click', () => showTab(b.dataset.tab));
$('#refresh').addEventListener('click', () => { clearCache(); clearForms(); forgetRun(); refresh(); }); // every tab re-renders, forms (and the Code tab's last run) empty

// ---------- bound to the tab it is embedded in (iframe from src/content/bubble.js; a page reload recreates it) ----------
let timer = null;
const scheduleRefresh = () => { clearTimeout(timer); timer = setTimeout(refresh, 500); };

chrome.tabs.onUpdated.addListener((id, change) => {
  if (id === tabId && (change.url || change.status === 'complete')) scheduleRefresh(); // Odoo's pushState navigation
});
addEventListener('message', (e) => { // from content/bubble.js: what the page recorded (RPCs) or picked (a field)
  if (e.source !== parent) return;
  const { type, detail } = e.data || {};
  if (type === 'odoo-debug-rpc') {
    addRpc(detail);
  } else if (type === 'odoo-debug-pick') {
    setPicked(detail); // '' = cancelled: the re-render just resets the picker button
    rendered.delete('view');
    showTab('view');
  }
});

// ---------- minimize: back to the Odoo Debug button (content/bubble.js hides the frame; the panel keeps its state) ----------
$('#minimize').addEventListener('click', () => chrome.tabs.sendMessage(tabId, { type: 'odoo-toggle', open: false }).catch(() => {}));

// ---------- full screen: the frame belongs to content/bubble.js, which answers with the resulting state ----------
const fullBtn = $('#full');
const isFull = () => fullBtn.getAttribute('aria-pressed') === 'true';
const setFull = (on) => chrome.tabs.sendMessage(tabId, { type: 'odoo-full', on }).then((now) => {
  fullBtn.setAttribute('aria-pressed', !!now); // ui.css swaps the icon
}, () => {});
fullBtn.addEventListener('click', () => setFull(!isFull()));
addEventListener('keydown', (e) => { // Esc leaves full screen, unless it is clearing a search box
  if (e.key === 'Escape' && isFull() && !e.target.value) setFull(false);
});

setTab(await chrome.tabs.getCurrent());
setFull(); // no argument: just read the state (full screen survives a reload)
await reloadRpc();
refresh();
