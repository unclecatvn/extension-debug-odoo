// Odoo's JSON-RPC, called from the panel through the inspected tab (its session, its cookies): /web/dataset/call_kw and
// the other JSON routes. Errors keep the server's traceback and exception class.
import type { Json } from '../contracts/json.ts';
import { exec } from '../extension/run-in-tab.ts';
import { pageRpc } from '../injected/json-rpc.ts';
import { _t } from '../i18n/i18n.ts';

/** A server-side error: its message, the Python traceback and the exception class (e.g. odoo.exceptions.AccessError). */
export class RpcError extends Error {
  traceback?: string;
  type?: string;
  constructor(message: string, traceback?: string, type?: string) {
    super(message);
    this.name = 'RpcError';
    this.traceback = traceback;
    this.type = type;
  }
}

/** The server refused the call for lack of rights (ACL or record rule): the caller shows what it needs instead. */
export const isAccessError = (e: unknown): boolean => e instanceof RpcError && /\bAccessError$/.test(e.type || '');

/** Marks the panel's own calls in their URL (a JSON route ignores its query string, 18.0 and 19.0: http.py →
 * JsonRPCDispatcher takes the body's params and the path's): the profiler names a profile after its full path, the
 * server log shows the path, so both tell the panel's reads from the page's requests. */
export const PANEL_MARK = 'odoo_debug_panel=1';

export async function rpc<T = unknown>(route: string, params: { [key: string]: Json | undefined }): Promise<T> {
  const r = await exec(pageRpc, `${route}${route.includes('?') ? '&' : '?'}${PANEL_MARK}`, params);
  if (!r) throw new Error(_t('No response — is this an Odoo page?'));
  if ('error' in r) {
    const { traceback, errorType } = r as { traceback?: string; errorType?: string }; // absent when exec() itself failed
    throw new RpcError(r.error, traceback, errorType);
  }
  return r.result as T;
}

export const call = <T = unknown>(model: string, method: string, args: Json[] = [], kwargs: { [key: string]: Json | undefined } = {}) =>
  rpc<T>(`/web/dataset/call_kw/${model}/${method}`, { model, method, args, kwargs });
