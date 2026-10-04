// An AccessError as Odoo words it, read back: the model, records, operation, rules or groups it names. Two kinds, the
// same text in 18.0 and 19.0 (20.0, ir.access: the same but the operation 'delete' instead of 'unlink' and "Blame the
// following accesses:"; the bullets and "(model: id)" are read as they are):
//   acl   ir.model.access._make_access_error: "You are not allowed to modify 'Sales Order' (sale.order) records.\n\n
//         This operation is allowed for the following groups:\n\t- Sales / User: All Documents\n\nContact your…"
//   rule  ir.rule._make_access_error: "Uh-oh! …\n\nSorry, Marc Demo (id=7) doesn't have 'write' access to:\n
//         - Sales Order (sale.order)\n\nIf you really…". In debug mode the records instead of the model line
//         ("- Sales Order, S00042 (sale.order: 42)") and a paragraph "Blame the following rules:\n- Personal Orders".
// The sentences are in the user's language; what survives translation is read: "(model)", "(model: id)", "(id=7)" and
// the bullet lists. The operation only from the English wording; otherwise from the call (modeOfCall).
// Pure, but for the hand-over from the RPC tab to the Security tab at the end. Tested by
// tests/unit/odoo/access-error.test.ts.
import type { Mode } from './models.ts';

export interface AccessProblem {
  kind: 'acl' | 'rule' | null;
  model: string | null;
  ids: number[];
  mode: Mode | null;
  /** the user it happened to: a rule error names them, "Marc Demo (id=7)" */
  user: { name: string; id: number } | null;
  /** the rules blamed (rule error, debug mode) */
  rules: string[];
  /** the groups that would allow it, by their full names (acl error) */
  groups: string[];
}

const MODEL = /\(([a-z_][a-z0-9_]*(?:\.[a-z0-9_]+)+)\)/;
const RECORD = /\(([a-z_][a-z0-9_]*(?:\.[a-z0-9_]+)+): (\d+)(?:, [^)]*)?\)/g;
const USER = /(?:^|[,:]\s*)([^,:\n(]+?)\s*\(id=(\d+)\)/m;
const ACL_VERB: Record<string, Mode> = { access: 'read', modify: 'write', create: 'create', delete: 'unlink' };
const bullet = (line: string) => /^\s*-\s+(.+?)\s*$/.exec(line)?.[1] ?? null;

/** What an AccessError message says; null when it doesn't look like one (no model in it). */
export function parseAccessError(text: string): AccessProblem | null {
  const msg = text.replace(/\r\n?/g, '\n');
  const records = [...msg.matchAll(RECORD)];
  const model = records[0]?.[1] ?? MODEL.exec(msg)?.[1] ?? null;
  if (!model) return null;
  const user = USER.exec(msg);
  const kind = user || records.length ? 'rule' : /\n\s*-\s/.test(msg) || /You are not allowed to/.test(msg) ? 'acl' : null;
  const verb = /You are not allowed to (access|modify|create|delete) /.exec(msg)?.[1];
  const said = /doesn't have '(read|write|create|unlink|delete)' access/.exec(msg)?.[1];
  const op = (said === 'delete' ? 'unlink' : said) as Mode | undefined;

  const rules: string[] = [];
  const groups: string[] = [];
  const paragraphs = msg.split(/\n\s*\n/).map((p) => p.split('\n').filter((l) => l.trim()));
  if (kind === 'rule') {
    // after the first paragraph (what was refused, then the records): a header and only plain bullets = the rules
    for (const lines of paragraphs.slice(1)) {
      const [head, ...rest] = lines;
      if (head && !bullet(head) && rest.length && rest.every((l) => bullet(l) && !RECORD.test(l) && !MODEL.test(l))) rules.push(...rest.map((l) => bullet(l)!));
      RECORD.lastIndex = 0;
    }
  } else if (kind === 'acl') {
    for (const lines of paragraphs.slice(1)) for (const l of lines) { const b = bullet(l); if (b) groups.push(b); }
  }
  return {
    kind,
    model,
    ids: [...new Set(records.filter((r) => r[1] === model).map((r) => Number(r[2])))],
    mode: op ?? (verb ? ACL_VERB[verb]! : null),
    user: user ? { name: user[1]!.trim(), id: Number(user[2]) } : null,
    rules,
    groups,
  };
}

const READS = new Set(['read', 'search', 'search_read', 'search_count', 'search_fetch', 'web_read', 'web_search_read', 'read_group',
  'web_read_group', 'formatted_read_group', 'read_progress_bar', 'name_search', 'web_name_search', 'export_data', 'get_metadata']);
const WRITES = new Set(['write', 'action_archive', 'action_unarchive', 'toggle_active', 'web_resequence']);
const CREATES = new Set(['create', 'name_create', 'copy']);

/** The record ids a call works on: the first positional argument when it is a list of ids. */
export function idsOfCall(args: unknown): number[] {
  const first = Array.isArray(args) ? args[0] : undefined;
  return Array.isArray(first) && first.every((x) => Number.isInteger(x)) ? first as number[] : [];
}

/** The access a call of the webclient needs: web_save creates without ids, writes with them; null for a method of
 * its own (it may do anything). */
export function modeOfCall(method: string, args: unknown): Mode | null {
  if (method === 'web_save') return idsOfCall(args).length ? 'write' : 'create';
  if (method === 'unlink' || method === 'web_unlink') return 'unlink'; // web_unlink: 20's webclient delete
  return READS.has(method) ? 'read' : WRITES.has(method) ? 'write' : CREATES.has(method) ? 'create' : null;
}

// The RPC tab hands an AccessError it recorded to the Security tab ("Why?"), which takes it when it renders.
let pending: AccessProblem | null = null;
export const reportAccessProblem = (p: AccessProblem) => { pending = p; };
export const takeAccessProblem = (): AccessProblem | null => { const p = pending; pending = null; return p; };
