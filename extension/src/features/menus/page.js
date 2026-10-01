// Functions injected into the Odoo page (self-contained, no imports).

/** Opens the action `xmlid` as a click on its menu does: no page reload, the breadcrumbs start over (a form with unsaved
 * changes is saved first, as when leaving it). Webclient out of reach (website, portal): its /odoo/action-<xmlid> URL. */
export async function pageOpenAction(xmlid) {
  const action = window.odoo?.__WOWL_DEBUG__?.root?.env?.services?.action;
  if (!action) {
    location.href = `/odoo/action-${xmlid}`;
    return { ok: true };
  }
  try {
    await action.doAction(xmlid, { clearBreadcrumbs: true });
    return { ok: true };
  } catch (e) {
    return { error: String(e?.data?.message || e?.message || e) };
  }
}
