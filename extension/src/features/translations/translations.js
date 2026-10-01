// Translations tab: activates / updates languages (Odoo's Add Languages wizard: activate + load the terms), and exports
// the .pot template + the .po of each language for several apps with Odoo's export wizard, downloading every file
// straight to Downloads/<module>/i18n/ (<module>.pot, <lang>.po): nothing to unpack.
import { NEW_LANG, resolveLangs, resolveModules, b64ToBytes, gunzip, untar } from './logic.js';
import { call, cached, uncache, sessionInfo, installedModules } from '../../shared/bridge.js';
import { el, pill, empty, block, card, errBox, formValues, saveForm } from '../../shared/ui.js';
import { splitList } from '../../shared/list.js';
import { modulePicker } from '../../shared/picker.js';
import { _t } from '../../shared/i18n.js';

let done = null; // outcome of the last Activate / Update, shown again once the tab re-rendered with the new active languages

/** "Active: en_US vi_VN…": each code toggles in `input` (a ;-separated list), lit while it is there; then onChange(). */
function activeChips(langs, input, onChange) {
  const typed = () => splitList(input.value);
  const has = (code) => typed().some((c) => c.toLowerCase() === code.toLowerCase());
  const chips = langs.map((l) => el('button', {
    type: 'button', class: 'chip', title: l.name,
    onclick: () => {
      input.value = (has(l.code) ? typed().filter((c) => c.toLowerCase() !== l.code.toLowerCase()) : [...typed(), l.code]).join('; ');
      sync();
      onChange();
      input.focus();
    },
  }, l.code));
  const sync = () => { for (const [i, l] of langs.entries()) chips[i].setAttribute('aria-pressed', String(has(l.code))); };
  input.addEventListener('input', sync);
  sync();
  return el('div', { class: 'row mt langs' }, el('span', { class: 'muted' }, _t('Active:')), chips);
}

export function renderTranslations(s) {
  block(s, 'add-langs', _t('Activate / Update Languages'), async () => {
    if (!(await sessionInfo()).is_system) return empty(_t('Needs Settings rights (base.group_system).')); // the wizard's ACL
    const all = await call('res.lang', 'search_read', [[]], { fields: ['code', 'name', 'active'], order: 'code', context: { active_test: false } });
    const input = el('input', { type: 'text', placeholder: 'fr_BE; de_DE', value: formValues('translations-add').langs || '', spellcheck: false });
    const keep = () => saveForm('translations-add', { langs: input.value });
    input.addEventListener('input', keep);
    const overwrite = el('input', { type: 'checkbox', checked: true }); // the wizard's default
    const btn = el('button', { class: 'btn', type: 'submit' }, _t('Activate / Update'));
    const log = el('ul', { class: 'steps' }, done && el('li', { class: 'row' }, el('span', { class: 'grow' }, done), pill('✓', 'ok')));
    done = null;
    const form = el('form', { class: 'form' },
      el('label', {}, _t('Languages'), input),
      activeChips(all.filter((l) => l.active), input, keep),
      el('div', { class: 'note' }, _t('Language codes, separated by ;. Inactive ones are activated, then every one gets the terms of the installed apps.')),
      el('label', { class: 'check mt' }, overwrite, _t('Overwrite Existing Terms')),
      el('div', { class: 'note' }, _t('If you check this box, your customized translations will be overwritten and replaced by the official ones.')),
      el('div', { class: 'row mt fill' }, btn),
      log);
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      log.replaceChildren();
      let status = null;
      try {
        const { codes, unknown } = resolveLangs(splitList(input.value), all.map((l) => l.code));
        if (unknown.length) throw new Error(_t('Unknown language: %s', unknown.join(', ')));
        if (!codes.length) throw new Error(_t('Enter at least one language.'));
        btn.disabled = true;
        const langs = codes.map((c) => all.find((l) => l.code === c));
        const toActivate = langs.filter((l) => !l.active).map((l) => l.code), toUpdate = langs.filter((l) => l.active).map((l) => l.code);
        const what = [toActivate.length && _t('activate %s', toActivate.join(', ')), toUpdate.length && _t('update %s', toUpdate.join(', '))].filter(Boolean).join(' · ');
        status = el('span', { class: 'muted' }, _t('Running…'));
        log.append(el('li', { class: 'row' }, el('span', { class: 'grow' }, what), status));
        const id = await call('base.language.install', 'create', [{ lang_ids: [[6, 0, langs.map((l) => l.id)]], overwrite: overwrite.checked }]);
        await call('base.language.install', 'lang_install', [[id]]);
        done = what;
        saveForm('translations-add', {});
        uncache('active langs');
        s.replaceChildren(); // the export below lists the active languages: draw the tab again
        renderTranslations(s);
      } catch (e) {
        status?.replaceWith(pill(_t('error'), 'err'));
        log.append(el('li', {}, errBox(e)));
        btn.disabled = false;
      }
    });
    return el('div', { class: 'pad' }, form);
  });

  card(s, async () => { // the export, what the tab is for: no title to open it by
    const langs = await cached('active langs', () => call('res.lang', 'search_read', [[['active', '=', true]]], { fields: ['code', 'name'], order: 'code' }));
    const last = formValues('translations');
    const apps = el('input', { type: 'text', placeholder: _t('Search or type: sale; stock; my_module'), 'aria-label': _t('Apps To Export'), value: last.apps || '', spellcheck: false });
    // Languages: the active ones as toggles (the wizard exports nothing else), the last choice kept
    const picked = new Set(resolveLangs(splitList(last.langs), langs.map((l) => l.code)).codes);
    const save = () => saveForm('translations', { apps: apps.value, langs: [...picked].join('; ') });
    const count = el('span', { class: 'muted count-note' }); // how many installed modules match what is typed
    const btn = el('button', { class: 'btn', type: 'submit' });
    const summary = () => { // what the button will download: every app gets the template + one .po per language
      const files = splitList(apps.value).length * (picked.size + 1);
      btn.textContent = !files ? _t('Export & Download') : files === 1 ? _t('Export & Download · 1 file') : _t('Export & Download · %s files', files);
    };
    const chip = (l) => {
      const b = el('button', { type: 'button', class: 'chip', title: l.name, 'aria-pressed': String(picked.has(l.code)) }, l.code);
      b.addEventListener('click', () => {
        if (picked.has(l.code)) picked.delete(l.code); else picked.add(l.code);
        b.setAttribute('aria-pressed', String(picked.has(l.code)));
        save();
        summary();
      });
      return b;
    };
    const log = el('ul', { class: 'steps' });
    const form = el('form', { class: 'form' },
      el('div', { class: 'row picker-head' }, apps, count), // no label: the placeholder and aria-label say what it is
      // no read access to ir.module.module: typing the names still works
      await installedModules().then(
        (mods) => modulePicker(apps, mods, { countEl: count, count: (n, total) => _t('%s/%s installed modules', n, total) }),
        () => el('div', { class: 'note' }, _t('Technical names, separated by ;'))),
      el('div', { class: 'row mt langs' }, el('span', { class: 'muted' }, _t('Languages:')),
        el('button', { type: 'button', class: 'chip', 'aria-pressed': 'true', disabled: true, title: _t('Always exported: the empty template, as <module>.pot') }, _t('Template (.pot)')),
        [...langs].sort((a, b) => picked.has(b.code) - picked.has(a.code)).map(chip)), // the chosen ones first, in sight
      el('div', { class: 'row mt fill' }, btn),
      log);
    apps.addEventListener('input', () => { save(); summary(); }); // kept as typed: Activate / Update redraws the tab
    summary();
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      save();
      btn.disabled = true;
      log.replaceChildren();
      try {
        await exportAll(splitList(apps.value), [...picked], langs.map((l) => l.code), log);
      } catch (e) {
        log.append(el('li', {}, errBox(e)));
      } finally {
        btn.disabled = false;
      }
    });
    return el('div', { class: 'pad' }, form);
  });
}

/** One base.language.export run per language (template first); each file of its .tgz is downloaded on its own. */
async function exportAll(appNames, langNames, active, log) {
  if (!appNames.length) throw new Error(_t('Enter at least one app.'));
  const { codes, unknown } = resolveLangs(langNames, active);
  if (unknown.length) throw new Error(_t('Not an active language: %s. Active: %s', unknown.join(', '), active.join(', ')));
  const rows = await call('ir.module.module', 'search_read', [[['name', 'in', appNames]]], { fields: ['name', 'state'] });
  const { ids, missing, notInstalled } = resolveModules(appNames, rows);
  if (missing.length) throw new Error(_t('Unknown app: %s', missing.join(', ')));
  if (notInstalled.length) throw new Error(_t('Not installed: %s', notInstalled.join(', ')));

  for (const lang of [NEW_LANG, ...codes]) {
    const status = el('span', { class: 'muted' }, _t('Exporting…'));
    const files = el('div', { class: 'meta mono' });
    log.append(el('li', {}, el('div', { class: 'row' },
      el('span', { class: 'name' }, lang === NEW_LANG ? _t('Template (.pot)') : lang), el('span', { class: 'grow' }), status), files));
    try {
      // format tgz: one <module>/i18n/<lang>.po per app (format po would merge every app into a single file)
      const id = await call('base.language.export', 'create', [{ lang, format: 'tgz', modules: [[6, 0, ids]] }]);
      await call('base.language.export', 'act_getfile', [[id]]);
      const [{ data }] = await call('base.language.export', 'read', [[id], ['data']]);
      const entries = data ? untar(await gunzip(b64ToBytes(data))) : []; // 19: no term → no file
      for (const f of entries) await download(f.name, f.data);
      files.textContent = entries.map((f) => f.name).join('\n');
      status.replaceWith(entries.length ? pill(_t('%s files', entries.length), 'ok') : pill(_t('nothing to export')));
    } catch (e) {
      status.replaceWith(pill(_t('error'), 'err'));
      files.replaceWith(errBox(e));
    }
  }
}

/** Saves bytes as Downloads/<path> (sub-folders included), replacing the file of a previous export. */
async function download(path, bytes) {
  // not text/plain: Chrome would then rename vi_VN.po to vi_VN.txt
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }));
  try {
    await chrome.downloads.download({ url, filename: path, conflictAction: 'overwrite', saveAs: false });
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 60_000); // the download reads the blob after the call returns
  }
}
