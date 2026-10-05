// Tooltips shown at once (the browser's title waits a second or more): any element with data-tip="…" explains itself
// on hover or keyboard focus. One tooltip for the panel, placed above the element (below when there is no room),
// kept inside the window. Started once by the panel (entrypoints/panel). Text only (textContent).
import { tpl } from './components.ts';

/** Gives `el` a tooltip (and an accessible name for what it explains). */
export function tip<E extends HTMLElement>(el: E, text: string): E {
  if (text) { el.dataset.tip = text; el.setAttribute('aria-label', text); }
  return el;
}

export function startTooltips(root: HTMLElement = document.body) {
  const { tip: box } = tpl('tooltip', { tip: HTMLDivElement }).refs;
  root.append(box);
  let current: HTMLElement | null = null;
  const show = (el: HTMLElement) => {
    current = el;
    box.textContent = el.dataset.tip ?? '';
    box.hidden = false;
    const r = el.getBoundingClientRect();
    const b = box.getBoundingClientRect();
    const left = Math.min(Math.max(4, r.left + r.width / 2 - b.width / 2), innerWidth - b.width - 4);
    const above = r.top - b.height - 6;
    box.style.left = `${left}px`;
    box.style.top = `${above >= 4 ? above : r.bottom + 6}px`;
  };
  const hide = () => { current = null; box.hidden = true; };
  const target = (e: Event) => (e.target instanceof Element ? e.target.closest<HTMLElement>('[data-tip]') : null);
  root.addEventListener('pointerover', (e) => { const el = target(e); if (el && el !== current) show(el); else if (!el && current) hide(); });
  root.addEventListener('pointerleave', hide);
  root.addEventListener('focusin', (e) => { const el = target(e); if (el) show(el); });
  root.addEventListener('focusout', hide);
  addEventListener('scroll', hide, true);
}
