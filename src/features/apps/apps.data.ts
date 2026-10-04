// Apps tab: what it reads from and writes to the server. The same methods as Odoo's Apps menu (base/models/ir_module.py);
// the uninstall preview is Odoo's own wizard (base.module.uninstall), whose fields differ in 18.0 / 19.0 / 20.0 (odoo/adapter.ts).
// Every call needs Settings rights (base.group_system).
import { exec, tabId } from '../../extension/run-in-tab.ts';
import { pageReload } from '../../injected/navigation.ts';
import type { OdooAdapter } from '../../odoo/adapter.ts';
import { call } from '../../odoo/rpc.ts';
import { pageHasFile } from './apps.injected.ts';
import { PENDING, type AppModule, type DepRow, type XmlIdRow } from './apps.logic.ts';

const LIST = ['name', 'shortdesc', 'summary', 'state', 'latest_version', 'author', 'application', 'category_id', 'auto_install', 'to_buy', 'country_ids'];

/** Every module the database knows (Update Apps List adds the ones new on disk). */
export const readModules = () => call<AppModule[]>('ir.module.module', 'search_read', [[]], { fields: LIST, order: 'name' });

/** The manifests' versions on disk (installed_version, computed from each manifest: read for the installed only). */
export async function readDiskVersions(ids: readonly number[]): Promise<Map<number, string | false>> {
  if (!ids.length) return new Map();
  const rows = await call<{ id: number; installed_version: string | false }[]>('ir.module.module', 'read', [[...ids], ['installed_version']]);
  return new Map(rows.map((r) => [r.id, r.installed_version]));
}

export const readDependencies = () => call<DepRow[]>('ir.module.module.dependency', 'search_read', [[]], { fields: ['name', 'module_id', 'auto_install_required'] });

/** The countries of the companies (a localization auto-installs only for them), as button_install reads them. */
export const readCompanyCountries = () => call<{ country_id: [number, string] | false }[]>('res.company', 'search_read', [[]], { fields: ['country_id'] })
  .then((rows) => [...new Set(rows.flatMap((r) => (r.country_id ? [r.country_id[0]] : [])))]);

/** A module opened: what its manifest gave Odoo, and its description as Odoo renders it. */
export interface ModuleDetail {
  id: number;
  /** static/description/index.html when the module has one, else its RST description (manifest or README), as HTML
   * sanitized by the server */
  description_html: string | false;
  icon: string | false;
  maintainer: string | false;
  contributors: string | false;
  website: string | false;
  license: string | false;
  url: string | false;
  demo: boolean;
  views_by_module: string | false;
  menus_by_module: string | false;
  reports_by_module: string | false;
}
const DETAIL = ['description_html', 'icon', 'maintainer', 'contributors', 'website', 'license', 'url', 'demo', 'views_by_module', 'menus_by_module', 'reports_by_module'];
export const readDetail = (id: number) => call<ModuleDetail[]>('ir.module.module', 'read', [[id], DETAIL]).then((r) => r[0]!);

/** Whether the module has a static/description/index.html (Odoo shows it as its description). */
export async function hasIndexHtml(name: string): Promise<boolean> {
  const r = await exec(pageHasFile, `/${name}/static/description/index.html`);
  return r === true;
}

/** Every xmlid of the module (ir.model.data). */
export const readXmlIds = (module: string) =>
  call<XmlIdRow[]>('ir.model.data', 'search_read', [[['module', '=', module]]], { fields: ['model', 'name', 'res_id', 'noupdate'], order: 'model, name' });

/** The models of the module's xmlids, with every installed module defining or extending each (ir.model.modules). */
export async function readModels(ids: readonly number[]): Promise<{ id: number; model: string; name: string; modules: string[] }[]> {
  if (!ids.length) return [];
  const rows = await call<{ id: number; model: string; name: string; modules: string | false }[]>('ir.model', 'read', [[...ids], ['model', 'name', 'modules']]);
  return rows.map((r) => ({ ...r, modules: r.modules ? r.modules.split(/\s*,\s*/).filter(Boolean) : [] })).sort((a, b) => a.model.localeCompare(b.model));
}

/** The installed modules defining or extending `model`: the screen's modules. */
export async function modulesOfModel(model: string): Promise<string[]> {
  const [r] = await call<{ modules: string | false }[]>('ir.model', 'search_read', [[['model', '=', model]]], { fields: ['modules'], limit: 1 });
  return r?.modules ? r.modules.split(/\s*,\s*/).filter(Boolean) : [];
}

/** What uninstalling `id` removes, as Odoo's wizard computes it: every module going with it (itself included) and the
 * models whose every xmlid belongs to them (their tables and data are dropped). */
export async function uninstallPreview(id: number, a: OdooAdapter): Promise<{ modules: number[]; models: { model: string; name: string }[] }> {
  const w = a.modules.uninstallWizard;
  const wid = await call<number>('base.module.uninstall', 'create', [{ [w.moduleField]: w.many ? [[6, 0, [id]]] : id, ...(w.showAll ? { show_all: true } : {}) }]);
  const [r] = await call<Record<string, number[]>[]>('base.module.uninstall', 'read', [[wid], [...w.impactedFields, 'model_ids']]);
  const models = r?.model_ids?.length ? await call<{ model: string; name: string }[]>('ir.model', 'read', [r.model_ids, ['model', 'name']]) : [];
  return { modules: w.impactedFields.flatMap((f) => r?.[f] ?? []), models };
}

// ---------- operations ----------

/** Update Apps List: scans the addons path. → [updated, added]. */
export const updateList = () => call<[number, number]>('ir.module.module', 'update_list');

/** Install / upgrade / uninstall now (Odoo rebuilds its registry before answering). */
export const immediate = (op: 'install' | 'upgrade' | 'uninstall', ids: readonly number[]) => call('ir.module.module', `button_immediate_${op}`, [[...ids]]);

/** The modules waiting for an operation, read again (the list may be older). */
export const readPending = () => call<{ id: number; name: string; state: AppModule['state'] }[]>('ir.module.module', 'search_read',
  [[['state', 'in', [...PENDING]]]], { fields: ['name', 'state'], order: 'name' });

/** Apply Scheduled Upgrades (base.module.upgrade, same in 18.0 / 19.0 / 20.0): runs every waiting operation, or cancels them all. */
export async function scheduled(what: 'apply' | 'cancel') {
  const wid = await call<number>('base.module.upgrade', 'create', [{}]);
  await call('base.module.upgrade', what === 'apply' ? 'upgrade_module' : 'upgrade_module_cancel', [[wid]]);
}

/** The Odoo page reloads (its webclient learns the new modules). */
export const reloadPage = () => exec(pageReload);

/** Opens /odoo/<path> of each module's form in new tabs, after the inspected one. */
export async function openForms(origin: string, paths: readonly string[]) {
  if (tabId == null) return;
  const here = await chrome.tabs.get(tabId);
  for (const [i, path] of paths.entries()) {
    await chrome.tabs.create({ url: `${origin}/odoo/${path}`, index: here.index + 1 + i, openerTabId: tabId, active: false });
  }
}
