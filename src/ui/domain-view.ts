// Odoo domains to read: as written (pyCode: the Python, one term per line, coloured) and as evaluated (domainView: a
// tree of all of / any of / not, each term "field operator value"). Markup: components.tpl.html; logic: domain.ts.
import { _t } from '../i18n/i18n.ts';
import { domainTree, formatPyDomain, pyTokens, type DomainNode, type PyTokenType } from './domain.ts';
import { pre, tpl } from './components.ts';

const CLASS: Record<PyTokenType, string | null> = { string: 'tok-string', number: 'tok-number', kw: 'tok-kw', punct: 'tok-punct', name: null, space: null };

function tok(cls: string | null, text: string): Node {
  if (!cls) return document.createTextNode(text);
  const { tok: t } = tpl('tok', { tok: HTMLSpanElement }).refs;
  t.className = cls;
  t.textContent = text;
  return t;
}

/** A domain (or any Python expression) as written, one term per line, coloured. */
export function pyCode(src: string): HTMLElement {
  const { code } = tpl('code-plain', { code: HTMLPreElement }).refs;
  code.append(...pyTokens(formatPyDomain(src)).map((t) => tok(CLASS[t.type], t.text)));
  return code;
}

/** A value as a domain term shows it: strings quoted, numbers, booleans / null as keywords, lists inline. */
function value(v: unknown): Node[] {
  if (typeof v === 'string') return [tok('tok-string', JSON.stringify(v))];
  if (typeof v === 'number') return [tok('tok-number', String(v))];
  if (typeof v === 'boolean' || v == null) return [tok('tok-kw', v === true ? 'True' : v === false ? 'False' : 'None')];
  if (Array.isArray(v)) return [tok('tok-punct', '['), ...v.flatMap((x, i) => [...(i ? [tok('tok-punct', ', ')] : []), ...value(x)]), tok('tok-punct', ']')];
  return [document.createTextNode(JSON.stringify(v))];
}

function node(n: DomainNode): HTMLElement {
  if (n.kind === 'leaf' || n.kind === 'const') {
    const { leaf, code } = tpl('dom-leaf', { leaf: HTMLDivElement, code: HTMLElement }).refs;
    if (n.kind === 'const') code.append(tok('tok-kw', n.value ? _t('always true') : _t('always false')));
    else code.append(tok('tok-fn', n.field), ' ', tok('tok-kw', n.op), ' ', ...value(n.value));
    return leaf;
  }
  const { group, op, children } = tpl('dom-group', { group: HTMLDivElement, op: HTMLSpanElement, children: HTMLDivElement }).refs;
  op.textContent = n.kind === 'all' ? _t('all of') : n.kind === 'any' ? _t('any of') : _t('not');
  group.classList.add(n.kind);
  children.append(...(n.kind === 'not' ? [node(n.child)] : n.children.map(node)));
  return group;
}

/** An evaluated domain as a tree; what isn't a domain shows as JSON. */
export function domainView(domain: unknown): HTMLElement {
  const tree = domainTree(domain);
  return tree ? node(tree) : pre(domain);
}
