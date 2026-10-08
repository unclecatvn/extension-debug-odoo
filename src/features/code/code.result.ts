// Code tab: a run's result, each value shown as what it is. Recordsets as their records (id ↗, name); rows of a model
// (a read, a search_read) as a table typed by the model's fields (fields_get): many2one as a link, selection as its
// label, numbers right aligned in the user's locale, dates and datetimes (UTC on the server) in the user's time zone,
// booleans as ✓ ✗, html as its text; rows without a model typed by their values; a number, a text, a date shown big
// with their kind; a dict as key → typed value; anything else as a JSON tree. Tables copy as CSV, Markdown, JSON or
// download as CSV. Then the prints, the error (its line, the server traceback) and the calls made (JS).
import { _t } from '../../i18n/i18n.ts';
import { fieldsOf } from '../../odoo/reads.ts';
import { call } from '../../odoo/rpc.ts';
import type { FieldInfo, FieldsGet } from '../../odoo/models.ts';
import { copyText, details, errBox, pill, pre } from '../../ui/components.ts';
import { jsonView } from '../../ui/json-view.ts';
import { tip } from '../../ui/tooltip.ts';
import type { RunResult } from './code.injected.ts';
import {
  callStats, columnType, columnsOf, isRecordset, kindOf, toCsv, toJson, toMarkdown, type ColumnType, type Lang, type RecordsetValue,
} from './code.logic.ts';
import { box, button, link, row, text, tpl } from './code.ui.ts';

export const MAX_ROWS = 500;

/** What formatting needs: where records open, the user's language and time zone. */
export interface Fmt { origin: string; lang: string; tz: string }

const locale = (f: Fmt) => f.lang.replace('_', '-');
const num = (f: Fmt, v: number, digits?: number) => new Intl.NumberFormat(locale(f), digits === undefined ? {} : { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(v);
function dateText(f: Fmt, iso: string, withTime: boolean): string {
  try {
    if (!withTime) return new Intl.DateTimeFormat(locale(f), { dateStyle: 'medium' }).format(new Date(`${iso}T00:00:00`));
    const utc = new Date(`${iso.replace(' ', 'T').slice(0, 19)}Z`); // the server stores datetimes in UTC
    return new Intl.DateTimeFormat(locale(f), { dateStyle: 'medium', timeStyle: 'medium', timeZone: f.tz || undefined }).format(utc);
  } catch { return iso; }
}
const recordUrl = (f: Fmt, model: string, id: number) => `${f.origin}/odoo/${model}/${id}`;
const empty = () => text('—', 'muted');

/** A cell, typed by its field when the model is known, else by its column's guessed type. */
function cell(v: unknown, f: Fmt, type: ColumnType, field?: FieldInfo): Node {
  const ftype = field?.type;
  if (v === null || v === undefined || (v === false && ftype !== 'boolean' && type !== 'boolean')) return empty();
  if (ftype === 'boolean' || type === 'boolean' || typeof v === 'boolean') return v ? text('✓', 'sym yes', _t('true')) : text('✗', 'sym no', _t('false'));
  if (Array.isArray(v) && v.length === 2 && Number.isInteger(v[0]) && typeof v[1] === 'string') { // many2one [id, name]
    const model = field?.relation;
    return model ? link(v[1], recordUrl(f, model, v[0] as number), `${model} #${v[0]}`) : row(text(v[1]), text(` #${v[0]}`, 'muted'));
  }
  if (Array.isArray(v) && v.every((x) => Number.isInteger(x))) { // x2many ids
    if (!v.length) return empty();
    return text(_t('%s records', v.length), 'chip-text', `${field?.relation ?? ''} ${v.slice(0, 50).join(', ')}${v.length > 50 ? '…' : ''}`.trim());
  }
  if (isRecordset(v)) return recordsetChip(v, f);
  if (typeof v === 'object' && v && '$date' in v) return text(dateText(f, String((v as { $date: string }).$date), false), '', String((v as { $date: string }).$date));
  if (typeof v === 'object' && v && '$datetime' in v) { const iso = String((v as { $datetime: string }).$datetime); return text(dateText(f, iso, true), '', `${iso} UTC`); }
  if (typeof v === 'number') {
    const digits = ftype === 'monetary' ? 2 : ftype === 'integer' || type === 'integer' || type === 'id' ? 0 : undefined;
    return text(type === 'id' ? String(v) : num(f, v, digits), 'num');
  }
  if (typeof v === 'string') {
    if (ftype === 'selection' && field?.selection) { const label = field.selection.find(([k]) => k === v)?.[1]; return text(label ?? v, '', v); }
    if (ftype === 'date' || (!ftype && type === 'date')) return text(dateText(f, v, false), '', v);
    if (ftype === 'datetime' || (!ftype && type === 'datetime')) return text(dateText(f, v, true), '', `${v} UTC`);
    if (ftype === 'html') { const t = v.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim(); return clipped(t); }
    if (ftype === 'binary') return text(_t('binary · %s', sizeText(v.length * 0.75)), 'muted');
    return clipped(v);
  }
  if (typeof v === 'object' && v && '$repr' in v) return text(String((v as { $repr: string }).$repr), 'mono');
  return jsonView(v, 0);
}

function clipped(s: string, max = 160): HTMLSpanElement {
  const t = text(s.length > max ? `${s.slice(0, max)}…` : s);
  if (s.length > max) tip(t, s.slice(0, 1500));
  return t;
}
const sizeText = (bytes: number) => (bytes > 1e6 ? `${(bytes / 1e6).toFixed(1)} MB` : bytes > 1e3 ? `${Math.round(bytes / 1e3)} kB` : `${Math.round(bytes)} B`);

function recordsetChip(v: RecordsetValue, f: Fmt): Node {
  const n = v.count ?? v.ids.length;
  if (v.ids.some((id) => id <= 0)) return text(`${v.$recordset}(${v.ids.join(', ')})`, 'mono', _t('Not created: in a dry run, create() returns a fake id'));
  if (n === 1) return link(v.names?.[0] ?? `${v.$recordset}(${v.ids[0]})`, recordUrl(f, v.$recordset, v.ids[0]!), `${v.$recordset} #${v.ids[0]}`);
  return text(`${v.$recordset}(${v.ids.slice(0, 8).join(', ')}${n > 8 ? ', …' : ''})`, 'mono', _t('%s records', n));
}

const TYPE_LABEL: Record<ColumnType, string> = {
  id: 'id', many2one: 'many2one', ids: 'ids', boolean: 'bool', integer: 'int', float: 'float', date: 'date', datetime: 'datetime',
  recordset: 'records', text: 'text', json: 'json', empty: '',
};

/** Rows as a table: typed by `fields` (a model's) when given, else by their values. */
function table(rows: readonly Record<string, unknown>[], f: Fmt, fields: FieldsGet | null): HTMLElement {
  const cols = columnsOf(rows);
  const types = new Map(cols.map((c) => [c, columnType(c, rows.map((r) => r[c]))]));
  const t = tpl('table', { table: HTMLTableElement, head: HTMLTableRowElement, body: HTMLTableSectionElement }).refs;
  for (const c of cols) {
    const h = tpl('th', { cell: HTMLTableCellElement, name: HTMLSpanElement, type: HTMLSpanElement }).refs;
    const fi = fields?.[c];
    h.name.textContent = fi?.string && fi.string !== c ? fi.string : c;
    h.type.textContent = fi ? ` ${fi.type}` : TYPE_LABEL[types.get(c)!] ? ` ${TYPE_LABEL[types.get(c)!]}` : '';
    tip(h.cell, fi ? `${c} · ${fi.type}${fi.relation ? ` → ${fi.relation}` : ''}` : c);
    if (isNumeric(fi?.type, types.get(c)!)) h.cell.classList.add('num');
    t.head.append(h.cell);
  }
  for (const r of rows.slice(0, MAX_ROWS)) {
    const tr = tpl('tr', { row: HTMLTableRowElement }).refs.row;
    for (const c of cols) {
      const td = tpl('td', { cell: HTMLTableCellElement }).refs.cell;
      const fi = fields?.[c];
      if (c === 'id' && fields && typeof r.id === 'number' && r.id > 0) td.append(link(String(r.id), recordUrl(f, fieldsModel(fields) ?? '', r.id)));
      else td.append(cell(r[c], f, types.get(c)!, fi));
      if (isNumeric(fi?.type, types.get(c)!)) td.classList.add('num');
      tr.append(td);
    }
    t.body.append(tr);
  }
  return t.table.parentElement!;
}
const isNumeric = (ftype: string | undefined, type: ColumnType) => ['integer', 'float', 'monetary'].includes(ftype ?? '') || type === 'integer' || type === 'float';
const MODEL_OF = new WeakMap<FieldsGet, string>();
const fieldsModel = (fields: FieldsGet) => MODEL_OF.get(fields);
async function modelFields(model: string): Promise<FieldsGet | null> {
  const fg = await fieldsOf(model).catch(() => null);
  if (fg) MODEL_OF.set(fg, model);
  return fg;
}

/** Copy CSV / Markdown / JSON, download CSV: in the value's head line, beside what it is. */
function exportBar(rows: readonly Record<string, unknown>[], value: unknown): HTMLElement {
  // short labels (the format), the full action on hover: they fit beside what the value is
  const copy = (label: string, hint: string, make: () => string) => {
    const b = button(label, () => { void copyText(make()).then(() => { b.classList.add('copied'); setTimeout(() => b.classList.remove('copied'), 1000); }); }, 'chip', hint);
    return b;
  };
  const download = button('⤓ CSV', () => {
    const url = URL.createObjectURL(new Blob([`﻿${toCsv(rows)}`], { type: 'text/csv;charset=utf-8' }));
    const a = link('', url);
    a.download = `odoo-debug-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }, 'chip', _t('Download CSV'));
  const tools = row(text(_t('Copy'), 'muted'), copy('CSV', _t('Copy CSV'), () => toCsv(rows)), copy('Markdown', _t('Copy Markdown'), () => toMarkdown(rows)),
    copy('JSON', _t('Copy JSON'), () => toJson(value)), download);
  tools.classList.add('value-tools'); // at the right of the value's head line (panel.css)
  return tools;
}

/** A value shown as what it is (see the header). */
export async function valueView(v: unknown, f: Fmt, snapshot = false): Promise<HTMLElement> {
  const r = tpl('value-box', { box: HTMLDivElement, head: HTMLDivElement, body: HTMLDivElement }).refs;
  const kind = kindOf(v);
  const head = (...n: (Node | string)[]) => r.head.append(...n);
  if (kind === 'recordset') {
    const rs = v as RecordsetValue;
    const n = rs.count ?? rs.ids.length;
    let names = rs.names;
    if (!snapshot && !names && rs.ids.length) names = (await call<{ id: number; display_name: string }[]>(rs.$recordset, 'read', [rs.ids.slice(0, MAX_ROWS), ['display_name']]).catch(() => []))
      .map((x) => x.display_name);
    const rows = rs.ids.slice(0, MAX_ROWS).map((id, i) => ({ id, display_name: names?.[i] ?? '' }));
    head(pill(_t('recordset'), 'accent'), text(rs.$recordset, 'mono'), text(_t('%s records', n), 'muted'));
    const fields = snapshot ? null : await modelFields(rs.$recordset);
    if (rows.length) { r.body.append(table(rows, f, fields)); head(exportBar(rows, v)); }
    if (n > rows.length) r.body.append(text(_t('… and %s more', n - rows.length), 'muted'));
  } else if (kind === 'rows' || kind === 'table') {
    const model = kind === 'rows' ? (v as { $rows: string }).$rows : null;
    const rows = kind === 'rows' ? (v as { rows: Record<string, unknown>[] }).rows : (v as Record<string, unknown>[]);
    head(pill(model ? _t('rows of %s', model) : _t('table'), 'accent'), text(rows.length > MAX_ROWS ? _t('%s rows (first %s shown)', rows.length, MAX_ROWS) : _t('%s rows', rows.length), 'muted'));
    r.body.append(table(rows, f, model && !snapshot ? await modelFields(model) : null));
    head(exportBar(rows, v));
  } else if (kind === 'number' || kind === 'string' || kind === 'boolean' || kind === 'null' || kind === 'date' || kind === 'datetime') {
    r.body.append(big(v, kind, f));
  } else if (kind === 'list') {
    const list = v as unknown[];
    head(pill(_t('list'), 'accent'), text(_t('%s items', list.length), 'muted'));
    const scalars = list.every((x) => x === null || ['string', 'number', 'boolean'].includes(typeof x));
    if (scalars && list.length) {
      const rows = list.map((x) => ({ value: x }));
      r.body.append(table(rows, f, null));
      head(exportBar(rows, v));
    } else r.body.append(jsonView(v, 2));
  } else if (kind === 'dict') {
    const obj = v as Record<string, unknown>;
    head(pill(_t('dict'), 'accent'), text(_t('%s keys', Object.keys(obj).length), 'muted'));
    const { list } = tpl('facts', { list: HTMLDListElement }).refs;
    for (const [k, x] of Object.entries(obj)) {
      const fr = tpl('fact', { label: HTMLElement, value: HTMLElement }).refs;
      fr.label.textContent = k;
      const xk = kindOf(x);
      fr.value.append(xk === 'dict' || xk === 'list' || xk === 'table' || xk === 'rows' ? jsonView(x, 1) : cell(x, f, columnType(k, [x])));
      list.append(fr.label.parentElement!);
    }
    r.body.append(list);
  } else if (kind === 'bytes') {
    r.body.append(big(_t('%s bytes', (v as { $bytes: number }).$bytes), 'bytes', f));
  } else {
    r.body.append(pre(String((v as { $repr?: string }).$repr ?? JSON.stringify(v))));
  }
  r.body.append(details(_t('JSON'), pre(toJson(v))));
  if (!r.head.childElementCount) r.head.remove();
  return r.box;
}

/** A single value, big, with its kind under it. */
function big(v: unknown, kind: string, f: Fmt): HTMLElement {
  const r = tpl('big', { box: HTMLDivElement, value: HTMLSpanElement, kind: HTMLSpanElement }).refs;
  if (kind === 'number') { r.value.textContent = num(f, v as number); r.kind.textContent = Number.isInteger(v) ? 'int' : 'float'; }
  else if (kind === 'boolean') { r.value.textContent = v ? '✓ true' : '✗ false'; r.value.className = v ? 'sym yes' : 'sym no'; r.kind.textContent = 'bool'; }
  else if (kind === 'null') { r.value.textContent = 'null'; r.value.className = 'muted'; r.kind.textContent = _t('nothing'); }
  else if (kind === 'date') { const iso = (v as { $date: string }).$date; r.value.textContent = dateText(f, iso, false); r.kind.textContent = `date · ${iso}`; }
  else if (kind === 'datetime') { const iso = (v as { $datetime: string }).$datetime; r.value.textContent = dateText(f, iso, true); r.kind.textContent = `datetime · ${iso} UTC`; }
  else if (kind === 'string') {
    const s = v as string;
    if (s.includes('\n') || s.length > 120) { const { text: t } = tpl('text-block', { text: HTMLPreElement }).refs; t.textContent = s; r.value.append(t); }
    else r.value.textContent = s;
    r.kind.textContent = _t('text · %s characters', s.length);
  } else { r.value.textContent = String(v); r.kind.textContent = kind; }
  return r.box;
}

/** One print(…) line: its values side by side, each as what it is (a text as it is, like Python's print). */
function printLine(values: readonly unknown[], f: Fmt): HTMLElement {
  const { line } = tpl('print-line', { line: HTMLDivElement }).refs;
  for (const [i, v] of values.entries()) {
    if (i) line.append(' ');
    const k = kindOf(v);
    line.append(typeof v === 'string' ? text(v) : k === 'dict' || k === 'list' || k === 'table' || k === 'rows' ? jsonView(v, 0) : cell(v, f, columnType('', [v])));
  }
  return line;
}

export interface ResultOptions { lang: Lang; refreshed?: { ok: true } | { error: string } | null; goToLine?(line: number): void; snapshot?: boolean }

/** The whole result of a run. */
export async function resultView(r: RunResult, f: Fmt, o: ResultOptions): Promise<Node[]> {
  const stats = callStats(r.calls);
  const head = tpl('result-head', { head: HTMLDivElement }).refs.head;
  head.append(r.ok ? pill(_t('ok'), 'ok') : pill(_t('error'), 'err'), pill(o.lang === 'python' ? 'Python' : 'JavaScript'),
    r.mode === 'read' ? pill(_t('read-only')) : r.mode === 'dry' ? pill(_t('dry run'), 'info') : pill(_t('writes committed'), 'med'),
    text(_t('%s ms', r.ms), 'ms'));
  if (o.lang === 'js') head.append(text(_t('%s calls', stats.total), 'ms'));
  if (stats.held) head.append(pill(_t('%s writes not sent', stats.held), 'info'));
  else if (stats.writes) head.append(pill(_t('%s write calls', stats.writes), 'med'));
  if (o.refreshed) head.append('ok' in o.refreshed ? pill(_t('page refreshed'), 'info') : tip(pill(_t('page not refreshed')), _t(o.refreshed.error)));
  const parts: Node[] = [head];
  if (r.mode === 'dry' && (o.lang === 'python' || stats.held)) {
    parts.push(text(o.lang === 'python'
      ? _t('Dry run: the code really ran, then all its changes were rolled back.')
      : _t('Dry run: the writes below were not sent; later reads show the old values.'), 'muted dry-note'));
  }
  if (r.out.length) {
    const { box: prints } = tpl('prints', { box: HTMLDivElement }).refs;
    for (const line of r.out) prints.append(printLine(line, f));
    parts.push(prints);
  }
  if (!r.ok && r.error) parts.push(errorView(r, o));
  else if (r.hasValue) parts.push(await valueView(r.value, f, o.snapshot));
  else parts.push(text(_t('No return value: end with return … to see one.'), 'muted'));
  if (r.calls.length) parts.push(callList(r.calls));
  return parts;
}

function errorView(r: RunResult, o: ResultOptions): HTMLElement {
  const e = r.error!;
  const message = e.msgid ? _t(e.msgid, ...e.args) : e.message;
  const out = box(errBox({ message: `${e.type ? `${e.type.split('.').pop()}: ` : ''}${message}`, traceback: e.traceback || undefined }));
  if (e.line) out.append(row(text(_t('Line %s', e.line), 'muted'), o.goToLine ? button(_t('Go to Line'), () => o.goToLine!(e.line!), 'chip') : null));
  if (e.name === 'EvalError') out.append(text(_t('Blocked by this page\'s Content-Security-Policy: check script-src on the proxy in front of Odoo.'), 'muted'));
  if (o.lang === 'python' && r.mode === 'write') out.append(text(_t('Nothing was saved: the error rolled back all changes.'), 'muted'));
  return out;
}

function callList(calls: RunResult['calls']): HTMLElement {
  const lines = calls.map((c) => {
    const l = row(text(`${c.model}.${c.method}`, 'name grow'), c.dry ? pill(_t('not sent'), 'info') : c.write ? pill(_t('write'), 'med') : null,
      c.error ? pill(_t('error'), 'err') : null, text(_t('%s ms', c.ms), 'ms'));
    return box(l, text(`args ${c.args} · kwargs ${c.kwargs}`, 'meta mono'), c.error ? text(c.error, 'meta error') : null);
  });
  const d = details(_t('Calls (%s)', calls.length), ...lines);
  d.classList.add('calls');
  return d;
}
