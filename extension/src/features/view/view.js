// View tab: inheritance tree of the current view, the action, form field modifiers (+ page picker), context & domain.
import { buildViewTree } from './logic.js';
import { pageFormFields, pagePick } from './page.js';
import { exec, execOrThrow, call } from '../../shared/bridge.js';
import { el, pre, pill, details, kv, block, expandable, filterBox, copyable, odooLink, listHead, splitRow } from '../../shared/ui.js';
import { _t, N_ } from '../../shared/i18n.js';

let picked = null; // field name clicked with the page picker, shown once on the next render
export const setPicked = (name) => { picked = name || null; };

export function renderView(s, state) {
  const { model, viewType, viewId, action } = state;
  const openLink = (path, text) => odooLink(state.origin, path, text);

  if (model && viewType) {
    block(s, 'inherited', _t('Inherited Views'), async () => {
      const [gv, all] = await Promise.all([
        call(model, 'get_views', [], { views: [[viewId || false, viewType]], options: {} }),
        call('ir.ui.view', 'search_read', [[['model', '=', model], ['type', '=', viewType]]],
          { fields: ['name', 'xml_id', 'inherit_id', 'mode', 'priority', 'active', 'arch_fs'], context: { active_test: false } }),
      ]);
      const v = gv.views[viewType];
      const items = buildViewTree(all, v.id).map(({ view: x, depth }) => expandable(el('li', {
        class: [x.id === v.id && 'current', !x.active && 'inactive'].filter(Boolean).join(' '),
        style: `padding-left:${10 + depth * 14}px`,
      },
        splitRow([el('span', { class: 'name tree' }, depth ? el('span', { class: 'muted' }, '└') : null, x.xml_id ? copyable(x.xml_id, '') : `#${x.id}`),
          pill(x.mode, x.mode === 'primary' ? 'accent' : ''), el('span', { class: 'grow' }), el('span', { class: 'ms' }, `prio ${x.priority}`)],
        openLink(`ir.ui.view/${x.id}`)),
        el('div', { class: 'meta' }, [x.name, `#${x.id}`, x.arch_fs, !x.active && _t('inactive')].filter(Boolean).join(' · ')))));
      return el('div', {}, listHead(_t('View · mode · priority'), _t('Name · id · file')), el('ul', { class: 'list' }, items),
        el('div', { class: 'pad-bottom' }, details(_t('Combined Arch (View #%s)', v.id), pre(v.arch))));
    }, _t('Every %s view of this model as an inheritance tree (the one shown highlighted, inactive ones included), and the combined arch.', viewType));
  }

  if (action) {
    block(s, 'action', _t('Action'), async () => {
      const { id, type, res_model, target, name, path } = action;
      let { xml_id } = action;
      if (!xml_id && typeof id === 'number') { // the client-side action usually carries no xml_id in 18/19
        const r = await call('ir.model.data', 'search_read', [[['model', '=', type], ['res_id', '=', id]]], { fields: ['module', 'name'] }).catch(() => []);
        xml_id = r.map((x) => `${x.module}.${x.name}`).join(', ');
      }
      return el('div', {},
        kv({ name, id, xml_id: xml_id || '—', type, res_model: res_model || '—', target: target || '—', ...(path ? { path: `/odoo/${path}` } : {}) }),
        typeof id === 'number' && type ? el('div', { class: 'pad-bottom' }, openLink(`${type}/${id}`, _t('Open Action Record ↗'))) : null,
        details(_t('Full Action (JSON)'), pre(action)));
    });
  }

  if (viewType === 'form') block(s, 'form-fields', _t('Form Fields'), formFields,
    _t('invisible / readonly / required of every field of the form, evaluated on the record shown.'));

  block(s, 'context', _t('Context & Domain'), () => el('div', {}, details(_t('Context'), pre(state.context ?? {})), details(_t('Domain'), pre(state.domain ?? []))));
}

const MODIFIERS = ['invisible', 'readonly', 'required'];

async function formFields() {
  const r = await execOrThrow(pageFormFields, N_('Cannot read the form.'));
  const flag = (m, label, kind) => (m.error ? pill(`${label}?`, 'med') : m.value ? pill(label, kind) : null);
  const items = r.fields.map((f) => {
    const hiddenByParent = !f.invisible.value && !f.inDom;
    const li = el('li', { class: f.invisible.value ? 'inactive' : '' },
      el('div', { class: 'row' }, copyable(f.name), f.widget && pill(f.widget), el('span', { class: 'grow muted' }, f.string),
        flag(f.invisible, _t('hidden'), 'err'), hiddenByParent && pill(_t('not shown'), 'med'),
        flag(f.readonly, 'readonly', 'info'), flag(f.required, 'required', 'info')),
      el('div', { class: 'meta mono' }, MODIFIERS.filter((k) => f[k].expr).map((k) => `${k}="${f[k].expr}"`).join(' · ')));
    li.dataset.q = `${f.name} ${f.string} ${f.widget || ''}`.toLowerCase();
    li.dataset.name = f.name;
    return expandable(li, () => el('div', {},
      hiddenByParent ? el('div', { class: 'note' }, _t('The field is not invisible itself but is not on screen: it is on another notebook page, or a parent node (group/page/div) is invisible.')) : null,
      MODIFIERS.filter((k) => f[k].error).map((k) => el('div', { class: 'error' }, `${k}: ${f[k].error}`)),
      Object.keys(f.vars).length ? details(_t('Expression Values'), pre(f.vars)) : null,
      details(_t('Full Node'), pre({ ...f, vars: undefined }))));
  });

  const filter = filterBox(items, _t('Filter name / label / widget'));
  const pickBtn = el('button', {
    class: 'chip', title: _t('Click a field on the Odoo page (Esc to cancel)'),
    onclick: () => { pickBtn.textContent = _t('Picking… (Esc to cancel)'); exec(pagePick); },
  }, _t('⌖ Pick on Page'));
  if (picked) {
    filter.value = picked;
    for (const li of items) { li.hidden = li.dataset.name !== picked; if (!li.hidden) li.click(); }
    picked = null;
  }
  return el('div', {},
    el('div', { class: 'toolbar' }, filter, pickBtn, listHead(_t('Field · widget · label · state'), _t('Modifier expressions'))),
    r.editable ? null : el('div', { class: 'note pad-x' }, _t('The form is read-only: every field is readonly.')),
    el('ul', { class: 'list' }, items));
}
