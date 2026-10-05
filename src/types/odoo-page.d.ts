// The Odoo page as the extension sees it from its MAIN-world code (entrypoints/rpc-recorder, injected functions): only
// the page context sees this (tsconfig.page.json), a content script reading window.odoo fails to type-check (it can't
// see the page's variables at run time either). Webclient internals are typed only as deep as they are used,
// the rest stays unknown: Odoo changes them between versions, so every access is guarded where it happens.
import type { RawRpc } from '../contracts/messages.ts';

declare global {
  /** web.layout sets `odoo = { csrf_token, debug }` on every Odoo page; the webclient adds the rest. */
  interface OdooGlobal {
    csrf_token: string;
    debug: string;
    loader?: { modules: Map<string, unknown> };
    __WOWL_DEBUG__?: { root?: OwlRoot };
  }

  interface OwlRoot {
    env?: { services?: { action?: ActionService; field?: { loadFields(model: string): Promise<Record<string, { string?: string }>> } } };
    __owl__?: unknown;
  }

  interface ActionService {
    currentController?: ActionController;
    doAction(action: string | Record<string, unknown>, options?: { clearBreadcrumbs?: boolean }): Promise<unknown>;
  }

  interface ActionController {
    props?: { resModel?: string; resId?: number; context?: unknown; domain?: unknown };
    action?: { res_model?: string; views?: [number | false, string][]; [key: string]: unknown };
    view?: { type?: string };
    currentState?: { resId?: number };
  }

  interface Window {
    odoo?: OdooGlobal;
    /** entrypoints/rpc-recorder: the recorded calls, and the page's fetch before it was wrapped (our own calls stay unlogged). */
    __odooDebugHook?: { buf: RawRpc[]; fetch: typeof fetch };
    /** view picker (features/view/page.ts) while it runs: its `done` */
    __odooDebugPick?: ((name: string) => void) | null;
  }
}

export {};
