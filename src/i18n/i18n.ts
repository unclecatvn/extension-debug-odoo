// Gettext-style i18n. msgids are the English source strings; translations live in static/i18n/<lang>.po (read at
// run time). Regenerate the .pot / merge the .po files with `npm run i18n`.
export const LANGS = { en: 'English', vi: 'Tiếng Việt' } as const;
export type Lang = keyof typeof LANGS;
const isLang = (code: unknown): code is Lang => typeof code === 'string' && code in LANGS;

let catalog = new Map<string, string>();
export let lang: Lang = 'en';

/** Translates `msgid` and fills its %s placeholders in order. Untranslated → the English msgid. */
export function _t(msgid: string, ...args: unknown[]): string {
  let i = 0;
  return (catalog.get(msgid) || msgid).replace(/%s/g, () => String(args[i++] ?? ''));
}
/** Marks a string for extraction only; translate it later with _t(value). For code that can't call _t (page functions). */
export const N_ = <S extends string>(s: S): S => s;

/** .po text → Map msgid → msgstr. Skips the header, untranslated and fuzzy entries. */
export function parsePo(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const entry of text.replace(/\r/g, '').split(/\n{2,}/)) {
    if (/^#,.*\bfuzzy\b/m.test(entry)) continue;
    const e: Record<string, string> = { msgid: '', msgstr: '' };
    let cur: string | null = null;
    for (const line of entry.split('\n')) {
      const m = line.match(/^(msgid|msgstr|msgctxt|msgid_plural|msgstr\[\d+\])\s+(".*")$/);
      if (m) { cur = m[1]!; e[cur] = JSON.parse(m[2]!) as string; } // PO escapes (\" \\ \n \t) are valid JSON escapes
      else if (cur && /^".*"$/.test(line)) e[cur] += JSON.parse(line) as string;
    }
    if (e.msgid && e.msgstr) out.set(e.msgid, e.msgstr);
  }
  return out;
}

/** Loads `code` (the one chosen in Settings), else Chrome's UI language, else English. */
export async function loadLang(code?: string): Promise<void> {
  const ui = chrome.i18n.getUILanguage().toLowerCase().split('-')[0];
  lang = isLang(code) ? code : isLang(ui) ? ui : 'en';
  try {
    const r = await fetch(chrome.runtime.getURL(`i18n/${lang}.po`));
    catalog = r.ok ? parsePo(await r.text()) : new Map();
  } catch { catalog = new Map(); }
}

/**
 * Static markup: data-i18n="text,title,placeholder,aria-label" translates the element's first text node
 * and/or those attributes, using their current (English) value as msgid.
 */
export function translateDom(root: ParentNode = document): void {
  for (const n of root.querySelectorAll<HTMLElement>('[data-i18n]')) {
    for (const what of (n.dataset.i18n || '').split(',')) {
      if (what === 'text') {
        const t = [...n.childNodes].find((c) => c.nodeType === Node.TEXT_NODE && c.textContent?.trim());
        if (t?.textContent) t.textContent = t.textContent.replace(t.textContent.trim(), _t(t.textContent.trim()));
      } else {
        const v = n.getAttribute(what);
        if (v != null) n.setAttribute(what, _t(v));
      }
    }
  }
}
