// Translations tab: what it reads and writes on the server. Field translations: get_field_translations /
// update_field_translations (the record's read / write rights). Views: ir.ui.view (Settings). Export, import, language
// install: base's wizards (Settings). Code translations: the webclient's route (public). Same in 18.0 and 19.0 but the
// route (odoo/adapter.ts → i18n).
import type { Json } from '../../contracts/json.ts';
import { cached } from '../../extension/page-cache.ts';
import { exec, isExecError } from '../../extension/run-in-tab.ts';
import { pageFetch } from '../../injected/json-rpc.ts';
import type { OdooAdapter } from '../../odoo/adapter.ts';
import type { Many2one } from '../../odoo/models.ts';
import { sessionInfo } from '../../odoo/reads.ts';
import { call } from '../../odoo/rpc.ts';
import { b64ToBytes, gunzip, untar, type FieldTranslation, type WebTerms } from './translations.logic.ts';

export interface Lang { id: number; code: string; name: string; active: boolean }

/** Every language, active ones first. Not cached: activating one is done here. */
export const readLangs = () => call<Lang[]>('res.lang', 'search_read', [[['active', 'in', [true, false]]]],
  { fields: ['code', 'name', 'active'], order: 'active desc, name' });

/** The logged-in user's language. */
export const myLang = async () => String((await sessionInfo()).user_context.lang ?? 'en_US');

export interface TranslatableField { name: string; string: string; type: string }

/** The model's translated fields (fields_get's `translate`), by label. */
export async function translatableFields(model: string): Promise<TranslatableField[]> {
  const fields = await cached(`translatable ${model}`, () => call<Record<string, { string: string; type: string; translate?: unknown }>>(model, 'fields_get', [],
    { attributes: ['string', 'type', 'translate'] }));
  return Object.entries(fields).filter(([, f]) => f.translate).map(([name, f]) => ({ name, string: f.string, type: f.type }))
    .sort((a, b) => a.string.localeCompare(b.string));
}

/** One field's translations in `langs`: per language (whole value) or per term (html / xml); `byTerm` says which. */
export async function fieldTranslations(model: string, id: number, field: string, langs: readonly string[]) {
  const [list, ctx] = await call<[FieldTranslation[], { translation_show_source?: boolean }]>(model, 'get_field_translations', [[id], field], { langs: [...langs] });
  return { list, byTerm: !!ctx.translation_show_source };
}

/** Writes translations: { lang: value } for a field translated whole (false: back to the en_US value),
 * { lang: { source term: translation } } for one translated by terms. */
export const updateTranslations = (model: string, id: number, field: string, translations: Json) =>
  call(model, 'update_field_translations', [[id], field, translations]);

/** The webclient's code translations in `lang`, per module (what _t() shows); cached per page load. */
export function webTerms(a: OdooAdapter, lang: string): Promise<WebTerms> {
  return cached(`web terms ${lang}`, async () => {
    const path = `${a.i18n.webTranslationsPath.replace('{unique}', String(Date.now()))}?lang=${encodeURIComponent(lang)}`;
    const r = await exec(pageFetch, path);
    if (!r || isExecError(r) || 'error' in r) throw new Error(r && 'error' in r ? String(r.error) : 'no answer');
    return ((JSON.parse(r.text) as { modules?: WebTerms }).modules) ?? {};
  });
}

export interface ViewRow { id: number; name: string; xml_id: string | false; inherit_id: Many2one; mode: string; active: boolean }
const VIEW_FIELDS = ['name', 'xml_id', 'inherit_id', 'mode', 'active'];

/** The views building the screen's view: the one shown (its id, else get_views' answer), what it inherits from, and
 * every active view extending them (Settings rights: ir.ui.view). */
export async function viewsOf(model: string, viewType: string, viewId: number | false): Promise<ViewRow[]> {
  let id = viewId;
  if (!id) {
    const r = await call<{ views: Record<string, { id: number }> }>(model, 'get_views', [], { views: [[false, viewType]] });
    id = r.views[viewType]?.id ?? false;
  }
  if (!id) return [];
  const read = (ids: number[]) => call<ViewRow[]>('ir.ui.view', 'read', [ids, VIEW_FIELDS], { context: { active_test: false } });
  const byId = new Map<number, ViewRow>();
  // up: what it inherits from (a primary view built on another)
  for (let next: number | false = id; next && !byId.has(next);) {
    const [v] = await read([next]);
    if (!v) break;
    byId.set(v.id, v);
    next = v.inherit_id ? v.inherit_id[0] : false;
  }
  // down: every active extension, level by level
  let level = [...byId.keys()];
  for (let depth = 0; level.length && depth < 20; depth++) {
    const kids = await call<ViewRow[]>('ir.ui.view', 'search_read', [[['inherit_id', 'in', level], ['mode', '=', 'extension']]], { fields: VIEW_FIELDS });
    level = kids.filter((k) => !byId.has(k.id)).map((k) => (byId.set(k.id, k), k.id));
  }
  return [...byId.values()];
}

/** The terms of a view's arch, per language ('' when missing). */
export const viewTerms = (id: number, langs: readonly string[]) =>
  call<[FieldTranslation[], unknown]>('ir.ui.view', 'get_field_translations', [[id], 'arch_db'], { langs: [...langs] }).then(([list]) => list);

export interface ModuleRow { id: number; name: string; shortdesc: string }

/** One export run (base.language.export, tgz: one <module>/i18n/<lang>.po per module) → its files. 19 gives no file
 * for a module without terms. */
export async function exportPo(moduleIds: readonly number[], lang: string): Promise<{ name: string; data: Uint8Array }[]> {
  const id = await call<number>('base.language.export', 'create', [{ lang, format: 'tgz', modules: [[6, 0, [...moduleIds]]] }]);
  await call('base.language.export', 'act_getfile', [[id]]);
  const [row] = await call<{ data: string | { content: string } | false }[]>('base.language.export', 'read', [[id], ['data']]);
  const b64 = typeof row?.data === 'object' ? row.data.content : row?.data; // 20 reads a binary as { content, size, filename? }
  return b64 ? untar(await gunzip(b64ToBytes(b64))) : [];
}

/** Loads a .po into the database (base.language.import): its terms in `lang`, replacing existing ones if asked. */
export async function importPo(lang: Lang, filename: string, base64: string, overwrite: boolean) {
  const id = await call<number>('base.language.import', 'create', [{ name: lang.name, code: lang.code, filename, data: base64, overwrite }]);
  await call('base.language.import', 'import_lang', [[id]]);
}

/** Activates a language and loads its terms for every installed module (base.language.install); `overwrite`: the
 * terms changed in the database are replaced too ("update the translations"). */
export async function installLang(langId: number, overwrite: boolean) {
  const id = await call<number>('base.language.install', 'create', [{ lang_ids: [[6, 0, [langId]]], overwrite }]);
  await call('base.language.install', 'lang_install', [[id]]);
}

/** How many active users use each language. */
export const usersPerLang = (codes: readonly string[]) => Promise.all(codes.map((code) =>
  call<number>('res.users', 'search_count', [[['lang', '=', code], ['share', '=', false]]]).catch(() => null)));

/** Your own language (a preference every user may change). */
export const setMyLang = async (code: string) => call('res.users', 'write', [[(await sessionInfo()).uid], { lang: code }]);

/** Menus named `text` (in your language), with their name in English. */
export async function menusNamed(text: string): Promise<{ id: number; complete_name: string; en: string }[]> {
  const rows = await call<{ id: number; complete_name: string }[]>('ir.ui.menu', 'search_read', [[['name', '=', text]]], { fields: ['complete_name'], limit: 10 }).catch(() => []);
  if (!rows.length) return [];
  const en = await call<{ id: number; name: string }[]>('ir.ui.menu', 'read', [rows.map((r) => r.id), ['name']], { context: { lang: 'en_US' } }).catch(() => []);
  return rows.map((r) => ({ ...r, en: en.find((e) => e.id === r.id)?.name ?? '' }));
}

/** fields_get of `model` in a language: field labels and selection labels. */
export const fieldLabels = (model: string, lang: string) => call<Record<string, { string: string; selection?: [string, string][] }>>(model, 'fields_get', [],
  { attributes: ['string', 'selection'], context: { lang } });

/** Saves bytes as Downloads/<path> (sub-folders included), replacing the file of a previous export. */
export async function download(path: string, bytes: Uint8Array) {
  // not text/plain: Chrome would rename vi_VN.po to vi_VN.txt
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/octet-stream' }));
  try {
    await chrome.downloads.download({ url, filename: path, conflictAction: 'overwrite', saveAs: false });
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 60_000); // the download reads the blob after the call returns
  }
}
