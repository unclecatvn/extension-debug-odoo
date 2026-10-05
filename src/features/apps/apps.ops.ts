// Apps tab: the module operations, step by step in a log (the Modules view's picked modules, or the module opened).
// Each refuses to start while modules wait for an operation: 19.0 would refuse it anyway, 18.0 and 20.0 would run the
// waiting ones along with it (odoo/adapter.ts → modules.refusesWhilePending). On success the Odoo page reloads.
import { _t } from '../../i18n/i18n.ts';
import type { OdooAdapter } from '../../odoo/adapter.ts';
import { call } from '../../odoo/rpc.ts';
import { immediate, openForms, readPending, reloadPage, updateList } from './apps.data.ts';
import { planInstall, planUpgrade, type InstallSim, type ModuleState } from './apps.logic.ts';
import type { StepLog } from './apps.ui.ts';

type Row = { id: number; name: string; state: ModuleState };
const readByNames = (names: readonly string[]) => call<Row[]>('ir.module.module', 'search_read', [[['name', 'in', [...names]]]], { fields: ['name', 'state'] });
const names = (list: readonly { name: string }[]) => list.map((m) => m.name).join(', ');

/** The Apps menu's form of a module: its breadcrumb leads back to Apps. */
export const formPath = (id: number) => `action-base.open_module_tree/${id}`;

/** Throws when modules wait for an operation, saying why that matters on this version. */
async function guardPending(a: OdooAdapter) {
  const waiting = await readPending();
  if (!waiting.length) return;
  const list = waiting.map((m) => `${m.name} (${m.state})`).join(', ');
  throw new Error(a.modules.refusesWhilePending
    ? _t('Modules are waiting for an operation: %s. Odoo refuses another one until they are applied or cancelled (Pending).', list)
    : _t('Modules are waiting for an operation: %s. Odoo %s would run them along with this one: apply or cancel them first (Pending).', list, a.major));
}

/** Runs `fn` with the log, a failure ending its current step; the buttons `lock` are disabled meanwhile. */
export async function run(log: StepLog, lock: readonly HTMLButtonElement[], fn: (begin: (label: string) => ReturnType<StepLog['step']>) => Promise<void>) {
  log.clear();
  for (const b of lock) b.disabled = true;
  const current: { step: ReturnType<StepLog['step']> | null } = { step: null };
  try {
    await fn((label) => (current.step = log.step(label)));
  } catch (e) {
    current.step?.fail();
    log.error(e);
  } finally {
    for (const b of lock) b.disabled = false;
  }
}

function reload(begin: (label: string) => ReturnType<StepLog['step']>) {
  begin(_t('Reloading the Odoo page…'));
  setTimeout(() => void reloadPage(), 800);
}

/** Update Apps List, then install every module with its dependencies (and the modules Odoo auto-installs with them,
 * as `simulate` predicts from the list read when the tab rendered). */
export async function activate(list: readonly string[], a: OdooAdapter, simulate: (names: readonly string[]) => InstallSim, begin: (label: string) => ReturnType<StepLog['step']>) {
  await guardPending(a);
  let st = begin(_t('Update Apps List'));
  const [updated, added] = await updateList();
  st.done(_t('%s updated · %s added', updated, added));
  const p = planInstall(list, await readByNames(list));
  if (p.missing.length) throw new Error(_t('Not found, even after Update Apps List: %s', p.missing.join(', ')));
  if (p.uninstallable.length) throw new Error(_t('Not installable: %s', names(p.uninstallable)));
  if (p.busy.length) throw new Error(_t('Waiting to be uninstalled: %s', names(p.busy)));
  if (p.installed.length) begin(_t('Already installed: %s', names(p.installed))).done();
  if (!p.install.length) return;
  const asked = new Set(p.install.map((m) => m.name));
  const sim = simulate([...asked]);
  const more = (reason: 'depends' | 'auto') => sim.brought.filter((b) => b.reason === reason && !asked.has(b.name)).map((b) => b.name).sort();
  if (more('depends').length) begin(_t('With its dependencies: %s', more('depends').join(', '))).done('+', 'med');
  if (more('auto').length) begin(_t('And auto-installed with them: %s', more('auto').join(', '))).done('+', 'med');
  st = begin(_t('Install %s', names(p.install)));
  await immediate('install', p.install.map((m) => m.id));
  st.done();
  reload(begin);
}

/** Upgrade every module (they must be installed). */
export async function upgrade(list: readonly string[], a: OdooAdapter, begin: (label: string) => ReturnType<StepLog['step']>) {
  await guardPending(a);
  const p = planUpgrade(list, await readByNames(list));
  if (p.missing.length) throw new Error(_t('Not found: %s', p.missing.join(', ')));
  if (p.notInstalled.length) throw new Error(_t('Not installed (use Activate): %s', names(p.notInstalled)));
  const st = begin(_t('Upgrade %s', names(p.upgrade)));
  await immediate('upgrade', p.upgrade.map((m) => m.id));
  st.done();
  reload(begin);
}

/** Uninstalls the module (and every module depending on it, as Odoo does). */
export async function uninstall(m: { id: number; name: string }, a: OdooAdapter, begin: (label: string) => ReturnType<StepLog['step']>) {
  await guardPending(a);
  const st = begin(_t('Uninstall %s', m.name));
  await immediate('uninstall', [m.id]);
  st.done();
  reload(begin);
}

/** Opens the form of every module in a new tab. */
export async function openModuleForms(list: readonly string[], origin: string, begin: (label: string) => ReturnType<StepLog['step']>) {
  const rows = await readByNames(list);
  const found = list.map((n) => rows.find((m) => m.name === n)).filter((m): m is Row => !!m);
  await openForms(origin, found.map((m) => formPath(m.id)));
  if (found.length) begin(_t('Opened %s tab(s): %s', found.length, names(found))).done();
  const missing = list.filter((n) => !rows.some((m) => m.name === n));
  if (missing.length) throw new Error(_t('Not found: %s (Activate runs Update Apps List first)', missing.join(', ')));
}
