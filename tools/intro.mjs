// npm run intro: the intro film, a motion piece drawn in tools/intro.html (no Odoo, no screen recording): rendered frame
// by frame in Chrome, set to its song (window.SONG; without one, scored on its cues by tools/score.mjs), then ffmpeg encodes website/intro.mp4 (1080p60), its poster
// website/intro-poster.jpg and store/odoo-debug-intro.mp4 (1440p60 master, not committed).
//   node tools/intro.mjs --stills 4,12.5   only those instants, as PNGs, and the score, in the temp folder (to check an edit)
import { spawn, spawnSync, execFileSync } from 'node:child_process';
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
const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : null);
const W = 2560, FPS = 60;
const browser = await puppeteer.launch({ args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage();
page.on('pageerror', (e) => console.error('stage:', e.message));
await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: W / 1920 });
await page.goto(`http://localhost:${server.address().port}/tools/intro.html`);
await page.waitForFunction(() => window.ready, { timeout: 60_000 });
const { duration, posterAt, cues, song } = await page.evaluate(() => ({ duration: window.DURATION, posterAt: window.POSTER_AT, cues: window.MUSIC, song: window.SONG }));
const only = arg('--stills')?.split(',').map(Number);
if (only) {
  console.log(`duration ${duration.toFixed(2)} s, poster at ${posterAt.toFixed(2)} s, ${song ? song.file : `${cues.sfx.length} sound cues`}`);
  if (!song) await writeFile(join(OUT, 'score.wav'), score(cues)); // to hear the edit too
  for (const t of only) {
    await page.evaluate((t) => window.renderAt(t), t);
    await writeFile(join(OUT, `still-${t}.png`), await page.screenshot());
    console.log(join(OUT, `still-${t}.png`));
  }
} else {
  await mkdir(join(ROOT, 'store'), { recursive: true });
  const master = join(ROOT, 'store', 'odoo-debug-intro.mp4'), picture = join(OUT, 'picture.mp4'), music = join(OUT, 'score.wav');
  const web = join(ROOT, 'website', 'intro.mp4'), poster = join(ROOT, 'website', 'intro-poster.jpg');
  if (!song) await writeFile(music, score(cues));
  else { // the song's parts joined (a 30 ms crossfade ending just before the bar's downbeat), faded out under the last
    // two seconds, brought to -14 LUFS by a plain gain (a limiter at -1.5 dB only trims the highest peaks: AAC adds about 1 dB to them)
    const D = .03, LEAD = .03, graph = [], cut = join(OUT, 'cut.wav');
    let last;
    song.parts.forEach(([a, b], i) => {
      const from = a - (i ? LEAD + D / 2 : 0), to = b ? b - LEAD + D / 2 : from + duration;
      graph.push(`[s${i}]atrim=${from}:${to},asetpts=PTS-STARTPTS[p${i}]`);
      if (i) graph.push(`[${last}][p${i}]acrossfade=d=${D}:c1=tri:c2=tri[x${i}]`);
      last = i ? `x${i}` : 'p0';
    });
    graph.unshift(`[0:a]asplit=${song.parts.length}${song.parts.map((_, i) => `[s${i}]`).join('')}`);
    graph.push(`[${last}]atrim=0:${duration},afade=t=in:d=0.01,afade=t=out:st=${duration - 2}:d=2[cut]`);
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', join(ROOT, song.file), '-filter_complex', graph.join(';'), '-map', '[cut]', '-c:a', 'pcm_f32le', cut]);
    const said = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', cut, '-af', 'ebur128', '-f', 'null', '-']).stderr.toString(); // ebur128 reports on stderr
    const gain = -14 - Number(said.slice(said.lastIndexOf('Integrated loudness')).match(/I:\s+(-?[\d.]+) LUFS/)[1]);
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', cut, '-af', `volume=${gain.toFixed(2)}dB,alimiter=limit=0.84:level=disabled`, '-ar', '48000', music]);
  }
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
  enc('-i', picture, '-i', music, '-map', '0:v', '-map', '1:a', '-c:v', 'copy', ...(song ? [] : ['-af', 'loudnorm=I=-16:TP=-1.5:LRA=11']), '-ar', '48000',
    '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', master);
  console.log(`\n${master} (${duration.toFixed(1)} s)`);
  enc('-i', master, '-vf', 'scale=1920:1080:flags=lanczos', '-c:v', 'libx264', '-preset', 'slow', '-crf', '27', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', web);
  enc('-ss', String(posterAt), '-i', web, '-frames:v', '1', '-q:v', '3', poster);
  console.log('website/intro.mp4, website/intro-poster.jpg');
}
await browser.close();
server.close();
