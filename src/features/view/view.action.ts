// View tab, part ④ Action & context: how the screen was opened, the context and domain it got. Collapsible: read
// once the view itself is understood.
import { _t } from '../../i18n/i18n.ts';
import type { PageState } from '../../injected/page-state.ts';
import { block } from '../../ui/cards.ts';
import { details, kv, odooLink, pre } from '../../ui/components.ts';
import { actionRef, actionXmlId, menusOf } from './view.data.ts';
import { frag, note } from '../../ui/parts.ts';

export function actionPart(parent: HTMLElement, state: PageState) {
  block(parent, 'action', _t('Action & context'), async () => {
    const { action } = state;
    const ref = actionRef(action);
    const [menus, xmlId] = ref ? await Promise.all([menusOf(ref), actionXmlId(ref, action?.xml_id)]) : [[], ''];
    const views = ((action?.views as [number | false, string][] | undefined) ?? []).map(([id, t]) => (id ? `${t} #${id}` : t)).join(', ');
    return frag(
      ref ? null : note(_t('Opened without an action: by the URL of a record. The webclient made one up to show it.')),
      action && kv({
        name: action.name ?? '—', id: action.id ?? '—', xml_id: xmlId || '—', type: action.type ?? '—', res_model: action.res_model ?? state.model ?? '—',
        target: action.target ?? '—', ...(action.path ? { path: `/odoo/${String(action.path)}` } : {}), views: views || '—',
        ...(menus.length ? { [_t('menu')]: menus.map((m) => m.split('/').join(' › ')).join(' · ') } : {}),
      }),
      ref && odooLink(state.origin, `${ref.type}/${ref.id}`, _t('Open Action Record ↗')),
      details(_t('Context'), pre(state.context ?? {})),
      details(_t('Domain'), pre(state.domain ?? [])),
      action && details(_t('Full action (JSON)'), pre(action)),
    );
  }, '4');
}
