// Pure Odoo helpers shared by several features, including the version differences (see README "Odoo versions").

export const MODES = ['read', 'write', 'create', 'unlink'];

/** res.users group field: renamed in Odoo 19 (groups_id → group_ids / all_group_ids). */
export function pickGroupField(fields) {
  return ['all_group_ids', 'groups_id', 'group_ids'].find((f) => f in fields) || null;
}

/** A UTC timestamp → HH:MM:SS on the browser's clock, '' if it isn't one. ISO (content/hook.js), or what the server
 * writes (it always runs in UTC): a datetime "YYYY-MM-DD HH:MM:SS", a profiling session "YYYY-MM-DD HH:MM:SS <user>". */
export function localTime(at) {
  const m = /^(\d{4}-\d\d-\d\d)[ T](\d\d:\d\d:\d\d)/.exec(at || '');
  if (!m) return '';
  const d = new Date(`${m[1]}T${m[2]}Z`);
  return [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, '0')).join(':');
}
