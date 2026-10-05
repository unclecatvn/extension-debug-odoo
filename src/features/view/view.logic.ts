// View tab, pure part: the inheritance tree of a view as Odoo combines it, the start tags of an arch, and the
// elements it restricts to groups (what a view does to a field: arch.logic.ts). Tested by tests/unit/features/view/view.logic.test.ts.
import type { IrUiView } from '../../odoo/models.ts';

/**
 * The views that build `currentId`, as ir.ui.view._get_combined_arch does (18.0 and 19.0 alike): its ancestors up
 * the inherit_id chain to the root, then from the root down every view of mode extension (same model, extensions of
 * extensions too), in the order Odoo applies them: priority, then id; a primary view on the way after all the
 * extensions of its parent. Inactive views stay in (shown as not applied).
 * → [{ view, depth }] in display order; [] when currentId isn't among `views`.
 */
export function buildViewTree(views: readonly IrUiView[], currentId: number): { view: IrUiView; depth: number }[] {
  const byId = new Map(views.map((v) => [v.id, v]));
  const parentOf = (v: IrUiView) => (v.inherit_id ? byId.get(v.inherit_id[0]) : undefined);
  let top = byId.get(currentId);
  if (!top) return [];
  const path = new Set([top.id]);
  for (let p = parentOf(top); p && !path.has(p.id); p = parentOf(p)) { top = p; path.add(p.id); }

  const kids = new Map<number, IrUiView[]>();
  for (const v of views) {
    if (!v.inherit_id) continue;
    const k = v.inherit_id[0];
    if (!kids.has(k)) kids.set(k, []);
    kids.get(k)!.push(v);
  }
  const out: { view: IrUiView; depth: number }[] = [];
  const seen = new Set<number>();
  const walk = (v: IrUiView, depth: number) => {
    if (seen.has(v.id)) return; // a broken inherit_id loop: Odoo refuses it, still not followed here
    seen.add(v.id);
    out.push({ view: v, depth });
    const cs = (kids.get(v.id) || []).sort((a, b) => a.priority - b.priority || a.id - b.id);
    // ir.ui.view._combine: "primary views (and their children) are traversed after all the extensions for the current
    // primary view have been visited"
    for (const c of cs) if (c.mode === 'extension') walk(c, depth + 1);
    for (const c of cs) if (c.mode === 'primary' && path.has(c.id)) walk(c, depth + 1);
  };
  walk(top, 0);
  return out;
}

/** A start tag of an arch: its name, attributes, the line it starts on, its text (whitespace collapsed), and for an
 * inheritance `<attribute name="…">value</attribute>` its value (the text up to the next tag). */
export interface ArchTag { name: string; attrs: Record<string, string>; line: number; text: string; content?: string }

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const unescapeXml = (s: string) => s.replace(/&(#\d+|#x[\da-f]+|\w+);/gi, (m, e: string) =>
  e[0] === '#' ? String.fromCodePoint(e[1]?.toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENTITIES[e] ?? m);

/** The start tags of an XML text, in order. Attribute values may hold '>' (invisible="amount > 0") and tags may span
 * lines; comments, closing tags and processing instructions are skipped. */
export function archTags(arch: string): ArchTag[] {
  const text = arch.replace(/<!--[\s\S]*?-->/g, (c) => c.replace(/[^\n]/g, ' ')); // comments out, lines kept
  const lineStarts = [0];
  for (let i = text.indexOf('\n'); i >= 0; i = text.indexOf('\n', i + 1)) lineStarts.push(i + 1);
  const lineOf = (index: number) => { let lo = 0, hi = lineStarts.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (lineStarts[mid]! <= index) lo = mid; else hi = mid - 1; } return lo + 1; };
  const tags: ArchTag[] = [];
  for (const m of text.matchAll(/<(?!\/|\?|!)((?:[^>"']|"[^"]*"|'[^']*')+)>/g)) {
    const body = m[1]!;
    const name = /^\s*([\w:.-]+)/.exec(body)?.[1];
    if (!name) continue;
    const attrs: Record<string, string> = {};
    for (const a of body.slice(name.length + body.indexOf(name)).matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[a[1]!] = unescapeXml(a[2] ?? a[3] ?? '');
    const tag: ArchTag = { name, attrs, line: lineOf(m.index), text: m[0].replace(/\s+/g, ' ').trim() };
    if (name === 'attribute' && !body.trimEnd().endsWith('/')) {
      const end = m.index + m[0].length;
      const next = text.indexOf('<', end);
      tag.content = unescapeXml(text.slice(end, next < 0 ? undefined : next)).trim();
      if (tag.content) tag.text = `${tag.text}${tag.content}</attribute>`;
    }
    tags.push(tag);
  }
  return tags;
}

/** The elements of `arch` restricted to groups: only users in them get the element (get_views strips it for the
 * others, then drops the attribute, which is why the combined arch never shows it). Either written on the element
 * (`<field name="x" groups="…"/>`) or added by an extension to an element of its parent
 * (`<field name="x" position="attributes"><attribute name="groups">…</attribute>`, or `add="…"`): `name` is then the
 * element targeted. */
export function restrictedNodes(arch: string): { line: number; tag: string; name: string | null; groups: string; text: string }[] {
  const out: { line: number; tag: string; name: string | null; groups: string; text: string }[] = [];
  let target: ArchTag | null = null; // the last `position="attributes"` spec: what an <attribute> applies to
  for (const t of archTags(arch)) {
    if (t.attrs.position === 'attributes') target = t;
    if (t.name === 'attribute' && t.attrs.name === 'groups') {
      const groups = t.content || t.attrs.add || '';
      if (groups && target) out.push({ line: t.line, tag: target.name, name: target.attrs.name ?? target.attrs.expr ?? null, groups, text: `${target.text} ${t.text}` });
    } else if (t.attrs.groups) out.push({ line: t.line, tag: t.name, name: t.attrs.name ?? t.attrs.string ?? null, groups: t.attrs.groups, text: t.text });
  }
  return out;
}
