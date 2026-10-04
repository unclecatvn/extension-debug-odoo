// Pure part of the Menus tab (no chrome.*, no DOM): unit-tested.
import { N_ } from '../../i18n/i18n.ts';

export interface TechMenu { label: string; action: string; model: string }

/** The technical screens of OCA's developer_menu, in its order: its label, the action it opens (xmlid), that action's model. */
export const MENUS: readonly TechMenu[] = [
  { label: N_('Models'), action: 'base.action_model_model', model: 'ir.model' },
  { label: N_('Fields'), action: 'base.action_model_fields', model: 'ir.model.fields' },
  { label: N_('Record Rules'), action: 'base.action_rule', model: 'ir.rule' },
  { label: N_('Access Rights'), action: 'base.ir_access_action', model: 'ir.access' }, // 20: ir.access replaces ir.model.access and ir.rule
  { label: N_('Views'), action: 'base.action_ui_view', model: 'ir.ui.view' },
  { label: N_('Menus'), action: 'base.grant_menu_access', model: 'ir.ui.menu' },
  { label: N_('Model Data'), action: 'base.action_model_data', model: 'ir.model.data' },
  { label: N_('Crons'), action: 'base.ir_cron_act', model: 'ir.cron' },
  { label: N_('Actions Window'), action: 'base.ir_action_window', model: 'ir.actions.act_window' },
  { label: N_('Actions Server'), action: 'base.action_server_action', model: 'ir.actions.server' },
  { label: N_('Reports'), action: 'base.ir_action_report', model: 'ir.actions.report' },
  { label: N_('Parameters'), action: 'base.ir_config_list_action', model: 'ir.config_parameter' },
  { label: N_('Sequences'), action: 'base.ir_sequence_form', model: 'ir.sequence' },
  { label: N_('Mail Templates'), action: 'mail.action_email_template_tree_all', model: 'mail.template' },
];

/** /odoo/<path> of an action, by xmlid. */
export const actionPath = (xmlid: string) => `action-${xmlid}`;

/** ir.model.data domain finding the actions of `menus` (and any other module's xmlid of the same name: availableMenus() sorts them out). */
export function actionDomain(menus: readonly TechMenu[]): [string, string, string[]][] {
  const ids = menus.map((m) => m.action.split('.') as [string, string]);
  return [['module', 'in', [...new Set(ids.map(([module]) => module))]], ['name', 'in', ids.map(([, name]) => name)]];
}

/** The `menus` whose action is among `rows` (ir.model.data: module, name): Mail Templates goes without the mail module. */
export function availableMenus<M extends TechMenu>(menus: readonly M[], rows: readonly { module: string; name: string }[]): M[] {
  const known = new Set(rows.map((r) => `${r.module}.${r.name}`));
  return menus.filter((m) => known.has(m.action));
}
