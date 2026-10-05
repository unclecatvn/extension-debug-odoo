// A tab told as a story (View, Security): numbered parts that fold, notes, segmented controls. Markup in
// components.tpl.html, styles in panel.css (.part, .seg, .note).
import { rememberedOpen } from './cards.ts';
import { tpl } from './components.ts';

/**
 * A part of a tab told as a story, appended to `parent`: open unless the user folded it (remembered as `<tab>:<key>`). Its body is
 * built by `lazy(build)` when first open, so a folded part costs nothing; `open()` unfolds it from code (a link from
 * another part). Its tools stay usable folded, and using them doesn't fold or unfold it.
 */
export function part(parent: HTMLElement, key: string, no: string, title: string) {
  const r = tpl('part', { part: HTMLDetailsElement, no: HTMLSpanElement, title: HTMLHeadingElement, sub: HTMLSpanElement, tools: HTMLSpanElement, body: HTMLDivElement }).refs;
  r.no.textContent = no;
  r.title.textContent = title;
  r.part.dataset.key = key;
  r.tools.addEventListener('click', (e) => { if (!(e.target as Element).closest('button')) e.preventDefault(); }); // an input in a <summary> would toggle it
  const state = rememberedOpen(`${parent.id}:${key}`, true);
  let build: (() => void) | null = null;
  let built = false;
  const ensure = () => { if (!built && build && r.part.open) { built = true; build(); } };
  r.part.addEventListener('toggle', () => { state.remember(r.part.open); ensure(); });
  r.part.open = state.open;
  parent.append(r.part);
  return {
    ...r,
    /** what fills the body, on first opening */
    lazy(fn: () => void) { build = fn; ensure(); },
    open() { r.part.open = true; ensure(); },
  };
}

export function note(text: string): HTMLElement {
  const { root, refs } = tpl('note', { text: HTMLDivElement });
  refs.text.textContent = text;
  return root;
}

/** Segmented control: one button per [value, label], `current` on; `onPick` when another is chosen. */
export function segmented<V extends string>(options: readonly [V, string][], current: V, onPick: (v: V) => void): HTMLElement {
  const { seg } = tpl('seg', { seg: HTMLDivElement }).refs;
  const draw = (on: V) => seg.replaceChildren(...options.map(([value, label]) => {
    const { button } = tpl('seg-option', { button: HTMLButtonElement }).refs;
    button.textContent = label;
    button.classList.toggle('on', value === on);
    button.setAttribute('aria-checked', String(value === on));
    button.addEventListener('click', () => { if (value !== on) { draw(value); onPick(value); } });
    return button;
  }));
  draw(current);
  return seg;
}

export function frag(...nodes: (Node | null | undefined | false)[]): DocumentFragment {
  const f = document.createDocumentFragment();
  f.append(...nodes.filter((n): n is Node => !!n));
  return f;
}

