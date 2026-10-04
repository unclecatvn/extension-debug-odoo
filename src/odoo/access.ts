// Odoo 20's ir.access (base/models/ir_access.py) read as the ACLs and record rules of 18 / 19, so the Security tab decides
// the same way on every version (adapter.ts → access). Pure: tested by tests/unit/odoo/access.test.ts.
//   a permission (a group): an ACL of that group for the operations it names, and a group rule with its domain (none:
//                           every record). The user's permissions are OR-ed as group rules are; with the adapter's
//                           groupRulesRequired, having none refuses (Domain.OR([]) is FALSE).
//   a restriction (no group): a global rule. It grants nothing, so it is no ACL (an ACL without a group would mean
//                           "every user").
import { MODES, type IrModelAccess, type IrRule, type Many2one, type Mode } from './models.ts';

/** ir.access as the panel reads it. */
export interface IrAccess {
  id: number;
  name: string;
  model_id?: Many2one;
  group_id: Many2one;
  /** a subset of 'crud' (c create, r read, u update = write, d delete = unlink) */
  operation: string;
  domain: string | false;
}

export const IR_ACCESS_FIELDS = ['name', 'model_id', 'group_id', 'operation', 'domain'];

const LETTER: Record<Mode, string> = { read: 'r', write: 'u', create: 'c', unlink: 'd' };

/** The perm_* booleans of the operations an ir.access row names. */
export const accessPerms = (operation: string) =>
  Object.fromEntries(MODES.map((m) => [`perm_${m}`, operation.includes(LETTER[m])])) as Pick<IrModelAccess, `perm_${Mode}`>;

/** Whether a domain as written limits the records ('[]' or nothing: it doesn't). */
export const restricts = (domain: string | false) => !!domain && domain.replace(/\s/g, '') !== '[]';

/** A permission as an ACL; a restriction grants nothing: null. */
export function aclOf<R extends IrAccess>(r: R): (IrModelAccess & Pick<R, 'model_id'>) | null {
  if (!r.group_id) return null;
  return { id: r.id, name: r.name, group_id: r.group_id, model_id: r.model_id, ...accessPerms(r.operation) };
}

/** A row as a record rule: a permission as a group rule, a restriction as a global rule. */
export function ruleOf<R extends IrAccess>(r: R): IrRule & Pick<R, 'model_id'> {
  return { id: r.id, name: r.name, groups: r.group_id ? [r.group_id[0]] : [], global: !r.group_id, domain_force: r.domain || false,
    model_id: r.model_id, ...accessPerms(r.operation) };
}
