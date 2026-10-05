// Odoo's group restriction spec, as written in `groups="…"` on a field (Python) or on a view element (arch):
// comma-separated group xmlids, any of which grants access; a `!` in front means "must NOT be in it"
// (res.users.has_groups, same in 18.0 and 19.0). Pure: tested by tests/unit/odoo/groups.test.ts.
import { _t } from '../i18n/i18n.ts';

/** A `groups` spec → its parts. */
export function parseGroups(spec: string): { xmlid: string; not: boolean }[] {
  return spec.split(',').map((s) => s.trim()).filter(Boolean).map((s) => (s.startsWith('!') ? { xmlid: s.slice(1), not: true } : { xmlid: s, not: false }));
}

/** A restriction as a row shows it: "A, B · not C" (any of A, B; none of C), each group by
 * its name when known (`names`: xmlid → res.groups full_name), else by its xmlid. */
export function groupsLabel(spec: string, names: ReadonlyMap<string, string>): string {
  const parts = parseGroups(spec);
  const name = (x: string) => names.get(x) || x;
  const any = parts.filter((p) => !p.not).map((p) => name(p.xmlid));
  const none = parts.filter((p) => p.not).map((p) => _t('not %s', name(p.xmlid)));
  return [any.join(', '), ...none].filter(Boolean).join(' · ');
}
