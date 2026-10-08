// Saved-record comparison UI. Pinning keeps an ID (not stale values) for this panel's session; comparison rereads it.
import { exec, isExecError } from '../../extension/run-in-tab.ts';
import { _t, N_, translateDom } from '../../i18n/i18n.ts';
import { pageRecordSelection } from '../../injected/record-selection.ts';
import type { PageState } from '../../injected/page-state.ts';
import type { OdooContext } from '../../odoo/detect.ts';
import type { FieldsGet } from '../../odoo/models.ts';
import { fieldsOf, sessionInfo } from '../../odoo/reads.ts';
import { countText } from '../../ui/cards.ts';
import { copyable, empty, errBox, loading, odooLink, pill } from '../../ui/components.ts';
import { templates } from '../../ui/template.ts';
import { compareRows, comparisonScope, pinForScope, validateCompareIds, type ComparisonCell, type PinnedRecord } from './record.compare.logic.ts';
import { readComparisonRecords, type ComparedRecord } from './record.data.ts';
import { copyValue, fmtValue, linkedRecord } from './record.logic.ts';
import html from './record.tpl.html';

const tpl = templates(html, translateDom);
let pinned: PinnedRecord | null = null;
export const clearRecordPin = () => { pinned = null; };

export function comparisonPanel(state: PageState, context: OdooContext, current: () => boolean): HTMLElement {
  const { root, refs } = tpl('comparison', {
    selected: HTMLButtonElement, pin: HTMLButtonElement, compare: HTMLButtonElement, clear: HTMLButtonElement,
    pinbox: HTMLSpanElement, pinned: HTMLSpanElement, status: HTMLDivElement, output: HTMLDivElement,
  });
  let scope: string | null = null;
  let ready = false;
  let busy = false;
  let request = 0;
  const model = state.model!;
  const validId = (id: unknown): id is number => typeof id === 'number' && Number.isSafeInteger(id) && id > 0;
  const alive = () => current();
  // Only the actions this screen allows: selected records on a list / kanban, the pin workflow on a form.
  const multi = ['list', 'kanban'].includes(state.viewType || '');
  const sync = () => {
    const pin = pinForScope(pinned, scope);
    refs.selected.hidden = !multi;
    refs.pin.hidden = multi;
    refs.compare.hidden = multi || !pin;
    refs.pinbox.hidden = !pin;
    refs.pin.disabled = busy || !ready || !validId(state.resId);
    refs.selected.disabled = busy || !ready;
    refs.compare.disabled = busy || !ready || !pin || !validId(state.resId) || pin.id === state.resId;
    refs.clear.disabled = busy;
    refs.pinned.textContent = pin ? _t('Pinned: %s (#%s)', model, pin.id) : '';
  };
  sync();

  /** Read the actual page before and after async work, not only the panel's debounced navigation snapshot. */
  const screen = async () => {
    const snapshot = await exec(pageRecordSelection);
    if (!snapshot || isExecError(snapshot)) throw new Error(snapshot?.error || _t('Could not read the selected records.'));
    if (snapshot.origin !== state.origin || snapshot.url !== state.url || snapshot.loadedAt !== state.loadedAt ||
        snapshot.model !== model || snapshot.resId !== (state.resId ?? null) || snapshot.viewType !== (state.viewType ?? null)) {
      throw new Error(_t('The screen changed. Reload Data before comparing records.'));
    }
    return snapshot;
  };

  // sessionInfo is cached only for the current page load; missing session identity disables pin/compare rather than
  // combining IDs from an unknown database or user. A stale initialization never clears a newer view's pin.
  void sessionInfo().then((session) => {
    if (!alive()) return;
    scope = comparisonScope(state.origin, session.db, model, session.uid);
    if (!scope) throw new Error(_t('Could not identify the database and user: comparison is off.'));
    pinned = pinForScope(pinned, scope);
    ready = true;
    sync();
  }).catch((error: unknown) => { if (alive()) refs.status.replaceChildren(errBox(error)); });

  refs.clear.addEventListener('click', () => {
    ++request;
    pinned = null;
    busy = false;
    refs.output.replaceChildren();
    refs.status.replaceChildren();
    sync();
  });
  refs.pin.addEventListener('click', () => {
    const token = ++request;
    busy = true;
    sync();
    void screen().then((snapshot) => {
      if (!alive() || token !== request || !scope) return;
      if (!validId(snapshot.resId)) throw new Error(_t('Open a saved record before pinning it.'));
      pinned = { scope, id: snapshot.resId };
      refs.status.replaceChildren();
      refs.output.replaceChildren();
    }).catch((error: unknown) => {
      if (alive() && token === request) refs.status.replaceChildren(errBox(error));
    }).finally(() => { if (alive() && token === request) { busy = false; sync(); } });
  });

  const compare = async (selected: boolean) => {
    const token = ++request;
    const fresh = () => alive() && token === request;
    busy = true;
    sync();
    refs.status.replaceChildren();
    refs.output.replaceChildren(loading());
    try {
      const snapshot = await screen();
      if (!fresh()) return;
      if (selected && snapshot.domainSelected) throw new Error(_t('Select 2–5 individual records, not every record matching the search.'));
      if (selected && !snapshot.selectionAvailable) throw new Error(_t('Could not read the selection. Select records in a list or kanban, or pin one.'));
      const pin = pinForScope(pinned, scope);
      const input = selected ? snapshot.ids : [pin?.id, snapshot.resId];
      const validated = validateCompareIds(input);
      if (validated.error === 'invalid') throw new Error(_t('Only saved records can be compared.'));
      if (validated.error) throw new Error(_t('Select 2–5 different saved records of this model.'));
      const fields = await fieldsOf(model);
      if (!fresh()) return;
      const records = await readComparisonRecords(model, validated.ids, fields, context.adapter.orm.binaryRead);
      await screen();
      if (!fresh()) return;
      refs.output.replaceChildren(comparisonMatrix(fields, records, state.origin, model));
    } catch (error) {
      if (fresh()) { refs.output.replaceChildren(); refs.status.replaceChildren(errBox(error)); }
    } finally {
      if (fresh()) { busy = false; sync(); }
    }
  };
  refs.selected.addEventListener('click', () => { void compare(true); });
  refs.compare.addEventListener('click', () => { void compare(false); });
  return root;
}

function comparisonMatrix(fields: FieldsGet, records: ComparedRecord[], origin: string, model: string): HTMLElement {
  const { root, refs } = tpl('comparison-matrix', {
    search: HTMLInputElement, differences: HTMLButtonElement, count: HTMLSpanElement,
    columns: HTMLTableRowElement, rows: HTMLTableSectionElement, notes: HTMLDivElement, empty: HTMLDivElement,
  });
  for (const record of records) {
    const { cell, head, name, status } = tpl('comparison-column', { cell: HTMLTableCellElement, head: HTMLSpanElement, name: HTMLSpanElement, status: HTMLSpanElement }).refs;
    const label = record.values.display_name || record.values.name;
    name.textContent = typeof label === 'string' ? `${label} (#${record.id})` : `#${record.id}`;
    head.append(odooLink(origin, `${model}/${record.id}`));
    status.textContent = record.error ? record.partial ? _t('Partial: stored values only') : _t('Record unreadable') : '';
    refs.columns.append(cell);
    if (record.error) {
      const { root: notice, refs: row } = tpl('comparison-error', { title: HTMLDivElement, detail: HTMLDivElement });
      row.title.textContent = _t('Record #%s: %s', record.id, record.partial ? _t('A computed field failed: only stored values are shown.') : _t('Record unreadable'));
      row.detail.append(errBox(record.error));
      refs.notes.append(notice);
    }
    if (Object.keys(record.fieldErrors ?? {}).length) {
      refs.notes.append(empty(_t('Record #%s: could not read the size of %s.', record.id, Object.keys(record.fieldErrors!).join(', '))));
    }
  }
  let differences = false;
  const render = () => {
    const rows = compareRows(fields, records, refs.search.value, differences);
    refs.rows.replaceChildren(...rows.map(({ name, field, cells, status }) => {
      const { row, field: heading, label, equality } = tpl('comparison-row', {
        row: HTMLTableRowElement, field: HTMLSpanElement, label: HTMLDivElement, equality: HTMLSpanElement,
      }).refs;
      heading.textContent = name;
      label.textContent = `${field.string} · ${field.type}`;
      if (status !== 'same') equality.append(pill(status === 'different' ? _t('Different') : _t('Unknown'), status === 'different' ? 'med' : '')); // same: muted values (panel.css)
      row.dataset.status = status;
      for (const cell of cells) {
        const { value } = tpl('comparison-cell', { value: HTMLTableCellElement }).refs;
        if (cell.status === 'value') {
          const shown = cell.value === false && field.type !== 'boolean' ? _t('(unset)') : fmtValue(cell.value, field);
          value.append(copyable(copyValue(cell.value), 'copy', shown));
          const target = linkedRecord(field, cell.value);
          if (target) value.append(odooLink(origin, target));
        } else {
          value.textContent = cellLabel(cell.status);
          value.classList.add('muted');
        }
        row.append(value);
      }
      return row;
    }));
    refs.count.textContent = countText(rows.length, Object.keys(fields).length, N_('%s fields'), N_('%s/%s fields'));
    refs.empty.hidden = rows.length > 0;
  };
  refs.search.addEventListener('input', render);
  refs.differences.addEventListener('click', () => {
    differences = !differences;
    refs.differences.setAttribute('aria-pressed', String(differences));
    render();
  });
  render();
  return root;
}

function cellLabel(status: Exclude<ComparisonCell['status'], 'value'>): string {
  switch (status) {
    case 'restricted': return _t('Restricted / not returned');
    case 'unreadable': return _t('Record unreadable');
    case 'unavailable': return _t('Value unavailable');
    case 'missing': return _t('Not returned');
  }
}
