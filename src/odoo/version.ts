// Which Odoo the panel is talking to, and how far it can be trusted. Pure: tested by version.test.ts.

/** The majors that have an adapter (adapters/v<major>.ts), oldest first. */
export const SUPPORTED = [18, 19, 20] as const;
export type SupportedMajor = (typeof SUPPORTED)[number];

export interface OdooVersion {
  major: number;
  minor: number;
  /** saas~18.2 and friends (Odoo Online): between two majors, closer to the lower one */
  saas: boolean;
  /** as the server says it, e.g. "18.0", "saas~18.2+e" */
  label: string;
}

/**
 * tested:      an adapter for that very major (18.0, 19.0, 20.0)
 * untested:    newer than every adapter, or a saas release: the closest older adapter is used, the header warns
 * unsupported: older than every adapter: the oldest one is used, every tab says what may fail
 */
export type Support = 'tested' | 'untested' | 'unsupported';

/** get_session_info's server_version_info ([18, 0, 0, 'final', 0, ''] or ['saas~18', 2, …]) → the version, or null. */
export function parseVersion(info: readonly (number | string)[] | undefined, label = ''): OdooVersion | null {
  const [head, minor] = info || [];
  const saas = typeof head === 'string' && head.startsWith('saas~');
  const major = typeof head === 'number' ? head : saas ? Number(head.slice(5)) : NaN;
  if (!Number.isInteger(major)) return null;
  const m = typeof minor === 'number' ? minor : 0;
  return { major, minor: m, saas, label: label || `${saas ? 'saas~' : ''}${major}.${m}` };
}

/** The adapter for a version: its own major, else the closest older one, else the oldest. */
export function pickMajor(v: OdooVersion): { major: SupportedMajor; support: Support } {
  const older = SUPPORTED.filter((m) => m <= v.major);
  const major = older.at(-1) ?? SUPPORTED[0];
  const support: Support = v.major < SUPPORTED[0] ? 'unsupported' : major === v.major && !v.saas ? 'tested' : 'untested';
  return { major, support };
}
