// Code to read in the panel: XML with its line numbers, coloured like an editor (tok-* classes of panel.css, which
// follow the theme), some lines marked, any line revealed on demand. Markup: components.tpl.html (code, code-line, tok);
// tokens: xml.ts. Text only through textContent / text nodes.
import { tpl } from './components.ts';
import { xmlTokens, type XmlTokenType } from './xml.ts';

const CLASS: Record<XmlTokenType, string | null> = {
  tag: 'tok-kw', attr: 'tok-fn', value: 'tok-string', comment: 'tok-comment', punct: 'tok-punct', text: null,
};

/** How a marked line stands out: `touch` (it touches the traced field), `lock` (it restricts to groups). */
export type LineMark = 'touch' | 'lock';

export interface CodeBlock {
  root: HTMLElement;
  /** Scrolls line `n` (1-based) into view and flashes it; opens the <details> holding the block. */
  reveal(n: number): void;
}

/** Appends the coloured tokens of `xml` to `el` (newlines kept as they are). */
function appendTokens(el: HTMLElement, xml: string) {
  for (const t of xmlTokens(xml)) {
    const cls = CLASS[t.type];
    if (!cls) { el.append(document.createTextNode(t.text)); continue; }
    const { tok } = tpl('tok', { tok: HTMLSpanElement }).refs;
    tok.className = cls;
    tok.textContent = t.text;
    el.append(tok);
  }
}

/** A short piece of XML in a line of text (a tag quoted in a list), coloured like the code blocks. */
export function xmlInline(xml: string): HTMLElement {
  const { code } = tpl('code-inline', { code: HTMLElement }).refs;
  appendTokens(code, xml);
  return code;
}

/** `xml` as a code block. `marks`: line number → how it stands out. */
export function xmlCode(xml: string, marks: ReadonlyMap<number, LineMark> = new Map()): CodeBlock {
  const { code } = tpl('code', { code: HTMLDivElement }).refs;
  const lines: HTMLElement[] = [];
  let src: HTMLElement;
  const newLine = () => {
    const r = tpl('code-line', { line: HTMLDivElement, n: HTMLSpanElement, src: HTMLSpanElement }).refs;
    const n = lines.length + 1;
    r.n.textContent = String(n);
    const mark = marks.get(n);
    if (mark) r.line.classList.add(mark);
    lines.push(r.line);
    code.append(r.line);
    src = r.src;
  };
  newLine();
  for (const t of xmlTokens(xml)) {
    t.text.split('\n').forEach((part, i) => {
      if (i) newLine(); // a token over several lines (a comment, a domain) continues on the next ones
      if (!part) return;
      const cls = CLASS[t.type];
      if (!cls) { src.append(document.createTextNode(part)); return; }
      const { tok } = tpl('tok', { tok: HTMLSpanElement }).refs;
      tok.className = cls;
      tok.textContent = part;
      src.append(tok);
    });
  }
  return {
    root: code,
    reveal(n) {
      const line = lines[n - 1];
      if (!line) return;
      const holder = code.closest('details');
      if (holder) holder.open = true;
      line.scrollIntoView({ block: 'center', behavior: 'smooth' });
      line.classList.remove('flash');
      void line.offsetWidth; // restart the animation
      line.classList.add('flash');
    },
  };
}
