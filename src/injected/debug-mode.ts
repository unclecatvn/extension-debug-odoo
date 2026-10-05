// Runs IN the Odoo page (MAIN world), through chrome.scripting.executeScript({ func }): only each function's own source
// text reaches the page, so nothing from outside it but browser globals and types (npm run check:page), and no
// chrome.* (tsconfig.page.json). Arguments and results cross as JSON.
// Odoo's debug mode of the page (?debug=…): read it, set it, toggle it. Changing it reloads the page.

/** '', '1', 'assets', 'assets,tests'… */
export function pageDebugMode(): string {
  return window.odoo?.debug || '';
}

export function pageDebug(mode: string): void {
  const u = new URL(location.href);
  u.searchParams.set('debug', mode); // '0' turns it off (Odoo keeps debug in the session otherwise)
  location.href = u.toString();
}

/** Keyboard shortcut: debug off → on, on (or assets) → off. Not an Odoo page: nothing. */
export function pageToggleDebug(): void {
  if (typeof window.odoo?.csrf_token !== 'string') return;
  const u = new URL(location.href);
  u.searchParams.set('debug', window.odoo.debug ? '0' : '1');
  location.href = u.toString();
}
