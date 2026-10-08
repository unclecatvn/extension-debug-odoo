// A code editor: a transparent <textarea> (caret, selection, IME and undo stay the browser's) over a <pre> that paints
// the same text in colours (tok-* classes of panel.css), line numbers beside it. Long lines wrap: one painted block per
// line, numbered by CSS, so a wrapped line keeps one number. The Code tab (features/code/code.editor.ts adds its
// languages and smart typing), the RPC request bodies (JSON). Markup: components.tpl.html.
import { tpl } from './components.ts';

/** Text → [token type ('' plain; else the tok-<type> class), text], covering all of it. */
export type Tokenizer = (text: string) => readonly (readonly [string, string])[];

export interface Editor { root: HTMLElement; ta: HTMLTextAreaElement; body: HTMLElement; paint: HTMLElement; refresh(): void }

export function editor(value: string, label: string, tokens: Tokenizer): Editor {
  const r = tpl('code-editor', { root: HTMLDivElement, body: HTMLDivElement, paint: HTMLPreElement, ta: HTMLTextAreaElement }).refs;
  r.ta.value = value;
  r.ta.setAttribute('aria-label', label);
  const ed: Editor = {
    root: r.root, ta: r.ta, body: r.body, paint: r.paint,
    refresh() {
      const lines: HTMLElement[] = [tpl('hl-line', { line: HTMLDivElement }).refs.line];
      for (const [type, text] of tokens(r.ta.value)) {
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
