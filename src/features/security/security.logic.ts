// Security tab, pure part: Odoo's access checks redone for a user the panel simulates (ACLs, record rules combined as
// ir.rule._compute_domain, _inherits parents included), the groups that would allow a refused operation and what else
// they open, the groups by application, two users compared, the audits. Same rules in 18.0, 19.0 and 20.0 (whose
// ir.access is read as ACLs and rules: odoo/access.ts); what differs comes from the adapter (implied groups, `time`,
// parents through a non-stored link, no group rule refusing in 20). Tested by
// tests/unit/features/security/security.logic.test.ts.
import { _t } from '../../i18n/i18n.ts';
import { parseGroups } from '../../odoo/groups.ts';
import { MODES, type FieldsGet, type IrModelAccess, type IrRule, type Many2one, type Mode } from '../../odoo/models.ts';

/** true / false / null: could not be told (a rule that failed to evaluate, a record the viewer can't read). */
export type Tri = boolean | null;

/** A record rule of the model, or of an _inherits parent (`via`: the parent and the link field to it). */
export interface Rule extends IrRule { via?: { model: string; link: string } }

const allows = (x: IrModelAccess | IrRule, mode: Mode) => x[`perm_${mode}`];

/** The ACLs granting `mode` to a user whose groups (implied included) are `groupIds`. */
export const aclGrants = (acls: readonly IrModelAccess[], groupIds: ReadonlySet<number>, mode: Mode) =>
  acls.filter((a) => allows(a, mode) && (!a.group_id || groupIds.has(a.group_id[0])));

/** The rules ir.rule._get_rules picks for this user and mode: global ones, and those of the user's groups. */
export const rulesFor = (rules: readonly Rule[], groupIds: ReadonlySet<number>, mode: Mode) =>
  rules.filter((r) => allows(r, mode) && (r.global || r.groups.some((g) => groupIds.has(g))));

/** AND of the global parts, OR of the group rules (none = no restriction from them; `required`: none refuses). */
function combine(globals: Tri[], groups: Tri[], required = false): Tri {
  const anyGroup: Tri = groups.includes(true) || (!groups.length && !required) ? true : groups.every((g) => g === false) ? false : null;
  if (globals.includes(false) || anyGroup === false) return false;
  return globals.includes(null) || anyGroup === null ? null : true;
}

const byParent = (rules: readonly Rule[]) => {
  const m = new Map<string, Rule[]>();
  for (const r of rules) if (r.via) m.set(r.via.model, [...(m.get(r.via.model) ?? []), r]);
  return m;
};

/**
 * Whether the record passes the applicable rules, as ir.rule._compute_domain combines them: every global rule AND
 * any group rule; each _inherits parent's own combination counts as one more global rule.
 * `passed`: rule id → the record matches its domain (missing: could not be told).
 * `required` (20, the adapter's groupRulesRequired): no group rule refuses — a parent the user has no permission on.
 */
export function rulesVerdict(applicable: readonly Rule[], passed: ReadonlyMap<number, boolean>, required = false): Tri {
  const own = applicable.filter((r) => !r.via);
  const parents = [...byParent(applicable).values()].map((rs) => rulesVerdict(rs.map(({ via: _, ...r }) => r), passed, required));
  return combine([...own.filter((r) => r.global).map((r) => passed.get(r.id) ?? null), ...parents],
    own.filter((r) => !r.global).map((r) => passed.get(r.id) ?? null), required);
}

/** The applicable rules that refuse the record: failing global rules; every group rule when none passes; the failing
 * rules of a parent that refuses it. */
export function failingRules(applicable: readonly Rule[], passed: ReadonlyMap<number, boolean>, required = false): Rule[] {
  const own = applicable.filter((r) => !r.via);
  const groups = own.filter((r) => !r.global);
  const out = own.filter((r) => r.global && passed.get(r.id) === false);
  if (groups.length && groups.every((r) => passed.get(r.id) === false)) out.push(...groups);
  for (const rs of byParent(applicable).values()) {
    const plain = rs.map(({ via: _, ...r }) => r);
    if (rulesVerdict(plain, passed, required) !== false) continue;
    const ids = new Set(failingRules(plain, passed, required).map((r) => r.id));
    out.push(...rs.filter((r) => ids.has(r.id)));
  }
  return out;
}

export interface VerdictInput {
  /** __system__ (id 1): no ACL, no rule */
  superuser: boolean;
  groupIds: ReadonlySet<number>;
  acls: readonly IrModelAccess[];
  rules: readonly Rule[];
  /** the record checked against the rules; null: the model only (the ACLs) */
  resId: number | null;
  passed: ReadonlyMap<number, boolean>;
  /** no group rule of the user's refuses (adapter: rules.groupRulesRequired) */
  groupRulesRequired?: boolean;
  /** the _inherits parents whose rules count (default: those `rules` name): with groupRulesRequired, one where the user
   * has no group rule refuses the whole model (20: a parent's FALSE access domain) */
  parents?: readonly string[];
}

export interface ModeVerdict {
  mode: Mode;
  ok: Tri;
  why: 'superuser' | 'no-acl' | 'parent' | 'model-only' | 'rules';
  grants: IrModelAccess[];
  applicable: Rule[];
  failing: Rule[];
}

/** Can the user do `mode`? The ACLs first (one granting it is enough), then the record against the rules. */
export function modeVerdict(input: VerdictInput, mode: Mode): ModeVerdict {
  const base = { mode, grants: [] as IrModelAccess[], applicable: [] as Rule[], failing: [] as Rule[] };
  if (input.superuser) return { ...base, ok: true, why: 'superuser' };
  const grants = aclGrants(input.acls, input.groupIds, mode);
  if (!grants.length) return { ...base, ok: false, why: 'no-acl' };
  const applicable = rulesFor(input.rules, input.groupIds, mode);
  const required = !!input.groupRulesRequired;
  if (required) {
    const parents = input.parents ?? [...new Set(input.rules.flatMap((r) => (r.via ? [r.via.model] : [])))];
    const granted = new Set(applicable.flatMap((r) => (r.via && !r.global ? [r.via.model] : [])));
    if (parents.some((m) => !granted.has(m))) return { ...base, grants, ok: false, why: 'parent' };
  }
  if (input.resId == null) return { ...base, grants, ok: true, why: 'model-only' };
  return { mode, grants, applicable, ok: rulesVerdict(applicable, input.passed, required), failing: failingRules(applicable, input.passed, required), why: 'rules' };
}

export const verdicts = (input: VerdictInput) => MODES.map((m) => modeVerdict(input, m));

/** The group rules' part alone: any of them matches (none: no restriction from them). */
export const groupRulesVerdict = (groupRules: readonly Rule[], passed: ReadonlyMap<number, boolean>): Tri =>
  combine([], groupRules.map((r) => passed.get(r.id) ?? null));

/** The ways to allow every refused operation, merged: each group once, with all the operations it allows. Fewest new
 * groups first, then the most operations. */
export function fixes(input: VerdictInput, closure: (id: number) => ReadonlySet<number>): { id: number; adds: number[]; allows: Mode[] }[] {
  const out = new Map<number, { id: number; adds: number[]; allows: Mode[] }>();
  for (const v of verdicts(input)) {
    if (v.ok !== false) continue;
    for (const u of unblockers(input, v.mode, closure)) {
      const f = out.get(u.id) ?? { id: u.id, adds: u.adds, allows: [] };
      f.allows = MODES.filter((m) => f.allows.includes(m) || m === v.mode || u.also.includes(m));
      out.set(u.id, f);
    }
  }
  return [...out.values()].sort((a, b) => a.adds.length - b.adds.length || b.allows.length - a.allows.length);
}

/** A model's rights for a user from the ACLs alone: the operations granted and the ACLs granting them. */
export interface ModelRights { model: [number, string]; modes: Set<Mode>; acls: AclRow[] }

/** Every model an ACL of `groupIds` (or of every user) grants something on. */
export function modelRights(rows: readonly AclRow[], groupIds: ReadonlySet<number>): Map<number, ModelRights> {
  const out = new Map<number, ModelRights>();
  for (const r of rows) {
    if (!r.model_id || (r.group_id && !groupIds.has(r.group_id[0]))) continue;
    const modes = MODES.filter((m) => r[`perm_${m}`]);
    if (!modes.length) continue;
    const m = out.get(r.model_id[0]) ?? { model: r.model_id, modes: new Set<Mode>(), acls: [] };
    for (const x of modes) m.modes.add(x);
    m.acls.push(r);
    out.set(r.model_id[0], m);
  }
  return out;
}

/** The first of ir.model.modules ("sale, sale_stock" → "sale"). Odoo sorts that list by name (ir_model.py →
 * _in_modules), so it is not the module creating the model: definingModules() is; this is only its fallback. */
export const firstModule = (modules: string | false | null | undefined) => (modules || '').split(',')[0]?.trim() || '';

/** The module creating each model, from the xmlids of the models (ir.model.data, model 'ir.model'), oldest first:
 * modules load in the order of their dependencies, so the module defining a model registers it before any module
 * extending it. → res_id (ir.model id) → module. */
export function definingModules(rows: readonly { id: number; module: string; res_id: number }[]): Map<number, string> {
  const out = new Map<number, string>();
  for (const r of [...rows].sort((a, b) => a.id - b.id)) if (!out.has(r.res_id)) out.set(r.res_id, r.module);
  return out;
}

/** How much a user may do on a model, in words: every operation, read only, some, or none. */
export type AccessLevel = 'full' | 'read' | 'partial' | 'none';
export function accessLevel(modes: ReadonlySet<Mode> | undefined): AccessLevel {
  if (!modes?.size) return 'none';
  if (MODES.every((m) => modes.has(m))) return 'full';
  if (modes.size === 1 && modes.has('read')) return 'read';
  return 'partial';
}

/** A module's models summed up: how many with full access, read only, some operations, and limited by rules. */
export function accessSummary(rows: readonly { level: AccessLevel; rules: number }[]) {
  return {
    full: rows.filter((r) => r.level === 'full').length,
    read: rows.filter((r) => r.level === 'read').length,
    partial: rows.filter((r) => r.level === 'partial').length,
    ruled: rows.filter((r) => r.rules > 0).length,
  };
}

/** A group that would allow a refused operation: the groups it adds (itself and what it implies, not held yet) and
 * the other operations it allows on the way. */
export interface Unblocker { id: number; adds: number[]; also: Mode[] }

/**
 * The groups that turn `mode` into allowed, fewest new groups first. Tried: every group an ACL or a rule of the model
 * (or of a parent) names, with what it implies (`closure`: the group and every group it implies). Every rule must be in
 * `passed`, not only the applicable ones. One group at a time: an operation needing two unrelated groups is not found.
 */
export function unblockers(input: VerdictInput, mode: Mode, closure: (id: number) => ReadonlySet<number>): Unblocker[] {
  const before = verdicts(input);
  const candidates = new Set([...input.acls.flatMap((a) => (a.group_id ? [a.group_id[0]] : [])), ...input.rules.flatMap((r) => r.groups)]);
  const found: Unblocker[] = [];
  for (const id of candidates) {
    if (input.groupIds.has(id)) continue;
    const adds = [...closure(id)].filter((g) => !input.groupIds.has(g));
    const after = verdicts({ ...input, groupIds: new Set([...input.groupIds, ...adds]) });
    if (after.find((v) => v.mode === mode)?.ok !== true) continue;
    const also = MODES.filter((m) => m !== mode && before.find((v) => v.mode === m)?.ok !== true && after.find((v) => v.mode === m)?.ok === true);
    found.push({ id, adds, also });
  }
  return found.sort((a, b) => a.adds.length - b.adds.length || a.also.length - b.also.length);
}

/** An ir.model.access row as read across models (what a group opens). */
export interface AclRow {
  /** the ACL's own name (access_sale_order_user…) */
  name?: string;
  model_id: Many2one;
  group_id: Many2one;
  perm_read: boolean;
  perm_write: boolean;
  perm_create: boolean;
  perm_unlink: boolean;
}

/** What adding `adds` grants on other models, beyond what `groupIds` already have: [model name, new operations]. */
export function newGrants(rows: readonly AclRow[], groupIds: ReadonlySet<number>, adds: readonly number[]): { model: string; modes: Mode[] }[] {
  const key = (r: AclRow, m: Mode) => `${r.model_id ? r.model_id[0] : 0}:${m}`;
  const had = new Set(rows.filter((r) => !r.group_id || groupIds.has(r.group_id[0])).flatMap((r) => MODES.filter((m) => r[`perm_${m}`]).map((m) => key(r, m))));
  const added = new Set(adds);
  const gained = new Map<string, Set<Mode>>();
  for (const r of rows) {
    if (!r.group_id || !added.has(r.group_id[0]) || !r.model_id) continue;
    for (const m of MODES) if (r[`perm_${m}`] && !had.has(key(r, m))) gained.set(r.model_id[1], (gained.get(r.model_id[1]) ?? new Set()).add(m));
  }
  return [...gained].map(([model, modes]) => ({ model, modes: MODES.filter((m) => modes.has(m)) })).sort((a, b) => a.model.localeCompare(b.model));
}

/** The user as a rule's domain sees it (the attributes rules commonly read; any other fails to evaluate and is said). */
export interface EvalUser {
  id: number;
  login: string;
  partner_id: number;
  commercial_partner_id: number;
  company_id: number | false;
  company_ids: number[];
  employee_id: number | false;
  employee_ids: number[];
  groupIds: number[];
}

/** ir.rule._eval_context for `u` with `companies` selected in the switcher (the first one is the current company). */
export function ruleEvalContext(u: EvalUser, companies: readonly number[]) {
  const ids = (xs: readonly number[]) => ({ ids: [...xs] });
  return {
    user: {
      id: u.id, login: u.login,
      partner_id: { id: u.partner_id, commercial_partner_id: { id: u.commercial_partner_id } },
      commercial_partner_id: { id: u.commercial_partner_id }, // res.users _inherits res.partner
      company_id: { id: u.company_id }, company_ids: ids(u.company_ids),
      employee_id: { id: u.employee_id }, employee_ids: ids(u.employee_ids),
      groups_id: ids(u.groupIds), group_ids: ids(u.groupIds), all_group_ids: ids(u.groupIds),
    },
    company_ids: [...companies],
    company_id: companies[0] ?? u.company_id,
  };
}

/** Whether an evaluated domain has 20's ('field', 'access', operation) condition, which the server resolves with the
 * rights of whoever searches. */
export const usesAccessOperator = (domain: readonly unknown[]): boolean =>
  domain.some((t) => Array.isArray(t) && t.length === 3 && t[1] === 'access');

/** Names a domain uses that the server's evaluation context lacks (the webclient's py_js has `time` anyway). */
export function unavailableNames(domain: string, evalNames: readonly string[]): string[] {
  const code = domain.replace(/(['"]).*?\1/g, '');
  return ['time'].filter((n) => !evalNames.includes(n) && new RegExp(`\\b${n}\\s*\\.`).test(code));
}

/** The held groups that no other held group implies: the ones set on the user. `implied(id)`: what it implies. */
export function directGroups(held: ReadonlySet<number>, implied: (id: number) => ReadonlySet<number>): Set<number> {
  const covered = new Set<number>();
  for (const h of held) for (const g of implied(h)) if (g !== h) covered.add(g);
  return new Set([...held].filter((g) => !covered.has(g)));
}

/** For each held group implied by others: which ones. */
export function impliedBy(held: ReadonlySet<number>, implied: (id: number) => ReadonlySet<number>): Map<number, number[]> {
  const out = new Map<number, number[]>();
  for (const h of held) for (const g of implied(h)) if (g !== h && held.has(g)) out.set(g, [...(out.get(g) ?? []), h]);
  return out;
}

/** res.users.has_groups on a `groups="…"` spec: none of the `!` groups, and any of the others (if there are). */
export function groupsSpecAllows(spec: string, has: (xmlid: string) => boolean): boolean {
  const parts = parseGroups(spec);
  if (parts.some((p) => p.not && has(p.xmlid))) return false;
  const positives = parts.filter((p) => !p.not);
  return !positives.length || positives.some((p) => has(p.xmlid));
}

export interface AppGroup { id: number; full_name: string; app: string }

/** Groups under their application (the prefix of their full_name), applications by name, "no application" last. */
export function byApp<G extends AppGroup>(groups: readonly G[]): { app: string; groups: G[] }[] {
  const m = new Map<string, G[]>();
  for (const g of groups) m.set(g.app, [...(m.get(g.app) ?? []), g]);
  return [...m].map(([app, gs]) => ({ app, groups: gs.sort((a, b) => a.full_name.localeCompare(b.full_name)) }))
    .sort((a, b) => (!a.app ? 1 : !b.app ? -1 : a.app.localeCompare(b.app)));
}

/** "Sales / User: All Documents" under "Sales": "User: All Documents". */
export const shortGroupName = (g: AppGroup) => (g.app && g.full_name.startsWith(`${g.app} / `) ? g.full_name.slice(g.app.length + 3) : g.full_name);

/** Two users' groups (implied included): what only one has. */
export function compareGroups(a: ReadonlySet<number>, b: ReadonlySet<number>) {
  return { onlyA: [...a].filter((g) => !b.has(g)), onlyB: [...b].filter((g) => !a.has(g)), both: [...a].filter((g) => b.has(g)).length };
}

/**
 * The write giving user A the groups of user B (`writeGroups`: the groups field written, as read on each).
 *   add   A keeps its groups and gets B's it lacks: [4, id] each
 *   same  A gets exactly B's: [6, 0, ids]
 * `adds` / `removes`: what changes, to show before writing (implied groups follow on their own).
 */
export function copyGroups(aWrite: readonly number[], bWrite: readonly number[], how: 'add' | 'same') {
  const a = new Set(aWrite), b = new Set(bWrite);
  const adds = [...b].filter((g) => !a.has(g));
  const removes = how === 'same' ? [...a].filter((g) => !b.has(g)) : [];
  const commands = how === 'same' ? [[6, 0, [...b]]] : adds.map((g) => [4, g]);
  return { adds, removes, commands };
}

export type Level = 'high' | 'med' | 'low' | 'info';
export interface Finding { level: Level; msg: string }

const perms = (x: IrModelAccess) => MODES.filter((m) => x[`perm_${m}`]).join('/');
// a key-name heuristic: false positives are expected (res.users.password is guarded in code, not by groups=)
const SENSITIVE = /pass(word)?|secret|token|api_?key|private_?key|iban|acc_number|salary|wage|ssn|passport|identification_id/i;

/** Risky security configuration on one model. `groupXml`: group id → its base xmlid, for the key groups. */
export function auditModel(fields: FieldsGet, acls: readonly IrModelAccess[], rules: readonly IrRule[], groupXml: ReadonlyMap<number, string>): Finding[] {
  const out: Finding[] = [];
  const add = (level: Level, msg: string) => out.push({ level, msg });
  const writes = (a: IrModelAccess) => a.perm_write || a.perm_create || a.perm_unlink;
  if (!acls.length) add('info', _t('No ACL: only the superuser can access this model.'));
  for (const a of acls) {
    const g = a.group_id ? groupXml.get(a.group_id[0]) : undefined;
    if (!a.group_id) add(writes(a) ? 'high' : 'med', _t('ACL "%s" has no group → applies to EVERY user, portal/public included (%s).', a.name, perms(a)));
    else if (g === 'base.group_public' || g === 'base.group_portal' || g === 'base.group_everyone') // everyone: 20, every user, portal/public included
      add(writes(a) ? 'high' : g === 'base.group_everyone' ? 'med' : 'low', _t('ACL "%s" grants %s to %s.', a.name, perms(a), g));
  }
  const co = fields.company_id;
  if (co?.type === 'many2one' && co.relation === 'res.company' && !rules.some((r) => r.global && /company_id/.test(r.domain_force || '')))
    add('med', _t('Has company_id but no global multi-company rule → records may leak across companies.'));
  for (const [name, f] of Object.entries(fields))
    if (SENSITIVE.test(name) && !f.groups && f.type !== 'boolean') add('low', _t('Field "%s" looks sensitive but has no groups=.', name));
  return out;
}

/** What /web/database/manager answers, read from its markup (classes and attributes: the same in any language). */
export interface ManagerState { status: number; reachable: boolean; disabled: boolean; insecure: boolean }
export function managerState(status: number, html: string): ManagerState {
  const reachable = status === 200 && html.includes('o_database_list'); // not a proxy block or a redirect to the login
  return {
    status,
    reachable,
    disabled: reachable && /class="alert alert-danger text-center"/.test(html), // not list_db
    insecure: reachable && /alert-warning[\s\S]{0,600}?data-bs-target="\.o_database_master"/.test(html), // the default master password
  };
}

/** What the instance check reads in the page (security.injected.ts → pageProbe). */
export interface Probe {
  host: string;
  protocol: string;
  headers: Record<string, string | null>;
  manager: ManagerState | null;
  dbList: string[] | null;
  version: string | null;
}
export interface CookieFlags { httpOnly: boolean; secure: boolean; sameSite: string; session: boolean }

/** Web-facing checks: the probe and the session cookie's flags (never its value). */
export function checkInstance(p: Probe, cookie: CookieFlags | null): Finding[] {
  const out: Finding[] = [];
  const add = (level: Level, msg: string) => out.push({ level, msg });
  const local = /^(localhost|127\.0\.0\.1|\[::1\])$|\.(localhost|test)$/.test(p.host);
  const https = p.protocol === 'https:';
  if (!https) add(local ? 'info' : 'high', _t('Not served over HTTPS.'));
  if (!cookie) add('info', _t('Cannot read the session_id cookie.'));
  else {
    if (!cookie.httpOnly) add('high', _t('session_id cookie is not HttpOnly → readable by JS/XSS.'));
    if (https && !cookie.secure) add('high', _t('session_id cookie lacks the Secure flag.'));
    if (cookie.sameSite === 'no_restriction') add('med', _t('session_id cookie is SameSite=None → larger CSRF surface.'));
  }
  const h = p.headers;
  if (https && !h['strict-transport-security']) add('med', _t('Missing Strict-Transport-Security (HSTS) header.'));
  if (!h['x-frame-options'] && !/frame-ancestors/.test(h['content-security-policy'] || '')) add('med', _t('Missing X-Frame-Options / CSP frame-ancestors → clickjacking.'));
  if (!h['x-content-type-options']) add('low', _t('Missing X-Content-Type-Options: nosniff.'));
  if (!h['content-security-policy']) add('low', _t('Missing Content-Security-Policy.'));
  for (const k of ['server', 'x-powered-by']) if (/\d/.test(h[k] || '')) add('low', _t('Header %s discloses a version: %s', k, h[k]));
  const m = p.manager;
  if (m?.insecure) add('high', _t('Database manager has NO master password (default "admin")!'));
  else if (m?.reachable && !m.disabled) add('high', _t('/web/database/manager is reachable → block /web/database/* at the proxy or set list_db = False.'));
  if (p.dbList) add('med', _t('list_db is on: database names are exposed (%s).', p.dbList.length));
  if (p.version) add('info', _t('Server version is public via /web/webclient/version_info: %s', p.version));
  return out;
}

export interface RiskUser { id: number; login: string; share: boolean; active: boolean; totp_enabled?: boolean; api_key_ids?: number[] }

/** Risk flags for a user. `has(xmlid)`: member of that group (simulated groups included). */
export function userRisks(u: RiskUser, has: (xmlid: string) => boolean): Finding[] {
  const out: Finding[] = [];
  const add = (level: Level, msg: string) => out.push({ level, msg });
  if (u.id === 1) add('high', _t('__system__ (superuser): bypasses every ACL and record rule.'));
  if (has('base.group_system')) add('high', _t('Settings administrator (base.group_system).'));
  else if (has('base.group_erp_manager')) add('high', _t('Access Rights manager (base.group_erp_manager): can grant itself any group.'));
  if (has('base.group_no_one')) add('low', _t('Has Technical Features (base.group_no_one).'));
  if (u.share) add('info', has('base.group_public') ? _t('Public user.') : _t('Portal user (share).'));
  if (u.login === 'admin') add('med', _t('Login "admin" is the default, easy to guess.'));
  if (u.totp_enabled === undefined) add('info', _t('auth_totp is not installed → no 2FA.'));
  else if (!u.totp_enabled && !u.share) add(has('base.group_system') ? 'high' : 'med', _t('2FA (TOTP) is not enabled.'));
  if (u.api_key_ids?.length) add('med', _t('%s API key(s): direct RPC calls with this user\'s rights.', u.api_key_ids.length));
  if (!u.active) add('info', _t('User is archived.'));
  return out;
}

/** A company as get_session_info's user_companies lists it (18 and 19; 19 adds currency_id). */
export interface SessionCompany { id: number; name: string; sequence: number; child_ids: number[]; parent_id: number | false }
export interface UserCompanies {
  current_company: number;
  allowed_companies: Record<string, SessionCompany>;
  disallowed_ancestor_companies?: Record<string, SessionCompany>;
}

/** The companies as a tree, parents before their children (by sequence, then name): each with its depth and whether the
 * user may use it (an ancestor of an allowed one may not be allowed itself). */
export function companyTree(uc: UserCompanies): { company: SessionCompany; depth: number; allowed: boolean }[] {
  const all = new Map<number, { company: SessionCompany; allowed: boolean }>();
  for (const c of Object.values(uc.disallowed_ancestor_companies ?? {})) all.set(c.id, { company: c, allowed: false });
  for (const c of Object.values(uc.allowed_companies)) all.set(c.id, { company: c, allowed: true });
  const order = (a: SessionCompany, b: SessionCompany) => a.sequence - b.sequence || a.name.localeCompare(b.name);
  const out: { company: SessionCompany; depth: number; allowed: boolean }[] = [];
  const seen = new Set<number>();
  const visit = (id: number, depth: number) => {
    const x = all.get(id);
    if (!x || seen.has(id)) return;
    seen.add(id);
    out.push({ ...x, depth });
    for (const child of x.company.child_ids.map((c) => all.get(c)?.company).filter((c): c is SessionCompany => !!c).sort(order)) visit(child.id, depth + 1);
  };
  for (const root of [...all.values()].map((x) => x.company).filter((c) => !c.parent_id || !all.has(c.parent_id)).sort(order)) visit(root.id, 0);
  return out;
}

/** The attribute paths of `user` the domains read ("user.employee_id.department_id.id" → ['employee_id',
 * 'department_id', 'id']), strings left out, each once. */
export function userPaths(domains: readonly string[]): string[][] {
  const seen = new Map<string, string[]>();
  for (const d of domains) {
    const code = d.replace(/(['"]).*?\1/g, '');
    for (const m of code.matchAll(/(?<![\w.])user((?:\.[A-Za-z_]\w*)+)/g)) {
      const path = m[1]!.slice(1).split('.');
      seen.set(path.join('.'), path);
    }
  }
  return [...seen.values()];
}

/** The last line of an evaluation error: py_js repeats the whole expression before it. */
export const shortError = (message: string) => message.trim().split('\n').filter((l) => l.trim()).pop()?.replace(/^Error:\s*/, '') ?? message;
