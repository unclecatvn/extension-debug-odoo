// Code tab: the editor (ui/editor.ts) in JavaScript or Python: its colours, and typing smarter than a textarea's
// (code.logic.ts → smartEdit), in the language chosen.
import { editor, type Editor as BaseEditor } from '../../ui/editor.ts';
import { smartEdit, tokenize, type Lang } from './code.logic.ts';

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

export interface Editor extends BaseEditor { lang: Lang; setLang(l: Lang): void }

/** The editor (ui/editor.ts) in `lang`: its colours (setLang switches them). */
export function codeEditor(value: string, label: string, lang: Lang): Editor {
  let current = lang;
  const base = editor(value, label, (text) => tokenize(text, current));
  const ed: Editor = Object.assign(base, { lang, setLang(l: Lang) { current = ed.lang = l; base.refresh(); } });
  return ed;
}
