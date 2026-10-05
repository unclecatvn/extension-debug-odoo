// List widgets of the panel: rows that unfold (expandable), and a list with a detail pane beside it on a wide panel
// (masterDetail), like the Network tab of the devtools. Markup in components.tpl.html, layout in panel.css (.list,
// .detail, .master-detail, .pane).
import { empty, errBox, loading, tpl } from './components.ts';

/** The full-screen layout of panel.css: wide enough for a pane beside the list. */
export const WIDE = matchMedia('(min-width: 900px)');

const details = new WeakMap<HTMLElement, HTMLElement>(); // row → its detail, once built
const panes = new WeakMap<Element, { pane: HTMLElement; hint: HTMLElement }>(); // list → the pane beside it

/** What a row shows when opened: built on the first opening; may be async; a failure shows its error there. */
export type DetailBuilder = () => Node | null | undefined | Promise<Node | null | undefined>;

/**
 * `li` toggles open on click / Enter / Space (open shows everything below its .row, see panel.css) and builds its
 * detail the first time. In a masterDetail() list on a wide panel the detail shows in the pane instead, one row at a time.
 */
export function expandable<E extends HTMLElement>(li: E, detail?: DetailBuilder): E {
  li.tabIndex = 0;
  li.addEventListener('keydown', (ev) => {
    if (ev.target === li && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); li.click(); }
  });
  li.addEventListener('click', (ev) => {
    const own = (ev.target as Element | null)?.closest('.detail, details, a, button, input, select, textarea');
    if (own && li.contains(own)) return; // not an ancestor: a row nested in another row's .detail still toggles
    const list = li.parentElement;
    const md = WIDE.matches && list ? panes.get(list) : undefined;
    if (md && list) for (const o of list.children) if (o !== li) o.classList.remove('open');
    const open = li.classList.toggle('open');
    if (detail && !details.has(li)) {
      const { detail: d } = tpl('row-detail', { detail: HTMLDivElement }).refs;
      d.append(loading());
      details.set(li, d);
      Promise.resolve().then(detail).then((x) => d.replaceChildren(...(x ? [x] : [])), (e: unknown) => d.replaceChildren(errBox(e)));
    }
    const d = details.get(li);
    if (md) md.pane.replaceChildren(open && d ? d : md.hint);
    else if (d && d.parentNode !== li) li.append(d);
  });
  return li;
}

/** `list` (of expandable rows) with a pane beside it, showing `hint` until a row is selected. Narrow panel: the pane
 * hides and rows unfold in place. → the wrapper to put where `list` was. */
export function masterDetail(list: HTMLElement, hint: string): HTMLElement {
  const { wrap, pane } = tpl('master-detail', { wrap: HTMLDivElement, pane: HTMLElement }).refs;
  const md = { pane, hint: empty(hint) };
  panes.set(list, md);
  wrap.prepend(list);
  const sync = () => { // the layout changed (full screen on / off): the open detail moves between its row and the pane
    if (!wrap.isConnected && ran) { WIDE.removeEventListener('change', sync); return; } // re-rendered away
    ran = true;
    const open = [...list.children].filter((li) => li.classList.contains('open')) as HTMLElement[];
    if (WIDE.matches) {
      for (const li of open.slice(1)) li.classList.remove('open');
      pane.replaceChildren((open[0] && details.get(open[0])) || md.hint);
    } else for (const li of open) { const d = details.get(li); if (d) li.append(d); }
  };
  let ran = false;
  WIDE.addEventListener('change', sync);
  sync();
  return wrap;
}

/** The pane's hint of the masterDetail() list `list` (to show again after the list is cleared). */
export const resetPane = (list: HTMLElement) => { const md = panes.get(list); md?.pane.replaceChildren(md.hint); };
