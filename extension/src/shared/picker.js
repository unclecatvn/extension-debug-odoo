// A list of modules under a text input, a checkbox each: the Apps and Translations tabs. One input for both typing and
// searching: the word being typed (after the last ;) filters the list by name / title / author, ticking a module puts
// its name in place of that word, typing a name ticks its box. Enter picks the match (the exact name, else the first
// shown) while a word is being typed; with nothing being typed ("sale; ") it is left to the form.
import { splitList, lastToken, pickInList, unpickInList } from './list.js';
import { el } from './ui.js';

/**
 * mods: ir.module.module rows ({ name, shortdesc, author? }). Options:
 * - count(shown, total): text of `countEl` after each change
 * - extra(m): nodes at the end of a row (version, state, ↗)
 * - shows(m, q, picked): whether a row matching `q` (the word being typed, lower case) shows; default every match
 */
export function modulePicker(input, mods, { countEl, count, extra = () => [], shows = () => true }) {
  const known = new Set(mods.map((m) => m.name));
  const set = (value) => { input.value = value; input.dispatchEvent(new Event('input')); input.focus(); };
  const items = mods.map((m) => {
    const box = el('input', { type: 'checkbox', tabIndex: -1, // the input stays the one keyboard stop
      onchange: () => set((box.checked ? pickInList : unpickInList)(input.value, m.name, known)) });
    const li = el('li', { title: m.author || '' },
      el('label', { class: 'row pick' }, box, el('span', { class: 'name', title: m.name }, m.name), // cut when too long: the whole name on hover
        el('span', { class: 'grow muted', title: m.shortdesc }, m.shortdesc), extra(m)));
    li.dataset.q = `${m.name} ${m.shortdesc} ${m.author || ''}`.toLowerCase();
    li.dataset.name = m.name;
    return { li, box, m };
  });
  const refresh = () => {
    const picked = new Set(splitList(input.value));
    const q = lastToken(input.value).toLowerCase();
    let shown = 0;
    for (const { li, box, m } of items) {
      box.checked = picked.has(m.name);
      li.hidden = !(li.dataset.q.includes(q) && shows(m, q, box.checked));
      if (!li.hidden) shown++;
    }
    countEl.textContent = count(shown, items.length);
  };
  input.addEventListener('input', refresh);
  input.addEventListener('keydown', (ev) => {
    const tok = lastToken(input.value);
    if (ev.key !== 'Enter' || !tok) return;
    ev.preventDefault();
    const shown = items.filter(({ li }) => !li.hidden);
    const hit = shown.find(({ m }) => m.name === tok) || shown[0];
    if (hit) set(pickInList(input.value, hit.m.name, known));
  });
  refresh();
  return el('div', { class: 'module-picker' }, el('ul', { class: 'list' }, items.map(({ li }) => li)));
}
