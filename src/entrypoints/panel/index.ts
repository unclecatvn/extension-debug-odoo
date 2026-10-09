// Panel shell: header (status, Odoo version), tab switching, binding to its tab. Two homes: an iframe inside the Odoo
// page (entrypoints/launcher), bound to the tab it is in; or its own window (?tab=<id>, opened by
// entrypoints/background/detached-panel.ts), bound to that tab from anywhere, e.g. on a second screen.
// The debug mode switch and the settings live in the toolbar popup (entrypoints/popup); each tab's content in
// features/<tab>/, listed in features/registry.ts.
import { isExtMessage, type ExtMessage } from '../../contracts/messages.ts';
import { clearCache } from '../../extension/page-cache.ts';
import { exec, isExecError, setTab, tabId } from '../../extension/run-in-tab.ts';
import { loadSettings } from '../../extension/settings.ts';
import { TABS, TAB_NAMES, isTabName, type PanelContext, type TabName } from '../../features/registry.ts';
import { RTL, _t, lang, loadLang, translateDom } from '../../i18n/i18n.ts';
import { pageState, type PageState } from '../../injected/page-state.ts';
import { odoo, type OdooContext } from '../../odoo/detect.ts';
import { copyable, empty, pill } from '../../ui/components.ts';
import { $ } from '../../ui/dom.ts';
import { clearForms } from '../../ui/form-state.ts';
import { templates } from '../../ui/template.ts';
import { startTooltips } from '../../ui/tooltip.ts';
import html from './panel.tpl.html';

const settings = await loadSettings();
await loadLang(settings.lang); // before anything renders: every _t() below needs the catalog
Object.assign(document.documentElement, { lang, dir: RTL.has(lang) ? 'rtl' : 'ltr' });
translateDom();
startTooltips();
const tpl = templates(html, translateDom);
/** In its own window: the tab it inspects (?tab=), else null (in the page). */
const ownWindowOf = Number(new URLSearchParams(location.search).get('tab')) || null;
for (const b of document.querySelectorAll<HTMLButtonElement>('.tabs button')) b.title = b.firstChild?.textContent?.trim() || ''; // narrow panel: icons only, the name on hover

let state: PageState = { url: '', origin: '', loadedAt: 0, odoo: false, debug: '' };
let ctx: OdooContext | null = null;
let ctxError: unknown = null;
const TAB_KEY = 'odoo-debug-tab'; // sessionStorage (one per browser tab): the panel comes back on this tab after a reload
let active: TabName = 'record';
const rendered = new Set<TabName>(); // tabs are rendered lazily, once per refresh
const section = (name: TabName) => $(`#${name}`);

function renderActive() {
  if (rendered.has(active)) return;
  rendered.add(active);
  const s = section(active);
  const tab = TABS[active];
  if (!tab?.render) {
    if (!tab?.mount) s.replaceChildren(tpl('not-ported').root);
    return;
  }
  s.replaceChildren();
  if (!state.odoo) return s.append(empty(state.error ? _t('Cannot read this page: %s', state.error) : _t('The current tab is not an Odoo page.')));
  if (!ctx) return s.append(empty(_t('Cannot read this page: %s', (ctxError as Error)?.message ?? ctxError)));
  const why = tab.supports?.(ctx);
  if (why) return s.append(empty(_t('Not available on Odoo %s: %s', ctx.version.label, why)));
  tab.render(s, state, ctx);
}

// ---------- each tab's scroll position, back after a reload / re-render (sessionStorage, like the tab) ----------
const SCROLL_KEY = 'odoo-debug-scroll';
const main = $('main');
let scrolls: Partial<Record<TabName, number>> = {};
try { scrolls = JSON.parse(sessionStorage.getItem(SCROLL_KEY) || '{}') as typeof scrolls; } catch { /* storage off or bad value */ }
let restoring: { tab: TabName; y: number; until: number } | null = null; // cards load async: the target is re-applied as the content grows
function restoreScroll(tab: TabName) {
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
function showTab(name: TabName, render = true) {
  active = name;
  try { sessionStorage.setItem(TAB_KEY, name); } catch { /* storage off: back to Record after a reload */ }
  for (const b of document.querySelectorAll<HTMLElement>('.tabs button')) {
    b.classList.toggle('active', b.dataset.tab === name);
    b.setAttribute('aria-selected', String(b.dataset.tab === name));
  }
  for (const s of document.querySelectorAll('.tab')) s.classList.toggle('active', s.id === name);
  restoreScroll(name);
  if (render) renderActive();
}

/** The Odoo version in the header, flagged when the panel can't vouch for it (see odoo/version.ts → Support). */
function showVersion() {
  const box = $('#odoo-version');
  if (!ctx) return box.replaceChildren();
  const { version, support, adapter, mismatches } = ctx;
  const warnings = [
    support === 'untested' && _t('Odoo %s is untested: using the Odoo %s support, some cards may fail.', version.label, adapter.major),
    support === 'unsupported' && _t('Odoo %s is older than every supported version: some cards may fail.', version.label),
    mismatches.length && _t('This database lacks fields the panel expects for Odoo %s: %s', adapter.major,
      mismatches.map((m) => `${m.model}.${m.field} (${m.usedBy})`).join(', ')),
  ].filter((w): w is string => !!w);
  const short = `${version.saas ? 'saas~' : ''}${version.major}.${version.minor}`; // the build date in the tooltip: the header stays short
  const p = pill(`Odoo ${short}${warnings.length ? ' ⚠' : ''}`, warnings.length ? 'med' : '');
  p.title = warnings.join('\n') || _t('Odoo %s, supported', version.label);
  box.replaceChildren(p);
}

/** The header status: model (click to copy), record id, view type, action name. */
function statusParts(): HTMLElement[] {
  if (!state.odoo) return [tpl('status-not-odoo').root];
  const { model, resId, viewType, action } = state;
  const parts: HTMLElement[] = [model ? copyable(model, 'model') : tpl('status-no-model').root];
  if (resId) parts.push(pill(`#${resId}`, 'accent'));
  if (viewType) parts.push(pill(viewType));
  if (typeof action?.name === 'string') {
    const { root, refs } = tpl('status-text', { text: HTMLSpanElement });
    refs.text.textContent = action.name;
    parts.push(root);
  }
  return parts;
}

let seq = 0; // a slow refresh must not overwrite a newer one (fast navigation, ⟳)
let observedPage = state; // observations advance before slow Odoo detection commits the rendered state (BFCache too)
async function refresh() {
  const n = ++seq;
  $('#refresh').classList.add('spin');
  const r = await exec(pageState);
  if (n !== seq) return;
  const next: PageState = r && !isExecError(r) ? r : { ...state, odoo: false, error: r?.error };
  if (next.loadedAt !== observedPage.loadedAt) {
    clearCache(); // another page load: cached reads are stale
  }
  for (const name of TAB_NAMES) TABS[name]?.pageObserved?.(observedPage, next);
  observedPage = next;
  ctx = null;
  ctxError = null;
  if (next.odoo) await odoo().then((c) => { ctx = c; }, (e: unknown) => { ctxError = e; });
  if (n !== seq) return;
  $('#refresh').classList.remove('spin');
  state = next;
  if (ownWindowOf != null) document.title = state.url ? `Odoo Debug · ${new URL(state.url).host}` : 'Odoo Debug'; // its window's title
  $('#status').replaceChildren(...statusParts());
  showVersion();
  rendered.clear();
  restoreScroll(active); // the re-render empties the tab first: keep where it was
  renderActive();
}

// ---------- tabs ----------
const panel: PanelContext = { state: () => state, odoo: () => ctx, showTab, rerender: (name) => { rendered.delete(name); showTab(name); } };
// before mounting: the RPC log reads what the page recorded already
setTab(ownWindowOf != null ? await chrome.tabs.get(ownWindowOf).catch(() => undefined) : await chrome.tabs.getCurrent());
// Mount prologues initialize DOM synchronously. Listen before awaiting the RPC snapshot: a completion arriving
// between snapshot capture and delivery must update its pending row, not disappear during panel startup.
const mounting = TAB_NAMES.map((name) => TABS[name]?.mount?.(section(name), panel));
let mounted = false;
chrome.runtime.onMessage.addListener((msg: unknown, sender) => {
  if (sender.tab?.id !== tabId || !isExtMessage(msg)) return;
  if (!mounted) {
    if (msg.type === 'odoo-rpc') TABS.rpc?.onMessage?.(msg);
    return; // other tabs keep their startup behaviour until mounting is finished
  }
  for (const name of TAB_NAMES) {
    const show = TABS[name]?.onMessage?.(msg);
    if (show) {
      rendered.delete(show);
      showTab(show);
    }
  }
});
await Promise.all(mounting);
mounted = true;
let saved: string | null = null;
try { saved = sessionStorage.getItem(TAB_KEY); } catch { /* storage off */ }
if (isTabName(saved)) showTab(saved, false);
for (const b of document.querySelectorAll<HTMLElement>('.tabs button')) {
  b.addEventListener('click', () => { if (isTabName(b.dataset.tab)) showTab(b.dataset.tab); });
}
$('#refresh').addEventListener('click', () => { // every tab re-renders, forms (and what tabs keep) empty
  clearCache();
  clearForms();
  for (const name of TAB_NAMES) TABS[name]?.reset?.();
  void refresh();
});

// ---------- bound to the tab it is embedded in (iframe from entrypoints/launcher; a page reload recreates it) ----------
let timer: ReturnType<typeof setTimeout> | undefined;
const scheduleRefresh = () => { clearTimeout(timer); timer = setTimeout(refresh, 500); };

chrome.tabs.onUpdated.addListener((id, change) => {
  if (id === tabId && (change.url || change.status === 'complete')) scheduleRefresh(); // Odoo's pushState navigation
});

// ---------- minimize: back to the Odoo Debug button (the launcher hides the frame; the panel keeps its state) ----------
$('#minimize').addEventListener('click', () => {
  if (tabId != null) chrome.tabs.sendMessage(tabId, { type: 'odoo-toggle', open: false } satisfies ExtMessage).catch(() => {});
});

// ---------- full screen: the frame belongs to the launcher, which answers with the resulting state ----------
const fullBtn = $('#full');
const isFull = () => fullBtn.getAttribute('aria-pressed') === 'true';
const setFull = (on?: boolean) => {
  if (tabId == null) return;
  chrome.tabs.sendMessage<ExtMessage, boolean>(tabId, { type: 'odoo-full', on }).then((now) => {
    fullBtn.setAttribute('aria-pressed', String(!!now));
    fullBtn.textContent = now ? '⤡' : '⤢';
  }, () => {});
};
fullBtn.addEventListener('click', () => setFull(!isFull()));
addEventListener('keydown', (e) => { // Esc leaves full screen, unless it is clearing a search box
  if (e.key === 'Escape' && isFull() && !(e.target as HTMLInputElement | null)?.value) setFull(false);
});

// ---------- its own window: open it (from the page), back into the page (from the window) ----------
const detachBtn = $('#detach');
const attachBtn = $('#attach');
// removed, not hidden: .icon-btn's display would win over [hidden]
if (ownWindowOf != null) { detachBtn.remove(); $('#full').remove(); $('#minimize').remove(); } else attachBtn.remove();
detachBtn.addEventListener('click', () => { if (tabId != null) chrome.runtime.sendMessage({ type: 'odoo-detach', tabId } satisfies ExtMessage).catch(() => {}); });
attachBtn.addEventListener('click', () => { if (tabId != null) chrome.runtime.sendMessage({ type: 'odoo-attach', tabId } satisfies ExtMessage).catch(() => {}); });
if (ownWindowOf != null) chrome.tabs.onRemoved.addListener((id) => { if (id === ownWindowOf) window.close(); }); // nothing left to inspect

if (ownWindowOf == null) setFull(); // no argument: just read the state (full screen survives a reload)
void refresh();
