// Saved record identity and list/kanban selection, read in the page. No RPC, mutation, selection truncation or imports.
export interface RecordSelection {
  origin: string;
  url: string;
  loadedAt: number;
  model: string | null;
  resId: number | null;
  viewType: string | null;
  ids: unknown[];
  selectionAvailable: boolean;
  domainSelected: boolean;
}

export function pageRecordSelection(): RecordSelection {
  const root = window.odoo?.__WOWL_DEBUG__?.root;
  const controller = root?.env?.services?.action?.currentController;
  const props = controller?.props;
  const viewType = controller?.view?.type || null;
  const fallback = location.pathname.match(/\/odoo\/(?:.*\/)?([a-z0-9_]+\.[a-z0-9_.]+)\/(\d+)/);
  const model = props?.resModel || controller?.action?.res_model || (!controller && fallback?.[1]) || null;
  const resId = controller ? (viewType === 'form' ? controller.currentState?.resId : props?.resId) || null : Number(fallback?.[2]) || null;
  const result: RecordSelection = { origin: location.origin, url: location.href, loadedAt: performance.timeOrigin, model, resId, viewType, ids: [], selectionAvailable: false, domainSelected: false };
  if (!model || !['list', 'kanban'].includes(viewType || '')) return result;
  try {
    const queue: any[] = root?.__owl__ ? [root.__owl__] : [];
    const seen = new Set<unknown>();
    const matches = new Map<object, { data: any; exact: boolean }>();
    for (let n = 0; queue.length && n < 5000; n++) {
      const node = queue.shift();
      if (!node || seen.has(node)) continue;
      seen.add(node);
      const component = node.component;
      const data = component?.model?.root;
      if (data && Array.isArray(data.selection) && (data.resModel || component.props?.resModel) === model) {
        matches.set(data, { data, exact: matches.get(data)?.exact || component.props === props });
      }
      for (const child of Object.values(node.children ?? {})) queue.push(child);
    }
    // If traversal hit its bound, or several active-looking roots remain, never guess a different view's selection.
    if (queue.length) return result;
    const candidates = [...matches.values()];
    const exact = candidates.filter((candidate) => candidate.exact);
    const active = exact.length ? exact : candidates;
    if (active.length !== 1) return result;
    const data = active[0]!.data;
    return { ...result, ids: data.selection.map((record: any) => record?.resId ?? null), selectionAvailable: true, domainSelected: !!data.isDomainSelected };
  } catch { return result; }
}
