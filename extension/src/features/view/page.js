// Functions injected into the Odoo tab (MAIN world) via chrome.scripting.executeScript.
// Each must be self-contained: only its source text is sent to the page.

/** Every <field> node of the open form (a dialog wins over the main form) with its modifiers evaluated like the webclient does. */
export function pageFormFields() {
  const N_ = (s) => s; // error msgids, translated by the panel
  const py = window.odoo?.loader?.modules?.get('@web/core/py_js/py');
  const root = window.odoo?.__WOWL_DEBUG__?.root?.__owl__;
  if (!py || !root) return { error: N_('Webclient internals are not reachable.') };
  let ctrl = null;
  const walk = (n) => {
    const c = n.component;
    if (c?.archInfo?.fieldNodes && c.model?.root?.evalContextWithVirtualIds) ctrl = c;
    for (const k of Object.values(n.children || {})) walk(k);
  };
  walk(root);
  if (!ctrl) return { error: N_('No form view is open.') };
  const rec = ctrl.model.root;
  const ctx = rec.evalContextWithVirtualIds;
  const plain = (o) => { try { return JSON.parse(JSON.stringify(o ?? null)); } catch { return String(o); } };
  const ev = (expr) => {
    if (!expr) return { expr: null, value: false };
    try { return { expr, value: !!py.evaluateBooleanExpr(expr, ctx) }; } catch (e) { return { expr, error: String(e?.message || e) }; }
  };
  const PY = new Set(['True', 'False', 'None', 'and', 'or', 'not', 'in', 'if', 'else']);
  const vars = (exprs) => {
    const names = new Set((exprs.join(' ').replace(/(['"]).*?\1/g, '').match(/[A-Za-z_]\w*/g) || []).filter((v) => !PY.has(v)));
    return Object.fromEntries([...names].filter((v) => v in ctx && typeof ctx[v] !== 'function').map((v) => [v, plain(ctx[v])]));
  };
  // ponytail: DOM check is page-wide, so a dialog and the form behind it with the same field can mask each other.
  const inDom = (name) => !!document.querySelector(`.o_form_view .o_field_widget[name="${CSS.escape(name)}"]`);
  return {
    editable: !!rec.isInEdition,
    fields: Object.entries(ctrl.archInfo.fieldNodes).map(([id, f]) => ({
      id, name: f.name, string: f.string, type: f.type, widget: f.widget || f.field?.component?.name || null,
      invisible: ev(f.invisible), readonly: ev(f.readonly), required: ev(f.required),
      column_invisible: f.column_invisible || null, context: f.context, domain: f.domain ?? null,
      options: plain(f.options), attrs: plain(f.attrs),
      vars: vars([f.invisible, f.readonly, f.required].filter(Boolean)),
      inDom: inDom(f.name),
    })),
  };
}

/** One-shot element picker: hover highlights a form field, click reports its name (Esc cancels). */
export function pagePick() {
  if (window.__odooDebugPick) return;
  const box = document.createElement('div');
  box.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483647;border:2px solid #7c3aed;background:rgba(124,58,237,.12);border-radius:3px;display:none';
  document.body.append(box);
  const find = (t) => {
    const label = t.closest?.('label[for]');
    return (label ? document.getElementById(label.htmlFor) : t)?.closest?.('.o_field_widget[name]') || null;
  };
  const move = (e) => {
    const f = find(e.target);
    if (!f) { box.style.display = 'none'; return; }
    const r = f.getBoundingClientRect();
    Object.assign(box.style, { display: 'block', left: `${r.left - 2}px`, top: `${r.top - 2}px`, width: `${r.width + 4}px`, height: `${r.height + 4}px` });
  };
  const stop = (e) => { e.preventDefault(); e.stopImmediatePropagation(); };
  const click = (e) => { stop(e); done(find(e.target)?.getAttribute('name') || ''); };
  const key = (e) => { if (e.key === 'Escape') { stop(e); done(''); } };
  const evs = [['mousemove', move], ['pointerdown', stop], ['mousedown', stop], ['mouseup', stop], ['click', click], ['keydown', key]];
  function done(name) {
    for (const [t, h] of evs) removeEventListener(t, h, true);
    box.remove();
    window.__odooDebugPick = null;
    document.dispatchEvent(new CustomEvent('odoo-debug-pick', { detail: name }));
  }
  for (const [t, h] of evs) addEventListener(t, h, true);
  window.__odooDebugPick = done;
}
