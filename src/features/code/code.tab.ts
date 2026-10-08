// Code tab: an ORM console, in two languages, run as the logged-in user:
//   JavaScript  in the page, an ORM-like env over call_kw (code.injected.ts): every call with the user's rights
//   Python      on the server, a temporary server action (code.data.ts): safe_eval, Settings rights
// Both get the screen as a server action would — record (opened), records (selected), model — and a mode: read-only
// (JS: a writing call is refused), dry run (JS: listed, not sent; Python: run, then rolled back), or writes (committed;
// Auto Refresh then reloads the view). The result shows each value as what it is (code.result.ts). Snippets: built-in
// and saved per Odoo (code.snippets.ts). The editor colours, completes (models, fields, methods) and types smartly.
import { N_, _t } from '../../i18n/i18n.ts';
import type { PageState } from '../../injected/page-state.ts';
import type { OdooContext } from '../../odoo/detect.ts';
import { sessionInfo } from '../../odoo/reads.ts';
import { errBox, loading } from '../../ui/components.ts';
import { segmented } from '../../ui/parts.ts';
import type { PanelContext, TabModule } from '../registry.ts';
import { runJs, runPython, screenOf, softReload, type Screen } from './code.data.ts';
import { codeEditor, replaceRange, smartKey, type Editor } from './code.editor.ts';
import { historyPane } from './code.history.ts';
import { captureRun, historyScope, restoreMode, sameRunPage } from './code.history.logic.ts';
import type { RunResult } from './code.injected.ts';
import { callStats, codeKey, type Lang, type RunMode } from './code.logic.ts';
import { resultView, type Fmt } from './code.result.ts';
import { guide, saveSnippet, snippetList, type Snippet } from './code.snippets.ts';
import { forgetRun, history, keepAutoRefresh, keepLang, last, loadCode, saveCode, selectScope } from './code.state.ts';
import { suggester } from './code.suggest.ts';
import { button, check, text, tpl } from './code.ui.ts';

const PLACEHOLDER: Record<Lang, string> = {
  js: N_('// JavaScript with env, record, records, model, print, Command. ⌘/Ctrl+Enter runs it.'),
  python: N_('# Python with env, record, records, model, print, Command; return a value. ⌘/Ctrl+Enter runs it.'),
};
const MODES: Record<Lang, [RunMode, string][]> = {
  js: [['read', N_('Read-only')], ['dry', N_('Dry run')], ['write', N_('Allow writes')]],
  python: [['dry', N_('Dry run')], ['write', N_('Commit')]],
};

/** The console on screen (a run that ends after a rebuild is shown in the new one). */
let view: { output: HTMLElement; run: HTMLButtonElement; ed: Editor; scope: string; drawAside(): void } | null = null;
let panel: PanelContext | null = null;
let renderVersion = 0;
let paintVersion = 0;

export const codeTab: TabModule = {
  mount(_section, context) { panel = context; },
  render(section, page, odoo) {
    const version = ++renderVersion;
    view = null;
    section.replaceChildren(loading());
    void build(section, page, odoo, version).catch((e: unknown) => {
      if (version === renderVersion) section.replaceChildren(errBox(e));
    });
  },
  reset: forgetRun,
};

async function build(section: HTMLElement, page: PageState, odoo: OdooContext, version: number) {
  const info = await sessionInfo();
  if (version !== renderVersion) return;
  const scope = historyScope(page.origin, info.db, info.uid);
  selectScope(scope);
  const cloned = tpl('console', { root: HTMLDivElement, bar: HTMLDivElement, acts: HTMLDivElement, screen: HTMLDivElement, editor: HTMLDivElement, guide: HTMLDivElement, output: HTMLDivElement });
  const r = cloned.refs;
  const lang = () => last.lang;
  const key = () => codeKey(page.origin, lang());
  const ed = codeEditor(loadCode(key()) ?? '', _t('Code'), lang());
  ed.ta.placeholder = _t(PLACEHOLDER[lang()]);
  const fmt: Fmt = { origin: page.origin, lang: String(info.user_context?.lang ?? navigator.language), tz: String(info.user_context?.tz ?? '') };

  // ---------- the screen the code runs on, and as whom ----------
  let screen: Screen = { model: page.model ?? null, resId: page.resId ?? null, ids: [] };
  const who = text(`${info.username || info.name} · uid ${info.uid}`, 'muted who', _t('Runs as %s (uid %s): their access rights, record rules and companies apply.', info.username || info.name, info.uid));
  const drawScreen = () => {
    const parts: (Node | string)[] = [text(_t('Runs on:'), '')];
    if (!screen.model) parts.push(text(_t('no model on this screen'), 'muted'));
    else {
      parts.push(text(screen.model, 'mono'));
      parts.push(text(screen.resId ? _t('record #%s', screen.resId) : _t('no record opened'), 'muted'));
      if (screen.ids.length) parts.push(text(_t('%s selected', screen.ids.length), 'muted', screen.ids.slice(0, 40).join(', ')));
    }
    const again = button('⟳', () => { void readScreen().catch((error: unknown) => r.screen.append(errBox(error))); }, 'chip', _t('Read the selection again'));
    again.classList.add('reload'); // an icon (panel.css)
    parts.push(again);
    r.screen.replaceChildren(...parts, who);
  };
  const readScreen = async () => { screen = await screenOf(page); drawScreen(); return screen; };
  drawScreen();
  void readScreen().catch(() => {}); // a failed initial selection read is reported if the user runs

  // ---------- the bar ----------
  const run = button(`▶ ${_t('Run')}`, () => void go(), 'btn', _t('Run (⌘/Ctrl+Enter)'));
  run.classList.add('primary');
  const refreshBox = check(_t('Auto Refresh'), last.autoRefresh, keepAutoRefresh, _t('After a run that writes, reload the view\'s data (soft_reload), not the whole page'));
  const modeSlot = text('');
  const drawMode = () => {
    const l = lang();
    modeSlot.replaceChildren(segmented(MODES[l].map(([v, label]) => [v, _t(label)] as [RunMode, string]), last.mode[l], (v) => { last.mode[l] = v; flag(); }));
    flag();
  };
  const flag = () => {
    const writes = last.mode[lang()] === 'write';
    r.root.classList.toggle('writes-on', writes);
    refreshBox.hidden = !writes;
  };
  const changeLanguage = (l: Lang) => {
    saveCode(key(), ed.ta.value);
    keepLang(l);
    ed.ta.value = loadCode(key()) ?? '';
    ed.ta.placeholder = _t(PLACEHOLDER[l]);
    ed.setLang(l);
    drawMode();
    drawAside();
    void paint();
  };
  const langSeg = text('');
  const drawLanguage = () => langSeg.replaceChildren(segmented<Lang>([['js', 'JavaScript'], ['python', 'Python']], lang(), changeLanguage));
  drawLanguage();
  // an icon, and its name when the panel has room for it (panel.css: .aside-btn); the hint names it either way
  const asideBtn = (which: 'guide' | 'snippets' | 'history', label: string, hint: string) => {
    const b = button('', () => { last.aside = last.aside === which ? null : which; drawAside(); }, 'chip', hint);
    b.classList.add('aside-btn');
    b.dataset.aside = which;
    b.append(text(label));
    return b;
  };
  const snippetsBtn = asideBtn('snippets', _t('Snippets'), _t('Built-in snippets and the ones you saved for this Odoo'));
  const historyBtn = asideBtn('history', _t('History'), _t('Inspect recent runs, restore code, or save a run as a snippet'));
  const guideBtn = asideBtn('guide', '?', _t('Guide: available variables, recordset API, examples'));
  r.acts.append(snippetsBtn, historyBtn, guideBtn, run); // what to do: Run last, where the eye ends
  langSeg.classList.add('console-lang');
  modeSlot.classList.add('console-mode');
  r.acts.before(langSeg, modeSlot, refreshBox); // how it runs (narrow panel: language beside the actions, mode below; panel.css)
  drawMode();

  // ---------- the guide / the snippets ----------
  function drawAside() {
    snippetsBtn.setAttribute('aria-pressed', String(last.aside === 'snippets'));
    guideBtn.setAttribute('aria-pressed', String(last.aside === 'guide'));
    historyBtn.setAttribute('aria-pressed', String(last.aside === 'history'));
    r.guide.hidden = !last.aside;
    if (last.aside === 'history') {
      r.guide.replaceChildren(historyPane(history.list(scope), last.historyId, {
        select: (id) => { last.historyId = id; drawAside(); },
        restore: (entry) => {
          last.mode[entry.lang] = restoreMode(entry.lang, entry.mode);
          changeLanguage(entry.lang);
          drawLanguage();
          replaceRange(ed.ta, 0, ed.ta.value.length, entry.code);
          ed.ta.setSelectionRange(entry.code.length, entry.code.length);
          void paint();
        },
        save: (entry) => {
          const name = prompt(_t('Name of the snippet:'))?.trim();
          if (name) saveSnippet(page.origin, { name, lang: entry.lang, code: entry.code });
        },
        clear: () => { history.clear(scope); last.historyId = null; drawAside(); },
      }));
    } else if (last.aside === 'guide') r.guide.replaceChildren(guide(lang()));
    else if (last.aside === 'snippets') {
      r.guide.replaceChildren(snippetList(page.origin, lang(), (s: Snippet) => {
        replaceRange(ed.ta, 0, ed.ta.value.length, s.code); // one undo step: Ctrl+Z brings the code back
        ed.ta.setSelectionRange(s.code.length, s.code.length);
      }, () => {
        const name = prompt(_t('Name of the snippet:'))?.trim();
        if (!name) return;
        saveSnippet(page.origin, { name, lang: lang(), code: ed.ta.value });
        drawAside();
      }, drawAside));
    }
  }
  drawAside();

  // ---------- the editor ----------
  r.editor.replaceWith(ed.root); // the console's grid places .console > .editor (panel.css)
  const hints = suggester(ed, () => screen.model);
  ed.body.append(hints.box);
  ed.ta.addEventListener('input', () => { saveCode(key(), ed.ta.value); void hints.update(); });
  let escaped = false; // Esc, then Tab: leaves the editor (the indenting Tab doesn't trap keyboard users)
  ed.ta.addEventListener('keydown', (ev) => {
    if (hints.key(ev)) { escaped = false; return; }
    const wasEscaped = escaped;
    escaped = ev.key === 'Escape';
    if (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey)) { ev.preventDefault(); void go(); }
    else if (ev.key === 'Tab' && !wasEscaped && !ev.shiftKey && !ev.altKey && !ev.metaKey && !ev.ctrlKey) {
      ev.preventDefault();
      replaceRange(ed.ta, ed.ta.selectionStart, ed.ta.selectionEnd, lang() === 'python' ? '    ' : '  ');
    } else if (smartKey(ed.ta, ev, lang())) void hints.update();
  });

  // ---------- running ----------
  async function go() {
    if (last.running || version !== renderVersion) return;
    const onOriginalPage = () => sameRunPage(page, panel?.state() ?? page);
    // Capture before readScreen(): typing, a language switch or a restored entry during that await must not change
    // what actually runs. The screen's selected IDs are copied as soon as its asynchronous read finishes.
    let snapshot = captureRun({ scope, code: ed.ta.value, lang: lang(), mode: last.mode[lang()], screen, fmt, startedAt: Date.now() });
    const { code, lang: l, mode } = snapshot;
    const autoRefresh = last.autoRefresh;
    const started = performance.now();
    saveCode(key(), code);
    Object.assign(last, { running: true, runningScope: scope, result: null, error: null });
    void paint();
    let result: RunResult | null = null;
    let error: unknown = null;
    let refreshed: { ok: true } | { error: string } | null = null;
    try {
      const sc = await readScreen();
      snapshot = captureRun({ ...snapshot, screen: sc });
      if (version !== renderVersion || last.scope !== scope || !onOriginalPage()) throw new Error(_t('The screen changed before the run. Run again.'));
      if (l === 'python' && !info.is_system) throw new Error(_t('Python runs as a server action: it needs Settings rights (base.group_system).'));
      result = l === 'python' ? await runPython(code, mode, sc, page)
        : await runJs(code, mode, odoo.adapter, sc, info.user_context ?? {}, info.uid, page);
      const finished: NonNullable<typeof last.result> = { r: result, lang: l, code, fmt, refreshed };
      if (last.scope === scope) last.result = finished;
      const wrote = mode === 'write' && (l === 'python' ? result.ok : callStats(result.calls).written > 0);
      // A completed run belongs to its original screen; do not refresh a different screen reached while it ran.
      if (wrote && autoRefresh && version === renderVersion && last.scope === scope && onOriginalPage()) {
        void paint();
        refreshed = await softReload(page);
        finished.refreshed = refreshed;
      }
    } catch (e) {
      error = e;
      if (last.scope === scope) last.error = e;
    } finally {
      history.add({ ...snapshot, completedAt: Date.now(), durationMs: result?.ms ?? Math.round(performance.now() - started),
        outcome: result ? { result } : { error }, refreshed });
      last.running = false;
      last.runningScope = null;
      view?.drawAside();
      void paint();
    }
  }

  r.output.setAttribute('aria-live', 'polite');
  section.replaceChildren(cloned.root);
  view = { output: r.output, run, ed, scope, drawAside };
  void paint(); // the last result, when the tab was rebuilt after (or during) a run
}

/** Shows `last` in the console on screen: Running…, then the result. */
async function paint() {
  const v = view;
  const revision = ++paintVersion;
  if (!v || v.scope !== last.scope) return;
  v.run.disabled = last.running;
  if (last.error) { v.output.replaceChildren(errBox(last.error)); return; }
  const result = last.result;
  if (!result) { v.output.replaceChildren(...(last.running && last.runningScope === v.scope ? [loading()] : [])); return; }
  const { r, lang, refreshed, code, fmt } = result;
  const matchesEditor = () => v.ed.lang === lang && v.ed.ta.value === code;
  try {
    const parts = await resultView(r, fmt, { lang, refreshed,
      ...(matchesEditor() ? { goToLine: (n: number) => { if (matchesEditor()) goToLine(v.ed, n); } } : {}) });
    if (view === v && revision === paintVersion && last.result === result) v.output.replaceChildren(...parts);
  } catch (error) {
    if (view === v && revision === paintVersion && last.result === result) v.output.replaceChildren(errBox(error));
  }
}

/** Selects line `n` (1-based) of the editor. */
function goToLine(ed: Editor, n: number) {
  const lines = ed.ta.value.split('\n');
  const start = lines.slice(0, n - 1).reduce((s, l) => s + l.length + 1, 0);
  ed.ta.focus();
  ed.ta.setSelectionRange(start, start + (lines[n - 1]?.length ?? 0));
}
