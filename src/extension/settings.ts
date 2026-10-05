// Settings (language, theme) in chrome.storage.local: shared by every panel and the toolbar popup (entrypoints/popup).
// auto / light / dark: Odoo's colors; the others are editor color themes, like VS Code's (palettes in ui/panel.css, [data-theme=…])
export const THEMES = ['auto', 'light', 'dark', 'github-light', 'solarized-light', 'github-dark', 'dracula', 'monokai', 'one-dark', 'nord', 'solarized-dark', 'catppuccin'] as const;
export type Theme = (typeof THEMES)[number];
export const isTheme = (t: unknown): t is Theme => (THEMES as readonly unknown[]).includes(t);

export interface Settings { lang?: string; theme?: string }

export const applyTheme = (theme: unknown) => {
  if (theme !== 'auto' && isTheme(theme)) document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
};

/** Reads the settings and applies the theme; call before the first render. Later changes apply live. */
export async function loadSettings(): Promise<Settings> {
  const saved = (await chrome.storage.local.get(['lang', 'theme']).catch(() => ({}))) as Settings;
  applyTheme(saved.theme);
  chrome.storage.onChanged.addListener((ch) => {
    if (ch.theme) applyTheme(ch.theme.newValue);
    if (ch.lang) location.reload(); // everything is rendered through _t: reload is simplest
  });
  return saved;
}
