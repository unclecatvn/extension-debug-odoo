// Code tab: the guide below the editor.
import { el, pre, copyable } from '../../shared/ui.js';
import { _t } from '../../shared/i18n.js';

// The guide below the editor, in the manner of Odoo's server action ("Available variables: - env: …").
const EXAMPLE = [
  "orders = await env['sale.order'].search([['state', '=', 'sale']], { limit: 5 })",
  'for (const order of orders) print(order.name, order.partner_id.name)',
  "return orders.read(['name', 'partner_id', 'amount_total'])",
].join('\n');

/** A 24×24 stroke icon (Lucide-style) from path/shape specs: [tag, attrs]. */
function icon(cls, shapes) {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  for (const [k, v] of Object.entries({ class: cls, viewBox: '0 0 24 24', width: 14, height: 14, fill: 'none', stroke: 'currentColor',
    'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) svg.setAttribute(k, v);
  for (const [tag, attrs] of shapes) {
    const n = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    svg.append(n);
  }
  return svg;
}

/** Icon-only copy button with a tooltip ("Copy code", then "Copied" with a check for a second), like a code block's. */
function copyButton(text) {
  const b = copyable(text, 'copy-btn', el('span', { class: 'copy-icons' },
    icon('i-copy', [['rect', { x: 9, y: 9, width: 13, height: 13, rx: 2 }], ['path', { d: 'M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1' }]]),
    icon('i-check', [['path', { d: 'M20 6 9 17l-5-5' }]])));
  b.removeAttribute('title'); // the tooltip below replaces the browser's
  b.setAttribute('aria-label', _t('Copy code'));
  b.dataset.tip = _t('Copy code');
  b.dataset.done = _t('Copied');
  return b;
}

export function help() {
  const list = (items) => el('ul', { class: 'help-list' }, items.map(([name, desc]) => el('li', {}, el('code', {}, name), ': ', desc)));
  return el('div', { class: 'code-help' },
    el('div', { class: 'help-title' }, _t('Available Variables:')),
    list([
      ['env', _t("environment of the logged-in user, with their access rights and record rules; env['res.partner'] is a void recordset")],
      ['env.user, env.company, env.companies', _t('current user, current company, active companies')],
      ['env.uid, env.context, env.lang', _t('user id, context sent with every call, language')],
      ["env.ref('module.xmlid')", _t('record of an external id, if you can read it')],
      ['print(…)', _t('shows values above the result')],
      ['Command', _t('x2many commands namespace: Command.create(vals), link(id), set(ids)…')],
    ]),
    el('div', { class: 'help-title' }, _t('Recordsets:')),
    list([
      ['search, search_read, search_count, read, read_group, fields_get, name_search', _t('read from the server')],
      ["browse, with_context, ensure_one, exists, mapped('a.b'), filtered_domain", _t('work like in Python')],
      ['rec.state, rec.partner_id.name', _t('field value of a single record, as in Python; await it inside an expression: if (await rec.state === \'sale\')')],
      ['for (const rec of rs)', _t('records one by one; each field is read once for all of them')],
      ["rec.state = 'sent'", _t('writes the field, like in Python (needs "Allow Writes"); later lines see the new value')],
      ['ids, id, length', _t('record ids, first id, count')],
      ['create, write, unlink, copy', _t('write to the server: need "Allow Writes"')],
      ['rs.action_confirm()', _t('any other public method, called on these records (also needs "Allow Writes")')],
      ["env['model'].call(method, args, kwargs)", _t('a method called on the model, without records')],
    ]),
    el('div', { class: 'help-title' }, _t('Suggestions:')),
    list([
      ["env['", _t('models of the installed modules')],
      ["'…' in a domain or a field list, rec.", _t("fields of the variable's model (else the last env[…] one), following relations (partner_id.country_id.)")],
      ['.', _t('recordset methods, env and Command members')],
      ['↑ ↓, Enter / Tab, Esc, Ctrl+Space', _t('pick, insert, close, ask for suggestions')],
    ]),
    el('div', { class: 'help-title' }, _t('To show a result, return it: lists of records show as a table.')),
    el('div', { class: 'example' }, pre(EXAMPLE), copyButton(EXAMPLE)),
    el('div', { class: 'note' }, _t('JavaScript, not Python: await every server call, lists and objects in JS syntax (true / false / null).')),
    el('div', { class: 'note' }, _t('Every call goes through /web/dataset/call_kw as the logged-in user: no sudo(), no SQL, no private _methods. Methods that switch to sudo() inside still do so, as when clicked in Odoo.')),
    el('div', { class: 'note' }, _t('The code runs in the Odoo page with its own JavaScript rights: only run code you understand. An endless loop freezes the page (reload it).')));
}
