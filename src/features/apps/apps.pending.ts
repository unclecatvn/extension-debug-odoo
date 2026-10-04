// Apps tab, view "Pending": the modules waiting for an operation (to install / to upgrade / to remove), usually left by
// an operation that failed or was started from the Apps menu without "Apply". Odoo runs them at its next module
// operation (18.0, 20.0: along with it; 19.0 refuses one until they are gone). Apply them now, or cancel them all: Odoo's
// "Apply Scheduled Upgrades" wizard (base.module.upgrade, same in 18.0 / 19.0 / 20.0).
import { _t } from '../../i18n/i18n.ts';
import { fill } from '../../ui/cards.ts';
import { frag, note } from '../../ui/parts.ts';
import { matrix, type MxRow } from '../../ui/matrix.ts';
import { reloadPage, scheduled } from './apps.data.ts';
import { pendingOf } from './apps.logic.ts';
import { run } from './apps.ops.ts';
import type { AppsCtx } from './apps.state.ts';
import { box, button, row, statePill, stepLog, tpl } from './apps.ui.ts';

export function pendingView(body: HTMLElement, c: AppsCtx) {
  fill(body, async () => {
    const pending = pendingOf(await c.modules);
    const why = note(c.a.modules.refusesWhilePending
      ? _t('Odoo refuses to install, upgrade or uninstall anything while modules wait ("Odoo is currently processing another module operation").')
      : _t('Odoo %s runs the waiting modules along with the next install, upgrade or uninstall: an install could also uninstall a module waiting here.', c.a.major));
    if (!pending.length) return frag(note(_t('No module is waiting for an operation.')), why);
    const rows: MxRow[] = pending.map((m) => ({ label: [m.shortdesc || m.name], sub: m.name, q: m.name, cells: [statePill(m.state)] }));
    const { log: ul } = tpl('steps', { log: HTMLUListElement }).refs;
    const log = stepLog(ul);
    const ops: HTMLButtonElement[] = [];
    const apply = button(_t('Apply Now'), () => {
      if (!confirm(_t('Run every waiting operation now?\n\n%s', pending.map((m) => `${m.name}: ${m.state}`).join('\n')))) return;
      void run(log, ops, async (begin) => {
        const st = begin(_t('Apply Scheduled Upgrades'));
        await scheduled('apply');
        st.done();
        begin(_t('Reloading the Odoo page…'));
        setTimeout(() => void reloadPage(), 800);
      });
    }, 'btn', _t('Odoo\'s Apply Scheduled Upgrades: installs, upgrades and uninstalls them'));
    const cancel = button(_t('Cancel All'), () => {
      if (!confirm(_t('Cancel every waiting operation? The modules go back to installed / not installed.'))) return;
      void run(log, ops, async (begin) => {
        const st = begin(_t('Cancel the waiting operations'));
        await scheduled('cancel');
        st.done();
        c.rerender();
      });
    }, 'btn', _t('Back to installed (to upgrade, to remove) or not installed (to install): nothing runs'));
    ops.push(apply, cancel);
    return box(why, matrix(_t('Module'), [_t('Waiting for')], [{ rows }]), row(apply, cancel), ul);
  });
}
