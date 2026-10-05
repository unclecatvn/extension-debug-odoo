// A JSON value to read in the panel: a tree, coloured by JSON type like the code blocks (tok-* classes of panel.css,
// they follow the theme), its arrays and objects folding (open down to `openDepth`, the deeper ones built when opened),
// long arrays shown 200 entries at a time. Markup: components.tpl.html (json, json-branch, json-leaf, json-more).
import { _t } from '../i18n/i18n.ts';
import { tpl } from './components.ts';
import { clipString, jsonCount, jsonEntries, jsonKind, jsonPreview, jsonScalar, type JsonKind } from './json.ts';

const PAGE = 200;
const SCALAR_CLASS: Partial<Record<JsonKind, string>> = { string: 'tok-string', number: 'tok-number', boolean: 'tok-kw', null: 'tok-kw', other: 'tok-comment' };

export function jsonView(value: unknown, openDepth = 2): HTMLElement {
  const { json } = tpl('json', { json: HTMLDivElement }).refs;
  json.append(node(null, value, 0, true, openDepth));
  return json;
}

function tok(cls: string, text: string): HTMLSpanElement {
  const { tok: t } = tpl('tok', { tok: HTMLSpanElement }).refs;
  t.className = cls;
  t.textContent = text;
  return t;
}

/** `"key": ` before a value of an object (nothing for an array item). */
const keyOf = (key: string | null): Node[] => (key == null ? [] : [tok('tok-fn', JSON.stringify(key)), tok('tok-punct', ': ')]);

function node(key: string | null, value: unknown, depth: number, last: boolean, openDepth: number): HTMLElement {
  const kind = jsonKind(value);
  const comma = last ? '' : ',';
  if (kind !== 'array' && kind !== 'object') {
    const { leaf } = tpl('json-leaf', { leaf: HTMLDivElement }).refs;
    const clip = kind === 'string' ? clipString(value as string) : null;
    if (clip?.rest) { // a long string (base64, an attachment): its head, the rest on demand
      const head = tok('tok-string', `${jsonScalar(clip.head).slice(0, -1)}…"`);
      const { button } = tpl('json-more', { button: HTMLButtonElement }).refs;
      button.textContent = _t('Show %s more characters', clip.rest);
      button.addEventListener('click', () => { head.textContent = jsonScalar(value); button.remove(); });
      leaf.append(...keyOf(key), head, ...(comma ? [tok('tok-punct', comma)] : []), ' ', button);
      return leaf;
    }
    leaf.append(...keyOf(key), tok(SCALAR_CLASS[kind]!, kind === 'other' ? String(value) : jsonScalar(value)), ...(comma ? [tok('tok-punct', comma)] : []));
    return leaf;
  }
  const v = value as unknown[] | Record<string, unknown>;
  const [open, close] = kind === 'array' ? ['[', ']'] : ['{', '}'];
  const { n, unit } = jsonCount(v);
  if (!n) {
    const { leaf } = tpl('json-leaf', { leaf: HTMLDivElement }).refs;
    leaf.append(...keyOf(key), tok('tok-punct', `${open}${close}${comma}`));
    return leaf;
  }
  const r = tpl('json-branch', { branch: HTMLDetailsElement, key: HTMLSpanElement, open: HTMLSpanElement, count: HTMLSpanElement, preview: HTMLSpanElement,
    folded: HTMLSpanElement, children: HTMLDivElement, close: HTMLSpanElement }).refs;
  if (kind === 'object') r.preview.textContent = jsonPreview(v as Record<string, unknown>); // folded: tells it apart (id, name…)
  r.key.append(...keyOf(key));
  r.open.textContent = open;
  r.count.textContent = unit === 'items' ? _t('%s items', n) : _t('%s keys', n);
  r.folded.textContent = `…${close}${comma}`;
  r.close.textContent = `${close}${comma}`;

  const entries = jsonEntries(v);
  // an array of scalars (ids, tags…) flows like text instead of one entry per line
  if (kind === 'array' && entries.every(([, x]) => { const k = jsonKind(x); return k !== 'array' && k !== 'object'; })) r.children.classList.add('json-inline');
  let shown = 0;
  const more = () => {
    const next = entries.slice(shown, shown + PAGE);
    r.children.append(...next.map(([k, x], i) => node(k, x, depth + 1, shown + i === entries.length - 1, openDepth)));
    shown += next.length;
    if (shown < entries.length) {
      const { button } = tpl('json-more', { button: HTMLButtonElement }).refs;
      button.textContent = _t('Show %s more (of %s)', Math.min(PAGE, entries.length - shown), entries.length);
      button.addEventListener('click', () => { button.remove(); more(); });
      r.children.append(button);
    }
  };
  // children built on first opening: a folded branch of a big value costs nothing
  const build = () => { if (!shown && r.branch.open) more(); };
  r.branch.addEventListener('toggle', build);
  r.branch.open = depth < openDepth;
  build();
  return r.branch;
}
