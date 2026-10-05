// Code tab: the suggestions under the caret — models of the installed modules, their fields, the recordset API of the
// language chosen. ↑ ↓ pick, Enter / Tab insert, Esc closes, Ctrl+Space asks.
import { cached } from '../../extension/page-cache.ts';
import { fieldsOf } from '../../odoo/reads.ts';
import { readModels } from './code.data.ts';
import { caretPoint, replaceRange, type Editor } from './code.editor.ts';
import { COMMAND_MEMBERS, ENV_MEMBERS, GLOBALS, METHODS, completionAt, rankSuggestions, type Completion, type Suggestion } from './code.logic.ts';
import { tpl } from './code.ui.ts';

const pairs = (list: readonly [string, string][]): Suggestion[] => list.map(([label, detail]) => ({ label, detail }));
// ir.model lists the models of installed modules; `modules` names the ones defining each
const models = () => cached('code models', async () =>
  (await readModels()).map((r): Suggestion => ({ label: r.model, detail: [r.name, r.modules].filter(Boolean).join(' · ') })));

/** Fields of `model`, after following the relational fields of `path` (partner_id.country_id…). */
async function fieldItems(model: string | null, path: readonly string[]): Promise<Suggestion[]> {
  let m = model;
  for (const f of path) m = m ? (await fieldsOf(m))[f]?.relation ?? null : null;
  if (!m) return [];
  return Object.entries(await fieldsOf(m)).map(([name, f]) => ({ label: name, detail: `${f.type}${f.relation ? ` → ${f.relation}` : ''} · ${f.string}` }));
}

async function itemsFor(c: Completion, ed: Editor): Promise<Suggestion[]> {
  if (c.kind === 'model') return models();
  if (c.kind === 'field') return fieldItems(c.model, c.path);
  if (c.kind === 'global') return pairs(GLOBALS[ed.lang]);
  if (c.on === 'env' && !c.path.length) return pairs(ENV_MEMBERS[ed.lang]);
  if (c.on === 'Command' && !c.path.length) return pairs(COMMAND_MEMBERS);
  return [...pairs(METHODS[ed.lang]), ...await fieldItems(c.model, c.path)];
}

/** The list under the caret of `ed`: update() after each edit, key(ev) first in its keydown (true: the key was used).
 * `screen()`: the screen's model (record / records / model are of it). */
export function suggester(ed: Editor, screen: () => string | null) {
  const { box } = tpl('suggest', { box: HTMLUListElement }).refs;
  const ta = ed.ta;
  let shown: Suggestion[] = [];
  let active = 0;
  let ctx: Completion | null = null;
  let seq = 0;
  let pending: string | null = null; // the label picked while an IME was composing the word: inserted once committed

  const close = () => { seq++; box.hidden = true; shown = []; };
  const mark = () => {
    [...box.children].forEach((li, i) => li.setAttribute('aria-selected', String(i === active)));
    const li = box.children[active] as HTMLElement | undefined; // kept in view by hand: scrollIntoView could scroll the Odoo page
    if (!li) return;
    if (li.offsetTop < box.scrollTop) box.scrollTop = li.offsetTop;
    else if (li.offsetTop + li.offsetHeight > box.scrollTop + box.clientHeight) box.scrollTop = li.offsetTop + li.offsetHeight - box.clientHeight;
  };
  const accept = () => {
    if (!ctx || !shown[active]) return;
    const { from } = ctx;
    const { label } = shown[active]!;
    close();
    replaceRange(ta, from, ta.selectionStart, label);
  };
  const place = () => {
    const at = caretPoint(ta, ed.paint);
    const room = (box.parentElement?.clientWidth ?? 0) - box.offsetWidth;
    box.style.left = `${Math.max(0, Math.min(at.left, room))}px`;
    box.style.top = `${at.bottom + 2}px`;
  };

  /** manual: Ctrl+Space, also for bare words (typed, `co` would offer Command while writing const). */
  async function update(manual = false) {
    const n = ++seq;
    const c = ta.selectionStart === ta.selectionEnd ? completionAt(ta.value, ta.selectionStart, screen()) : null;
    if (!c || (c.kind === 'global' && !manual)) { close(); return; }
    const items = rankSuggestions(await itemsFor(c, ed).catch(() => []), c.prefix);
    if (n !== seq) return; // typed again meanwhile
    if (!items.length) { close(); return; }
    ctx = c;
    shown = items;
    active = 0;
    box.replaceChildren(...items.map((it, i) => {
      const r = tpl('suggest-item', { item: HTMLLIElement, name: HTMLSpanElement, detail: HTMLSpanElement }).refs;
      r.name.textContent = it.label;
      r.detail.textContent = it.detail;
      r.item.addEventListener('mousedown', (e) => { e.preventDefault(); active = i; accept(); }); // before the editor loses focus
      return r.item;
    }));
    box.hidden = false;
    place();
    mark();
  }

  function key(ev: KeyboardEvent): boolean {
    // an IME (Vietnamese Telex: `s` is a tone key) commits its word after this key: a pick waits for compositionend
    if (ev.isComposing || ev.keyCode === 229) {
      if (!box.hidden && ['Tab', 'Enter', 'NumpadEnter'].includes(ev.code)) { ev.preventDefault(); pending = shown[active]?.label ?? null; }
      return true;
    }
    pending = null;
    if (ev.key === ' ' && ev.ctrlKey) { ev.preventDefault(); void update(true); return true; }
    if (box.hidden) return false;
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault();
      active = (active + (ev.key === 'ArrowDown' ? 1 : -1) + shown.length) % shown.length;
      mark();
      return true;
    }
    if ((ev.key === 'Enter' && !ev.metaKey && !ev.ctrlKey && !ev.shiftKey) || (ev.key === 'Tab' && !ev.shiftKey)) { ev.preventDefault(); accept(); return true; }
    if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); close(); return true; }
    if (['ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown'].includes(ev.key)) close();
    return false;
  }

  box.addEventListener('mousedown', (e) => e.preventDefault()); // its scrollbar must not take the focus (blur closes it)
  ta.addEventListener('scroll', () => { if (!box.hidden) place(); });
  ta.addEventListener('compositionend', () => {
    if (!pending) return;
    const label = pending;
    pending = null;
    setTimeout(() => {
      const c = completionAt(ta.value, ta.selectionStart, screen());
      if (!c) return;
      close();
      replaceRange(ta, c.from, ta.selectionStart, label);
    });
  });
  ta.addEventListener('blur', close);
  ta.addEventListener('click', close);
  return { box, update, key };
}
