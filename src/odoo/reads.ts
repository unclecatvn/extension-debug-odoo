// The server reads several tabs share. Those that only change on a page load are cached (extension/page-cache.ts);
// ACLs and rules are not: they are what people edit while debugging.
import { cached } from '../extension/page-cache.ts';
import { aclOf, IR_ACCESS_FIELDS, ruleOf, type IrAccess } from './access.ts';
import type { OdooAdapter } from './adapter.ts';
import { MODES, type FieldsGet, type IrModelAccess, type IrModule, type IrRule, type SessionInfo } from './models.ts';
import { call, rpc } from './rpc.ts';
import type { Json } from '../contracts/json.ts';

const FIELD_ATTRS = ['string', 'type', 'relation', 'store', 'depends', 'related', 'readonly', 'required', 'groups', 'selection'];

export const sessionInfo = () => cached('session', () => rpc<SessionInfo>('/web/session/get_session_info', {}));

export const fieldsOf = (model: string) => cached(`fields ${model}`, () => call<FieldsGet>(model, 'fields_get', [], { attributes: FIELD_ATTRS }));

// latest_version = the version installed in the DB (installed_version is computed from the manifest on disk: slow)
export const installedModules = () => cached('modules', () => call<IrModule[]>('ir.module.module', 'search_read', [[['state', '=', 'installed']]],
  { fields: ['name', 'shortdesc', 'latest_version', 'author'], order: 'name' }));

const PERMS = MODES.map((m) => `perm_${m}`);
const ofModel = (model: string): Json[] => [[['model_id.model', '=', model]]];

/** A model's ACLs and record rules; on 20, its ir.access rows read as both (access.ts). */
export async function readAccess(model: string, a: OdooAdapter): Promise<{ acls: IrModelAccess[]; rules: IrRule[] }> {
  if (a.access === 'unified') {
    const rows = await call<IrAccess[]>('ir.access', 'search_read', ofModel(model), { fields: IR_ACCESS_FIELDS });
    return { acls: rows.flatMap((r) => aclOf(r) ?? []), rules: rows.map(ruleOf) };
  }
  const [acls, rules] = await Promise.all([
    call<IrModelAccess[]>('ir.model.access', 'search_read', ofModel(model), { fields: ['name', 'group_id', ...PERMS] }),
    call<IrRule[]>('ir.rule', 'search_read', ofModel(model), { fields: ['name', 'groups', 'domain_force', 'global', ...PERMS] }),
  ]);
  return { acls, rules };
}

/** Group xmlids → their names (res.groups.full_name, e.g. "Administration / Settings"), for the groups the user may
 * read. Each xmlid goes through ir.model.data.check_object_reference, which only reads the group itself: no Access
 * Rights needed (ir.model.data is theirs). Unknown or unreadable: left out (callers show the xmlid). Cached per page load. */
export async function groupNames(xmlids: readonly string[]): Promise<Map<string, string>> {
  const ids = await groupIds(xmlids);
  const known = ids.filter((id): id is number => id != null);
  const rows = known.length ? await call<{ id: number; full_name: string }[]>('res.groups', 'read', [known, ['full_name']]).catch(() => []) : [];
  const byId = new Map(rows.map((g) => [g.id, g.full_name]));
  return new Map(xmlids.flatMap((xmlid, i) => {
    const name = byId.get(ids[i] ?? -1);
    return name ? [[xmlid, name] as const] : [];
  }));
}

/** Group xmlids → their ids (null: no such group), through ir.model.data.check_object_reference (no Access Rights
 * needed). Cached per page load. */
export const groupIds = (xmlids: readonly string[]): Promise<(number | null)[]> => Promise.all(xmlids.map((xmlid) => cached(`group id ${xmlid}`, async () => {
  const [module, ...name] = xmlid.split('.');
  if (!module || !name.length) return null;
  const ref = await call<[string, number | false]>('ir.model.data', 'check_object_reference', [module, name.join('.')]).catch(() => null);
  return ref?.[0] === 'res.groups' && typeof ref[1] === 'number' ? ref[1] : null;
})));
