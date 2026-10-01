// Menus tab, one card: the technical screens a developer opens all day (models, views, record rules, crons…), without
// debug mode nor the Technical menu: what OCA's developer_menu adds to Settings, with nothing to install. A click opens
// the action in the Odoo page, as its menu would; ↗ in a new tab.
import { MENUS, actionPath, actionDomain, availableMenus } from './logic.js';
import { pageOpenAction } from './page.js';
import { exec, call, cached, sessionInfo } from '../../shared/bridge.js';
import { $, el, empty, card, errBox, copyable, odooLink, listHead, splitRow } from '../../shared/ui.js';
import { _t } from '../../shared/i18n.js';

export function renderMenus(s, state) {
  card(s, async () => { // the tab's only card: no title to open it by
    // as developer_menu's groups=: these screens are for Access Rights managers, who can also read ir.model.data
    if (!(await sessionInfo()).is_admin) return empty(_t('Needs Access Rights (base.group_erp_manager).'));
    const rows = await cached('menu actions', () => call('ir.model.data', 'search_read', [actionDomain(MENUS)], { fields: ['module', 'name'] }));
    const error = el('div', { class: 'pad' });
    error.hidden = true;
    const items = availableMenus(MENUS, rows).map((m) => {
      const open = async () => {
        error.hidden = true;
        const r = await exec(pageOpenAction, m.action);
        if (r?.ok) return $('#full[aria-pressed=true]')?.click(); // full screen covers the page: back beside it, the screen just opened in sight
        error.replaceChildren(errBox(new Error(r?.error || _t('No response — is this an Odoo page?'))));
        error.hidden = false;
      };
      const li = el('li', {
        tabIndex: 0,
        onclick: (ev) => { if (!ev.target.closest('a, button')) open(); }, // ↗ and the copies act on their own
        onkeydown: (ev) => { if (ev.target === li && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); open(); } },
      },
      splitRow([el('span', {}, _t(m.label)), el('span', { class: 'muted' }, copyable(m.model, 'mono'))], odooLink(state.origin, actionPath(m.action))),
      el('div', { class: 'meta mono' }, copyable(m.action, '')));
      return li;
    });
    return el('div', {}, listHead(_t('Menu · model'), _t('Action')), el('ul', { class: 'list menus' }, items), error);
  });
}
