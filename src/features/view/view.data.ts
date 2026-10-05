// View tab: the data its five parts share, read once per page load (extension/page-cache.ts): how a view is composed,
// the menus and xmlid of the action. Same calls on 18.0 and 19.0 (checked in both sources); ir.ui.view is readable
// with Settings (base.group_system) only, ir.ui.menu by every internal user.
import { cached } from '../../extension/page-cache.ts';
import type { PageState } from '../../injected/page-state.ts';
import type { IrUiView, Many2one } from '../../odoo/models.ts';
import { call, isAccessError } from '../../odoo/rpc.ts';
import { summarize, type ViewSummary } from './arch.logic.ts';
import { buildViewTree, restrictedNodes } from './view.logic.ts';

export interface ComposedView {
  view: IrUiView;
  depth: number;
  /** its own arch, as written (arch_db): the line numbers every part links to */
  arch: string;
  summary: ViewSummary;
  restricted: ReturnType<typeof restrictedNodes>;
}

export interface Composition {
  type: string;
  /** the view used on screen (get_views resolves the default one) and its combined arch */
  view: { id: number; arch: string };
  /** in the order Odoo applies them; null: ir.ui.view not readable (Settings only) */
  views: ComposedView[] | null;
}

const VIEW_FIELDS = ['name', 'xml_id', 'inherit_id', 'mode', 'priority', 'active', 'arch_fs'];

/** How the `type` view `viewId` (false: the model's default) of `model` is composed. */
export const composition = (model: string, type: string, viewId: number | false): Promise<Composition | null> =>
  cached(`composition ${model} ${type} ${viewId}`, async () => {
    const gv = await call<{ views: Record<string, { id: number; arch: string }> }>(model, 'get_views', [], { views: [[viewId, type]], options: {} });
    const view = gv.views[type];
    if (!view) return null;
    const rows = await call<IrUiView[]>('ir.ui.view', 'search_read', [[['model', '=', model], ['type', '=', type]]], { fields: VIEW_FIELDS, context: { active_test: false } })
      .catch((e: unknown) => { if (isAccessError(e)) return null; throw e; });
    if (!rows) return { type, view, views: null };
    const tree = buildViewTree(rows, view.id);
    const archs = new Map((await call<{ id: number; arch_db: string | false }[]>('ir.ui.view', 'read', [tree.map((t) => t.view.id), ['arch_db']], { context: { active_test: false } }))
      .map((r) => [r.id, r.arch_db || ''] as const));
    return {
      type, view,
      views: tree.map(({ view: v, depth }) => {
        const arch = archs.get(v.id) ?? '';
        return { view: v, depth, arch, summary: summarize(arch), restricted: restrictedNodes(arch) };
      }),
    };
  });

/** The search view the screen uses: the action's, the model's default (false), or none (undefined: no window view). */
export function searchViewOf(state: PageState): number | false | undefined {
  const { action, viewType } = state;
  if (!viewType) return undefined;
  if (action?.type && action.type !== 'ir.actions.act_window') return undefined;
  const s = action?.search_view_id as Many2one | number | undefined;
  return Array.isArray(s) ? s[0] : typeof s === 'number' ? s : false;
}

/** The action as a reference `<type>,<id>`, or null when the screen was opened without one (a URL to a record). */
export function actionRef(action: PageState['action']): { type: string; id: number } | null {
  return action && typeof action.id === 'number' && typeof action.type === 'string' ? { type: action.type, id: action.id } : null;
}

/** The menus opening the action (Accounting / Customers / Invoices). */
export const menusOf = (ref: { type: string; id: number }) => cached(`menus ${ref.type},${ref.id}`, () =>
  call<{ complete_name: string }[]>('ir.ui.menu', 'search_read', [[['action', '=', `${ref.type},${ref.id}`]]], { fields: ['complete_name'] })
    .then((r) => r.map((m) => m.complete_name), () => [] as string[]));

/** The action's xmlid: the webclient's action usually carries none in 18 / 19. */
export const actionXmlId = (ref: { type: string; id: number }, given: unknown) => cached(`action xmlid ${ref.type},${ref.id}`, async () => {
  if (typeof given === 'string' && given) return given;
  const r = await call<{ module: string; name: string }[]>('ir.model.data', 'search_read', [[['model', '=', ref.type], ['res_id', '=', ref.id]]], { fields: ['module', 'name'] }).catch(() => []);
  return r.map((x) => `${x.module}.${x.name}`).join(', ');
});
