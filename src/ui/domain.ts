// Odoo domains made readable (pure: tested by tests/unit/ui/domain.test.ts).
//   - as written (a Python expression, ir.rule.domain_force): tokens to colour, and one term per line
//   - as evaluated (a JSON list in prefix notation: '&' '|' take two terms, '!' one, terms side by side are ANDed):
//     a tree of all-of / any-of / not, leaves (field, operator, value). Same notation in 18.0 and 19.0.

export type PyTokenType = 'string' | 'number' | 'kw' | 'name' | 'punct' | 'space';
export interface PyToken { type: PyTokenType; text: string }

const KEYWORDS = new Set(['True', 'False', 'None', 'and', 'or', 'not', 'in', 'is', 'if', 'else', 'lambda']);

/** The tokens of a Python expression; the text of all of them is the source, unchanged. */
export function pyTokens(src: string): PyToken[] {
  const out: PyToken[] = [];
  const re = /(\s+)|('(?:\\.|[^'\\])*'?|"(?:\\.|[^"\\])*"?)|(\d+(?:\.\d+)?)|([A-Za-z_]\w*)|(.)/gs;
  for (const m of src.matchAll(re)) {
    const [text, space, str, num, name] = m;
    out.push({ text, type: space ? 'space' : str ? 'string' : num ? 'number' : name ? (KEYWORDS.has(name) ? 'kw' : 'name') : 'punct' });
  }
  return out;
}

/** A domain as written, one term per line when it has several: "[\n    (a),\n    (b)\n]". Anything that is not a
 * list (or doesn't parse) comes back as it is. */
export function formatPyDomain(src: string): string {
  const s = src.trim();
  if (!s.startsWith('[') || !s.endsWith(']')) return src;
  const terms: string[] = [];
  let depth = 0, start = 1;
  for (const t of tokenStarts(s)) {
    if (t.type !== 'punct') continue;
    if ('([{'.includes(t.text)) depth++;
    else if (')]}'.includes(t.text)) depth--;
    else if (t.text === ',' && depth === 1) { terms.push(s.slice(start, t.at).trim()); start = t.at + 1; }
    if (depth < 0) return src;
  }
  if (depth !== 0) return src;
  const last = s.slice(start, -1).trim();
  if (last) terms.push(last);
  return terms.length < 2 ? s : `[\n${terms.map((t) => `    ${t}`).join(',\n')}\n]`;
}

function* tokenStarts(s: string) {
  let at = 0;
  for (const t of pyTokens(s)) { yield { ...t, at }; at += t.text.length; }
}

/** An evaluated domain as a tree. */
export type DomainNode =
  | { kind: 'all' | 'any'; children: DomainNode[] }
  | { kind: 'not'; child: DomainNode }
  | { kind: 'leaf'; field: string; op: string; value: unknown }
  | { kind: 'const'; value: boolean };

const isLeaf = (t: unknown): t is [unknown, string, unknown] => Array.isArray(t) && t.length === 3 && typeof t[1] === 'string';

/** Prefix notation → tree; the always-true / always-false leaves ((1, '=', 1), (0, '=', 1)) become constants. Null
 * when it isn't a domain. Nested all-of / any-of of the same kind are flattened. */
export function domainTree(domain: unknown): DomainNode | null {
  if (!Array.isArray(domain)) return null;
  let i = 0;
  const term = (): DomainNode | null => {
    const t: unknown = domain[i++];
    if (t === '&' || t === '|') {
      const a = term(), b = term();
      if (!a || !b) return null;
      const kind = t === '&' ? 'all' : 'any';
      return { kind, children: [a, b].flatMap((x) => (x.kind === kind ? x.children : [x])) };
    }
    if (t === '!') { const a = term(); return a && { kind: 'not', child: a }; }
    if (!isLeaf(t)) return null;
    const [f, op, v] = t;
    if ((f === 1 || f === 0) && op === '=' && v === 1) return { kind: 'const', value: f === 1 };
    return { kind: 'leaf', field: String(f), op, value: v };
  };
  const terms: DomainNode[] = [];
  while (i < domain.length) { const t = term(); if (!t) return null; terms.push(t); }
  if (!terms.length) return { kind: 'const', value: true };
  return terms.length === 1 ? terms[0]! : { kind: 'all', children: terms.flatMap((x) => (x.kind === 'all' ? x.children : [x])) };
}
