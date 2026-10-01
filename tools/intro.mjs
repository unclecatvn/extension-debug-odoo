// npm run intro: renders the intro film (tools/intro.html) frame by frame in headless Chrome, then ffmpeg encodes it:
//   store/odoo-debug-intro-4k.mp4   3840×2160 master (not committed: the Chrome Web Store / YouTube copy)
//   website/intro.mp4               1920×1080, the website's hero (muted loop)
//   website/intro-poster.jpg        its last scene: the video's poster, and the READMEs' image (GitHub plays no video
//                                   from the repository: the image links to the website)
// No Odoo needed: the film uses website/screenshots/*.png (npm run screenshots). Needs ffmpeg on the PATH.
//   node tools/intro.mjs --stills 3,7,12    only those instants, as PNGs in $TMPDIR (to check a change quickly)
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { tmpdir } from 'node:os';
import puppeteer from 'puppeteer';

const ROOT = new URL('..', import.meta.url).pathname;
const FPS = 30;
const MASTER = join(ROOT, 'store', 'odoo-debug-intro-4k.mp4');
const stills = process.argv.includes('--stills') ? process.argv[process.argv.indexOf('--stills') + 1].split(',').map(Number) : null;

// the stage loads three.js as ES modules: served over http from the repository root (file:// would block them)
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = createServer(async (req, res) => {
  try {
    const body = await readFile(join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname)));
    res.writeHead(200, { 'Content-Type': TYPES[extname(req.url)] || 'application/octet-stream' }).end(body);
  } catch { res.writeHead(404).end(); }
}).listen(0);
const url = `http://localhost:${server.address().port}/tools/intro.html`;

const browser = await puppeteer.launch({ args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'] });
const page = await browser.newPage();
page.on('pageerror', (e) => console.error('stage:', e.message));
await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 2 }); // 3840×2160 frames
await page.goto(url);
await page.waitForFunction(() => window.ready, { timeout: 30_000 });
const duration = await page.evaluate(() => window.DURATION);
console.log(`GPU: ${await page.evaluate(() => { const g = document.createElement('canvas').getContext('webgl2'); return g.getParameter(g.getExtension('WEBGL_debug_renderer_info').UNMASKED_RENDERER_WEBGL); })}, ${duration.toFixed(1)} s`);

const frame = async (t, type = 'jpeg') => {
  await page.evaluate((t) => window.renderAt(t), t);
  return page.screenshot({ type, quality: type === 'jpeg' ? 95 : undefined, optimizeForSpeed: true });
};

if (stills) {
  const dir = join(tmpdir(), 'odoo-debug-intro');
  await mkdir(dir, { recursive: true });
  for (const t of stills) {
    await writeFile(join(dir, `t${t}.png`), await frame(t, 'png'));
    console.log(join(dir, `t${t}.png`));
  }
} else {
  await mkdir(join(ROOT, 'store'), { recursive: true });
  const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-i', '-',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-tune', 'film', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', MASTER], { stdio: ['pipe', 'inherit', 'inherit'] });
  const n = Math.round(duration * FPS);
  const t0 = Date.now();
  for (let i = 0; i < n; i++) {
    const buf = await frame(i / FPS);
    if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
    if (i % FPS === 0) process.stdout.write(`\r${i}/${n} frames, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  }
  ff.stdin.end();
  await new Promise((r) => ff.on('close', r));
  console.log(`\n${MASTER}`);
  const enc = (...a) => execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', MASTER, ...a], { stdio: 'inherit' });
  enc('-vf', 'scale=1920:1080:flags=lanczos', '-c:v', 'libx264', '-preset', 'slow', '-crf', '22', '-tune', 'film', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an',
    join(ROOT, 'website', 'intro.mp4'));
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', String(duration - 2.4), '-i', MASTER, '-frames:v', '1', '-vf', 'scale=1920:1080:flags=lanczos', '-q:v', '3',
    join(ROOT, 'website', 'intro-poster.jpg')], { stdio: 'inherit' });
  console.log('website/intro.mp4, website/intro-poster.jpg');
}
await browser.close();
server.close();
