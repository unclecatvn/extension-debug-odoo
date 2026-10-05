// Security tab: what it reads from the server, and the simulation it runs on it (security.logic.ts does the deciding).
// The ACLs, rules and ir.model are readable with Access Rights (base.group_erp_manager) only: below it each read gives
// null and the parts say so; res.users and res.groups are readable by every internal user. Version differences come
// from the adapter (groups fields, the application of a group, parents through a non-stored link, `time`; on 20 the
// ACLs and rules are ir.access rows, read as both: odoo/access.ts).
import type { Json } from '../../contracts/json.ts';
import { cached } from '../../extension/page-cache.ts';
import { exec, isExecError } from '../../extension/run-in-tab.ts';
import { aclOf, IR_ACCESS_FIELDS, restricts, ruleOf, type IrAccess } from '../../odoo/access.ts';
import type { OdooAdapter } from '../../odoo/adapter.ts';
import { MODES, type FieldsGet, type IrModelAccess, type IrRule, type Many2one } from '../../odoo/models.ts';
import { fieldsOf, groupIds, readAccess, sessionInfo } from '../../odoo/reads.ts';
import { call, isAccessError } from '../../odoo/rpc.ts';
import { pageCompanies, pageEvalDomains, type Evaluated } from './security.injected.ts';
import {
  definingModules, ruleEvalContext, unavailableNames, usesAccessOperator, userPaths, verdicts, type AclRow, type ModeVerdict, type Rule, type Tri, type VerdictInput,
} from './security.logic.ts';

/** null when the server refuses for lack of rights; any other failure goes on. */
export const unlessDenied = <T>(p: Promise<T>): Promise<T | null> => p.catch((e: unknown) => { if (isAccessError(e)) return null; throw e; });

/** The groups the panel names: base's key groups, xmlid → id (check_object_reference: no Access Rights needed). */
export const KEY_GROUPS = ['base.group_system', 'base.group_erp_manager', 'base.group_no_one', 'base.group_user', 'base.group_portal', 'base.group_public',
  'base.group_everyone'] as const; // group_everyone: 20, implied by user, portal and public
export const keyGroups = async (): Promise<Map<string, number>> => {
  const ids = await groupIds(KEY_GROUPS);
  return new Map(KEY_GROUPS.flatMap((xmlid, i) => (ids[i] != null ? [[xmlid, ids[i]!] as const] : [])));
};

export interface Group { id: number; full_name: string; app: string; /** the groups it implies, itself excluded */ implies: Set<number> }
export interface GroupGraph {
  all: Group[];
  byId: Map<number, Group>;
  /** the group and every group it implies */
  closure(id: number): Set<number>;
  implied(id: number): Set<number>;
  name(id: number): string;
}

/** Every group, its application and what it implies (adapter: which fields say so on this version). */
export const groupGraph = (a: OdooAdapter): Promise<GroupGraph> => cached('security groups', async () => {
  const rows = await call<Record<string, unknown>[]>('res.groups', 'search_read', [[]], { fields: ['full_name', a.groups.appField, a.groups.impliedField], order: 'full_name' });
  const all = rows.map((r) => {
    const id = r.id as number;
    const app = r[a.groups.appField] as Many2one;
    return { id, full_name: String(r.full_name), app: app ? app[1] : '', implies: new Set((r[a.groups.impliedField] as number[]).filter((g) => g !== id)) };
  });
  const byId = new Map(all.map((g) => [g.id, g]));
  const implied = (id: number) => byId.get(id)?.implies ?? new Set<number>();
  return { all, byId, implied, closure: (id) => new Set([id, ...implied(id)]), name: (id) => byId.get(id)?.full_name ?? `#${id}` };
});

/** res.users as the tab reads it. `all`: every group (implied included); `write`: the field groups are written to. */
export interface UserRow {
  id: number;
  name: string;
  login: string;
  active: boolean;
  share: boolean;
  partner_id: Many2one;
  company_id: Many2one;
  company_ids: number[];
  all: number[];
  write: number[];
  totp_enabled?: boolean;
  api_key_ids?: number[];
  employee_id?: Many2one;
  employee_ids?: number[];
  login_date?: string | false;
}

const OPTIONAL = ['totp_enabled', 'api_key_ids', 'employee_id', 'employee_ids', 'login_date']; // modules / rights may hide them

export async function readUser(uid: number, a: OdooAdapter): Promise<UserRow> {
  const fields = await fieldsOf('res.users');
  const { allGroupsField: all, writeGroupsField: write } = a.users;
  const names = ['name', 'login', 'active', 'share', 'partner_id', 'company_id', 'company_ids', ...new Set([all, write]), ...OPTIONAL.filter((f) => f in fields)];
  const [u] = await call<Record<string, unknown>[]>('res.users', 'read', [[uid], names], { context: { active_test: false } });
  if (!u) throw new Error(`res.users #${uid}?`);
  return { ...u, all: u[all] as number[], write: u[write] as number[] } as unknown as UserRow;
}

/** Users by name or login (archived too, when asked), internal users first. */
export function searchUsers(q: string, archived: boolean, a: OdooAdapter) {
  const domain: Json[] = ['|', ['name', 'ilike', q], ['login', 'ilike', q]];
  if (archived) domain.push(['active', 'in', [true, false]]);
  return call<{ id: number; name: string; login: string; share: boolean; active: boolean; [groups: string]: unknown }[]>('res.users', 'search_read', [domain],
    { fields: ['name', 'login', 'share', 'active', a.users.allGroupsField], limit: 20, order: 'share, name', context: { active_test: !archived } });
}

/** The user the tab is about, as simulated: real groups, the groups being tried (and what they imply), the companies
 * selected in its switcher. */
export interface Simulated {
  user: UserRow;
  isMe: boolean;
  superuser: boolean;
  real: Set<number>;
  tried: Set<number>;
  groupIds: Set<number>;
  /** the companies its switcher has on, the current one first */
  companies: number[];
  companyNames: Map<number, string>;
  /** whether `companies` is what the page has on (your own user, not changed in the tab) */
  pageCompanies: boolean;
  commercialPartner: number;
  has(xmlid: string): boolean;
}

/**
 * `companies`: chosen in the tab, else the default: for yourself the page's switcher, for someone else their default
 * company (what Odoo starts them on; their switcher can't be seen).
 */
export async function simulate(uid: number, tried: ReadonlySet<number>, companies: readonly number[] | null, a: OdooAdapter): Promise<Simulated> {
  const [info, user, keys] = await Promise.all([sessionInfo(), readUser(uid, a), keyGroups()]);
  const graph = tried.size ? await groupGraph(a) : null;
  const real = new Set(user.all);
  const groupIds = new Set(real);
  for (const g of tried) for (const h of graph!.closure(g)) groupIds.add(h);
  const isMe = uid === info.uid;
  const page = isMe ? await exec(pageCompanies).then((r) => (Array.isArray(r) ? r : null), () => null) : null;
  const own = new Set(user.company_ids);
  const fallback = user.company_id ? [user.company_id[0]] : user.company_ids.slice(0, 1);
  const chosen = (companies ?? page ?? fallback).filter((c) => own.has(c));
  const picked = chosen.length ? chosen : fallback;
  const [partner] = user.partner_id
    ? await call<{ commercial_partner_id: Many2one }[]>('res.partner', 'read', [[user.partner_id[0]], ['commercial_partner_id']]).catch(() => [])
    : [];
  const names = await call<{ id: number; display_name: string }[]>('res.company', 'read', [user.company_ids, ['display_name']]).catch(() => []);
  return {
    user, isMe, superuser: uid === 1, real, tried: new Set(tried), groupIds, companies: picked,
    companyNames: new Map(names.map((c) => [c.id, c.display_name])),
    pageCompanies: isMe && !companies && !!page && picked.join() === page.join(),
    commercialPartner: partner?.commercial_partner_id ? partner.commercial_partner_id[0] : user.partner_id ? user.partner_id[0] : 0,
    has: (xmlid) => { const id = keys.get(xmlid); return id != null && groupIds.has(id); },
  };
}

/** An _inherits parent: its rules join the model's (as one global rule) unless the adapter skips a non-stored link or
 * the model doesn't check its parents. */
export interface Parent { model: string; link: string; stored: boolean; counted: boolean }

export interface ModelSecurity {
  fields: FieldsGet;
  /** null: needs Access Rights */
  acls: IrModelAccess[] | null;
  /** the model's rules, then its parents' (with `via`); null: needs Access Rights */
  rules: Rule[] | null;
  parents: Parent[];
}

/** The _inherits parents of `model` (ir.model.inherited_model_ids), each with the many2one the inherited fields go
 * through (fields_get: `related` = "<link>.<field>"). */
async function parentsOf(model: string, fields: FieldsGet, a: OdooAdapter): Promise<Parent[]> {
  const unchecked = a.rules.inheritsUnchecked;
  const [row] = await call<{ inherited_model_ids: number[] }[]>('ir.model', 'search_read', [[['model', '=', model]]], { fields: ['inherited_model_ids'] });
  if (!row?.inherited_model_ids.length) return [];
  const models = await call<{ model: string }[]>('ir.model', 'read', [row.inherited_model_ids, ['model']]);
  const relatedVia = (link: string) => Object.values(fields).filter((f) => String(Array.isArray(f.related) ? f.related.join('.') : f.related ?? '').startsWith(`${link}.`)).length;
  return models.flatMap(({ model: parent }) => {
    const links = Object.entries(fields).filter(([, f]) => f.type === 'many2one' && f.relation === parent).sort(([x], [y]) => relatedVia(y) - relatedVia(x));
    const [link, f] = links[0] ?? [];
    if (!link || !f) return [];
    const stored = f.store !== false;
    const checked = !unchecked.models.includes(model) && !unchecked.parents.includes(parent);
    return [{ model: parent, link, stored, counted: checked && (stored || !a.rules.inheritsStoredOnly) }];
  });
}

/** Not cached: ACLs and rules are what people edit while debugging. */
export async function modelSecurity(model: string, a: OdooAdapter): Promise<ModelSecurity> {
  const fields = await fieldsOf(model);
  const [own, parents] = await Promise.all([unlessDenied(readAccess(model, a)), unlessDenied(parentsOf(model, fields, a))]);
  const theirs = await Promise.all((parents ?? []).filter((p) => p.counted).map(async (p) =>
    ((await unlessDenied(readAccess(p.model, a)))?.rules ?? []).map((r): Rule => ({ ...r, via: { model: p.model, link: p.link } }))));
  return { fields, acls: own?.acls ?? null, rules: own && [...own.rules, ...theirs.flat()], parents: parents ?? [] };
}

/** Odoo's answer for yourself: has_access per operation, with the companies selected (null: no answer). */
export const serverAccess = (model: string, resId: number | null, companies: readonly number[]): Promise<Tri[]> =>
  Promise.all(MODES.map((op) => call<boolean>(model, 'has_access', [resId ? [resId] : [], op], { context: { allowed_company_ids: [...companies] } }).catch(() => null)));

/** What the tab concludes on a model (and a record) for a simulated user. */
export interface Assessment {
  /** the ACLs and rules could be read */
  rights: boolean;
  input: VerdictInput | null;
  verdicts: ModeVerdict[];
  /** has_access, run by the server: your own user, real groups only */
  server: Tri[] | null;
  /** rule id → its domain evaluated for the user, or why it can't be */
  evaluated: Map<number, Evaluated>;
  /** rule id → why the record could not be checked against it */
  notes: Map<number, string>;
}

const N_ = (s: string) => s;

/**
 * A record as a rule's domain reads it: the attributes `paths` name, read from the database. A many2one is
 * { id, …its attributes }, an x2many { ids, …its attributes, read on all its records }: what `user.x.ids`,
 * `user.x.y.id` evaluate to. Fields the viewer can't read stay missing (the rule then says it can't be evaluated).
 */
async function recordObject(model: string, ids: number[], paths: string[][], many: boolean): Promise<Record<string, unknown>> {
  const obj: Record<string, unknown> = many ? { ids } : { id: ids[0] ?? false };
  const names = [...new Set(paths.map((p) => p[0]!).filter((n) => n !== 'id' && n !== 'ids'))];
  if (!ids.length || !names.length) return obj;
  const fields = await fieldsOf(model).catch((): FieldsGet => ({}));
  const known = names.filter((n) => n in fields);
  if (!known.length) return obj;
  const rows = await call<Record<string, unknown>[]>(model, 'read', [ids, known], { context: { active_test: false } }).catch(() => []);
  for (const n of known) {
    const f = fields[n]!;
    const rest = paths.filter((p) => p[0] === n && p.length > 1).map((p) => p.slice(1));
    const vals = rows.map((r) => r[n]);
    if (f.type === 'many2one' && f.relation) {
      const rel = [...new Set(vals.flatMap((v) => (Array.isArray(v) ? [v[0] as number] : [])))];
      obj[n] = await recordObject(f.relation, rel, rest, many);
    } else if ((f.type === 'one2many' || f.type === 'many2many') && f.relation) {
      obj[n] = await recordObject(f.relation, [...new Set(vals.flatMap((v) => (Array.isArray(v) ? v as number[] : [])))], rest, true);
    } else obj[n] = many ? vals : vals[0];
  }
  return obj;
}

/**
 * Each rule's domain evaluated for the user (py_js in the page), then the record checked against it with search_count
 * (filtered_domain is not callable over RPC): [('id', '=', record)] + the domain, or + (link, 'any', domain) for a
 * parent's rule, as _compute_domain does. Run under the viewer's own rules: a record the viewer can't read can't be
 * checked.
 */
export async function assess(model: string, resId: number | null, sim: Simulated, sec: ModelSecurity, a: OdooAdapter): Promise<Assessment> {
  const server = sim.isMe && !sim.tried.size ? serverAccess(model, resId, sim.companies) : null;
  const evaluated = new Map<number, Evaluated>();
  const notes = new Map<number, string>();
  if (!sec.acls || !sec.rules) return { rights: false, input: null, verdicts: [], server: await server, evaluated, notes };

  const rules = sec.rules;
  const evaluatedNow = await evaluateFor(sim, rules, a);
  const count = (domain: Json[]) => call<number>(model, 'search_count', [[['id', '=', resId], ...domain]], { context: { active_test: false } });
  const visible = resId ? await count([]).catch(() => 0) : 0;
  const passed = new Map<number, boolean>();
  await Promise.all(rules.map(async (r) => {
    const ev = evaluatedNow.get(r.id)!;
    evaluated.set(r.id, ev);
    if ('error' in ev || !resId) return;
    if (!visible) return notes.set(r.id, N_('You cannot read this record yourself, so its rules cannot be checked.'));
    const domain = ev.domain as Json[];
    if (!domain.length) return passed.set(r.id, true);
    // 20's ('field', 'access', operation) is resolved for whoever runs the search: the viewer, not the simulated user
    if ((!sim.isMe || sim.tried.size) && usesAccessOperator(domain)) return notes.set(r.id, N_('Its \'access\' condition is checked with your own rights, not the simulated user\'s: it cannot be told.'));
    try { passed.set(r.id, (await count(r.via ? [[r.via.link, 'any', domain]] : domain)) > 0); } catch (e) { notes.set(r.id, (e as Error).message); }
  }));
  const input: VerdictInput = { superuser: sim.superuser, groupIds: sim.groupIds, acls: sec.acls, rules, resId, passed,
    groupRulesRequired: a.rules.groupRulesRequired, parents: sec.parents.filter((p) => p.counted).map((p) => p.model) };
  return { rights: true, input, verdicts: verdicts(input), server: await server, evaluated, notes };
}

/**
 * The rules' domains evaluated for the simulated user (py_js in the page): ir.rule._eval_context with the companies
 * on, `user` with every attribute the rules read (custom fields too, from the real user; the groups simulated).
 */
export async function evaluateFor(sim: Simulated, rules: readonly IrRule[], a: OdooAdapter): Promise<Map<number, Evaluated>> {
  const ctx = ruleEvalContext({
    id: sim.user.id, login: sim.user.login, partner_id: sim.user.partner_id ? sim.user.partner_id[0] : 0, commercial_partner_id: sim.commercialPartner,
    company_id: sim.user.company_id ? sim.user.company_id[0] : false, company_ids: sim.user.company_ids,
    employee_id: sim.user.employee_id ? sim.user.employee_id[0] : false, employee_ids: sim.user.employee_ids ?? [], groupIds: [...sim.groupIds],
  }, sim.companies);
  const extra = await recordObject('res.users', [sim.user.id], userPaths(rules.map((r) => r.domain_force || '')), false);
  const groups = { groups_id: ctx.user.groups_id, group_ids: ctx.user.group_ids, all_group_ids: ctx.user.all_group_ids };
  const evalCtx = { ...ctx, user: { ...ctx.user, ...extra, ...groups } };
  const evals = rules.length ? await exec(pageEvalDomains, rules.map((r) => r.domain_force || '[]'), evalCtx as Json) : [];
  return new Map(rules.map((r, i) => {
    const missing = unavailableNames(r.domain_force || '', a.rules.evalNames);
    const ev: Evaluated = missing.length ? { error: `name '${missing[0]}' is not defined` }
      : Array.isArray(evals) ? evals[i] ?? { error: N_('no result') } : { error: isExecError(evals) ? evals.error : N_('no result') };
    return [r.id, ev];
  }));
}

/** A group in detail: its description, xmlid, the groups it implies directly, its ACLs, its rules, its users. */
export interface GroupDetail {
  comment: string;
  xmlid: string | false;
  implies: number[];
  acls: AclRow[] | null;
  rules: (IrRule & { model_id: Many2one })[] | null;
  users: { id: number; name: string; login: string; share: boolean }[];
}

export async function groupDetail(id: number, a: OdooAdapter): Promise<GroupDetail> {
  const [[g], meta, [acls, rules]] = await Promise.all([
    call<Record<string, unknown>[]>('res.groups', 'read', [[id], ['comment', 'implied_ids', a.groups.usersField]]),
    call<{ xmlid: string | false }[]>('res.groups', 'get_metadata', [[id]]).catch(() => []),
    groupAccess(id, a),
  ]);
  const userIds = ((g?.[a.groups.usersField] as number[] | undefined) ?? []).slice(0, 500);
  const users = userIds.length ? await call<GroupDetail['users']>('res.users', 'read', [userIds, ['name', 'login', 'share']]).catch(() => []) : [];
  return { comment: String(g?.comment || ''), xmlid: meta[0]?.xmlid ?? false, implies: (g?.implied_ids as number[] | undefined) ?? [], acls, rules,
    users: users.sort((x, y) => x.name.localeCompare(y.name)) };
}

/** A group's ACLs and rules (null: needs Access Rights). On 20 its permissions: each an ACL, a rule when it has a domain. */
async function groupAccess(id: number, a: OdooAdapter): Promise<[AclRow[] | null, GroupDetail['rules']]> {
  if (a.access === 'unified') {
    const rows = await unlessDenied(readIrAccess([['group_id', '=', id]]));
    return rows ? [rows.flatMap((r) => aclOf(r) ?? []), rows.filter((r) => restricts(r.domain)).map(ruleOf)] : [null, null];
  }
  return Promise.all([
    unlessDenied(call<AclRow[]>('ir.model.access', 'search_read', [[['group_id', '=', id]]], { fields: ['model_id', 'group_id', ...MODES.map((m) => `perm_${m}`)] })),
    unlessDenied(call<(IrRule & { model_id: Many2one })[]>('ir.rule', 'search_read', [[['groups', 'in', [id]]]],
      { fields: ['name', 'model_id', 'groups', 'global', 'domain_force', ...MODES.map((m) => `perm_${m}`)] })),
  ]);
}

type ModelAccess = IrAccess & { model_id: Many2one };
const readIrAccess = (domain: Json[]) => call<ModelAccess[]>('ir.access', 'search_read', [domain], { fields: IR_ACCESS_FIELDS });

/** How many users each group has (implied ones too). Not cached: groups are written in the tab. */
export async function usersPerGroup(a: OdooAdapter): Promise<Map<number, number>> {
  const rows = await call<Record<string, unknown>[]>('res.groups', 'search_read', [[]], { fields: [a.groups.usersField] }).catch(() => []);
  return new Map(rows.map((r) => [r.id as number, ((r[a.groups.usersField] as number[] | undefined) ?? []).length]));
}

/** The ACL rows of the user's groups and of `adds`, every model: what adding them opens elsewhere (20: their permissions). */
export const aclRows = async (groupIds: readonly number[], a: OdooAdapter): Promise<AclRow[]> => (a.access === 'unified'
  ? (await readIrAccess([['group_id', 'in', [...groupIds]]])).flatMap((r) => aclOf(r) ?? [])
  : call<AclRow[]>('ir.model.access', 'search_read', [['|', ['group_id', '=', false], ['group_id', 'in', [...groupIds]]]],
    { fields: ['model_id', 'group_id', ...MODES.map((m) => `perm_${m}`)] }));

/** Every ACL row, every model (Access Rights; 20: every permission). */
export const readAllAcls = (a: OdooAdapter): Promise<AclRow[] | null> => unlessDenied(a.access === 'unified'
  ? readIrAccess([['group_id', '!=', false]]).then((rows) => rows.flatMap((r) => aclOf(r) ?? []))
  : call<AclRow[]>('ir.model.access', 'search_read', [[]], { fields: ['name', 'model_id', 'group_id', ...MODES.map((m) => `perm_${m}`)] }));

/** Every record rule, every model: which models restrict a user's records (Access Rights; 20: the restrictions and the
 * permissions with a domain). */
export const readAllRules = (a: OdooAdapter): Promise<(IrRule & { model_id: Many2one })[] | null> => unlessDenied(a.access === 'unified'
  ? readIrAccess([]).then((rows) => rows.filter((r) => !r.group_id || restricts(r.domain)).map(ruleOf))
  : call<(IrRule & { model_id: Many2one })[]>('ir.rule', 'search_read', [[]],
    { fields: ['name', 'model_id', 'groups', 'global', 'domain_force', ...MODES.map((m) => `perm_${m}`)] }));

/** ir.model by id: technical name, description, the modules defining or extending it (Access Rights). */
export const readModels = (ids: readonly number[]) => ids.length
  ? unlessDenied(call<{ id: number; model: string; name: string; modules: string | false }[]>('ir.model', 'read', [[...ids], ['model', 'name', 'modules']]))
  : Promise.resolve([]);

/** The module creating each of the models `ids` (security.logic.ts → definingModules): their xmlids (Access Rights). */
export async function readDefiningModules(ids: readonly number[]): Promise<Map<number, string> | null> {
  if (!ids.length) return new Map();
  const rows = await unlessDenied(call<{ id: number; module: string; res_id: number }[]>('ir.model.data', 'search_read',
    [[['model', '=', 'ir.model'], ['res_id', 'in', [...ids]]]], { fields: ['module', 'res_id'], order: 'id' }));
  return rows && definingModules(rows);
}

/** The titles of modules (Accounting for account): Settings rights only, else null (the technical names show). */
export async function readModuleTitles(names: readonly string[]): Promise<Map<string, string> | null> {
  if (!names.length) return new Map();
  const rows = await unlessDenied(call<{ name: string; shortdesc: string }[]>('ir.module.module', 'search_read', [[['name', 'in', [...names]]]], { fields: ['name', 'shortdesc'] }));
  return rows && new Map(rows.map((r) => [r.name, r.shortdesc]));
}

/** Writes the groups field of `uid`: x2many commands. */
export const writeGroups = (uid: number, commands: Json[], a: OdooAdapter) => call('res.users', 'write', [[uid], { [a.users.writeGroupsField]: commands }]);

