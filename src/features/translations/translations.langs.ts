// Translations tab, view "Languages": every language as a table — active, yours, how many internal users use it — and
// what to do with it: Activate (base.language.install: its terms loaded for every installed module), Update (the same
// with "overwrite": the terms changed in the database replaced by the modules' .po), Use (your own language, to see
// the screens in it; the page reloads, "Back to …" switches back). Only the active ones show until the filter
// searches them all. Activating and updating need Settings rights.
import { exec } from '../../extension/run-in-tab.ts';
import { _t } from '../../i18n/i18n.ts';
import { pageReload } from '../../injected/navigation.ts';
import { fill, filterBox } from '../../ui/cards.ts';
import { errBox } from '../../ui/components.ts';
import { filterMatrix, matrix, type MxRow } from '../../ui/matrix.ts';
import { frag, note } from '../../ui/parts.ts';
import { installLang, myLang, setMyLang, usersPerLang, type Lang } from './translations.data.ts';
import type { TranslationsCtx } from './translations.state.ts';
import { box, button, row, tpl } from './translations.ui.ts';

const PREVIOUS = 'odoo-debug-previous-lang'; // sessionStorage: survives the page reload "Use" causes

const previous = () => { try { return sessionStorage.getItem(PREVIOUS); } catch { return null; } };
const remember = (code: string | null) => { try { if (code) sessionStorage.setItem(PREVIOUS, code); else sessionStorage.removeItem(PREVIOUS); } catch { /* storage off */ } };

export function langsView(body: HTMLElement, c: TranslationsCtx) {
  fill(body, async () => {
    const [langs, mine] = await Promise.all([c.langs, myLang()]);
    const active = langs.filter((l) => l.active);
    const users = await usersPerLang(active.map((l) => l.code));
    const count = new Map(active.map((l, i) => [l.code, users[i]]));
    const out = box();
    const act = async (what: () => Promise<unknown>, then: () => void) => {
      out.replaceChildren(note(_t('Working… (loading terms can take a minute)')));
      try { await what(); then(); } catch (e) { out.replaceChildren(errBox(e)); }
    };
    const use = (l: Lang) => {
      if (!confirm(_t('Switch your language to %s? The page reloads.', l.name))) return;
      remember(previous() ?? mine);
      void act(() => setMyLang(l.code), () => void exec(pageReload));
    };
    const rows: MxRow[] = langs.map((l) => ({
      label: [l.name],
      sub: l.code,
      q: `${l.name} ${l.code}`,
      tags: l.active ? ['active'] : [],
      kind: l.active ? undefined : 'off',
      cells: [
        { v: l.active ? true : 'na', title: l.active ? _t('Active') : _t('Not active') },
        { v: l.code === mine ? true : 'na', title: l.code === mine ? _t('Your language') : _t('Not your language') },
        l.active ? String(count.get(l.code) ?? '?') : '',
        row(...(l.active
          ? [button(_t('Update'), () => { if (confirm(_t('Reload the translations of %s from the modules\' .po, replacing the ones changed in the database?', l.name))) void act(() => installLang(l.id, true), c.rerender); }, 'chip',
              _t('Load the modules\' translations again, replacing the ones changed in the database')),
            ...(l.code === mine ? [] : [button(_t('Use'), () => use(l), 'chip', _t('Make it your language and reload the page'))])]
          : [button(_t('Activate'), () => { if (confirm(_t('Activate %s and load its translations for every installed module?', l.name))) void act(() => installLang(l.id, false), c.rerender); }, 'chip')])),
      ],
    }));
    const table = matrix(_t('Language'), [_t('Active'), _t('Yours'), _t('Users'), ''], [{ rows }]);
    const { bar } = tpl('toolbar', { bar: HTMLDivElement }).refs;
    const { text: shown } = tpl('count', { text: HTMLSpanElement }).refs;
    const f = filterBox([], _t('Find a language to activate…'));
    const apply = () => {
      const q = f.input.value.trim();
      const n = filterMatrix(table, q, (r) => !!q || (r.dataset.tags ?? '') === 'active');
      shown.textContent = q ? _t('%s languages found', n) : _t('%s active languages', n);
    };
    f.input.addEventListener('input', apply);
    bar.append(f.input, shown);
    apply();
    const back = previous();
    const banner = back && back !== mine
      ? row(note(_t('You are seeing Odoo in %s.', mine)), button(_t('Back to %s', back), () => {
        remember(null);
        void act(() => setMyLang(back), () => void exec(pageReload));
      }, 'chip'))
      : null;
    if (back === mine) remember(null);
    const legend = note(_t('Users: internal users with this language. Update reloads the terms from the modules (what a module upgrade does).'));
    legend.classList.add('legend');
    return frag(banner, bar, table, legend, out);
  });
}
