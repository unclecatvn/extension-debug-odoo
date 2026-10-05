// Menus tab, one card: the technical screens a developer opens all day (models, views, record rules, crons…), without
// debug mode nor the Technical menu: what OCA's developer_menu adds to Settings, with nothing to install. A click opens
// the action in the Odoo page, as its menu would; ↗ in a new tab. Same on 18.0 and 19.0 (the xmlids, doAction).
// Markup: menus.tpl.html; pure part: menus.logic.ts.
import { _t, translateDom } from '../../i18n/i18n.ts';
import { cached } from '../../extension/page-cache.ts';
import { exec, isExecError } from '../../extension/run-in-tab.ts';
import { sessionInfo } from '../../odoo/reads.ts';
import { call } from '../../odoo/rpc.ts';
import { card } from '../../ui/cards.ts';
import { copyable, empty, errBox, listHead, odooLink } from '../../ui/components.ts';
import { templates } from '../../ui/template.ts';
import type { TabModule } from '../registry.ts';
import { pageOpenAction } from './menus.injected.ts';
import { MENUS, actionDomain, actionPath, availableMenus } from './menus.logic.ts';
import html from './menus.tpl.html';

const tpl = templates(html, translateDom);

export const menusTab: TabModule = {
  render(section, state) {
    card(section, async () => {
      // as developer_menu's groups=: these screens are for Access Rights managers, who can also read ir.model.data
      if (!(await sessionInfo()).is_admin) return empty(_t('Needs Access Rights (base.group_erp_manager).'));
      const rows = await cached('menu actions', () =>
        call<{ module: string; name: string }[]>('ir.model.data', 'search_read', [actionDomain(MENUS)], { fields: ['module', 'name'] }));
      const r = tpl('menus', { root: HTMLDivElement, list: HTMLUListElement, error: HTMLDivElement }).refs;
      for (const m of availableMenus(MENUS, rows)) {
        const x = tpl('menu', { item: HTMLLIElement, line: HTMLDivElement, label: HTMLSpanElement, model: HTMLSpanElement, meta: HTMLDivElement }).refs;
        x.label.textContent = _t(m.label);
        x.model.append(copyable(m.model, 'mono'));
        x.line.append(odooLink(state.origin, actionPath(m.action)));
        x.meta.append(copyable(m.action, ''));
        const open = async () => {
          r.error.hidden = true;
          const res = await exec(pageOpenAction, m.action);
          if (res && !isExecError(res)) {
            // full screen covers the page: back beside it, the screen just opened in sight
            document.querySelector<HTMLButtonElement>('#full[aria-pressed=true]')?.click();
            return;
          }
          r.error.replaceChildren(errBox(new Error(res?.error || _t('No response — is this an Odoo page?'))));
          r.error.hidden = false;
        };
        x.item.addEventListener('click', (ev) => { if (!(ev.target as Element).closest('a, button')) void open(); }); // ↗ and the copies act on their own
        x.item.addEventListener('keydown', (ev) => {
          if (ev.target === x.item && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); void open(); }
        });
        r.list.append(x.item);
      }
      r.root.prepend(listHead(_t('Menu · model'), _t('Action')));
      return r.root;
    });
  },
};
