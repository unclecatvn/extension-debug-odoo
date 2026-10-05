// npm run check:markup — markup lives in *.tpl.html (and the extension pages), styles in *.css, never in .ts: no HTML
// built with innerHTML / insertAdjacentHTML / outerHTML, no element created by hand. The few createElement calls that
// are not UI (a shadow host, an off-screen textarea) carry a `markup-ok:` comment saying why.
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

process.chdir(join(import.meta.dirname, '..'));
const FORBIDDEN = /\.(innerHTML|outerHTML)\s*=|insertAdjacentHTML\(|document\.createElement\(|\bel\(\s*'/;
const ALLOWED_FILES = new Set(['ui/template.ts']); // parses the .tpl.html files themselves

const problems: string[] = [];
for (const f of (await readdir('src', { recursive: true })).filter((x) => x.endsWith('.ts') && !x.endsWith('.d.ts')).sort()) {
  if (ALLOWED_FILES.has(f)) continue;
  const lines = (await readFile(join('src', f), 'utf8')).split('\n');
  lines.forEach((line, i) => {
    if (FORBIDDEN.test(line) && !/markup-ok:/.test(line)) problems.push(`src/${f}:${i + 1}: ${line.trim()}`);
  });
}
if (problems.length) {
  console.error(`Markup built in code (move it to a .tpl.html template, or add "markup-ok: <why>"):\n${problems.join('\n')}`);
  process.exit(1);
}
console.log('✓ no markup in .ts files');
