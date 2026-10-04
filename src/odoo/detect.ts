// The Odoo of the inspected tab: detected once per page load (extension/page-cache.ts), with the adapter features ask.
//   1. version: get_session_info's server_version_info
//   2. adapter: that major's, else the closest older one (version.ts → pickMajor)
//   3. self-check: the fields the adapter relies on, verified with fields_get on the live database. A customized or
//      saas database that differs from its major shows in the header instead of failing inside a feature.
import { cached } from '../extension/page-cache.ts';
import { _t } from '../i18n/i18n.ts';
import type { ExpectedField, OdooAdapter } from './adapter.ts';
import { v18 } from './adapters/v18.ts';
import { v19 } from './adapters/v19.ts';
import { v20 } from './adapters/v20.ts';
import { sessionInfo } from './reads.ts';
import { call } from './rpc.ts';
import { parseVersion, pickMajor, type OdooVersion, type Support, type SupportedMajor } from './version.ts';

/** One adapter per supported major: a missing one fails type-checking (version.ts → SUPPORTED). */
export const ADAPTERS: Readonly<Record<SupportedMajor, OdooAdapter>> = { 18: v18, 19: v19, 20: v20 };

export interface OdooContext {
  version: OdooVersion;
  support: Support;
  adapter: OdooAdapter;
  /** expected fields the database doesn't have (or doesn't show this user) */
  mismatches: ExpectedField[];
}

/** The Odoo of the inspected tab, detected once per page load. Rejects when not logged in (no session info). */
export const odoo = (): Promise<OdooContext> => cached('odoo', detect);

async function detect(): Promise<OdooContext> {
  const info = await sessionInfo();
  const version = parseVersion(info.server_version_info, info.server_version);
  if (!version) throw new Error(_t('Cannot read the Odoo version (%s).', info.server_version));
  const { major, support } = pickMajor(version);
  const adapter = ADAPTERS[major];
  return { version, support, adapter, mismatches: await selfCheck(adapter) };
}

/** The adapter's expected fields the database lacks. fields_get has no model ACL (it only hides fields the user can't
 * access), so this works for every internal user; a model that can't be read at all counts as missing. */
async function selfCheck(adapter: OdooAdapter): Promise<ExpectedField[]> {
  const models = [...new Set(adapter.expects.map((e) => e.model))];
  const found = Object.fromEntries(await Promise.all(models.map(async (model) => {
    const wanted = adapter.expects.filter((e) => e.model === model).map((e) => e.field);
    const fields = await call<Record<string, unknown>>(model, 'fields_get', [], { allfields: wanted, attributes: ['type'] }).catch(() => ({}));
    return [model, Object.keys(fields)] as const;
  })));
  return missingFields(adapter.expects, found);
}

/** Pure part of the self-check: expected fields absent from `found` (model → field names). */
export function missingFields(expects: readonly ExpectedField[], found: Readonly<Record<string, readonly string[]>>): ExpectedField[] {
  return expects.filter((e) => !found[e.model]?.includes(e.field));
}
