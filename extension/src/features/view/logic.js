// Pure helpers, no chrome.* / DOM: tested by tests/view.test.mjs.

/**
 * Views of one model/type → [{view, depth}] for the chain that builds `currentId`:
 * its primary ancestors, plus every extension view hanging off that chain.
 */
export function buildViewTree(views, currentId) {
  const byId = new Map(views.map((v) => [v.id, v]));
  const parentOf = (v) => v.inherit_id && byId.get(v.inherit_id[0]);
  let top = byId.get(currentId);
  if (!top) return [];
  const path = new Set([top.id]);
  while (parentOf(top)) { top = parentOf(top); path.add(top.id); }

  const kids = new Map();
  for (const v of views) {
    if (!v.inherit_id) continue;
    const k = v.inherit_id[0];
    if (!kids.has(k)) kids.set(k, []);
    kids.get(k).push(v);
  }
  const out = [];
  const walk = (v, depth) => {
    out.push({ view: v, depth });
    const cs = (kids.get(v.id) || []).sort((a, b) => a.priority - b.priority || a.id - b.id);
    for (const c of cs) if (c.mode === 'extension' || path.has(c.id)) walk(c, depth + 1);
  };
  walk(top, 0);
  return out;
}
