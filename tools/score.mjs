// The intro film's score, synthesized (no samples, no dependency) on the film's cues (window.MUSIC of tools/intro.html):
// a warm A minor pad, kicks and swishes on the opening montage's beats, a riser to a boom on the title, then a pulse,
// an echoing arpeggio and soft hats under the take, a swish at each new caption, a long chord to close.
// score(cues) → a 48 kHz stereo 16-bit WAV, as a Buffer.
const SR = 48000;
const hz = (m) => 440 * 2 ** ((m - 69) / 12);
const CHORDS = [[45, 52, 59, 60], [41, 48, 57, 64], [48, 55, 59, 64], [43, 50, 59, 62]]; // Am9 · Fmaj7 · Cmaj7 · G(add6)
let seed = 1;
const noise = () => ((seed = (seed * 16807) % 2147483647) / 1073741823.5) - 1; // deterministic: the same score every time

export function score({ duration, beat, montage, impact, main, captions, end }) {
  const n = Math.ceil((duration + .5) * SR);
  const L = new Float32Array(n), R = new Float32Array(n), send = new Float32Array(n); // send: to the reverb (mono)
  const at = (t) => Math.max(0, Math.round(t * SR));
  const add = (i, l, r = l, s = 0) => { if (i >= 0 && i < n) { L[i] += l; R[i] += r; send[i] += s; } };
  const chordAt = (t) => CHORDS[Math.floor(Math.max(0, t) / (beat * 4)) % CHORDS.length];
  const env = (t, a, d) => (t < 0 ? 0 : t < a ? t / a : Math.exp(-(t - a) / d));

  // ---- pad: detuned band-limited saws, slow attack, a lowpass opening with the film; ±crossfaded chords ----
  const lpPad = [0, 0];
  for (let i = 0; i < n; i++) {
    const t = i / SR, bar = beat * 4, k = (t % bar) / bar;
    const level = .5 * Math.min(1, t / 3) * (t > impact ? .75 : 1) * (1 - Math.min(1, Math.max(0, (t - duration + 2.5) / 2.5)));
    const cut = t < impact ? 500 + 900 * t / impact : t < main ? 2200 : 1500;
    let s = 0;
    for (const [w, chord] of [[1 - Math.max(0, (k - .85) / .15), chordAt(t)], [Math.max(0, (k - .85) / .15), chordAt(t + bar)]]) {
      if (w <= 0) continue;
      for (const m of chord) {
        for (const det of [-.07, .07]) {
          const f = hz(m + det), ph = 2 * Math.PI * f * t;
          for (let h = 1; h <= 6; h++) s += w * Math.sin(ph * h + h) / h;
        }
      }
    }
    s *= level * .045;
    const a = 1 - Math.exp(-2 * Math.PI * cut / SR);
    lpPad[0] += a * (s - lpPad[0]);
    lpPad[1] += a * (lpPad[0] - lpPad[1]);
    const v = lpPad[1] * (1 + .08 * Math.sin(2 * Math.PI * .25 * t)); // a slow breath
    add(i, v * 1.05, v * .95, v * .5);
  }

  // ---- kick: a falling sine; on the montage's beats, then every other beat under the take ----
  const kick = (t0, g) => {
    const i0 = at(t0);
    let ph = 0;
    for (let j = 0; j < SR * .5; j++) {
      const t = j / SR, f = 45 + 95 * Math.exp(-t / .035);
      ph += 2 * Math.PI * f / SR;
      const v = g * Math.sin(ph) * Math.exp(-t / .16);
      add(i0 + j, v, v, v * .1);
    }
  };
  // ---- swish: noise through a bandpass sweeping from f0 to f1, a bell-shaped level ----
  const swish = (t0, dur, f0, f1, g, wet = .4) => {
    const i0 = at(t0);
    let lo = 0, bp = 0;
    for (let j = 0; j < dur * SR; j++) {
      const k = j / (dur * SR), f = f0 * (f1 / f0) ** k;
      const F = 2 * Math.sin(Math.PI * Math.min(f, SR / 6) / SR), q = .35;
      const x = noise();
      const hp = x - lo - q * bp;
      bp += F * hp;
      lo += F * bp;
      const v = g * bp * Math.sin(Math.PI * k) ** 2;
      add(i0 + j, v * (1 - .3 * k), v * (.7 + .3 * k), v * wet);
    }
  };
  for (const t of montage) { kick(t, .55); swish(t - .22, .4, 6000, 900, .22); }

  // ---- the title: a riser (noise and a rising tone), then a boom and a crash on the impact ----
  const r0 = impact - 1.9;
  swish(r0, 1.9, 300, 7000, .12, .6);
  for (let i = at(r0); i < at(impact); i++) {
    const t = (i / SR - r0) / 1.9, f = 180 * 2 ** (t * 3);
    const v = .06 * t * t * Math.sin(2 * Math.PI * f * (i / SR));
    add(i, v, v, v * .5);
  }
  const boom = (t0, g) => {
    const i0 = at(t0);
    let ph = 0, lp = 0;
    for (let j = 0; j < SR * 4; j++) {
      const t = j / SR, f = 32 + 40 * Math.exp(-t / .25);
      ph += 2 * Math.PI * f / SR;
      lp += .08 * (noise() - lp);
      const v = g * (Math.sin(ph) * Math.exp(-t / 1.1) + 1.6 * lp * Math.exp(-t / .5));
      add(i0 + j, v, v, v * .8);
    }
  };
  boom(impact, .8);
  swish(main - 2.2, 1.3, 3500, 250, .18, .5); // the window flying in

  // ---- under the take: a pumping sub, kicks on every other beat, hats on the off-beats, an echoing arpeggio ----
  for (let i = at(impact); i < at(end + 1.5); i++) {
    const t = i / SR, tb = (t - impact) % beat;
    const fade = Math.min(1, (t - impact) / 2) * (1 - Math.min(1, Math.max(0, (t - end) / 1.5)));
    const root = hz(chordAt(t)[0] - 12);
    const pump = .35 + .65 * (1 - Math.exp(-tb / .2));
    const v = .16 * fade * pump * (Math.sin(2 * Math.PI * root * t) + .25 * Math.sin(4 * Math.PI * root * t));
    add(i, v, v);
  }
  for (let t = main; t < end; t += beat * 2) kick(t, .3);
  let hlp = 0;
  for (let t = main + beat / 2; t < end; t += beat) {
    const i0 = at(t);
    for (let j = 0; j < SR * .05; j++) { const x = noise(); hlp += .6 * (x - hlp); const v = .035 * (x - hlp) * Math.exp(-j / SR / .012); add(i0 + j, v * .8, v); }
  }
  const step = beat / 2; // eighths: the chord's tones, an octave up, rising and falling
  const pattern = [0, 1, 2, 3, 2, 1, 2, 3];
  for (let t = main, s = 0; t < end; t += step, s++) {
    const m = chordAt(t)[pattern[s % 8]] + 12, f = hz(m), i0 = at(t);
    const g = .09 * Math.min(1, (t - main) / 4);
    for (let j = 0; j < SR * .5; j++) {
      const tt = j / SR, ph = (f * tt) % 1;
      const tri = 4 * Math.abs(ph - .5) - 1;
      const v = g * tri * env(tt, .004, .16);
      const pan = s % 2 ? .75 : 1.25;
      add(i0 + j, v * pan, v * (2 - pan), v * .7);
    }
  }
  for (const c of captions) swish(c - .35, .6, 4500, 700, .08, .5);
  // the closing: a chord swelling, a soft boom under the name
  boom(end + .8, .35);

  // ---- echo of the arpeggio and the hits: a ping-pong delay (dotted eighth); then a Schroeder reverb ----
  const D = Math.round(beat * .75 * SR);
  for (let i = D; i < n; i++) { L[i] += .28 * R[i - D] * .9; R[i] += .28 * L[i - D] * .9; }
  const verb = (x, offs) => {
    const out = new Float32Array(n);
    for (const [d0, fb] of [[1557, .84], [1617, .84], [1491, .84], [1422, .84]]) {
      const d = Math.round((d0 + offs) * SR / 44100) * 2, buf = new Float32Array(d);
      let p = 0, lp = 0;
      for (let i = 0; i < n; i++) { const y = buf[p]; lp += .3 * (y - lp); buf[p] = x[i] + fb * lp; p = (p + 1) % d; out[i] += y * .25; }
    }
    for (const d0 of [225, 556]) {
      const d = Math.round((d0 + offs) * SR / 44100), buf = new Float32Array(d);
      let p = 0;
      for (let i = 0; i < n; i++) { const b = buf[p], y = -out[i] * .5 + b; buf[p] = out[i] + b * .5; out[i] = y; p = (p + 1) % d; }
    }
    return out;
  };
  const vl = verb(send, 0), vr = verb(send, 23);
  // ---- master: the reverb mixed in, a soft clip, faded in and out, normalized to -1 dBFS ----
  let peak = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR, f = Math.min(1, t / .4) * (1 - Math.min(1, Math.max(0, (t - duration + 1.2) / 1.2)));
    L[i] = Math.tanh((L[i] + .55 * vl[i]) * 1.1) * f;
    R[i] = Math.tanh((R[i] + .55 * vr[i]) * 1.1) * f;
    peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
  }
  const gain = .89 / (peak || 1);
  const wav = Buffer.alloc(44 + n * 4);
  wav.write('RIFF', 0); wav.writeUInt32LE(36 + n * 4, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(2, 22); wav.writeUInt32LE(SR, 24);
  wav.writeUInt32LE(SR * 4, 28); wav.writeUInt16LE(4, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) {
    wav.writeInt16LE(Math.round(Math.max(-1, Math.min(1, L[i] * gain)) * 32767), 44 + i * 4);
    wav.writeInt16LE(Math.round(Math.max(-1, Math.min(1, R[i] * gain)) * 32767), 46 + i * 4);
  }
  return wav;
}
