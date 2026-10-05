// Code tab: snippets — the built-in ones, per language (each runs on 18.0 and 19.0: only the API both have), and the
// ones saved for this Odoo (localStorage of the panel, per origin: a per-viewer convenience); and the guide.
import { N_, _t } from '../../i18n/i18n.ts';
import type { Lang } from './code.logic.ts';
import { box, button, tpl } from './code.ui.ts';

export interface Snippet { name: string; lang: Lang; code: string; desc?: string; builtin?: boolean }

const BUILTIN: Snippet[] = [
  { lang: 'js', name: N_('This record'), desc: N_('every field of the record opened'), code: 'return record.read()' },
  { lang: 'js', name: N_('Selected records'), desc: N_('the records ticked in the list, else the one opened'), code: "return records.read(['display_name'])" },
  { lang: 'js', name: N_('Count by a field'), desc: N_('how many records of the screen\'s model per value (change state)'), code: [
    "const rows = await model.search_read([], ['state'])",
    'const count = {}',
    'for (const r of rows) count[r.state] = (count[r.state] || 0) + 1',
    'return count'].join('\n') },
  { lang: 'js', name: N_('Empty field'), desc: N_('records missing a value'), code: "return env['res.partner'].search_read([['email', '=', false]], ['display_name', 'email'], { limit: 50 })" },
  { lang: 'js', name: N_('My access to this record'), desc: N_('what the server answers for each operation'), code: [
    'const ops = {}',
    "for (const op of ['read', 'write', 'create', 'unlink']) ops[op] = await record.call('has_access', [op])",
    'return ops'].join('\n') },
  { lang: 'js', name: N_('Record of an xmlid'), desc: 'env.ref', code: "return env.ref('base.main_company')" },
  { lang: 'js', name: N_('Change a field (dry run first)'), desc: N_('rec.field = value writes it, like in Python'), code: [
    "record.name = (await record.name) + ' (test)'",
    "return record.read(['name'])"].join('\n') },
  { lang: 'python', name: N_('This record'), desc: N_('every field of the record opened'), code: "return record.read()[0] if record else 'Open a record first'" },
  { lang: 'python', name: N_('Selected records'), desc: N_('the records ticked in the list, else the one opened'), code: 'return records' },
  { lang: 'python', name: N_('Count by a field'), desc: N_('how many records of the screen\'s model per value (change state)'), code: [
    "groups = model._read_group([], ['state'], ['__count'])",
    "return [{'state': state, 'count': count} for state, count in groups]"].join('\n') },
  { lang: 'python', name: N_('Empty field'), desc: N_('records missing a value'), code: "return env['res.partner'].search_read([('email', '=', False)], ['display_name', 'email'], limit=50)" },
  { lang: 'python', name: N_('My access to this record'), desc: N_('what the server answers for each operation'), code: [
    'ops = {}',
    "for op in ('read', 'write', 'create', 'unlink'):",
    '    ops[op] = record.has_access(op)',
    'return ops'].join('\n') },
  { lang: 'python', name: N_('Record of an xmlid'), desc: 'env.ref', code: "return env.ref('base.main_company')" },
  { lang: 'python', name: N_('Change a field (dry run first)'), desc: N_('a dry run rolls it back: see what it would do'), code: [
    "record.write({'name': record.name + ' (test)'})",
    "return record.read(['name'])"].join('\n') },
  { lang: 'python', name: N_('Time a piece of code'), desc: N_('how long a call takes on the server'), code: [
    't = time.time()',
    "env['res.partner'].search([]).mapped('display_name')",
    "return {'seconds': round(time.time() - t, 3)}"].join('\n') },
];

const KEY = (origin: string) => `odoo-debug-snippets:${origin}`;
export function savedSnippets(origin: string): Snippet[] {
  try { return (JSON.parse(localStorage.getItem(KEY(origin)) || '[]') as Snippet[]).filter((s) => s && typeof s.code === 'string'); } catch { return []; }
}
function writeSaved(origin: string, list: readonly Snippet[]) {
  try { localStorage.setItem(KEY(origin), JSON.stringify(list)); } catch { /* storage off */ }
}
export function saveSnippet(origin: string, s: Snippet) {
  writeSaved(origin, [...savedSnippets(origin).filter((x) => !(x.name === s.name && x.lang === s.lang)), s]);
}
export function deleteSnippet(origin: string, s: Snippet) {
  writeSaved(origin, savedSnippets(origin).filter((x) => !(x.name === s.name && x.lang === s.lang)));
}

/** The snippets of `lang`: saved ones first, then the built-in ones; a click loads one, × deletes a saved one. */
export function snippetList(origin: string, lang: Lang, load: (s: Snippet) => void, saveCurrent: () => void, redraw: () => void): HTMLElement {
  const r = tpl('snippets', { root: HTMLDivElement, list: HTMLDivElement }).refs;
  const line = (s: Snippet) => {
    const x = tpl('snippet', { row: HTMLDivElement, pick: HTMLButtonElement, desc: HTMLSpanElement }).refs;
    x.pick.textContent = s.builtin ? _t(s.name) : s.name;
    x.pick.addEventListener('click', () => load(s));
    x.desc.textContent = s.desc ? (s.builtin ? _t(s.desc) : s.desc) : s.code.split('\n')[0]!.slice(0, 80);
    if (!s.builtin) x.row.append(button('×', () => { if (confirm(_t('Delete the snippet "%s"?', s.name))) { deleteSnippet(origin, s); redraw(); } }, 'chip', _t('Delete this snippet')));
    return x.row;
  };
  const saved = savedSnippets(origin).filter((s) => s.lang === lang);
  r.list.append(box(button(_t('+ Save the code as a snippet…'), saveCurrent, 'chip')),
    ...saved.map(line),
    ...BUILTIN.filter((s) => s.lang === lang).map((s) => line({ ...s, builtin: true })));
  return r.root;
}

// ---------- the guide ----------

/** [name, what it is, whether the name is words to translate (else code)] */
const GUIDE: Record<Lang, { title: string; items: [string, string, boolean?][] }[]> = {
  js: [
    { title: N_('Available variables:'), items: [
      ['env', N_('environment of the logged-in user, with their access rights and record rules; env[\'res.partner\'] is an empty recordset')],
      ['record, records, model', N_('the record opened, the records selected (else the one opened), the screen\'s model: as in a server action')],
      ['env.user, env.company, env.companies', N_('current user, current company, active companies')],
      ['env.ref(\'module.xmlid\')', N_('record of an external id, if you can read it')],
      ['print(…)', N_('shows values above the result')],
      ['Command', N_('x2many commands: Command.create(vals), link(id), set(ids)…')],
    ] },
    { title: N_('Recordsets:'), items: [
      ['search, search_read, search_count, read, read_group, fields_get, name_search', N_('read from the server')],
      ['browse, with_context, ensure_one, exists, mapped(\'a.b\'), filtered_domain', N_('work like in Python')],
      ['rec.state, rec.partner_id.name', N_('field value of a single record, as in Python; await it inside an expression')],
      ['rec.state = \'sent\'', N_('writes the field, like in Python')],
      ['create, write, unlink, copy, rs.action_confirm()', N_('write: refused in read-only, listed but not sent in a dry run')],
    ] },
  ],
  python: [
    { title: N_('Available variables (a server action\'s):'), items: [
      ['env', N_('environment of the logged-in user (their rights; sudo() is yours to call)')],
      ['record, records, model', N_('the record opened, the records selected (else the one opened), the screen\'s model')],
      ['print(…)', N_('shows values above the result')],
      ['return …', N_('the value shown, as what it is')],
      ['Command, UserError, datetime, dateutil, time, log', N_('what a server action has')],
    ] },
    { title: N_('Runs:'), items: [
      [N_('Dry run'), N_('the code runs for real, then everything is rolled back: try a write, see what it does'), true],
      [N_('Commit'), N_('saved at once; an error rolls back everything the code changed'), true],
      ['safe_eval', N_('Odoo\'s sandbox: no import, no dunder (__x__) names; Settings rights needed')],
    ] },
  ],
};

export function guide(lang: Lang): HTMLElement {
  const out = box();
  for (const part of GUIDE[lang]) {
    const t = tpl('help-title', { title: HTMLDivElement }).refs.title;
    t.textContent = _t(part.title);
    const { list } = tpl('help-list', { list: HTMLUListElement }).refs;
    for (const [name, desc, words] of part.items) {
      const it = tpl('help-item', { item: HTMLLIElement, name: HTMLElement, desc: HTMLSpanElement }).refs;
      it.name.textContent = words ? _t(name) : name;
      it.desc.textContent = _t(desc);
      list.append(it.item);
    }
    out.append(t, list);
  }
  const t = tpl('help-title', { title: HTMLDivElement }).refs.title;
  t.textContent = _t('Suggestions: env[\' (models), \'… (fields), . (methods and fields); ↑ ↓ Enter / Tab, Esc, Ctrl+Space. ⌘/Ctrl+Enter runs.');
  out.append(t);
  return out;
}
