// Toolbar popup (only enabled on Odoo pages, see entrypoints/background) and options page: language, theme, shortcuts, and
// (popup only) the page's host, Odoo version, database, the panel in its own window, debug mode.
import type { ExtMessage } from '../../contracts/messages.ts';
import { THEMES, applyTheme, isTheme, loadSettings, type Theme } from '../../extension/settings.ts';
import { LANGS, N_, _t, lang, loadLang, translateDom } from '../../i18n/i18n.ts';
import { pageDebug, pageDebugMode } from '../../injected/debug-mode.ts';
import { setTab } from '../../extension/run-in-tab.ts';
import type { Json } from '../../contracts/json.ts';
import { sessionInfo } from '../../odoo/reads.ts';
import { rpc } from '../../odoo/rpc.ts';
import { $ } from '../../ui/dom.ts';
import { templates } from '../../ui/template.ts';
import html from './popup.tpl.html';

const THEME_LABELS: Partial<Record<Theme, string>> = { auto: N_('System'), light: N_('Light'), dark: N_('Dark') }; // editor themes keep their names
const EDITOR_THEMES: Partial<Record<Theme, string>> = { 'github-light': 'GitHub Light', 'solarized-light': 'Solarized Light', 'github-dark': 'GitHub Dark',
  dracula: 'Dracula', monokai: 'Monokai', 'one-dark': 'One Dark Pro', nord: 'Nord', 'solarized-dark': 'Solarized Dark', catppuccin: 'Catppuccin Mocha' };

const saved = await loadSettings();
await loadLang(saved.lang);
document.documentElement.lang = lang;
translateDom();
const tpl = templates(html, translateDom);
$('#version').textContent = `v${chrome.runtime.getManifest().version}`;

/** Segmented control: one button per [value, label, title?], `current` highlighted. */
function segmented<V extends string>(box: HTMLElement, options: [V, string, string?][], current: V, onPick: (v: V) => void) {
  box.replaceChildren(...options.map(([value, label, title]) => {
    const { button } = tpl('seg-option', { button: HTMLButtonElement }).refs;
    button.textContent = label;
    if (title) button.title = title;
    button.classList.toggle('on', value === current);
    button.setAttribute('aria-checked', String(value === current));
    button.addEventListener('click', () => { segmented(box, options, value, onPick); onPick(value); });
    return button;
  }));
}
segmented($('#lang'), Object.entries(LANGS) as [string, string][], lang, (v) => { void chrome.storage.local.set({ lang: v }); }); // loadSettings reloads the page
const themeBox = $<HTMLSelectElement>('#theme');
themeBox.append(...THEMES.map((t) => {
  const { option } = tpl('theme-option', { option: HTMLOptionElement }).refs;
  const odooLabel = THEME_LABELS[t];
  option.value = t;
  option.textContent = odooLabel ? `Odoo · ${_t(odooLabel)}` : EDITOR_THEMES[t] ?? t;
  return option;
}));
themeBox.value = isTheme(saved.theme) ? saved.theme : 'auto';
themeBox.addEventListener('change', () => { applyTheme(themeBox.value); void chrome.storage.local.set({ theme: themeBox.value }); }); // every open panel follows

// Keyboard shortcuts (manifest "commands"): as set in chrome://extensions/shortcuts, where Change leads.
const COMMANDS: Record<string, string> = { 'toggle-panel': N_('panel'), 'popout-panel': N_('window'), 'toggle-debug': N_('debug') };
const all = await chrome.commands.getAll();
const keys = Object.keys(COMMANDS).map((name) => all.find((c) => c.name === name)).filter((c) => !!c); // panel first
$('#shortcuts').replaceChildren(...keys.map((c) => {
  const { root, refs } = tpl('shortcut', { keys: HTMLElement, label: HTMLSpanElement });
  refs.keys.textContent = c.shortcut || '—';
  refs.label.textContent = _t(COMMANDS[c.name!] ?? '');
  return root;
}));
$('#edit-shortcuts').addEventListener('click', () => { void chrome.tabs.create({ url: 'chrome://extensions/shortcuts' }); });

// "This page" only makes sense in the toolbar popup, not on the options page.
type DebugMode = '0' | '1' | 'assets';
const [tab] = chrome.extension.getViews({ type: 'popup' }).includes(window) ? await chrome.tabs.query({ active: true, currentWindow: true }) : [];
if (tab?.id != null) {
  const tabId = tab.id;
  setTab(tab); // sessionInfo() / rpc() below run in this tab, with its session
  // one line: host, version, database, each after its icon, the full value on hover
  const host = tab.url ? new URL(tab.url).host : '';
  const info = (kind: string, text: string, title: string) => {
    const r = tpl('info', { info: HTMLSpanElement, text: HTMLSpanElement }).refs;
    r.info.dataset.info = kind;
    r.info.title = `${title}: ${text}`;
    r.text.textContent = text;
    return r.info;
  };
  const show = (version?: string, db?: string) => $('#page-info').replaceChildren(info('host', host, _t('Host')),
    ...(version ? [info('version', version, _t('Odoo version'))] : []), ...(db ? [info('db', db, _t('Database'))] : []));
  show('…');
  // Logged in: the session info has both. Logged out (login page): the version only, the database comes with a session.
  sessionInfo().then((i) => show(i.server_version, i.db),
    () => rpc<{ server_version?: Json }>('/web/webclient/version_info', {}).then((v) => show(String(v.server_version ?? '')), () => show()));
  $('#detach').addEventListener('click', () => { // entrypoints/background/detached-panel.ts opens it (or brings it to the front)
    chrome.runtime.sendMessage({ type: 'odoo-detach', tabId } satisfies ExtMessage).catch(() => {});
    window.close();
  });
  // Odoo's debug mode of this tab: reloads it with ?debug=0 / 1 / assets (Odoo keeps it in the session)
  const [res] = await chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', func: pageDebugMode })
    .catch(() => []); // not scriptable (chrome:// …): no current mode shown
  const debug = res?.result ?? '';
  const current: DebugMode = debug.split(',').includes('assets') ? 'assets' : debug ? '1' : '0';
  const setMode = async (mode: DebugMode) => {
    await chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', func: pageDebug, args: [mode] }).catch(() => {});
    window.close();
  };
  // Keep it on: { origin → '1' | 'assets' } in storage, applied by the launcher to every page opened without ?debug=
  const origin = tab.url ? new URL(tab.url).origin : '';
  const { autoDebug = {} } = (await chrome.storage.local.get('autoDebug')) as { autoDebug?: Record<string, string> };
  const keep = (mode: DebugMode | false) => {
    if (mode && mode !== '0') autoDebug[origin] = mode; else delete autoDebug[origin];
    return chrome.storage.local.set({ autoDebug });
  };
  const box = $<HTMLInputElement>('#keep');
  box.checked = !!autoDebug[origin];
  box.addEventListener('change', async () => {
    await keep(box.checked && (current === '0' ? '1' : current));
    if (box.checked && current === '0') await setMode('1');
  });
  segmented<DebugMode>($('#debug'), [['0', 'Off', _t('Turn Debug Off')], ['1', 'Debug', '?debug=1'], ['assets', 'Assets', '?debug=assets']], current, async (mode) => {
    if (box.checked) await keep(mode); // off: not kept any more
    await setMode(mode);
  });
  $('#page').hidden = false;
}
