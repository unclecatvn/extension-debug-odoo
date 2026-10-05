// Runs IN the Odoo page (MAIN world), through chrome.scripting.executeScript({ func }): only each function's own source
// text reaches the page, so nothing from outside it but browser globals and types (npm run check:page).

/** Opens the action `xmlid` as a click on its menu does: no page reload, the breadcrumbs start over (a form with unsaved
 * changes is saved first, as when leaving it). Webclient out of reach (website, portal): its /odoo/action-<xmlid> URL. */
export async function pageOpenAction(xmlid: string): Promise<{ ok: true } | { error: string }> {
  const action = window.odoo?.__WOWL_DEBUG__?.root?.env?.services?.action;
  if (!action) {
    location.href = `/odoo/action-${xmlid}`;
    return { ok: true };
  }
  try {
    await action.doAction(xmlid, { clearBreadcrumbs: true });
    return { ok: true };
  } catch (e) {
    const err = e as { data?: { message?: string }; message?: string } | null;
    return { error: String(err?.data?.message || err?.message || e) };
  }
}
