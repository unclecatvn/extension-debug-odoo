// npm run website: writes website/<lang>/index.html for each website/i18n/<lang>.json, so each language of the landing
// page has its own URL for search engines (the hreflang links of index.html list them). A page is index.html with its
// data-i18n elements, title and description in that language; a missing key stays English, as the README says.
// Not committed: the Pages workflow runs this before it publishes.
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';

const SITE = 'https://odoo-debug.unclecatvn.com/';
const dir = new URL('../website/', import.meta.url);
const html = readFileSync(new URL('index.html', dir), 'utf8');
const langs = readdirSync(new URL('i18n/', dir)).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5));

// The inner HTML of each data-i18n element, as [start, end) in html: up to the close tag that balances its open tag.
const spans: [number, number][] = [];
for (const open of html.matchAll(/<([a-z0-9]+)\b[^>]*\sdata-i18n[^>]*>/g)) {
  const start = open.index + open[0].length;
  const tag = new RegExp(`<(/?)${open[1]}\\b[^>]*>`, 'g');
  tag.lastIndex = start;
  let depth = 1, end = -1;
  for (let t; depth && (t = tag.exec(html)); end = t.index) depth += t[1] ? -1 : 1;
  if (depth) throw new Error(`index.html: no close tag for ${open[0]}`);
  spans.push([start, end]);
}

const attr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
// One replacement in the head; a pattern that no longer matches is a page that changed under this script.
const swap = (page: string, pattern: RegExp, to: (...groups: string[]) => string) => {
  if (!pattern.test(page)) throw new Error(`index.html: ${pattern} not found`);
  return page.replace(pattern, (_, ...groups: string[]) => to(...groups));
};

for (const lang of langs) {
  if (!html.includes(`hreflang="${lang}" href="${SITE}${lang}/"`)) throw new Error(`index.html: no hreflang link for ${lang}`);
  const dict: Record<string, string> = JSON.parse(readFileSync(new URL(`i18n/${lang}.json`, dir), 'utf8'));
  let page = html, english = 0;
  for (const [start, end] of spans.toReversed()) { // from the end: the offsets before stay right
    const key = html.slice(start, end).replace(/\s+/g, ' ').trim();
    if (key in dict) page = page.slice(0, start) + dict[key] + page.slice(end);
    else english++;
  }
  page = swap(page, /<html lang="en">/, () => `<html lang="${lang}"${lang === 'ar' ? ' dir="rtl"' : ''}>`);
  page = swap(page, /<title>([^<]*)<\/title>/, (t) => `<title>${dict[t] ?? t}</title>`);
  page = swap(page, /(<meta name="description" content=")([^"]*)"/, (pre, d) => `${pre}${attr(dict[d] ?? d)}"`);
  page = swap(page, /(<link rel="canonical" href=")[^"]*"/, (pre) => `${pre}${SITE}${lang}/"`);
  page = swap(page, /(<meta property="og:url" content=")[^"]*"/, (pre) => `${pre}${SITE}${lang}/"`);
  mkdirSync(new URL(`${lang}/`, dir), { recursive: true });
  writeFileSync(new URL(`${lang}/index.html`, dir), page);
  console.log(`website/${lang}/index.html${english ? `: ${english} of ${spans.length} texts left in English` : ''}`);
}
