// Record tab: the identity of the current record (xmlids, who created / changed it) and every field of its model with
// its definition and value: filter, quick filters, copy a name or a value, open the record a many2one points to, copy
// the whole record as JSON. Same on 18.0, 19.0 and 20.0 (get_metadata, fields_get, ir.model.fields: checked in the
// sources) but how a binary is read without its content (adapter: orm.binaryRead). Markup: record.tpl.html; pure part:
// record.logic.ts.
import { _t, N_, translateDom } from '../../i18n/i18n.ts';
import { cached } from '../../extension/page-cache.ts';
import type { IrModelField } from '../../odoo/models.ts';
import { groupsLabel, parseGroups } from '../../odoo/groups.ts';
import { odoo } from '../../odoo/detect.ts';
import { fieldsOf, groupNames } from '../../odoo/reads.ts';
import { call, isAccessError } from '../../odoo/rpc.ts';
import { block, countText, filterBox } from '../../ui/cards.ts';
import { copyable, copyText, empty, errBox, kv, listHead, odooLink, pill, pre } from '../../ui/components.ts';
import { xmlCode } from '../../ui/code.ts';
import { jsonView } from '../../ui/json-view.ts';
import { expandable } from '../../ui/lists.ts';
import { templates } from '../../ui/template.ts';
import type { PanelContext, TabModule } from '../registry.ts';
import { copyValue, describeField, fmtValue, linkedRecord, matchesAll, recordJson, reverseDeps, valueDisplay, QUICK_FILTERS, type QuickFilter } from './record.logic.ts';
import html from './record.tpl.html';
import { clearRecordPin, comparisonPanel } from './record.comparison.ts';
import { readValues } from './record.data.ts';

const tpl = templates(html, translateDom);
let panel: PanelContext | null = null;
let generation = 0;

export const recordTab: TabModule = {
  mount(_section, context) { panel = context; },
  reset() { ++generation; clearRecordPin(); },
  render(section, state, context) {
    const view = ++generation;
    const current = () => view === generation && (!panel || panel.state() === state);
    const { model, resId, origin } = state;
    if (!model) { section.append(empty(_t('No model on this screen.'))); return; }
    block(section, 'identity', _t('Identity & metadata'), () => identity(model, resId ?? null));
    block(section, 'fields', _t('Fields'), () => fieldList(model, resId ?? null, origin));
    block(section, 'compare', _t('Compare saved records'), () => comparisonPanel(state, context, current)); // an occasional task: last
  },
};

interface Metadata {
  xmlids?: { xmlid: string; noupdate: boolean }[];
  create_uid?: [number, string] | false;
  create_date?: string;
  write_uid?: [number, string] | false;
  write_date?: string;
}

/** get_metadata reads ir.model.data with sudo: the xmlids show even without access to ir.model.data. */
async function identity(model: string, resId: number | null) {
  const [m] = resId ? await call<Metadata[]>(model, 'get_metadata', [[resId]]) : [];
  const who = (uid: [number, string] | false | undefined, date: string | undefined) => (uid ? `${uid[1]} (#${uid[0]}) · ${date ?? ''}` : '—');
  return kv({
    model, id: resId || _t('(none / several records)'),
    xmlid: m?.xmlids?.map((x) => `${x.xmlid}${x.noupdate ? ' (noupdate)' : ''}`).join(', ') || '—',
    ...(m && 'create_uid' in m ? { [_t('created by')]: who(m.create_uid, m.create_date), [_t('last updated by')]: who(m.write_uid, m.write_date) } : {}),
  });
}

/** ir.model.fields: the modules defining a field, and whether it is indexed. Access Rights only (both versions). */
const irFields = (model: string): Promise<{ rows: IrModelField[]; error?: unknown }> => cached(`ir fields ${model}`, () =>
  call<IrModelField[]>('ir.model.fields', 'search_read', [[['model', '=', model]]], { fields: ['name', 'modules', 'index'] }))
  .then((rows) => ({ rows }), (error: unknown) => ({ rows: [], error }));

/** A field's value once its row opens, as fits its type (record.logic.ts → valueDisplay). */
function valueView(type: string, v: unknown): Node {
  const how = valueDisplay(type, v);
  if (how === 'code') return xmlCode(v as string).root;
  if (how === 'text') return pre(v as string);
  return jsonView(v);
}

function note(text: string) {
  const { root, refs } = tpl('note', { text: HTMLDivElement });
  refs.text.textContent = text;
  return root;
}

async function fieldList(model: string, resId: number | null, origin: string) {
  const fields = await fieldsOf(model);
  const restricted = [...new Set(Object.values(fields).flatMap((f) => (f.groups ? parseGroups(f.groups).map((g) => g.xmlid) : [])))];
  const [ir, read, names] = await Promise.all([irFields(model), resId ? odoo().then((context) => readValues(model, resId, fields, context.adapter.orm.binaryRead)) : null, groupNames(restricted)]);
  const values = read?.values ?? {};
  const irByName = new Map(ir.rows.map((f) => [f.name, f]));
  const recompute = reverseDeps(fields);

  const items = Object.keys(fields).sort().map((name) => {
    const f = fields[name]!;
    const v = values[name];
    const has = name in values;
    const shown = has ? fmtValue(v, f) : '';
    const { row: li, line, meta } = tpl('field', { row: HTMLLIElement, line: HTMLDivElement, meta: HTMLDivElement }).refs;
    const value = has ? copyable(copyValue(v), `grow val${shown.length > 40 ? ' long' : ''}`, shown) : tpl('no-value').root;
    if (has) value.title = _t('Click to copy the value');
    const target = linkedRecord(f, v);
    // groups=: on the main line (the description only shows once the row is open), by group name; the spec as written on hover
    const lock = f.groups ? pill(groupsLabel(f.groups, names), 'info') : null;
    if (lock && f.groups) { lock.classList.add('lock'); lock.title = `groups ${f.groups}`; }
    line.append(copyable(name), pill(f.type), ...(lock ? [lock] : []), value, ...(target ? [odooLink(origin, target)] : []));
    meta.textContent = describeField(f, irByName.get(name), recompute.get(name));
    li.dataset.q = [name, f.string, f.type, irByName.get(name)?.modules || '', shown].join(' ').toLowerCase();
    li.dataset.name = name;
    return expandable(li, () => (has ? valueView(f.type, v) : null));
  });

  // search box + quick filters (AND), one count
  const bar = tpl('fields-toolbar', { bar: HTMLDivElement, chips: HTMLSpanElement, copyJson: HTMLButtonElement, count: HTMLSpanElement }).refs;
  const on = new Set<QuickFilter>();
  const setCount = (n: number) => { bar.count.textContent = countText(n, items.length, N_('%s fields'), N_('%s/%s fields')); };
  const search = filterBox(items, _t('Filter name / label / value / type / module'), setCount, (li) => matchesAll(fields[li.dataset.name!]!, on));
  for (const chip of bar.chips.querySelectorAll<HTMLButtonElement>('[data-filter]')) {
    const key = chip.dataset.filter as QuickFilter;
    if (!(key in QUICK_FILTERS)) continue;
    chip.addEventListener('click', () => {
      if (on.has(key)) on.delete(key); else on.add(key);
      chip.setAttribute('aria-pressed', String(on.has(key)));
      search.refresh();
    });
  }
  bar.bar.prepend(search.input);
  bar.bar.append(listHead(_t('Field · type · value'), _t('Label · storage · compute · module')));
  setCount(items.length);
  if (resId) {
    bar.copyJson.addEventListener('click', async () => {
      await copyText(recordJson(values, fields));
      bar.copyJson.classList.add('copied');
      setTimeout(() => bar.copyJson.classList.remove('copied'), 1000);
    });
  } else bar.copyJson.remove(); // no record: no values

  const notes: HTMLElement[] = [];
  if (read?.error) {
    notes.push(...(read.partial ? [note(_t('A computed field failed: only stored values are shown.'))] : []));
    notes.push(errBox(read.error));
  }
  if (ir.error) {
    notes.push(note(isAccessError(ir.error)
      ? _t('Modules and indexes need Access Rights (base.group_erp_manager).')
      : _t('Modules and indexes unavailable: %s', (ir.error as Error)?.message ?? ir.error)));
  }
  const { list } = tpl('fields', { list: HTMLUListElement }).refs;
  list.append(...items);
  const out = document.createDocumentFragment();
  out.append(bar.bar, ...notes, list);
  return out;
}
