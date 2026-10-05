// XML for reading: tokens to colour (code.ts renders them) and a re-indentation for archs Odoo returns already combined.
// Pure: tested by tests/unit/ui/xml.test.ts. Attribute values may hold '>' (invisible="amount > 0"), tags may span lines.

export type XmlTokenType = 'punct' | 'tag' | 'attr' | 'value' | 'comment' | 'text';
export interface XmlToken { type: XmlTokenType; text: string }

const NODE = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<\/?[\w:.-]+(?:[^>"']|"[^"]*"|'[^']*')*>/g;

/** The tokens of `xml`, in order: their texts joined give `xml` back exactly. */
export function xmlTokens(xml: string): XmlToken[] {
  const out: XmlToken[] = [];
  const push = (type: XmlTokenType, text: string) => { if (text) out.push({ type, text }); };
  let at = 0;
  for (const m of xml.matchAll(NODE)) {
    push('text', xml.slice(at, m.index));
    const node = m[0];
    if (node.startsWith('<!--') || node.startsWith('<?') || node.startsWith('<![CDATA[')) push('comment', node);
    else tagTokens(node, push);
    at = m.index + node.length;
  }
  push('text', xml.slice(at));
  return out;
}

function tagTokens(tag: string, push: (type: XmlTokenType, text: string) => void) {
  const head = /^<\/?/.exec(tag)![0];
  const name = /^[\w:.-]+/.exec(tag.slice(head.length))![0];
  const tail = /\/?>$/.exec(tag)![0];
  push('punct', head);
  push('tag', name);
  const body = tag.slice(head.length + name.length, tag.length - tail.length);
  let at = 0;
  for (const a of body.matchAll(/([\w:.-]+)(\s*=\s*)("[^"]*"|'[^']*')/g)) {
    push('text', body.slice(at, a.index)); // whitespace between attributes
    push('attr', a[1]!);
    push('punct', a[2]!);
    push('value', a[3]!);
    at = a.index + a[0].length;
  }
  push('text', body.slice(at));
  push('punct', tail);
}

/** Whitespace between attributes collapsed (a tag written on several lines on one), values untouched. */
const oneLine = (tag: string) => tag.replace(/("[^"]*"|'[^']*')|\s+/g, (m, quoted: string | undefined) => quoted ?? ' ').replace(/\s+(\/?>)$/, '$1');

/** `xml` re-indented, one element per line (`indent` spaces a level); an element holding only a short text stays on
 * one line (<attribute name="invisible">state == 'done'</attribute>). Comments kept; whitespace-only text dropped. */
export function prettyXml(xml: string, indent = 2): string {
  type Node = { kind: 'open' | 'close' | 'empty' | 'other'; text: string; name?: string } | { kind: 'text'; text: string };
  const nodes: Node[] = [];
  let at = 0;
  const text = (t: string) => { const s = t.trim(); if (s) nodes.push({ kind: 'text', text: s }); };
  for (const m of xml.matchAll(NODE)) {
    text(xml.slice(at, m.index));
    const node = m[0];
    const name = /^<\/?([\w:.-]+)/.exec(node)?.[1];
    if (!name) nodes.push({ kind: 'other', text: node.trim() });
    else if (node.startsWith('</')) nodes.push({ kind: 'close', text: `</${name}>`, name });
    else nodes.push({ kind: node.endsWith('/>') ? 'empty' : 'open', text: oneLine(node), name });
    at = m.index + node.length;
  }
  text(xml.slice(at));

  const lines: string[] = [];
  let depth = 0;
  const pad = () => ' '.repeat(depth * indent);
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i]!;
    const next = nodes[i + 1];
    const after = nodes[i + 2];
    if (n.kind === 'open') {
      if (next?.kind === 'close' && next.name === n.name) { lines.push(pad() + n.text + next.text); i++; continue; }
      if (next?.kind === 'text' && !next.text.includes('\n') && next.text.length <= 80 && after?.kind === 'close' && after.name === n.name) {
        lines.push(pad() + n.text + next.text + after.text); i += 2; continue;
      }
      lines.push(pad() + n.text);
      depth++;
    } else if (n.kind === 'close') {
      depth = Math.max(0, depth - 1);
      lines.push(pad() + n.text);
    } else lines.push(pad() + n.text);
  }
  return lines.join('\n');
}

/** An element of an XML text, as xmlTree() reads it. */
export interface XmlElement {
  name: string;
  attrs: Record<string, string>;
  /** the line its start tag is on (1-based) */
  line: number;
  children: XmlElement[];
  /** its own text, trimmed (an <attribute name="invisible">'s value) */
  text: string;
  parent: XmlElement | null;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const unescape = (s: string) => s.replace(/&(#\d+|#x[\da-f]+|\w+);/gi, (m, e: string) =>
  e[0] === '#' ? String.fromCodePoint(e[1]?.toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENTITIES[e] ?? m);

/** The element tree of `xml` (comments, CDATA and processing instructions left out), or null if it holds no element.
 * Lenient: an unclosed or stray end tag doesn't throw (archs are well-formed; this only reads them). */
export function xmlTree(xml: string): XmlElement | null {
  const lineStarts = [0];
  for (let i = xml.indexOf('\n'); i >= 0; i = xml.indexOf('\n', i + 1)) lineStarts.push(i + 1);
  const lineOf = (index: number) => { let lo = 0, hi = lineStarts.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (lineStarts[mid]! <= index) lo = mid; else hi = mid - 1; } return lo + 1; };
  let root: XmlElement | null = null;
  const stack: XmlElement[] = [];
  let at = 0;
  const addText = (t: string) => {
    const s = unescape(t).trim();
    const top = stack.at(-1);
    if (s && top) top.text = top.text ? `${top.text} ${s}` : s;
  };
  for (const m of xml.matchAll(NODE)) {
    addText(xml.slice(at, m.index));
    at = m.index + m[0].length;
    const node = m[0];
    const name = /^<\/?([\w:.-]+)/.exec(node)?.[1];
    if (!name) continue; // comment, CDATA, <?…?>
    if (node.startsWith('</')) { // closes the nearest open element of that name
      const i = stack.map((e) => e.name).lastIndexOf(name);
      if (i >= 0) stack.length = i;
      continue;
    }
    const attrs: Record<string, string> = {};
    for (const a of node.slice(1 + name.length).matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[a[1]!] = unescape(a[2] ?? a[3] ?? '');
    const parent = stack.at(-1) ?? null;
    const el: XmlElement = { name, attrs, line: lineOf(m.index), children: [], text: '', parent };
    if (parent) parent.children.push(el); else root ??= el;
    if (!node.endsWith('/>')) stack.push(el);
  }
  return root;
}

/** Every element under `el` (itself first), depth first, in document order. */
export function* walk(el: XmlElement): Generator<XmlElement> {
  yield el;
  for (const c of el.children) yield* walk(c);
}
