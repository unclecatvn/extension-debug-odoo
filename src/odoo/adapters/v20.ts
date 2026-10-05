// Odoo 20.0. Every value checked against the 20.0 sources (odoo/orm/models.py, base/models/ir_access.py, res_users.py,
// res_groups.py, ir_module.py, ir_profile.py, ir_config_parameter.py, base/wizard/base_module_uninstall.py, addons/rpc,
// addons/web/models/models.py); the comment says what changed since 19.0.
import type { MethodSignature, OdooAdapter } from '../adapter.ts';
import { SIGNATURES as SIGNATURES_19 } from './v19.ts';

const READ = [
  'search', 'search_read', 'search_count', // search_fetch: @api.private
  'read', 'formatted_read_group', 'read_group', // read_group: public again, the tuple API (the former _read_group)
  'web_search_read', 'web_read', 'web_read_group', 'read_progress_bar',
  'fields_get', 'name_search', 'default_get', 'get_views', 'get_view',
  'has_access', // check_access_rights / check_access_rule are gone; check_access, exists: @api.private
  'has_group', 'check_object_reference', 'get_metadata', 'export_data',
] as const;

const MODEL = [
  'search', 'search_read', 'search_count', 'formatted_read_group', 'read_group', 'web_search_read', 'web_read_group',
  'read_progress_bar', 'fields_get', 'name_search', 'name_create', 'default_get', 'get_views', 'get_view', 'create',
  'check_object_reference',
] as const;

/** 19.0's, the same in 20.0 but read_group (a new signature), exists (@api.private) and web_unlink (new: the webclient's
 * delete, addons/web/models/models.py). */
const { exists: _, ...SAME } = SIGNATURES_19;
const SIGNATURES: Record<string, MethodSignature> = {
  ...SAME,
  read_group: { params: ['domain', 'groupby', 'aggregates', 'having', 'offset', 'limit', 'order'], model: true },
  web_unlink: { params: [], model: false },
};

export const v20: OdooAdapter = {
  major: 20,
  users: {
    allGroupsField: 'all_group_ids',
    writeGroupsField: 'group_ids',
  },
  groups: {
    impliedField: 'all_implied_ids',
    impliedIncludesSelf: true,
    appField: 'privilege_id', // labelled "Scope" in 20
    usersField: 'all_user_ids',
  },
  // ir.model.access and ir.rule are gone: one ir.access, permissions (a group) OR-ed, restrictions (none) AND-ed
  access: 'unified',
  rules: {
    inheritsStoredOnly: false, // _access_domain: every parent's whole access domain (permissions too), stored link or not
    inheritsUnchecked: { // _check_inherits_access = False
      models: ['hr.employee', 'mail.mail', 'website.controller.page', 'quotation.document'],
      parents: ['mail.alias'], // mail.alias.mixin
    },
    groupRulesRequired: true, // Domain.OR([]) of no permission is FALSE, for a parent too
    evalNames: ['user', 'time', 'company_ids', 'company_id'], // `time` is back (ir.access._eval_context)
  },
  i18n: { webTranslationsPath: '/web/webclient/translations' },
  profiler: {
    listFields: ['name', 'session', 'duration', 'cpu_duration', 'sql_count', 'create_date'],
    speedscopeMany: true,
    speedscopeNeedsEnabled: false,
    paramGetter: 'get_str', // get_param / set_param are gone: get_str, get_bool, get_int…
  },
  modules: {
    // show_all is gone (create refuses an unknown field); the applications are listed apart from the other modules
    uninstallWizard: { moduleField: 'module_ids', many: true, impactedFields: ['impacted_application_ids', 'impacted_module_ids'], showAll: false },
    refusesWhilePending: false, // _button_immediate_function only refuses a concurrent operation (a lock); Registry.new runs every waiting one
  },
  // /json/2 as in 19 (the API key needs the 'rpc' scope); /jsonrpc still answers, removed in 22
  api: { kind: 'json2', signatures: SIGNATURES },
  orm: { readMethods: READ, modelMethods: MODEL, groupMethod: 'formatted_read_group', binaryRead: 'web' },
  expects: [
    { model: 'res.users', field: 'group_ids', usedBy: 'Security: groups' },
    { model: 'res.users', field: 'all_group_ids', usedBy: 'Security: groups' },
    { model: 'res.groups', field: 'all_implied_ids', usedBy: 'Security: implied groups' },
    { model: 'res.groups', field: 'privilege_id', usedBy: 'Security: groups by application' },
    { model: 'res.groups', field: 'all_user_ids', usedBy: 'Security: users of a group' },
    { model: 'ir.access', field: 'operation', usedBy: 'Security: access rights' },
    { model: 'ir.access', field: 'domain', usedBy: 'Security: access rights' },
    { model: 'ir.profile', field: 'cpu_duration', usedBy: 'Perf' },
    { model: 'base.module.uninstall', field: 'impacted_application_ids', usedBy: 'Apps: uninstall preview' },
    { model: 'base.module.uninstall', field: 'impacted_module_ids', usedBy: 'Apps: uninstall preview' },
  ],
};
