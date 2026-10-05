// Security tab: what the tab keeps between renders, per Odoo (the panel moves between instances): the user it is
// about, the groups being tried on them, the companies selected, the user compared with, the record or error being
// diagnosed, and the verdicts before an Apply (to show what it changed). Forgotten on ⟳ Reload Data.
import type { PageState } from '../../injected/page-state.ts';
import type { AccessProblem } from '../../odoo/access-error.ts';
import type { OdooAdapter } from '../../odoo/adapter.ts';
import type { Mode } from '../../odoo/models.ts';
import type { Assessment, ModelSecurity, Simulated } from './security.data.ts';
import type { AclRow, Tri } from './security.logic.ts';

/** What the tab checks: the page's record, or the one an AccessError named. */
export interface Subject {
  model: string;
  resId: number | null;
  /** every record the error named (the first is checked) */
  ids: number[];
  /** the operation refused, when known */
  mode: Mode | null;
  problem: AccessProblem | null;
}

/** The tab's views: the record, the user's rights by model, this model, the groups, the system. */
export const VIEWS = ['record', 'models', 'model', 'groups', 'system'] as const;
export type View = (typeof VIEWS)[number];

export interface SecurityState {
  /** the view shown; null: the default for the screen */
  view: View | null;
  /** Groups view: the group opened, and whether the list shows the users' groups only */
  group: number | null;
  allGroups: boolean;
  /** null: yourself */
  uid: number | null;
  tried: Set<number>;
  /** null: the default (see security.data.ts → simulate) */
  companies: number[] | null;
  compare: number | null;
  /** an error being diagnosed; null: the page's record */
  subject: Subject | null;
  archived: boolean;
  /** the verdicts with the real groups when trying started: what Apply is compared with */
  baseline: Tri[] | null;
  /** the verdicts before a write, to say what it changed after */
  before: { uid: number; model: string; resId: number | null; verdicts: Tri[] } | null;
}

const states = new Map<string, SecurityState>();

export function stateOf(origin: string): SecurityState {
  let s = states.get(origin);
  if (!s) states.set(origin, s = { view: null, group: null, allGroups: false, uid: null, tried: new Set(), companies: null, compare: null, subject: null, archived: false, baseline: null, before: null });
  return s;
}

export const forgetAll = () => states.clear();

/** What a render gives each part: the reads it started once, shared (the user simulated, the model's rights, the
 * verdicts), and how to re-render after a change. */
export interface SecurityCtx {
  page: PageState;
  a: OdooAdapter;
  s: SecurityState;
  /** the page's record, or the error's; null: the screen has no model */
  subject: Subject | null;
  sim: Promise<Simulated>;
  sec: Promise<ModelSecurity> | null;
  assessment: Promise<Assessment> | null;
  /** the user compared, and their assessment of the subject */
  other: Promise<Simulated> | null;
  otherAssessment: Promise<Assessment> | null;
  /** every ACL row of the database (null: needs Access Rights), read once per render */
  allAcls(): Promise<AclRow[] | null>;
  rerender(): void;
}

/** The verdicts on the subject as they are now (ACL / rule simulation, else the server's), null when unknown. */
async function verdictsNow(c: SecurityCtx): Promise<Tri[] | null> {
  const x = c.assessment ? await c.assessment.catch(() => null) : null;
  return x ? (x.verdicts.length ? x.verdicts.map((v) => v.ok) : x.server) : null;
}

/** Tries a group on the user: every part simulated with it. The verdicts with the real groups are kept first. */
export async function tryGroup(c: SecurityCtx, id: number) {
  if (!c.s.tried.size) c.s.baseline = await verdictsNow(c);
  c.s.tried.add(id);
  c.rerender();
}

export function stopTrying(c: SecurityCtx, id?: number) {
  if (id == null) c.s.tried.clear(); else c.s.tried.delete(id);
  if (!c.s.tried.size) c.s.baseline = null;
  c.rerender();
}

/** Runs a write of the user's groups, then re-renders: part ① says what it changed on the subject. */
export async function afterWrite(c: SecurityCtx, uid: number, write: () => Promise<unknown>) {
  const before = c.s.tried.size ? c.s.baseline : await verdictsNow(c);
  await write();
  if (c.subject && before) c.s.before = { uid, model: c.subject.model, resId: c.subject.resId, verdicts: before };
  c.s.tried.clear();
  c.s.baseline = null;
  c.rerender();
}
