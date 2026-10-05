// The panel and popup pages' own static elements (their index.html).

/** The element `selector` of the page; missing = the page and its code are out of sync, which fails loudly. */
export function $<E extends Element = HTMLElement>(selector: string): E {
  const n = document.querySelector<E>(selector);
  if (!n) throw new Error(`${selector} is missing from the page`);
  return n;
}
