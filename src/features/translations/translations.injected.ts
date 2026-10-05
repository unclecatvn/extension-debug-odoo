// Translations tab, functions run IN the Odoo page (MAIN world): only each function's own source text reaches it (npm
// run check:page), no chrome.* (tsconfig.page.json). Same in 18.0 and 19.0 (plain DOM).

/**
 * Lets the user click a text on the page (the element under the pointer outlined, its text shown); resolves with that
 * text, or null on Esc. The panel hides meanwhile (it may cover the page). executeScript waits for the promise: the
 * panel gets the text when the user clicks.
 */
export function pagePickText(): Promise<string | null> {
  return new Promise((resolve) => {
    const box = document.createElement('div'); // markup-ok: the outline, drawn on the page by an injected function (no template reaches it)
    box.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483647;border:2px solid #7c3aed;background:rgba(124,58,237,.12);border-radius:3px;display:none';
    const label = document.createElement('div'); // markup-ok: the text about to be picked, beside the outline
    label.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483647;max-width:360px;padding:4px 8px;border-radius:4px;background:#18181b;color:#fff;font:12px/1.4 system-ui,sans-serif;display:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis';
    document.body.append(box, label);
    // the panel (in the page, maybe full screen) steps aside while picking: back on click or Esc
    const panel = document.querySelector<HTMLElement>('odoo-debug-root');
    const was = panel?.style.visibility ?? '';
    if (panel) panel.style.visibility = 'hidden';
    const textOf = (el: Element) => {
      const input = el as HTMLInputElement;
      const own = [...el.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE).map((n) => n.textContent).join(' ').trim();
      return (own || (el as HTMLElement).innerText || input.placeholder || el.getAttribute('title') || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim();
    };
    // the deepest element under the pointer that has a text of its own, else the closest one with any text
    const find = (t: EventTarget | null): Element | null => {
      if (!(t instanceof Element) || t.closest('odoo-debug-root')) return null;
      for (let el: Element | null = t; el && el !== document.body; el = el.parentElement) if (textOf(el)) return el;
      return null;
    };
    let current: Element | null = null;
    const move = (e: Event) => {
      current = find(e.target);
      if (!current) { box.style.display = label.style.display = 'none'; return; }
      const r = current.getBoundingClientRect();
      Object.assign(box.style, { display: 'block', left: `${r.left - 2}px`, top: `${r.top - 2}px`, width: `${r.width + 4}px`, height: `${r.height + 4}px` });
      label.textContent = textOf(current).slice(0, 120);
      Object.assign(label.style, { display: 'block', left: `${Math.max(4, r.left)}px`, top: `${r.top > 30 ? r.top - 28 : r.bottom + 6}px` });
    };
    const stop = (e: Event) => { e.preventDefault(); e.stopImmediatePropagation(); };
    const click = (e: Event) => { stop(e); const el = find(e.target) ?? current; done(el ? textOf(el).slice(0, 500) : null); };
    const key = (e: Event) => { if ((e as KeyboardEvent).key === 'Escape') { stop(e); done(null); } };
    const evs: [string, (e: Event) => void][] = [['mousemove', move], ['pointerdown', stop], ['mousedown', stop], ['mouseup', stop], ['click', click], ['keydown', key]];
    function done(text: string | null) {
      for (const [t, h] of evs) removeEventListener(t, h, true);
      box.remove();
      label.remove();
      if (panel) panel.style.visibility = was;
      resolve(text);
    }
    for (const [t, h] of evs) addEventListener(t, h, true);
  });
}
