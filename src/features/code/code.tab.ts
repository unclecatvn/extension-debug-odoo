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
import type { TabModule } from '../registry.ts';
import { runJs, runPython, screenOf, softReload, type Screen } from './code.data.ts';
import { codeEditor, replaceRange, smartKey, type Editor } from './code.editor.ts';
import { callStats, codeKey, type Lang, type RunMode } from './code.logic.ts';
import { resultView, type Fmt } from './code.result.ts';
import { guide, saveSnippet, snippetList, type Snippet } from './code.snippets.ts';
import { forgetRun, keepAutoRefresh, keepLang, last, loadCode, saveCode } from './code.state.ts';
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
let view: { output: HTMLElement; run: HTMLButtonElement; ed: Editor; fmt: Fmt } | null = null;

export const codeTab: TabModule = {
  render(section, page, odoo) {
    section.replaceChildren(loading());
    void build(section, page, odoo).catch((e: unknown) => section.replaceChildren(errBox(e)));
  },
  reset: forgetRun,
};

async function build(section: HTMLElement, page: PageState, odoo: OdooContext) {
  const info = await sessionInfo();
  const cloned = tpl('console', { root: HTMLDivElement, bar: HTMLDivElement, opts: HTMLDivElement, acts: HTMLDivElement, screen: HTMLDivElement, editor: HTMLDivElement, guide: HTMLDivElement, output: HTMLDivElement });
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
    if (!screen.model) parts.push(text(_t('no model on this screen: record, records and model are empty'), 'muted'));
    else {
      parts.push(text(screen.model, 'mono'));
      parts.push(text(screen.resId ? _t('record #%s', screen.resId) : _t('no record opened'), 'muted'));
      if (screen.ids.length) parts.push(text(_t('%s selected', screen.ids.length), 'muted', screen.ids.slice(0, 40).join(', ')));
    }
    parts.push(button('⟳', () => void readScreen(), 'chip', _t('Read the selection again')));
    r.screen.replaceChildren(...parts, who);
  };
  const readScreen = async () => { screen = await screenOf(page.model, page.resId); drawScreen(); return screen; };
  drawScreen();
  void readScreen();

  // ---------- the bar ----------
  const run = button(`▶ ${_t('Run')}`, () => void go(), 'btn', _t('Run (⌘/Ctrl+Enter)'));
  run.classList.add('primary');
  const refreshBox = check(_t('Auto Refresh'), last.autoRefresh, keepAutoRefresh, _t('After a run that wrote, reload the data of the view on screen (Odoo\'s soft_reload), without reloading the page'));
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
  const langSeg = segmented<Lang>([['js', 'JavaScript'], ['python', 'Python']], lang(), (l) => {
    saveCode(key(), ed.ta.value);
    keepLang(l);
    ed.ta.value = loadCode(key()) ?? '';
    ed.ta.placeholder = _t(PLACEHOLDER[l]);
    ed.setLang(l);
    drawMode();
    drawAside();
  });
  const asideBtn = (which: 'guide' | 'snippets', label: string, hint: string) => {
    const b = button(label, () => { last.aside = last.aside === which ? null : which; drawAside(); }, 'chip', hint);
    return b;
  };
  const snippetsBtn = asideBtn('snippets', _t('Snippets'), _t('Ready-made snippets, and the ones you saved for this Odoo'));
  const guideBtn = asideBtn('guide', '?', _t('Guide: available variables, recordset API, examples'));
  r.opts.append(langSeg, modeSlot, refreshBox); // how it runs
  r.acts.append(snippetsBtn, guideBtn, run); // what to do: Run last, where the eye ends
  drawMode();

  // ---------- the guide / the snippets ----------
  function drawAside() {
    snippetsBtn.setAttribute('aria-pressed', String(last.aside === 'snippets'));
    guideBtn.setAttribute('aria-pressed', String(last.aside === 'guide'));
    r.guide.hidden = !last.aside;
    if (last.aside === 'guide') r.guide.replaceChildren(guide(lang()));
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
    if (last.running) return;
    const l = lang();
    const mode = last.mode[l];
    saveCode(key(), ed.ta.value);
    Object.assign(last, { running: true, result: null, error: null });
    void paint();
    try {
      const sc = await readScreen();
      if (l === 'python' && !info.is_system) throw new Error(_t('Python runs as a server action: it needs Settings rights (base.group_system).'));
      const res = l === 'python' ? await runPython(ed.ta.value, mode, sc)
        : await runJs(ed.ta.value, mode, odoo.adapter, sc, info.user_context ?? {}, info.uid);
      last.result = { r: res, lang: l, refreshed: null };
      const wrote = mode === 'write' && (l === 'python' ? res.ok : callStats(res.calls).written > 0);
      if (wrote && last.autoRefresh) {
        void paint();
        last.result.refreshed = await softReload();
      }
    } catch (e) {
      last.error = e;
    } finally {
      last.running = false;
      void paint();
    }
  }

  r.output.setAttribute('aria-live', 'polite');
  section.replaceChildren(cloned.root);
  view = { output: r.output, run, ed, fmt };
  void paint(); // the last result, when the tab was rebuilt after (or during) a run
}

/** Shows `last` in the console on screen: Running…, then the result. */
async function paint() {
  const v = view;
  if (!v) return;
  v.run.disabled = last.running;
  if (last.error) { v.output.replaceChildren(errBox(last.error)); return; }
  if (!last.result) { v.output.replaceChildren(...(last.running ? [loading()] : [])); return; }
  const { r, lang, refreshed } = last.result;
  const parts = await resultView(r, v.fmt, { lang, refreshed, goToLine: (n) => goToLine(v.ed, n) });
  if (view === v) v.output.replaceChildren(...parts);
}

/** Selects line `n` (1-based) of the editor. */
function goToLine(ed: Editor, n: number) {
  const lines = ed.ta.value.split('\n');
  const start = lines.slice(0, n - 1).reduce((s, l) => s + l.length + 1, 0);
  ed.ta.focus();
  ed.ta.setSelectionRange(start, start + (lines[n - 1]?.length ?? 0));
}
