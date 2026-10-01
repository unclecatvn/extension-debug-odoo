// Apps tab: Odoo's search bar over the module list.
import { el } from '../../shared/ui.js';
import { _t } from '../../shared/i18n.js';

/** Odoo's search bar: the active filters as facets inside it (× or Backspace in an empty input removes one), the input,
 * and ▾ opening the filters (Installed / Not Installed, Apps / Extra) and the categories. Like Odoo's, it wraps:
 * the facets first, the input on the next line when they fill one, ▾ as tall as the bar. `f` is changed in place;
 * onChange() after each change. */
export function searchBar(input, f, cats, onChange) {
  const GROUPS = [ // a group is one facet, its ticked options joined by "or" (OR'ed, as in Odoo)
    { keys: [['installed', _t('Installed')], ['notInstalled', _t('Not Installed')]] },
    { keys: [['apps', _t('Apps')], ['extra', _t('Extra')]] },
  ];
  const facets = el('span', { class: 'facets' });
  const panel = el('div', { class: 'search-panel', hidden: true });
  const toggle = el('button', { type: 'button', class: 'search-toggle', title: _t('Filters'), 'aria-label': _t('Filters'), 'aria-expanded': 'false' }, '▾');
  const open = (on) => { panel.hidden = !on; toggle.setAttribute('aria-expanded', String(on)); if (on) redraw(); };
  toggle.addEventListener('click', () => open(panel.hidden));

  const item = (on, label, click) => el('button', { type: 'button', class: 'search-item', 'aria-pressed': String(on), onclick: click }, label);
  function redraw() {
    facets.replaceChildren(...[...GROUPS.map((g) => {
      const on = g.keys.filter(([k]) => f[k]);
      return on.length && facet(null, on.map(([, label]) => label), () => { for (const [k] of g.keys) f[k] = false; onChange(); });
    }), f.category && facet(_t('Category'), [f.category], () => { f.category = null; onChange(); })].filter(Boolean)); // elements only: Backspace takes the last
    if (panel.hidden) return;
    panel.replaceChildren(
      el('div', { class: 'search-col' }, el('div', { class: 'search-head' }, _t('Filters')),
        GROUPS.flatMap((g, i) => [i ? el('hr') : null, ...g.keys.map(([k, label]) => item(!!f[k], label, () => { f[k] = !f[k]; onChange(); }))])),
      el('div', { class: 'search-col cats' }, el('div', { class: 'search-head' }, _t('Category')),
        item(!f.category, _t('All Categories'), () => { f.category = null; onChange(); }),
        cats.map((name) => item(f.category === name, name, () => { f.category = f.category === name ? null : name; onChange(); }))));
  }
  /** As Odoo draws one: a coloured label (`field`'s name, or a funnel for a filter), the values joined by "or", ×. */
  const facet = (field, values, remove) => el('span', { class: 'facet', title: field ? `${field}: ${values[0]}` : values.join(` ${_t('or')} `) },
    el('span', { class: field ? 'facet-label' : 'facet-label filter' }, field),
    el('span', { class: 'facet-values' }, values.flatMap((v, i) => [i ? el('em', {}, _t('or')) : null, v])),
    el('button', { type: 'button', class: 'facet-x', title: _t('Remove'), 'aria-label': _t('Remove'), onclick: remove }, '×'));

  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Backspace' && !input.value && facets.lastChild) { ev.preventDefault(); facets.lastChild.querySelector('.facet-x').click(); }
    if (ev.key === 'Escape' && !panel.hidden) { ev.preventDefault(); open(false); }
  });
  const root = el('div', { class: 'searchbar' }, el('div', { class: 'search-main' }, facets, input), toggle, panel);
  document.addEventListener('pointerdown', (ev) => { if (!panel.hidden && !root.contains(ev.target)) open(false); });
  redraw();
  return { el: root, redraw };
}
