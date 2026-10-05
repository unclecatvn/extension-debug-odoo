// View tab, pure part: what a view's own arch does. An extension is a list of inheritance specs (a <field name="x">
// or an <xpath expr="…"> with a position), each changing its parent's arch; a base view places elements. From that:
// a one-line summary of each view (part ② of the tab) and the steps a field goes through (part ③). Same rules on
// 18.0 and 19.0 (ir.ui.view inheritance). Tested by tests/unit/features/view/arch.logic.test.ts.
import { walk, xmlTree, type XmlElement } from '../../ui/xml.ts';

export type Position = 'after' | 'before' | 'inside' | 'replace' | 'attributes' | 'move';
const POSITIONS = new Set<string>(['after', 'before', 'inside', 'replace', 'attributes', 'move']);

/** What a spec points at: a field (by name), an xpath, or another element (group[name], page[string]…). */
export interface Target { label: string; field: string | null }

/** An element a spec brings in (after / before / inside / replace), or moves there (position="move"). */
export interface Added { tag: string; name: string | null; line: number; moved: boolean }

/** One inheritance spec of an extension. */
export interface Spec {
  line: number;
  position: Position;
  target: Target;
  adds: Added[];
  /** position="attributes": the attributes it sets (or adds to / removes from) */
  attributes: { name: string; value: string; line: number }[];
}

const nameOf = (el: XmlElement) => el.attrs.name ?? el.attrs.string ?? null;

function targetOf(el: XmlElement): Target {
  if (el.name === 'xpath') {
    const expr = el.attrs.expr ?? '';
    const field = /field\[@name=['"]([\w.]+)['"]\]\s*$/.exec(expr)?.[1] ?? null; // an xpath ending on a field
    return { label: expr, field };
  }
  if (el.name === 'field') return { label: `field ${el.attrs.name ?? '?'}`, field: el.attrs.name ?? null };
  const n = nameOf(el);
  return { label: n ? `${el.name}[${n}]` : el.name, field: null };
}

// position="move" marks an element moved by its enclosing spec, not a spec of its own
const isSpec = (el: XmlElement) => el.name === 'xpath' || (el.attrs.position != null && el.attrs.position !== 'move' && POSITIONS.has(el.attrs.position));

/** The inheritance specs of an arch: the children of a <data> root, or the root itself when it is a spec. A base view
 * (a <form>, <list>… root without position) has none. */
export function specsOf(arch: string): Spec[] {
  const root = xmlTree(arch);
  if (!root) return [];
  const nodes = root.name === 'data' ? root.children : isSpec(root) ? [root] : [];
  return nodes.filter(isSpec).map((el) => {
    const position = (POSITIONS.has(el.attrs.position ?? '') ? el.attrs.position : 'inside') as Position;
    return {
      line: el.line,
      position,
      target: targetOf(el),
      adds: position === 'attributes' ? [] : el.children.map((c) => ({ tag: c.name, name: nameOf(c), line: c.line, moved: c.attrs.position === 'move' })),
      attributes: position === 'attributes'
        ? el.children.filter((c) => c.name === 'attribute' && c.attrs.name).map((c) => ({ name: c.attrs.name!, value: c.text || c.attrs.add || c.attrs.remove || '', line: c.line }))
        : [],
    };
  });
}

/** A view in numbers (the one-line summary of part ②): fields it adds, fields it moves, attributes it changes,
 * elements it removes (position="replace" with nothing), other elements it adds. A base view: the fields it places. */
export interface ViewSummary { base: boolean; fields: number; moved: number; attributes: number; removed: number; others: number }

export function summarize(arch: string): ViewSummary {
  const specs = specsOf(arch);
  const root = xmlTree(arch);
  if (!specs.length) {
    const fields = root ? [...walk(root)].filter((e) => e.name === 'field').length : 0;
    return { base: !!root && root.name !== 'data', fields, moved: 0, attributes: 0, removed: 0, others: 0 };
  }
  const s: ViewSummary = { base: false, fields: 0, moved: 0, attributes: 0, removed: 0, others: 0 };
  for (const spec of specs) {
    s.attributes += spec.attributes.length;
    if (spec.position === 'replace' && !spec.adds.length) s.removed++;
    for (const a of spec.adds) {
      if (a.moved) s.moved++;
      else if (a.tag === 'field') s.fields++;
      else s.others++;
    }
  }
  return s;
}

/** What a view does to a field:
 *   places    a base view shows it
 *   adds      an extension brings it in (after / before / inside / replace of `target`)
 *   moves     an extension moves it there (position="move")
 *   changes   an extension sets some of its attributes (position="attributes")
 *   restricts its element is limited to groups (groups="…", or an <attribute name="groups">)
 *   neighbour an extension adds elements after / before / inside it
 *   replaces  an extension replaces it with other elements; removes: with nothing
 *   reads     an expression (invisible / readonly / required / domain / context…) reads it */
export type StepKind = 'places' | 'adds' | 'moves' | 'changes' | 'restricts' | 'neighbour' | 'replaces' | 'removes' | 'reads';
export interface Step { line: number; kind: StepKind; /** the position, the target, the attributes… raw, for the UI to word */ detail: string }

const EXPRESSION_ATTRS = ['invisible', 'readonly', 'required', 'column_invisible', 'domain', 'context', 'options'];
const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The steps `field` goes through in `arch`, in line order. */
export function fieldSteps(arch: string, field: string): Step[] {
  const root = field ? xmlTree(arch) : null;
  if (!root) return [];
  const word = new RegExp(`(^|[^\\w.])${escapeRegExp(field)}(?![\\w])`);
  const reads = (expr: string) => word.test(expr.replace(/(['"]).*?\1/g, '')); // names inside strings are not fields
  const steps: Step[] = [];
  const specOf = (el: XmlElement): XmlElement | null => { for (let p = el.parent; p; p = p.parent) if (isSpec(p)) return p; return null; };

  for (const el of walk(root)) {
    const spec = isSpec(el) ? null : specOf(el);
    if (isSpec(el)) {
      const t = targetOf(el);
      if (t.field === field) {
        const position = (el.attrs.position ?? 'inside') as Position;
        if (position === 'attributes') {
          const attrs = el.children.filter((c) => c.name === 'attribute' && c.attrs.name);
          const groups = attrs.filter((c) => c.attrs.name === 'groups');
          const others = attrs.filter((c) => c.attrs.name !== 'groups');
          if (others.length) steps.push({ line: el.line, kind: 'changes', detail: others.map((c) => `${c.attrs.name}="${c.text || c.attrs.add || c.attrs.remove || ''}"`).join(' ') });
          for (const g of groups) steps.push({ line: g.line, kind: 'restricts', detail: g.text || g.attrs.add || '' });
        } else if (position === 'replace') {
          steps.push({ line: el.line, kind: el.children.length ? 'replaces' : 'removes', detail: el.children.map((c) => nameOf(c) ?? c.name).join(', ') });
        } else if (position !== 'move') {
          const added = el.children.filter((c) => !(c.name === 'field' && c.attrs.name === field));
          if (added.length) steps.push({ line: el.line, kind: 'neighbour', detail: `${position}: ${added.map((c) => (c.name === 'field' ? c.attrs.name : nameOf(c) ? `${c.name}[${nameOf(c)}]` : c.name)).join(', ')}` });
        }
      }
    } else if (el.name === 'field' && el.attrs.name === field) {
      if (!spec) steps.push({ line: el.line, kind: 'places', detail: el.parent ? `${el.parent.name}${nameOf(el.parent) ? `[${nameOf(el.parent)}]` : ''}` : '' });
      else if (el.attrs.position === 'move') steps.push({ line: el.line, kind: 'moves', detail: `${spec.attrs.position ?? 'inside'} ${targetOf(spec).label}` });
      else steps.push({ line: el.line, kind: 'adds', detail: `${spec.attrs.position ?? 'inside'} ${targetOf(spec).label}` });
      if (el.attrs.groups) steps.push({ line: el.line, kind: 'restricts', detail: el.attrs.groups });
    }
    // an expression reading the field, on any element (but its own placement), or in an <attribute> value
    const own = el.name === 'field' && el.attrs.name === field;
    const exprs = own ? [] : EXPRESSION_ATTRS.filter((a) => el.attrs[a] != null && reads(el.attrs[a]!)).map((a) => a);
    if (exprs.length) steps.push({ line: el.line, kind: 'reads', detail: `${exprs.join(', ')} of ${el.name === 'field' ? `field ${el.attrs.name}` : nameOf(el) ? `${el.name}[${nameOf(el)}]` : el.name}` });
    if (el.name === 'attribute' && EXPRESSION_ATTRS.includes(el.attrs.name ?? '') && reads(el.text || el.attrs.add || '')) {
      const s = el.parent && isSpec(el.parent) ? targetOf(el.parent) : null;
      if (s?.field !== field) steps.push({ line: el.line, kind: 'reads', detail: `${el.attrs.name} of ${s?.label ?? '?'}` });
    }
  }
  return steps.sort((a, b) => a.line - b.line);
}

/** The module a view comes from: its xmlid's (null when it has none, e.g. made by Studio or by hand). */
export const moduleOf = (xmlId: string | false | null | undefined) => (xmlId ? xmlId.split('.')[0]! : null);

/** The names of the fields a (combined) arch shows, in order, once each. */
export function archFields(arch: string): string[] {
  const root = xmlTree(arch);
  return root ? [...new Set([...walk(root)].filter((e) => e.name === 'field' && e.attrs.name).map((e) => e.attrs.name!))] : [];
}
