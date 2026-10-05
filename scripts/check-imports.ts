// npm run check:imports — dependencies point one way (README → Layout):
//   entrypoints → features → libraries (ui, odoo, extension, injected, i18n) → contracts
// - nothing imports an entrypoint
// - a tab (features/<tab>/) doesn't import another tab; only features/registry.ts imports the tabs
// - libraries never import features
// - contracts import nothing but contracts
// Which context may import which (no chrome.* in the page, no DOM in the worker…) is the tsconfig projects' job.
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, normalize } from 'node:path';

process.chdir(join(import.meta.dirname, '..', 'src'));
const LIBRARIES = ['ui', 'odoo', 'extension', 'injected', 'i18n', 'types'];
const top = (f: string) => f.split('/')[0]!;
const tab = (f: string) => (f.startsWith('features/') && f.split('/').length > 2 ? f.split('/')[1]! : null);

function violation(from: string, to: string): string | null {
  if (top(to) === 'entrypoints' && top(from) !== 'entrypoints') return 'nothing imports an entrypoint';
  if (top(from) === 'entrypoints' && top(to) === 'entrypoints' && from.split('/')[1] !== to.split('/')[1]) return 'an entrypoint does not import another one';
  if (tab(from) && tab(to) && tab(from) !== tab(to)) return 'a tab does not import another tab';
  if (top(to) === 'features' && tab(to) && from !== 'features/registry.ts' && !tab(from)) return 'only features/registry.ts imports the tabs';
  if (LIBRARIES.includes(top(from)) && top(to) === 'features') return 'libraries never import features';
  if (top(from) === 'contracts' && top(to) !== 'contracts') return 'contracts import nothing but contracts';
  return null;
}

const problems: string[] = [];
for (const f of (await readdir('.', { recursive: true })).filter((x) => /\.ts$/.test(x)).sort()) {
  const text = await readFile(f, 'utf8');
  for (const m of text.matchAll(/(?:from\s+|import\s*\(\s*|import\s+)'(\.{1,2}\/[^']+)'/g)) {
    const to = normalize(join(dirname(f), m[1]!));
    const why = violation(f, to);
    if (why) problems.push(`src/${f} → src/${to}: ${why}`);
  }
}
if (problems.length) {
  console.error(`Imports against the dependency direction:\n${problems.join('\n')}`);
  process.exit(1);
}
console.log('✓ imports follow the dependency direction');
