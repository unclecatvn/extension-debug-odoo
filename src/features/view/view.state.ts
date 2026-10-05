// View tab: the field being inspected, shared by part ② (its views come forward) and part ③ (its story), and the way
// part ③ shows a line of a view's own arch in part ②.

let inspected = '';
const listeners = new Set<(field: string) => void>();
let revealer: ((type: string, viewId: number, line: number) => void) | null = null;

export const inspectedField = () => inspected;

/** Inspects `field` ('' = none): every part following it updates. */
export function inspect(field: string) {
  inspected = field;
  for (const l of listeners) l(field);
}

export const onInspect = (listener: (field: string) => void) => { listeners.add(listener); };

/** Shows line `line` of view `viewId` (of the `type` composition) in part ②. */
export const revealLine = (type: string, viewId: number, line: number) => revealer?.(type, viewId, line);
export const setRevealer = (fn: typeof revealer) => { revealer = fn; };

/** A new render: the parts of the previous one stop following. */
export function resetFollowers() {
  listeners.clear();
  revealer = null;
}
