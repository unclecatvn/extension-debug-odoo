// Toolbar popup (only enabled on Odoo pages, see background.js) and options page: language, theme, and (popup only)
// the page's host, Odoo version, database and debug mode.
import { LANGS, lang, loadLang, translateDom, _t, N_ } from '../shared/i18n.js';
import { THEMES, applyTheme, loadSettings } from '../shared/settings.js';
import { setTab, exec, rpc, sessionInfo } from '../shared/bridge.js';
import { $, el } from '../shared/ui.js';
import { pageDebug } from '../shared/page.js';

const THEME_LABELS = { auto: N_('System'), light: N_('Light'), dark: N_('Dark') }; // the editor themes keep their own names
const EDITOR_THEMES = { 'github-light': 'GitHub Light', 'solarized-light': 'Solarized Light', 'github-dark': 'GitHub Dark', dracula: 'Dracula',
  monokai: 'Monokai', 'one-dark': 'One Dark Pro', nord: 'Nord', 'solarized-dark': 'Solarized Dark', catppuccin: 'Catppuccin Mocha' };

const saved = await loadSettings();
await loadLang(saved.lang);
document.documentElement.lang = lang;
translateDom();
$('#version').textContent = `v${chrome.runtime.getManifest().version}`;

/** Segmented control: one button per [value, label, title?], `current` highlighted. */
function segmented(box, options, current, onPick) {
  box.replaceChildren(...options.map(([value, label, title]) => el('button', {
    class: value === current ? 'on' : '', role: 'radio', 'aria-checked': String(value === current), title,
    onclick: () => { segmented(box, options, value, onPick); onPick(value); },
  }, label)));
}
segmented($('#lang'), Object.entries(LANGS), lang, (v) => chrome.storage.local.set({ lang: v })); // loadSettings reloads the page
const themeBox = $('#theme');
themeBox.append(...THEMES.map((t) => el('option', { value: t }, THEME_LABELS[t] ? `Odoo · ${_t(THEME_LABELS[t])}` : EDITOR_THEMES[t])));
themeBox.value = THEMES.includes(saved.theme) ? saved.theme : 'auto';
themeBox.addEventListener('change', () => { applyTheme(themeBox.value); chrome.storage.local.set({ theme: themeBox.value }); }); // every open panel follows (loadSettings)

// Keyboard shortcuts (manifest "commands"): as set in chrome://extensions/shortcuts, where Change leads.
const COMMANDS = { 'toggle-panel': N_('panel'), 'popout-panel': N_('window'), 'toggle-debug': N_('debug') };
const all = await chrome.commands.getAll();
const keys = Object.keys(COMMANDS).map((name) => all.find((c) => c.name === name)).filter(Boolean); // panel first
$('#shortcuts').replaceChildren(...keys.flatMap((c, i) => [i ? ' · ' : '', el('kbd', {}, c.shortcut || '—'), ` ${_t(COMMANDS[c.name])}`]));
$('#edit-shortcuts').addEventListener('click', () => chrome.tabs.create({ url: 'chrome://extensions/shortcuts' }));

// "This page" only makes sense in the toolbar popup, not on the options page.
if (chrome.extension.getViews({ type: 'popup' }).includes(window)) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  setTab(tab); // exec() / rpc() below run in this tab, with its session
  const host = tab?.url ? new URL(tab.url).host : '';
  // one line: host, version, db, each after its icon (ui.css), the full value in the tooltip
  const info = (kind, text, title) => el('span', { class: 'info', 'data-info': kind, title: `${title}: ${text}` }, el('span', {}, text));
  const show = (version, db) => $('#page-info').replaceChildren(...[
    info('host', host, _t('Host')), version && info('version', version, _t('Odoo version')), db && info('db', db, _t('Database')),
  ].filter(Boolean));
  show('…');
  // Logged in: the session info has both. Logged out (login page): the version only, the db comes with a session.
  sessionInfo().then((i) => show(i.server_version, i.db),
    () => rpc('/web/webclient/version_info', {}).then((v) => show(v.server_version), () => show()));
  // Odoo's debug mode of this tab: reloads it with ?debug=0 / 1 / assets (Odoo keeps it in the session)
  const r = await exec(() => window.odoo?.debug || '');
  const debug = typeof r === 'string' ? r : ''; // not scriptable (chrome:// …): { error }, no current mode shown
  const current = debug.split(',').includes('assets') ? 'assets' : debug ? '1' : '0';
  const setMode = async (mode) => {
    await exec(pageDebug, mode);
    window.close();
  };
  // Keep it on: { origin → '1' | 'assets' } in storage, applied by content/bubble.js to every page opened without ?debug=
  const origin = tab?.url ? new URL(tab.url).origin : '';
  const { autoDebug = {} } = await chrome.storage.local.get('autoDebug');
  const keep = (mode) => {
    if (mode && mode !== '0') autoDebug[origin] = mode; else delete autoDebug[origin];
    return chrome.storage.local.set({ autoDebug });
  };
  const box = $('#keep');
  box.checked = !!autoDebug[origin];
  box.addEventListener('change', async () => {
    await keep(box.checked && (current === '0' ? '1' : current));
    if (box.checked && current === '0') setMode('1');
  });
  segmented($('#debug'), [['0', 'Off', _t('Turn Debug Off')], ['1', 'Debug', '?debug=1'], ['assets', 'Assets', '?debug=assets']], current, async (mode) => {
    if (box.checked) await keep(mode); // off: not kept any more
    setMode(mode);
  });
  $('#popout').addEventListener('click', () => { // src/background.js opens it (or brings it to the front)
    chrome.runtime.sendMessage({ type: 'odoo-popout', tabId: tab.id }).catch(() => {});
    window.close();
  });
  $('#page').hidden = false;
}
