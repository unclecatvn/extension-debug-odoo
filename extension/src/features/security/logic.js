// Pure helpers, no chrome.* / DOM: tested by the *.test.mjs next to this file.
import { MODES } from '../../shared/odoo.js';
import { _t } from '../../shared/i18n.js';

const perms = (x) => MODES.filter((m) => x[`perm_${m}`]).join('/');

/** ACL rows granting `mode` to a user whose (implied-included) groups are `groupIds`. */
export function aclGrants(acls, groupIds, mode) {
  return acls.filter((a) => a[`perm_${mode}`] && (!a.group_id || groupIds.has(a.group_id[0])));
}

/** Rules ir.rule._get_rules would pick for this user and mode. */
export function rulesFor(rules, groupIds, mode) {
  return rules.filter((r) => r[`perm_${mode}`] && (r.global || r.groups.some((g) => groupIds.has(g))));
}

/**
 * Same combination as ir.rule._compute_domain: AND(global rules) AND OR(group rules).
 * passed: Map ruleId → true/false (missing = could not evaluate). Returns true/false/null (unknown).
 */
export function rulesVerdict(applicable, passed) {
  const known = (xs) => xs.every((x) => x === true || x === false);
  const glob = applicable.filter((r) => r.global).map((r) => passed.get(r.id));
  const grp = applicable.filter((r) => !r.global).map((r) => passed.get(r.id));
  if (glob.includes(false) || (grp.length && known(grp) && !grp.includes(true))) return false;
  if (!known(glob) || (grp.length && !grp.includes(true))) return null;
  return true;
}

/**
 * Can user `u` do `mode` (on record `resId`, if any)? → { ok: true/false/null (unknown), why }.
 * passed: Map ruleId → rule domain matches the record (see rulesVerdict).
 */
export function modeVerdict({ u, groupIds, acls, rules, mode, resId, passed }) {
  if (u.id === 1) return { ok: true, why: 'superuser' };
  const grants = aclGrants(acls, groupIds, mode);
  if (!grants.length) return { ok: false, why: _t('No ACL grants this to the user\'s groups.') };
  const names = grants.map((a) => a.name).join(', ');
  if (!resId) return { ok: true, why: _t('ACL: %s. No record to check the rules against.', names) };
  const applicable = rulesFor(rules, groupIds, mode);
  const ok = rulesVerdict(applicable, passed);
  return {
    ok,
    why: ok === false ? _t('Blocked by a record rule (see below).')
      : ok === null ? _t('A rule could not be evaluated, not certain.')
      : _t('ACL: %s · %s rules pass.', names, applicable.length),
  };
}

/**
 * Groups that would turn `mode` into allowed, fewest new groups first: every group an ACL or rule of the model names is
 * tried, with what it implies (closure(id) → Set of the group + its implied groups), through modeVerdict.
 * passed must cover every rule (not only the applicable ones). → [{ id, adds: new group ids }].
 * ponytail: one group at a time; a mode that needs two unrelated new groups is not found.
 */
export function unblockers({ u, groupIds, acls, rules, mode, resId, passed, closure }) {
  const cands = new Set([...acls.map((a) => a.group_id && a.group_id[0]), ...rules.flatMap((r) => r.groups)]);
  return [...cands].filter((g) => g && !groupIds.has(g)).map((id) => {
    const adds = [...closure(id)].filter((g) => !groupIds.has(g));
    const ok = modeVerdict({ u, groupIds: new Set([...groupIds, ...adds]), acls, rules, mode, resId, passed }).ok;
    return ok === true && { id, adds };
  }).filter(Boolean).sort((a, b) => a.adds.length - b.adds.length);
}

/**
 * Stand-in for ir.rule._eval_context of user `u` (a res.users read + commercial_partner_id).
 * ponytail: `user` only carries the attributes rules commonly use; anything else fails to evaluate
 * and is reported, not guessed. company_ids = all the user's companies (the most permissive switcher state).
 */
export function ruleEvalContext(u) {
  const m2o = (v) => ({ id: v ? v[0] : false });
  return {
    user: {
      id: u.id, login: u.login,
      commercial_partner_id: { id: u.commercial_partner_id }, // res.users _inherits res.partner
      partner_id: { id: u.partner_id[0], commercial_partner_id: { id: u.commercial_partner_id } },
      company_id: m2o(u.company_id), company_ids: { ids: u.company_ids },
      employee_id: m2o(u.employee_id), employee_ids: { ids: u.employee_ids || [] },
    },
    company_ids: u.company_ids,
    company_id: u.company_id ? u.company_id[0] : false,
  };
}

// ponytail: name heuristic, expect false positives (e.g. res.users.password is guarded in code, not by groups=)
const SENSITIVE = /pass(word)?|secret|token|api_?key|private_?key|iban|acc_number|salary|wage|ssn|passport|identification_id/i;

/** Risky security configuration on one model. groupXml: Map groupId → 'base.group_x'. */
export function auditModel({ fields, acls, rules, groupXml }) {
  const out = [];
  const add = (level, msg) => out.push({ level, msg });
  const writes = (a) => a.perm_write || a.perm_create || a.perm_unlink;
  if (!acls.length) add('info', _t('No ACL: only the superuser can access this model.'));
  for (const a of acls) {
    const g = a.group_id && groupXml.get(a.group_id[0]);
    if (!a.group_id) add(writes(a) ? 'high' : 'med', _t('ACL "%s" has no group → applies to EVERY user, portal/public included (%s).', a.name, perms(a)));
    else if (g === 'base.group_public' || g === 'base.group_portal') add(writes(a) ? 'high' : 'low', _t('ACL "%s" grants %s to %s.', a.name, perms(a), g));
  }
  const co = fields.company_id;
  if (co?.type === 'many2one' && co.relation === 'res.company' && !rules.some((r) => r.global && /company_id/.test(r.domain_force || '')))
    add('med', _t('Has company_id but no global multi-company rule → records may leak across companies.'));
  for (const [name, f] of Object.entries(fields))
    if (SENSITIVE.test(name) && !f.groups && f.type !== 'boolean') add('low', _t('Field "%s" looks sensitive but is not restricted to any group.', name));
  return out;
}

/** Web-facing checks from pageProbe() + session cookie flags (value never included). */
export function checkInstance(p, cookie) {
  const out = [];
  const add = (level, msg) => out.push({ level, msg });
  const local = /^(localhost|127\.0\.0\.1|\[::1\])$|\.(localhost|test)$/.test(p.host);
  const https = p.protocol === 'https:';
  if (!https) add(local ? 'info' : 'high', _t('Not served over HTTPS.'));
  if (!cookie) add('info', _t('Cannot read the session_id cookie.'));
  else {
    if (!cookie.httpOnly) add('high', _t('session_id cookie is not HttpOnly → readable by JS/XSS.'));
    if (https && !cookie.secure) add('high', _t('session_id cookie lacks the Secure flag.'));
    if (cookie.sameSite === 'no_restriction') add('med', _t('session_id cookie is SameSite=None → larger CSRF surface.'));
  }
  const h = p.headers || {};
  if (https && !h['strict-transport-security']) add('med', _t('Missing Strict-Transport-Security (HSTS) header.'));
  if (!h['x-frame-options'] && !/frame-ancestors/.test(h['content-security-policy'] || '')) add('med', _t('Missing X-Frame-Options / CSP frame-ancestors → clickjacking.'));
  if (!h['x-content-type-options']) add('low', _t('Missing X-Content-Type-Options: nosniff.'));
  if (!h['content-security-policy']) add('low', _t('Missing Content-Security-Policy.'));
  for (const k of ['server', 'x-powered-by']) if (/\d/.test(h[k] || '')) add('low', _t('Header %s discloses a version: %s', k, h[k]));
  const m = p.manager || {};
  if (m.insecure) add('high', _t('Database manager has NO master password (default "admin")!'));
  else if (m.reachable && !m.disabled) add('high', _t('/web/database/manager is reachable → block /web/database/* at the proxy or set list_db = False.'));
  if (Array.isArray(p.dbList)) add('med', _t('list_db is on: database names are exposed (%s).', p.dbList.length));
  if (p.version) add('info', _t('Server version is public via /web/webclient/version_info: %s', p.version));
  return out;
}

/** Risk flags for a user. has(name) → member of base.<name>. */
export function userRisks(u, has) {
  const out = [];
  const add = (level, msg) => out.push({ level, msg });
  if (u.id === 1) add('high', _t('__system__ (superuser): bypasses every ACL and record rule.'));
  if (has('group_system')) add('high', _t('Settings administrator (base.group_system).'));
  else if (has('group_erp_manager')) add('high', _t('Access Rights manager (base.group_erp_manager): can grant itself any group.'));
  if (has('group_no_one')) add('low', _t('Has Technical Features (base.group_no_one).'));
  if (u.share) add('info', has('group_public') ? _t('Public user.') : _t('Portal user (share).'));
  if (u.login === 'admin') add('med', _t('Login "admin" is the default, easy to guess.'));
  if (!('totp_enabled' in u)) add('info', _t('auth_totp is not installed → no 2FA.'));
  else if (!u.totp_enabled && !u.share) add(has('group_system') ? 'high' : 'med', _t('2FA (TOTP) is not enabled.'));
  if (u.api_key_ids?.length) add('med', _t('%s API key(s): direct RPC calls with this user\'s rights.', u.api_key_ids.length));
  if (u.active === false) add('info', _t('User is archived.'));
  return out;
}
