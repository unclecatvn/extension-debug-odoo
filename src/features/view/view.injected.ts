// View tab, functions run IN the Odoo page (MAIN world): only each function's own source text reaches it (npm run
// check:page), no chrome.* (tsconfig.page.json). The webclient internals they read (OWL tree, archInfo.fieldNodes,
// record.evalContextWithVirtualIds, py_js evaluateBooleanExpr, .o_field_widget[name]) are the same in 18.0 and 19.0.

/** A modifier of a field node as the webclient evaluates it: its expression, and its value or why it failed. */
export interface Modifier { expr: string | null; value?: boolean; error?: string }

export interface FormField {
  id: string;
  name: string;
  string: string | null;
  type: string | null;
  widget: string | null;
  invisible: Modifier;
  readonly: Modifier;
  required: Modifier;
  column_invisible: string | null;
  context: unknown;
  domain: unknown;
  options: unknown;
  attrs: unknown;
  /** values of the record the expressions read */
  vars: Record<string, unknown>;
  /** an element of the field is on the page (not on another notebook page, not in an invisible parent) */
  inDom: boolean;
}

export type FormFields = { model: string; resId: number | null; editable: boolean; fields: FormField[] } | { error: string };

/** Every <field> node of the open form (a dialog wins over the form behind it) with its modifiers evaluated as the
 * webclient does: py_js evaluateBooleanExpr on the record's evalContextWithVirtualIds. */
export function pageFormFields(): FormFields {
  const N_ = (s: string) => s; // error msgids, translated by the panel
  type Py = { evaluateBooleanExpr(expr: string, ctx: unknown): unknown };
  type FieldNode = { name: string; string?: string; type?: string; widget?: string; field?: { component?: { name?: string } };
    invisible?: string; readonly?: string; required?: string; column_invisible?: string; context?: unknown; domain?: unknown; options?: unknown; attrs?: unknown };
  type Ctrl = { archInfo: { fieldNodes: Record<string, FieldNode> }; model: { root: { resModel: string; resId?: number; isInEdition?: boolean; evalContextWithVirtualIds: Record<string, unknown> } } };
  type OwlNode = { component?: Partial<Ctrl>; children?: Record<string, OwlNode> };

  const py = window.odoo?.loader?.modules.get('@web/core/py_js/py') as Py | undefined;
  const root = window.odoo?.__WOWL_DEBUG__?.root?.__owl__ as OwlNode | undefined;
  if (!py || !root) return { error: N_('Webclient internals are not reachable.') };
  let ctrl: Ctrl | null = null;
  const walk = (n: OwlNode) => {
    const c = n.component;
    if (c?.archInfo?.fieldNodes && c.model?.root?.evalContextWithVirtualIds) ctrl = c as Ctrl; // the last one found: a dialog's form
    for (const k of Object.values(n.children || {})) walk(k);
  };
  walk(root);
  if (!ctrl) return { error: N_('No form view is open.') };
  const { archInfo, model } = ctrl as Ctrl;
  const rec = model.root;
  const ctx = rec.evalContextWithVirtualIds;
  const plain = (o: unknown): unknown => { try { return JSON.parse(JSON.stringify(o ?? null)); } catch { return String(o); } };
  const ev = (expr: string | undefined): Modifier => {
    if (!expr) return { expr: null, value: false };
    try { return { expr, value: !!py.evaluateBooleanExpr(expr, ctx) }; } catch (e) { return { expr, error: String((e as Error)?.message || e) }; }
  };
  const PY = new Set(['True', 'False', 'None', 'and', 'or', 'not', 'in', 'if', 'else']);
  const vars = (exprs: string[]) => {
    const names = new Set((exprs.join(' ').replace(/(['"]).*?\1/g, '').match(/[A-Za-z_]\w*/g) || []).filter((v) => !PY.has(v)));
    return Object.fromEntries([...names].filter((v) => v in ctx && typeof ctx[v] !== 'function').map((v) => [v, plain(ctx[v])]));
  };
  // page-wide: a dialog and the form behind it showing the same field can mask each other
  const inDom = (name: string) => !!document.querySelector(`.o_form_view .o_field_widget[name="${CSS.escape(name)}"]`);
  return {
    model: rec.resModel, resId: rec.resId || null, editable: !!rec.isInEdition,
    fields: Object.entries(archInfo.fieldNodes).map(([id, f]) => ({
      id, name: f.name, string: f.string ?? null, type: f.type ?? null, widget: f.widget || f.field?.component?.name || null,
      invisible: ev(f.invisible), readonly: ev(f.readonly), required: ev(f.required),
      column_invisible: f.column_invisible || null, context: plain(f.context), domain: plain(f.domain ?? null),
      options: plain(f.options), attrs: plain(f.attrs),
      vars: vars([f.invisible, f.readonly, f.required].filter((x): x is string => !!x)),
      inDom: inDom(f.name),
    })),
  };
}

/** One-shot element picker on the page: hover outlines a form field, a click reports its name (Esc cancels), as an
 * odoo-debug-pick event the rpc-relay content script forwards to the panel. */
export function pagePick(): void {
  if (window.__odooDebugPick) return;
  const box = document.createElement('div'); // markup-ok: the outline, drawn on the page by an injected function (no template reaches it)
  box.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483647;border:2px solid #7c3aed;background:rgba(124,58,237,.12);border-radius:3px;display:none';
  document.body.append(box);
  const find = (t: EventTarget | null) => {
    if (!(t instanceof Element)) return null;
    const label = t.closest<HTMLLabelElement>('label[for]');
    return ((label && document.getElementById(label.htmlFor)) || t).closest('.o_field_widget[name]');
  };
  const move = (e: Event) => {
    const f = find(e.target);
    if (!f) { box.style.display = 'none'; return; }
    const r = f.getBoundingClientRect();
    Object.assign(box.style, { display: 'block', left: `${r.left - 2}px`, top: `${r.top - 2}px`, width: `${r.width + 4}px`, height: `${r.height + 4}px` });
  };
  const stop = (e: Event) => { e.preventDefault(); e.stopImmediatePropagation(); };
  const click = (e: Event) => { stop(e); done(find(e.target)?.getAttribute('name') || ''); };
  const key = (e: Event) => { if ((e as KeyboardEvent).key === 'Escape') { stop(e); done(''); } };
  const evs: [string, (e: Event) => void][] = [['mousemove', move], ['pointerdown', stop], ['mousedown', stop], ['mouseup', stop], ['click', click], ['keydown', key]];
  function done(name: string) {
    for (const [t, h] of evs) removeEventListener(t, h, true);
    box.remove();
    window.__odooDebugPick = null;
    document.dispatchEvent(new CustomEvent('odoo-debug-pick', { detail: name }));
  }
  for (const [t, h] of evs) addEventListener(t, h, true);
  window.__odooDebugPick = done;
}
