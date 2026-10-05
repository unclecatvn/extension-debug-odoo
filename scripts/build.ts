// npm run build (once) / npm run watch: src/ + static/ → dist/, the folder to load unpacked in chrome://extensions.
// Every output is listed here by name, as the manifest refers to it (static/manifest.json):
//   SCRIPTS  content scripts + service worker: one self-contained IIFE each (not modules; rpc-recorder runs on every site)
//   PAGES    panel + popup: ES modules with shared chunks (top-level await), their index.html and the stylesheet
//   static/  manifest, icons, .po: copied as is
// *.tpl.html and the launcher's shadow-root CSS are imported by code: inlined as text, never copied.
// keepNames stays off: esbuild would call a __name() helper inside the injected functions, which only their own source
// text reaches (scripts/check-page-fns.ts guards that).
import { build, context, type BuildOptions } from 'esbuild';
import { cp, mkdir, rm, stat } from 'node:fs/promises';
import { watch as watchFs } from 'node:fs';
import { dirname, join } from 'node:path';

process.chdir(join(import.meta.dirname, '..'));
const watching = process.argv.includes('--watch');
const OUT = 'dist';
const RECORDER_MAX = 4096; // bytes: rpc-recorder.js is injected into every page of every site, at document_start

const SCRIPTS = [
  { in: 'src/entrypoints/background/index.ts', out: 'background' },
  { in: 'src/entrypoints/rpc-recorder/index.ts', out: 'rpc-recorder' },
  { in: 'src/entrypoints/rpc-relay/index.ts', out: 'rpc-relay' },
  { in: 'src/entrypoints/launcher/index.ts', out: 'launcher' },
];
const PAGES = [
  { in: 'src/entrypoints/panel/index.ts', out: 'panel/index' },
  { in: 'src/entrypoints/popup/index.ts', out: 'popup/index' },
];
/** [source, path in dist/]: the pages' HTML and their stylesheet (referenced by the HTML, not imported). */
const COPIES = [
  ['src/entrypoints/panel/index.html', 'panel/index.html'],
  ['src/entrypoints/popup/index.html', 'popup/index.html'],
  ['src/ui/panel.css', 'panel.css'],
] as const;

const common: BuildOptions = {
  bundle: true,
  outdir: OUT,
  target: 'chrome120',
  platform: 'browser',
  keepNames: false,
  minify: false, // readable for the store review and for whoever debugs the debugger
  legalComments: 'none',
  charset: 'utf8',
  sourcemap: watching ? 'linked' : false,
  logLevel: 'info',
  loader: { '.html': 'text', '.css': 'text' }, // templates / shadow-root CSS imported by code
};
const scripts: BuildOptions = { ...common, entryPoints: SCRIPTS, format: 'iife' };
const pages: BuildOptions = { ...common, entryPoints: PAGES, format: 'esm', splitting: true, chunkNames: 'chunks/[name]-[hash]' };

async function copyFiles() {
  await cp('static', OUT, { recursive: true });
  for (const [from, to] of COPIES) {
    await mkdir(join(OUT, dirname(to)), { recursive: true });
    await cp(from, join(OUT, to));
  }
}

async function checkRecorderSize() {
  const { size } = await stat(join(OUT, 'rpc-recorder.js'));
  if (size > RECORDER_MAX) throw new Error(`rpc-recorder.js is ${size} bytes (max ${RECORDER_MAX}): it must not import anything`);
}

await rm(OUT, { recursive: true, force: true });
await copyFiles();

if (!watching) {
  await Promise.all([build(scripts), build(pages)]);
  await checkRecorderSize();
} else {
  const ctxs = await Promise.all([context(scripts), context(pages)]);
  await Promise.all(ctxs.map((c) => c.watch()));
  // copied files: again on change (chrome://extensions → ⟳ to reload the extension)
  const recopy = () => copyFiles().catch((e: unknown) => console.error(e));
  watchFs('static', { recursive: true }, recopy);
  for (const [from] of COPIES) watchFs(from, recopy);
  console.log('watching src/ and static/ …');
}
