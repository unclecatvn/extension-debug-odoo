// Runs IN the Odoo page (MAIN world), through chrome.scripting.executeScript({ func }): only each function's own source
// text reaches the page, so nothing from outside it but browser globals and types (npm run check:page), and no
// chrome.* (tsconfig.page.json). Arguments and results cross as JSON.
// Moving the Odoo page itself.

export function pageGo(path: string): void {
  location.href = path;
}

export function pageReload(): void {
  location.reload();
}
