// View tab: the story of the screen, from the overview to the code (each part in its own file):
//   ① view.overview.ts     what is on screen, at a glance
//   ② view.composition.ts  how the view is built: the views Odoo combines, what each does, their own arch
//   ③ view.field.ts        one field: how it is now, its story through the views, its groups
//   ④ view.action.ts       the action and the context the screen was opened with
//   ⑤ view.arch.ts         the combined arch
// view.data.ts reads what they share, view.state.ts holds the inspected field. Same on 18.0 and 19.0 (webclient
// internals, get_views, ir.ui.view, ir.ui.menu: checked in both sources).
import type { ExtMessage } from '../../contracts/messages.ts';
import { exec } from '../../extension/run-in-tab.ts';
import { _t } from '../../i18n/i18n.ts';
import { empty } from '../../ui/components.ts';
import type { TabModule, TabName } from '../registry.ts';
import { actionPart } from './view.action.ts';
import { archPart } from './view.arch.ts';
import { compositionPart } from './view.composition.ts';
import { composition, searchViewOf } from './view.data.ts';
import { fieldPart } from './view.field.ts';
import { pageFormFields, type FormFields } from './view.injected.ts';
import { overviewPart } from './view.overview.ts';
import { inspect, inspectedField, resetFollowers } from './view.state.ts';

let picked: string | null = null; // a field clicked with Pick on Page, for the next render
let lastModel: string | null = null;

export const viewTab: TabModule = {
  render(section, state) {
    resetFollowers();
    const { model, viewType, viewId } = state;
    if (model !== lastModel) { lastModel = model ?? null; if (inspectedField()) inspect(''); } // another model: another field list
    if (picked) { inspect(picked); picked = null; }
    if (!model) {
      section.append(empty(_t('No model on this screen.')));
      if (state.action) actionPart(section, state);
      return;
    }
    const comps = viewType ? [{ type: viewType, promise: composition(model, viewType, viewId || false) }] : [];
    const searchId = searchViewOf(state);
    if (searchId !== undefined) comps.push({ type: 'search', promise: composition(model, 'search', searchId) });
    const form: Promise<FormFields | null> | null = viewType === 'form'
      ? exec(pageFormFields).then((r) => (r && 'fields' in r ? r : null), () => null) : null;

    overviewPart(section, state, comps[0]?.promise ?? null, comps.find((c) => c.type === 'search')?.promise ?? null, form);
    if (comps.length) {
      compositionPart(section, state.origin, comps);
      fieldPart(section, model, comps, form);
    }
    actionPart(section, state);
    if (comps.length) archPart(section, comps);
  },
  onMessage(msg: ExtMessage): TabName | null {
    if (msg.type !== 'odoo-pick') return null;
    picked = msg.name || null; // '' = cancelled: the re-render just resets the picker button
    return 'view';
  },
};
