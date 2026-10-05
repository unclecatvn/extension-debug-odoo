// What was typed in a tab's form: kept across re-renders and reloads, forgotten on ⟳ Reload Data.
// localStorage of the panel (every instance): a per-viewer convenience only, never anything that must persist.

const FORM = 'odoo-debug-form:';

export const formValues = <T extends object>(key: string): Partial<T> => {
  try { return (JSON.parse(localStorage.getItem(FORM + key) || 'null') as Partial<T> | null) || {}; } catch { return {}; }
};

export const saveForm = (key: string, values: object) => {
  try { localStorage.setItem(FORM + key, JSON.stringify(values)); } catch { /* storage off */ }
};

export function clearForms() {
  try { for (const k of Object.keys(localStorage)) if (k.startsWith(FORM)) localStorage.removeItem(k); } catch { /* storage off */ }
}
