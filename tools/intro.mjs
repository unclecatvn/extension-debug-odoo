// npm run intro: the intro film, a motion piece drawn in tools/intro.html (no Odoo, no screen recording): rendered frame
// by frame in Chrome, scored on its cues (tools/score.mjs), then ffmpeg encodes website/intro.mp4 (1080p60), its poster
// website/intro-poster.jpg and store/odoo-debug-intro.mp4 (1440p60 master, not committed).
//   node tools/intro.mjs --stills 4,12.5   only those instants, as PNGs, and the score, in the temp folder (to check an edit)
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { tmpdir } from 'node:os';
import puppeteer from 'puppeteer';
import { score } from './score.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const OUT = join(tmpdir(), 'odoo-debug-intro'); // stills, picture.mp4, score.wav
await mkdir(OUT, { recursive: true });

// tools/intro.html loads the panel's icons (src/ui/panel.css) over http
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
const server = createServer(async (req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  try {
    const body = await readFile(join(ROOT, p));
    res.writeHead(200, { 'Content-Type': TYPES[extname(p)] || 'application/octet-stream' }).end(body);
  } catch { res.writeHead(404).end(); }
}).listen(0);
const W = 2560, FPS = 60;
const browser = await puppeteer.launch({ args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage();
page.on('pageerror', (e) => console.error('stage:', e.message));
await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: W / 1920 });
await page.goto(`http://localhost:${server.address().port}/tools/intro.html`);
await page.waitForFunction(() => window.ready, { timeout: 60_000 });
const { duration, posterAt, cues } = await page.evaluate(() => ({ duration: window.DURATION, posterAt: window.POSTER_AT, cues: window.MUSIC }));
const only = process.argv.includes('--stills') ? process.argv[process.argv.indexOf('--stills') + 1].split(',').map(Number) : null;
if (only) {
  console.log(`duration ${duration.toFixed(2)} s, poster at ${posterAt.toFixed(2)} s, ${cues.sfx.length} sound cues`);
  await writeFile(join(OUT, 'score.wav'), score(cues)); // to hear the edit too
  for (const t of only) {
    await page.evaluate((t) => window.renderAt(t), t);
    await writeFile(join(OUT, `still-${t}.png`), await page.screenshot());
    console.log(join(OUT, `still-${t}.png`));
  }
} else {
  await mkdir(join(ROOT, 'store'), { recursive: true });
  const master = join(ROOT, 'store', 'odoo-debug-intro.mp4'), picture = join(OUT, 'picture.mp4'), music = join(OUT, 'score.wav');
  await writeFile(music, score(cues));
  const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-i', '-',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-pix_fmt', 'yuv420p', picture], { stdio: ['pipe', 'inherit', 'inherit'] });
  const n = Math.round(duration * FPS), t0 = Date.now();
  for (let i = 0; i < n; i++) {
    await page.evaluate((t) => window.renderAt(t), i / FPS);
    const buf = await page.screenshot({ type: 'jpeg', quality: 94, optimizeForSpeed: true });
    if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
    if (i % FPS === 0) process.stdout.write(`\r${i}/${n} frames, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  }
  ff.stdin.end();
  await new Promise((r) => ff.on('close', r));
  const enc = (...a) => execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...a], { stdio: 'inherit' });
  enc('-i', picture, '-i', music, '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11', '-ar', '48000',
    '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', master);
  console.log(`\n${master} (${duration.toFixed(1)} s)`);
  enc('-i', master, '-vf', 'scale=1920:1080:flags=lanczos', '-c:v', 'libx264', '-preset', 'slow', '-crf', '27', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', join(ROOT, 'website', 'intro.mp4'));
  enc('-ss', String(posterAt), '-i', join(ROOT, 'website', 'intro.mp4'), '-frames:v', '1', '-q:v', '3', join(ROOT, 'website', 'intro-poster.jpg'));
  console.log('website/intro.mp4, website/intro-poster.jpg');
}
await browser.close();
server.close();
