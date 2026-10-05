// Translations tab, view "Modules (.po)": chosen modules × the template and the languages chosen, with Odoo's own
// export (base.language.export, tgz: one <module>/i18n/<lang>.po per module). "Check coverage" reads each .po: the
// terms, how many are translated, missing, fuzzy; a module opens the missing ones per language. "Download" saves every
// file to Downloads/<module>/i18n/ (<module>.pot, <lang>.po). Below, a .po imported into the database
// (base.language.import), to try it without upgrading the module. Settings rights (base.group_system).
import { _t } from '../../i18n/i18n.ts';
import type { IrModule } from '../../odoo/models.ts';
import { installedModules } from '../../odoo/reads.ts';
import { fill } from '../../ui/cards.ts';
import { errBox, pill } from '../../ui/components.ts';
import { formValues, saveForm } from '../../ui/form-state.ts';
import { matrix, type MxRow } from '../../ui/matrix.ts';
import { frag, note } from '../../ui/parts.ts';
import { tip } from '../../ui/tooltip.ts';
import { download, exportPo, importPo, type Lang } from './translations.data.ts';
import { bytesToB64, NEW_LANG, parsePo, poPath, poStats, type PoEntry, type PoStats } from './translations.logic.ts';
import type { TranslationsCtx } from './translations.state.ts';
import { box, button, plainList, row, text, title, tpl } from './translations.ui.ts';

const FORM = 'translations';
const SHOWN_MISSING = 40;

/** The last export, kept for Download after Check coverage (same modules and languages). */
let last: { key: string; files: { name: string; data: Uint8Array }[] } | null = null;

export function modulesView(body: HTMLElement, c: TranslationsCtx) {
  fill(body, async () => {
    const [mods, langs] = await Promise.all([installedModules().catch(() => null), c.langs]);
    if (!mods) return note(_t('Exporting translations needs Settings rights (base.group_system).'));
    const active = langs.filter((l) => l.active && l.code !== 'en_US');
    const saved = formValues<{ modules: string[]; langs: string[] }>(FORM);
    const chosen = new Set((saved.modules ?? []).filter((m) => mods.some((x) => x.name === m)));
    const picked = new Set((saved.langs ?? active.map((l) => l.code)).filter((l) => active.some((x) => x.code === l)));
    const save = () => saveForm(FORM, { modules: [...chosen], langs: [...picked] });

    const results = box();
    const picker = modulePicker(mods, chosen, () => { save(); results.replaceChildren(); });
    const langChips = row(tip(pill(_t('Template (.pot)'), 'accent'), _t('Always exported: the empty template, <module>.pot')),
      ...active.map((l) => {
        const b = button(l.code, () => {
          if (picked.has(l.code)) picked.delete(l.code); else picked.add(l.code);
          b.setAttribute('aria-pressed', String(picked.has(l.code)));
          save();
        }, 'chip', l.name);
        b.setAttribute('aria-pressed', String(picked.has(l.code)));
        return b;
      }));
    const run = (then: 'check' | 'download') => fill(results, async () => {
      if (!chosen.size) return note(_t('Add at least one module.'));
      const ids = mods.filter((m) => chosen.has(m.name)).map((m) => m.id);
      const codes = [NEW_LANG, ...active.map((l) => l.code).filter((l) => picked.has(l))];
      const key = `${[...chosen].sort().join()}|${codes.join()}`;
      if (last?.key !== key) {
        const files: { name: string; data: Uint8Array }[] = [];
        for (const lang of codes) files.push(...await exportPo(ids, lang));
        last = { key, files };
      }
      if (then === 'download') {
        for (const f of last.files) await download(f.name, f.data);
        return frag(note(_t('%s files saved to Downloads/<module>/i18n/.', last.files.length)), plainList(last.files.map((f) => f.name)));
      }
      return coverage(last.files, [...chosen].sort(), codes);
    });
    const actions = row(button(_t('Check Coverage'), () => run('check')), button(_t('Download .pot / .po'), () => run('download')),
      tip(pill(_t('Odoo\'s export wizard: one run per language'), ''), _t('base.language.export, tgz')));
    return frag(title(_t('Modules')), picker, title(_t('Languages')), langChips, actions, results,
      title(_t('Import a .po into the database')), importForm(active));
  });
}

/** Search the installed modules (name or title), click to add; the chosen ones as chips (× removes). */
function modulePicker(mods: IrModule[], chosen: Set<string>, changed: () => void): HTMLElement {
  const r = tpl('module-picker', { root: HTMLDivElement, input: HTMLInputElement, list: HTMLUListElement, chips: HTMLDivElement }).refs;
  const drawChips = () => r.chips.replaceChildren(...[...chosen].sort().map((name) => button(`${name} ×`, () => { chosen.delete(name); drawChips(); changed(); }, 'chip', _t('Remove'))),
    ...(chosen.size ? [] : [text(_t('No module yet.'), 'muted')]));
  const search = () => {
    const q = r.input.value.trim().toLowerCase();
    const found = q ? mods.filter((m) => !chosen.has(m.name) && `${m.name} ${m.shortdesc}`.toLowerCase().includes(q)).slice(0, 20) : [];
    r.list.replaceChildren(...found.map((m) => {
      const it = tpl('suggest-item', { item: HTMLLIElement, name: HTMLSpanElement, meta: HTMLSpanElement }).refs;
      it.name.textContent = m.name;
      it.meta.textContent = m.shortdesc;
      it.item.addEventListener('mousedown', (e) => { e.preventDefault(); chosen.add(m.name); r.input.value = ''; r.list.hidden = true; drawChips(); changed(); });
      return it.item;
    }));
    r.list.hidden = !found.length;
  };
  r.input.addEventListener('input', search);
  r.input.addEventListener('blur', () => { r.list.hidden = true; });
  r.input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const exact = mods.find((m) => m.name === r.input.value.trim());
    if (exact) { chosen.add(exact.name); r.input.value = ''; r.list.hidden = true; drawChips(); changed(); }
  });
  drawChips();
  return r.root;
}

/** Module × language: the template's terms, then per language the share translated, missing ones on opening. */
function coverage(files: { name: string; data: Uint8Array }[], modules: string[], codes: string[]): Node {
  const byModule = new Map<string, Map<string, { stats: PoStats; entries: PoEntry[] }>>();
  for (const f of files) {
    const p = poPath(f.name);
    if (!p) continue;
    const entries = parsePo(new TextDecoder().decode(f.data));
    const m = byModule.get(p.module) ?? new Map();
    m.set(p.lang, { stats: poStats(entries), entries });
    byModule.set(p.module, m);
  }
  const langs = codes.filter((l) => l !== NEW_LANG);
  const rows: MxRow[] = modules.map((name) => {
    const m = byModule.get(name);
    const total = m?.get(NEW_LANG)?.stats.total ?? 0;
    return {
      label: [name],
      cells: [total ? _t('%s terms', total) : '—', ...langs.map((l) => cell(m?.get(l)?.stats, total))],
      detail: () => missing(m, langs),
    };
  });
  const legend = note(_t('Share of the template\'s terms translated in each language; fuzzy ones count as not translated. Click a module for the missing terms.'));
  legend.classList.add('legend');
  return frag(matrix(_t('Module'), [_t('Template'), ...langs], [{ rows }], -1, true), legend);
}

function cell(s: PoStats | undefined, total: number): Node | string {
  if (!total) return '—';
  if (!s) return text(_t('no file'), 'muted');
  const pct = Math.floor((s.translated / total) * 100);
  const t = text(`${pct}%${s.missing + s.fuzzy ? ` · ${s.missing + s.fuzzy} ✗` : ''}`, pct === 100 ? 'cov-full' : pct >= 80 ? 'cov-good' : 'cov-low');
  return tip(t, _t('%s translated, %s missing, %s fuzzy, of %s', s.translated, s.missing, s.fuzzy, total));
}

function missing(m: Map<string, { stats: PoStats; entries: PoEntry[] }> | undefined, langs: string[]): Node {
  const parts = langs.flatMap((l) => {
    const todo = (m?.get(l)?.entries ?? []).filter((e) => !e.msgstr || e.fuzzy);
    if (!todo.length) return [];
    const lines = todo.slice(0, SHOWN_MISSING).map((e) => `${e.fuzzy ? '(fuzzy) ' : ''}${e.msgid.replace(/\s+/g, ' ').slice(0, 160)}`);
    if (todo.length > SHOWN_MISSING) lines.push(_t('… and %s more', todo.length - SHOWN_MISSING));
    return [title(_t('Missing in %s (%s)', l, todo.length)), plainList(lines)];
  });
  return parts.length ? frag(...parts) : note(_t('Nothing missing.'));
}

/** A .po loaded into the database for a language (base.language.import), replacing what is there if asked. */
function importForm(active: Lang[]): HTMLElement {
  const r = tpl('import-form', { form: HTMLFormElement, file: HTMLInputElement, lang: HTMLSelectElement, overwrite: HTMLInputElement, go: HTMLButtonElement, out: HTMLDivElement }).refs;
  for (const l of active) {
    const { option } = tpl('option', { option: HTMLOptionElement }).refs;
    option.value = l.code;
    option.textContent = `${l.code} · ${l.name}`;
    r.lang.append(option);
  }
  r.file.addEventListener('change', () => { // vi_VN.po → vi_VN
    const code = r.file.files?.[0]?.name.replace(/\.pot?$/, '');
    if (code && active.some((l) => l.code === code)) r.lang.value = code;
  });
  r.form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const file = r.file.files?.[0];
    const lang = active.find((l) => l.code === r.lang.value);
    if (!file || !lang) { r.out.replaceChildren(note(_t('Choose a .po file and its language.'))); return; }
    if (!confirm(_t('Import %s into %s%s?', file.name, lang.name, r.overwrite.checked ? _t(', replacing the existing translations') : ''))) return;
    r.go.disabled = true;
    try {
      const terms = parsePo(await file.text()).length;
      await importPo(lang, file.name, bytesToB64(new Uint8Array(await file.arrayBuffer())), r.overwrite.checked);
      r.out.replaceChildren(note(_t('Imported: %s terms in %s. Reload the page to see them.', terms, lang.code)));
      last = null;
    } catch (err) {
      r.out.replaceChildren(errBox(err));
    } finally {
      r.go.disabled = false;
    }
  });
  return r.form;
}
