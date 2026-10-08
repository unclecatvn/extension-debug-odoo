// The panel's small components: markup in components.tpl.html, styles in panel.css. Odoo data only ever goes through
// textContent. List widgets: lists.ts.
import { _t, translateDom } from '../i18n/i18n.ts';
import { templates } from './template.ts';
import html from './components.tpl.html';

/** The templates of components.tpl.html (lists.ts uses them too). */
export const tpl = templates(html, translateDom);

export type PillKind = '' | 'ok' | 'err' | 'med' | 'low' | 'high' | 'info' | 'accent';

export function pill(text: string, kind: PillKind = ''): HTMLSpanElement {
  const { pill: p } = tpl('pill', { pill: HTMLSpanElement }).refs;
  p.textContent = text;
  if (kind) p.classList.add(kind);
  return p;
}

/** true / false / anything else (unknown) → green / red / `unknownKind` pill with the matching label. */
export const triPill = (v: unknown, [yes, no, unknown]: [string, string, string] = ['✓', '✗', '?'], unknownKind: PillKind = '') =>
  v === true ? pill(yes, 'ok') : v === false ? pill(no, 'err') : pill(unknown, unknownKind);

export function empty(msg: string): HTMLElement {
  const { root, refs } = tpl('empty', { text: HTMLDivElement });
  refs.text.textContent = msg;
  return root;
}

export function pre(o: unknown): HTMLPreElement {
  const { text } = tpl('pre', { text: HTMLPreElement }).refs;
  text.textContent = typeof o === 'string' ? o : JSON.stringify(o, null, 2) ?? String(o);
  return text;
}

/** Collapsible section, closed until its summary is clicked (every one in the panel starts closed). */
export function details(summary: string | Node, ...body: Node[]): HTMLDetailsElement {
  const { details: d, summary: s } = tpl('details', { details: HTMLDetailsElement, summary: HTMLElement }).refs;
  s.append(summary);
  d.append(...body);
  return d;
}

/** An error (Error, RpcError with its traceback, or anything thrown) as the panel shows it. */
export function errBox(e: unknown): HTMLElement {
  const { message, traceback } = (e ?? {}) as { message?: string; traceback?: string };
  const { root, refs } = tpl('error', { message: HTMLSpanElement, trace: HTMLDetailsElement, traceback: HTMLPreElement });
  refs.message.textContent = message ?? String(e);
  if (traceback) refs.traceback.textContent = traceback;
  else refs.trace.remove();
  return root;
}

export function kv(obj: Record<string, unknown>): HTMLElement {
  const { root, refs } = tpl('kv', { list: HTMLDListElement });
  for (const [k, v] of Object.entries(obj)) {
    const row = tpl('kv-row', { key: HTMLElement, value: HTMLElement });
    row.refs.key.textContent = k;
    row.refs.value.textContent = v !== null && typeof v === 'object' ? JSON.stringify(v) : String(v ?? '');
    refs.list.append(row.root);
  }
  return root;
}

type PolicyDoc = Document & { permissionsPolicy?: { allowsFeature(f: string): boolean }; featurePolicy?: { allowsFeature(f: string): boolean } };

/** Whether this document may use the Clipboard API. The panel is a frame of the Odoo page (it asks for clipboard-write,
 * entrypoints/launcher), but the page — or a proxy in front of Odoo — can forbid it to its frames with a
 * Permissions-Policy header: calling the API then fails and Chrome reports a "permissions policy violation". */
export function clipboardAllowed(doc: PolicyDoc = document): boolean {
  const policy = doc.permissionsPolicy ?? doc.featurePolicy;
  try { return policy ? policy.allowsFeature('clipboard-write') : true; } catch { return true; }
}

/** Copies `text`: the Clipboard API when the page allows it, else (or when it refuses: focus) execCommand('copy'),
 * which no permissions policy governs. → whether it was copied. */
export async function copyText(text: string): Promise<boolean> {
  if (clipboardAllowed() && navigator.clipboard) {
    try { await navigator.clipboard.writeText(text); return true; } catch { /* not focused: the old way */ }
  }
  const ta = document.createElement('textarea'); // markup-ok: off-screen copy helper, not UI
  ta.value = text;
  ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none'; // selecting it must not scroll the panel
  document.body.append(ta);
  ta.select();
  const ok = document.execCommand('copy');
  ta.remove();
  return ok;
}

/** `text` (a field name, xmlid…) as a button copying it to the clipboard; ✓ for a second after. `label`: shown instead (e.g. masked). */
export function copyable(text: string, cls = 'name', label = text): HTMLButtonElement {
  const { button } = tpl('copy', { button: HTMLButtonElement }).refs;
  button.classList.add(...cls.split(/\s+/).filter(Boolean));
  button.textContent = label;
  button.addEventListener('click', async () => {
    await copyText(text);
    button.classList.add('copied');
    setTimeout(() => button.classList.remove('copied'), 1000);
  });
  return button;
}

/** An icon button copying `text()` (a block: an SQL query…), ✓ for a second after; `hint` names it (tooltip, aria-label).
 * Placed at the top right of a relative block (panel.css: .example). */
export function copyButton(text: () => string, hint: string): HTMLButtonElement {
  const { button } = tpl('copy-btn', { button: HTMLButtonElement }).refs;
  button.dataset.tip = hint; // tooltip.ts
  button.setAttribute('aria-label', hint);
  button.addEventListener('click', async (e) => {
    e.stopPropagation();
    await copyText(text());
    button.classList.add('copied');
    setTimeout(() => button.classList.remove('copied'), 1000);
  });
  return button;
}

export const loading = (): HTMLElement => tpl('loading').root;

/** Column names of a .list, shown only when the list is laid out as a table (wide panel). */
export function listHead(main: string, desc: string): HTMLElement {
  const { root, refs } = tpl('list-head', { main: HTMLSpanElement, desc: HTMLSpanElement });
  refs.main.textContent = main;
  refs.desc.textContent = desc;
  return root;
}

/** Opens /odoo/<path> (e.g. res.partner/7) of the inspected Odoo in a new tab (the inspected tab stays put). */
export function odooLink(origin: string, path: string, text = '↗'): HTMLAnchorElement {
  const { link } = tpl('odoo-link', { link: HTMLAnchorElement }).refs;
  link.href = `${origin}/odoo/${path}`;
  link.title = _t('Open /odoo/%s', path);
  link.textContent = text;
  return link;
}
