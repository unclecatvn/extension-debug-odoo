// Code tab: the editor. A transparent <textarea> (caret, selection, IME and undo stay the browser's) over a <pre> that
// paints the same text in colours, with line numbers beside it (panel.css). Typing is smarter than a textarea's
// (code.logic.ts → smartEdit), in the language chosen.
import { smartEdit, tokenize, type Lang } from './code.logic.ts';
import { tpl } from './code.ui.ts';

/** Replaces text[from, to) of `ta` by `text` the way typing does (one undo step, an `input` event). */
export function replaceRange(ta: HTMLTextAreaElement, from: number, to: number, text: string) {
  ta.focus();
  ta.setSelectionRange(from, to);
  if (document.execCommand(text ? 'insertText' : 'delete', false, text)) return; // keeps Ctrl+Z working
  ta.setRangeText(text, from, to, 'end'); // execCommand refused (no focus in this frame)
  ta.dispatchEvent(new Event('input', { bubbles: true }));
}

/** A character, Backspace or Enter typed smartly. true: it was handled, the browser must not. */
export function smartKey(ta: HTMLTextAreaElement, ev: KeyboardEvent, lang: Lang): boolean {
  if (ev.isComposing || ev.ctrlKey || ev.metaKey || ev.altKey) return false;
  const edit = smartEdit(ta.value, ta.selectionStart, ta.selectionEnd, ev.key, lang);
  if (!edit) return false;
  ev.preventDefault();
  if (edit.from !== edit.to || edit.text) replaceRange(ta, edit.from, edit.to, edit.text);
  ta.setSelectionRange(...edit.select);
  return true;
}

/** Where the caret is, in px from the top left of the editor body, measured on the painted copy (a Range at the same
 * line and column), so wrapped lines are right too. */
export function caretPoint(ta: HTMLTextAreaElement, paint: HTMLElement): { left: number; bottom: number } {
  const before = ta.value.slice(0, ta.selectionStart);
  const line = paint.children[before.split('\n').length - 1] as HTMLElement | undefined;
  let col = before.length - before.lastIndexOf('\n') - 1;
  let rect = line?.getBoundingClientRect() ?? ta.getBoundingClientRect();
  if (line) {
    for (const walk = document.createTreeWalker(line, NodeFilter.SHOW_TEXT); walk.nextNode();) {
      const node = walk.currentNode as Text;
      if (col > node.length) { col -= node.length; continue; }
      const r = document.createRange();
      r.setStart(node, col);
      rect = r.getBoundingClientRect();
      break;
    }
  }
  const at = ta.parentElement!.getBoundingClientRect();
  return { left: rect.left - at.left, bottom: rect.bottom - at.top };
}

export interface Editor { root: HTMLElement; ta: HTMLTextAreaElement; body: HTMLElement; paint: HTMLElement; lang: Lang; setLang(l: Lang): void; refresh(): void }

/** The editor; `lang` colours and types (setLang switches it). Long lines wrap: one painted block per line, numbered
 * by CSS, so a wrapped line keeps one number. */
export function codeEditor(value: string, label: string, lang: Lang): Editor {
  const r = tpl('editor', { root: HTMLDivElement, body: HTMLDivElement, paint: HTMLPreElement, ta: HTMLTextAreaElement }).refs;
  r.ta.value = value;
  r.ta.setAttribute('aria-label', label);
  const ed: Editor = {
    root: r.root, ta: r.ta, body: r.body, paint: r.paint, lang,
    setLang(l) { ed.lang = l; ed.refresh(); },
    refresh() {
      const lines: HTMLElement[] = [tpl('hl-line', { line: HTMLDivElement }).refs.line];
      for (const [type, text] of tokenize(r.ta.value, ed.lang)) {
        text.split('\n').forEach((part, i) => {
          if (i) lines.push(tpl('hl-line', { line: HTMLDivElement }).refs.line);
          if (!part) return;
          if (type) { const { tok } = tpl('tok', { tok: HTMLSpanElement }).refs; tok.className = `tok-${type}`; tok.textContent = part; lines[lines.length - 1]!.append(tok); }
          else lines[lines.length - 1]!.append(part);
        });
      }
      r.paint.replaceChildren(...lines);
      r.body.style.setProperty('--digits', String(Math.max(2, String(lines.length).length))); // the gutter grows with the line count
      r.paint.scrollTop = r.ta.scrollTop;
    },
  };
  r.ta.addEventListener('input', () => ed.refresh());
  r.ta.addEventListener('scroll', () => { r.paint.scrollTop = r.ta.scrollTop; });
  ed.refresh();
  return ed;
}
