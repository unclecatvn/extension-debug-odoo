// View tab, part ① Overview: what is on screen, in a few facts read at a glance. Which view (and its file), how many
// views and modules build it, where it was opened from (menu, action, or a URL), the record and the state of its
// fields, the other views of the action.
import { _t } from '../../i18n/i18n.ts';
import type { PageState } from '../../injected/page-state.ts';
import { fill } from '../../ui/cards.ts';
import { copyable, pill } from '../../ui/components.ts';
import type { FormFields } from './view.injected.ts';
import { moduleOf } from './arch.logic.ts';
import { actionRef, actionXmlId, menusOf, type Composition } from './view.data.ts';
import { frag, part } from '../../ui/parts.ts';
import { tpl } from './view.ui.ts';

const MODULES_SHOWN = 8;

export function overviewPart(parent: HTMLElement, state: PageState, main: Promise<Composition | null> | null,
  search: Promise<Composition | null> | null, form: Promise<FormFields | null> | null) {
  const p = part(parent, 'overview', '1', _t('Overview'));
  p.lazy(() => fill(p.body, async () => {
    const [comp, searchComp, fields] = await Promise.all([main, search, form].map((x) => x?.catch(() => null) ?? null)) as
      [Composition | null, Composition | null, FormFields | null];
    const { list } = tpl('facts', { list: HTMLDListElement }).refs;
    const fact = (label: string, ...value: (Node | string | null | false | undefined)[]) => {
      const r = tpl('fact', { label: HTMLElement, value: HTMLElement }).refs;
      r.label.textContent = label;
      r.value.append(...value.filter((v): v is Node | string => !!v));
      list.append(r.label.parentElement!);
    };

    // the view on screen
    const views = comp?.views ?? null;
    const current = views?.find((v) => v.view.id === comp?.view.id)?.view;
    if (comp) {
      fact(_t('View'), pill(comp.type, 'accent'), current?.xml_id ? copyable(current.xml_id) : `#${comp.view.id}`,
        current && pill(current.name), current?.xml_id && `#${comp.view.id}`);
      if (current?.arch_fs) fact(_t('File'), copyable(current.arch_fs, 'mono'));
    } else if (!state.viewType) fact(_t('View'), _t('none: a client action (%s)', String(state.action?.tag ?? state.action?.type ?? '?')));

    // how it is built
    if (views) {
      const active = views.filter((v) => v.view.active);
      const extensions = active.filter((v) => v.view.mode === 'extension').length;
      const bases = active.length - extensions;
      const modules = [...new Set(active.map((v) => moduleOf(v.view.xml_id) ?? _t('(no module)')))];
      const inactive = views.length - active.length;
      fact(_t('Built from'),
        _t('%s base + %s extensions · %s modules', bases, extensions, modules.length),
        inactive > 0 && pill(_t('%s inactive', inactive)),
        ...modules.slice(0, MODULES_SHOWN).map((m) => pill(m)),
        modules.length > MODULES_SHOWN && pill(`+${modules.length - MODULES_SHOWN}`));
    } else if (comp) fact(_t('Built from'), _t('unknown: the inheritance needs Settings rights (base.group_system)'));

    // where it was opened from
    const ref = actionRef(state.action);
    if (ref) {
      const [menus, xmlId] = await Promise.all([menusOf(ref), actionXmlId(ref, state.action?.xml_id)]);
      if (menus.length) fact(_t('Menu'), ...menus.map((m) => pill(m.split('/').join(' › '))));
      fact(_t('Action'), String(state.action?.name ?? '—'), xmlId ? copyable(xmlId) : `#${ref.id}`, pill(ref.type));
    } else if (state.viewType) fact(_t('Action'), _t('none: opened directly by its URL'));

    // the record, and its fields as they are now
    if (state.resId || fields) {
      const f = fields && 'fields' in fields ? fields : null;
      fact(_t('Record'), state.resId ? `#${state.resId}` : _t('new'), f && pill(f.editable ? _t('editing') : _t('read-only'), f.editable ? 'ok' : ''));
      if (f) {
        const all = f.fields;
        const n = (pred: (x: (typeof all)[number]) => boolean) => all.filter(pred).length;
        const hidden = n((x) => !!x.invisible.value);
        const notShown = n((x) => !x.invisible.value && !x.inDom);
        const readonly = n((x) => !!x.readonly.value);
        const required = n((x) => !!x.required.value);
        const errors = n((x) => !!(x.invisible.error || x.readonly.error || x.required.error));
        fact(_t('Fields'), _t('%s on the form', f.fields.length),
          hidden > 0 && pill(_t('%s hidden', hidden), 'err'), notShown > 0 && pill(_t('%s not shown', notShown), 'med'),
          readonly > 0 && pill(_t('%s read-only', readonly), 'info'), required > 0 && pill(_t('%s required', required), 'info'),
          errors > 0 && pill(_t('%s expression errors', errors), 'med'));
      }
    }

    // the other views of the action, and its search view
    const modes = ((state.action?.views as [number | false, string][] | undefined) ?? []).map(([, t]) => t);
    const searchView = searchComp?.views?.find((v) => v.view.id === searchComp.view.id)?.view;
    if (modes.length || searchComp) {
      fact(_t('Views of the action'), ...modes.map((m) => pill(m, m === state.viewType ? 'accent' : '')),
        searchComp && pill(_t('search: %s', searchView?.xml_id || `#${searchComp.view.id}`)));
    }
    return frag(list);
  }));
}
