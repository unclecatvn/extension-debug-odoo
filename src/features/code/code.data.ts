// Code tab: running the code. JavaScript runs in the page (code.injected.ts) as the logged-in user. Python runs on the
// server through a temporary server action (ir.actions.server, state 'code', base/models/ir_actions.py, the same in
// 18.0 and 19.0): created, run with the screen as its active_model / active_id / active_ids — what a server action
// clicked on that screen gets as record / records / model — then deleted. Its code (code.logic.ts → pythonProgram)
// returns the value and the prints through `action`; a dry run rolls the transaction back before. Creating a server
// action with code needs Settings rights (base.group_system).
import { exec, isExecError } from '../../extension/run-in-tab.ts';
import { _t } from '../../i18n/i18n.ts';
import type { OdooAdapter } from '../../odoo/adapter.ts';
import { call, RpcError } from '../../odoo/rpc.ts';
import { cleanPythonError, pythonErrorLine, pythonProgram, pythonSyntaxError, type RunMode } from './code.logic.ts';
import { pageRunCode, pageSelectedIds, pageSoftReload, type RunOptions, type RunResult } from './code.injected.ts';

/** The screen the code runs on: the model, the record opened, the records selected. */
export interface Screen { model: string | null; resId: number | null; ids: number[] }

export async function screenOf(model: string | null | undefined, resId: number | null | undefined): Promise<Screen> {
  const ids = await exec(pageSelectedIds);
  return { model: model || null, resId: resId || null, ids: Array.isArray(ids) ? ids : [] };
}

export async function runJs(code: string, mode: RunMode, a: OdooAdapter, screen: Screen, context: Record<string, unknown>, uid: number): Promise<RunResult> {
  const opts: RunOptions = { mode, context, uid, readMethods: [...a.orm.readMethods], modelMethods: [...a.orm.modelMethods],
    groupMethod: a.orm.groupMethod, screen };
  const r = await exec(pageRunCode, code, opts as never);
  if (!r) throw new Error(_t('No response — is this an Odoo page?'));
  if (isExecError(r)) throw new Error(r.error);
  return r as RunResult;
}

/** The name of the temporary server actions: one left behind by a run that couldn't delete it is deleted by the next. */
const ACTION_NAME = 'Odoo Debug: Python console (temporary)';

/** What a Python run gives back, in the shape of a JS run (no calls: it is one server action). */
export async function runPython(code: string, mode: RunMode, screen: Screen): Promise<RunResult> {
  const started = performance.now();
  const dry = mode !== 'write';
  const model = screen.model || 'res.users';
  const [ir] = await call<{ id: number }[]>('ir.model', 'search_read', [[['model', '=', model]]], { fields: ['id'], limit: 1 });
  if (!ir) throw new Error(_t('Unknown model: %s', model));
  const left = await call<number[]>('ir.actions.server', 'search', [[['name', '=', ACTION_NAME]]]).catch(() => []);
  if (left.length) await call('ir.actions.server', 'unlink', [left]).catch(() => null);
  const base = { out: [] as unknown[][], calls: [], mode, uid: null };
  const failed = (message: string, line: number | null, traceback = '', type = ''): RunResult => ({
    ...base, ok: false, ms: Math.round(performance.now() - started),
    error: { message, name: '', type, traceback, msgid: '', args: [], server: true, line },
  });
  let id: number;
  try {
    id = await call<number>('ir.actions.server', 'create', [{ name: ACTION_NAME, model_id: ir.id, state: 'code', code: pythonProgram(code, dry) }]);
  } catch (e) { // the code doesn't compile: Odoo refuses to save it (ir.actions.server._check_python_code)
    const syntax = e instanceof RpcError ? pythonSyntaxError(e.message) : null;
    if (!syntax) throw e;
    return failed(syntax.message, syntax.line);
  }
  const ids = screen.ids.length ? screen.ids : screen.resId ? [screen.resId] : [];
  const context = screen.model ? { active_model: model, ...(screen.resId ? { active_id: screen.resId } : ids[0] ? { active_id: ids[0] } : {}), ...(ids.length ? { active_ids: ids } : {}) } : {};
  try {
    const action = await call<{ params?: { value: unknown; has_value: boolean; out: unknown[][] } } | false>('ir.actions.server', 'run', [[id]], { context });
    const p = action && action.params;
    if (!p) throw new Error(_t('The server action returned nothing: is this Odoo running it as code?'));
    return { ...base, ok: true, value: p.value, hasValue: p.has_value, out: p.out, ms: Math.round(performance.now() - started) };
  } catch (e) {
    const err = e as RpcError;
    const traceback = err.traceback ?? '';
    const clean = cleanPythonError(err.message);
    return failed(clean.message, pythonErrorLine(traceback, code.split('\n').length), traceback, clean.wrapped ? '' : err.type ?? '');
  } finally {
    await call('ir.actions.server', 'unlink', [[id]]).catch(() => null);
  }
}

/** Reloads the data of the view on screen (Odoo's soft_reload), after a run that wrote. */
export async function softReload(): Promise<{ ok: true } | { error: string }> {
  const r = await exec(pageSoftReload);
  if (!r) return { error: _t('No response — is this an Odoo page?') };
  return isExecError(r) ? { error: r.error } : r;
}

/** The models of the installed modules (suggestions after env['). */
export const readModels = () => call<{ model: string; name: string; modules?: string | false }[]>('ir.model', 'search_read', [[]], { fields: ['model', 'name', 'modules'], order: 'model' });
