// Markup lives in *.tpl.html files, as <template data-tpl="name"> elements; code clones one and fills the elements it
// marks with data-ref="key". esbuild inlines the file as text at build time (scripts/build.ts: loader text), so nothing
// is fetched at run time. The refs a caller asks for are checked when cloned (present, right element type): a template
// edited out of sync with its code fails at once, on its first use, with its name.
//
//   <template data-tpl="pill"><span class="pill" data-ref="pill"></span></template>
//   const { root, refs } = tpl('pill', { pill: HTMLSpanElement });   // refs.pill: HTMLSpanElement
//   refs.pill.textContent = text;                                    // data: always textContent, never innerHTML

/** An element constructor (HTMLSpanElement, HTMLButtonElement…): what a data-ref must be an instance of. */
type ElementClass = { new (): Element; prototype: Element };
export type RefSpec = Record<string, ElementClass>;
export type Refs<S extends RefSpec> = { [K in keyof S]: S[K]['prototype'] };

export interface Cloned<S extends RefSpec> {
  /** the template's single root element, detached: append it where it goes */
  root: HTMLElement;
  refs: Refs<S>;
}

export type Templates = <S extends RefSpec = Record<never, ElementClass>>(name: string, refs?: S) => Cloned<S>;

/**
 * The templates of one .tpl.html file. `translate` (i18n's translateDom) runs on each template once, on its first
 * clone: by then the panel has loaded its language. The content scripts pass none (the page is not in the panel's
 * language).
 */
export function templates(html: string, translate?: (root: ParentNode) => void): Templates {
  const file = document.createElement('template');
  file.innerHTML = html; // our own file, inlined by the build: never Odoo data
  const byName = new Map<string, HTMLTemplateElement>();
  for (const t of file.content.querySelectorAll<HTMLTemplateElement>('template[data-tpl]')) byName.set(t.dataset.tpl!, t);
  const translated = new WeakSet<HTMLTemplateElement>();

  return <S extends RefSpec>(name: string, spec?: S): Cloned<S> => {
    const t = byName.get(name);
    if (!t) throw new Error(`template "${name}" is missing`);
    if (translate && !translated.has(t)) {
      translate(t.content);
      translated.add(t);
    }
    const frag = t.content.cloneNode(true) as DocumentFragment;
    const root = frag.firstElementChild;
    if (frag.childElementCount !== 1 || !(root instanceof HTMLElement)) throw new Error(`template "${name}" must have one root element`);
    const refs: Record<string, Element> = {};
    for (const [key, Class] of Object.entries(spec ?? {})) {
      const n = root.matches(`[data-ref="${key}"]`) ? root : root.querySelector(`[data-ref="${key}"]`);
      if (!(n instanceof Class)) throw new Error(`template "${name}": data-ref="${key}" ${n ? `is not a ${Class.name}` : 'is missing'}`);
      refs[key] = n;
    }
    return { root, refs: refs as Refs<S> };
  };
}
