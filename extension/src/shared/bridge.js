// Talking to the inspected Odoo tab: page functions run in its MAIN world (with its session), RPC, reads cached until the
// next page load, and the few server reads several tabs share.
import { pageRpc } from './page.js';
import { MODES } from './odoo.js';
import { _t } from './i18n.js';

export let tabId = null;
export const setTab = (t) => { tabId = t?.id ?? null; };

/** Runs a self-contained page function in the tab's MAIN world, reusing the Odoo session. */
export async function exec(func, ...args) {
  if (tabId == null) return { error: _t('No tab is open.') };
  try {
    const [r] = await chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', func, args });
    return r?.result ?? null;
  } catch (e) {
    return { error: String(e.message || e) };
  }
}

/** exec() for page functions returning { error } with an N_-marked msgid: throws the translated message. */
export async function execOrThrow(func, fallback, ...args) {
  const r = await exec(func, ...args);
  if (!r || r.error) throw new Error(_t(r?.error || fallback));
  return r;
}

export async function rpc(route, params) {
  const r = await exec(pageRpc, route, params);
  if (!r) throw new Error(_t('No response — is this an Odoo page?'));
  if (r.error) throw Object.assign(new Error(r.error), { traceback: r.traceback });
  return r.result;
}
export const call = (model, method, args = [], kwargs = {}) =>
  rpc(`/web/dataset/call_kw/${model}/${method}`, { model, method, args, kwargs });

// ---------- cached reads: data that only changes on a page load, kept until then (or ⟳), shared by every tab ----------
const cache = new Map();
export function cached(key, fn) {
  if (!cache.has(key)) {
    const p = fn();
    p.catch(() => cache.get(key) === p && cache.delete(key)); // a failure is retried on the next render
    cache.set(key, p);
  }
  return cache.get(key);
}
export const uncache = (key) => cache.delete(key);
export const clearCache = () => cache.clear();

const FIELD_ATTRS = ['string', 'type', 'relation', 'store', 'depends', 'related', 'readonly', 'required', 'groups'];
export const sessionInfo = () => cached('session', () => rpc('/web/session/get_session_info', {}));
export const fieldsOf = (model) => cached(`fields ${model}`, () => call(model, 'fields_get', [], { attributes: FIELD_ATTRS }));
export const installedModules = () => cached('modules', () => call('ir.module.module', 'search_read', [[['state', '=', 'installed']]],
  { fields: ['name', 'shortdesc', 'author'], order: 'name' }));

// ACLs and rules are not cached: they are what people edit while debugging.
const PERMS = MODES.map((m) => `perm_${m}`);
const ofModel = (model) => [[['model_id.model', '=', model]]];
export const readAcls = (model) => call('ir.model.access', 'search_read', ofModel(model), { fields: ['name', 'group_id', ...PERMS] });
export const readRules = (model) => call('ir.rule', 'search_read', ofModel(model), { fields: ['name', 'groups', 'domain_force', 'global', ...PERMS] });

/** session_id cookie flags only: the token value never leaves this function. */
export async function cookieFlags(url) {
  try {
    const c = await chrome.cookies.get({ url, name: 'session_id' });
    return c && { httpOnly: c.httpOnly, secure: c.secure, sameSite: c.sameSite, session: c.session };
  } catch {
    return null;
  }
}
