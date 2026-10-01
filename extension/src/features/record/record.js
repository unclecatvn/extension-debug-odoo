// Record tab: identity/metadata of the current record and every field with its definition and value.
import { fmtValue, reverseDeps } from './logic.js';
import { call, cached, fieldsOf } from '../../shared/bridge.js';
import { el, pre, errBox, pill, empty, kv, block, expandable, filterBox, copyable, listHead } from '../../shared/ui.js';
import { _t } from '../../shared/i18n.js';

export function renderRecord(s, state) {
  const { model, resId } = state;
  if (!model) return s.append(empty(_t('This screen is not bound to a model.')));

  block(s, 'identity', _t('Identity'), async () => {
    // get_metadata reads ir.model.data with sudo, so xmlids show even without access to ir.model.data.
    const [m] = resId ? await call(model, 'get_metadata', [[resId]]) : [];
    const who = (uid, date) => (uid ? `${uid[1]} (#${uid[0]}) · ${date}` : '—');
    return kv({
      model, id: resId || _t('(none / several records)'),
      xmlid: m?.xmlids?.map((x) => `${x.xmlid}${x.noupdate ? ' (noupdate)' : ''}`).join(', ') || '—',
      ...(m && 'create_uid' in m ? { [_t('created by')]: who(m.create_uid, m.create_date), [_t('last updated by')]: who(m.write_uid, m.write_date) } : {}),
    });
  }, _t('Model and id, xmlids (noupdate flagged), who created and last updated the record, and when.'));

  block(s, 'fields', _t('Fields'), async () => {
    const [fields, irFields, values] = await Promise.all([
      fieldsOf(model),
      cached(`ir fields ${model}`, () => call('ir.model.fields', 'search_read', [[['model', '=', model]]], { fields: ['name', 'modules', 'index'] }))
        .catch(() => []),
      resId ? call(model, 'read', [[resId]], { context: { bin_size: true } }).then((r) => r[0] || {}, (e) => ({ __error: e })) : {},
    ]);
    const ir = Object.fromEntries(irFields.map((f) => [f.name, f]));
    const recompute = reverseDeps(fields);
    const items = Object.keys(fields).sort().map((name) => {
      const f = fields[name];
      const v = values[name];
      const has = name in values;
      const shown = has ? fmtValue(v, f.type) : '';
      const meta = [
        f.string, f.relation && `→ ${f.relation}`, f.store ? 'stored' : 'non-stored',
        f.related ? `related ${[].concat(f.related).join('.')}` : f.depends?.length && `ƒ ${f.depends.join(', ')}`,
        f.required && 'required', f.readonly && 'readonly', ir[name]?.index && 'indexed', f.groups && `groups=${f.groups}`,
        ir[name]?.modules && `[${ir[name].modules}]`,
        recompute.get(name) && _t('change → recomputes %s', recompute.get(name).join(', ')),
      ].filter(Boolean).join(' · ');
      const li = el('li', {},
        el('div', { class: 'row' }, copyable(name), pill(f.type), el('span', { class: `grow val${shown.length > 40 ? ' long' : ''}` }, shown)),
        el('div', { class: 'meta' }, meta));
      li.dataset.q = [name, f.string, f.type, ir[name]?.modules, shown].join(' ').toLowerCase();
      return expandable(li, () => has && pre(typeof v === 'string' ? v : JSON.stringify(v, null, 2)));
    });
    const count = el('span', { class: 'muted' }, _t('%s fields', items.length));
    const filter = filterBox(items, _t('Filter name / label / value / type / module'),
      (n) => { count.textContent = _t('%s/%s fields', n, items.length); });
    return el('div', {},
      el('div', { class: 'toolbar' }, filter, count, listHead(_t('Field · type · value'), _t('Label · storage · compute · module'))),
      values.__error ? el('div', { class: 'pad-x' }, errBox(values.__error)) : null,
      el('ul', { class: 'list' }, items));
  });
}
