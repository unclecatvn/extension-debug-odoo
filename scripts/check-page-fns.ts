// npm run check:page — the injected functions (every export of src/injected/*.ts and of a *.injected.ts) only reach the
// Odoo page as their own source text (chrome.scripting.executeScript({ func })). tsconfig.page.json keeps chrome.* out
// of them; this keeps out everything else from outside them. A reference to anything outside the function — a module
// constant, an import, an esbuild helper such as __name — works in tests and fails in the page. This bundles each
// file exactly as scripts/build.ts does, then lists, per exported function, the identifiers it reads from outside
// itself: anything but JS / browser globals fails.
import { build } from 'esbuild';
import { parse } from 'acorn';
import { analyze } from 'eslint-scope';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';

process.chdir(join(import.meta.dirname, '..'));

// JS builtins (from a fresh V8 context) + the browser globals page functions use
const ALLOWED = new Set([
  ...(runInNewContext('Object.getOwnPropertyNames(globalThis)') as string[]),
  'window', 'document', 'location', 'navigator', 'performance', 'console', 'fetch', 'Request', 'Response', 'Headers',
  'URL', 'URLSearchParams', 'CustomEvent', 'Event', 'XMLHttpRequest', 'CSS', 'Node', 'HTMLElement', 'Element',
  'Blob', 'atob', 'btoa', 'structuredClone', 'queueMicrotask', 'setTimeout', 'clearTimeout', 'TextDecoder', 'TextEncoder',
  'AbortController', 'crypto', 'addEventListener', 'removeEventListener', 'innerWidth', 'innerHeight', 'getComputedStyle',
  'requestAnimationFrame',
]);

const isInjected = (f: string) => /^injected\/[^/]+\.ts$/.test(f) || f.endsWith('.injected.ts');
const files = (await readdir('src', { recursive: true })).filter(isInjected).sort();
let failures = 0;
let checked = 0;

for (const file of files) {
  const out = await build({
    entryPoints: [join('src', file)], bundle: true, write: false, format: 'esm', platform: 'browser',
    target: 'chrome120', keepNames: false, minify: false, logLevel: 'silent',
  });
  const code = out.outputFiles[0]!.text;
  const mod = (await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)) as Record<string, unknown>;
  for (const [name, fn] of Object.entries(mod)) {
    if (typeof fn !== 'function') continue;
    checked++;
    const ast = parse(`(${fn.toString()})`, { ecmaVersion: 'latest', sourceType: 'script', ranges: true });
    const scope = analyze(ast as never, { ecmaVersion: 2022, sourceType: 'script' });
    const outside = [...new Set(scope.globalScope!.through.map((r) => r.identifier.name))].filter((n) => !ALLOWED.has(n));
    if (outside.length) {
      failures++;
      console.error(`✗ src/${file} → ${name}() reads ${outside.join(', ')} from outside itself`);
    }
  }
}

if (failures) {
  console.error(`\n${failures} injected function(s) are not self-contained: move what they use inside them, or pass it as an argument.`);
  process.exit(1);
}
console.log(`✓ ${checked} injected functions in ${files.length} file(s) are self-contained`);
