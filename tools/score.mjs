// The intro film's score, synthesized (no samples, no dependency) on the film's cues (window.MUSIC of tools/intro.html):
// 120 BPM in A minor (Am · F · C · G). The opening builds: a filtered pad and a heartbeat kick under the questions, a
// pluck on each, kicks and claps on the montage's cuts, a snare roll and a riser, a beat of silence, then the drop on the
// title: a boom, a crash and a wide chord, four-on-the-floor, a bass and a supersaw pad pumping with the kick, claps,
// hats, the hook on the lead. Under the take the groove goes on, the hook every other phrase, a swell into each caption;
// a fill, then the last chord rings out under the closing title.
// score(cues) → a 48 kHz stereo 16-bit WAV, as a Buffer.
const SR = 48000;
const hz = (m) => 440 * 2 ** ((m - 69) / 12);
const CHORDS = [[57, 60, 64, 69], [53, 57, 60, 65], [55, 60, 64, 67], [55, 59, 62, 67]]; // Am · F · C · G
const ROOTS = [33, 29, 36, 31]; // A1 · F1 · C2 · G1
const DET = [-.18, -.08, 0, .08, .18]; // the supersaw's voices, in semitones
// the hook, over four bars of eighths: [step, note, length in eighths]
const HOOK = [
  [0, 76, 2], [2, 74, 1], [3, 72, 1], [4, 69, 2], [6, 72, 1], [7, 74, 1],
  [8, 77, 2], [10, 76, 1], [11, 74, 1], [12, 72, 3], [15, 74, 1],
  [16, 76, 2], [18, 79, 1], [19, 76, 1], [20, 74, 2], [22, 72, 1], [23, 74, 1],
  [24, 74, 2], [26, 71, 1], [27, 74, 1], [28, 79, 3], [31, 76, 1],
];
let seed = 1;
const noise = () => ((seed = (seed * 16807) % 2147483647) / 1073741823.5) - 1; // deterministic: the same score every time

/** A band-limited sawtooth (polyBLEP) at phase p (0..1) advancing by dt per sample. */
function saw(p, dt) {
  let v = 2 * p - 1;
  if (p < dt) { const x = p / dt; v -= x + x - x * x - 1; } else if (p > 1 - dt) { const x = (p - 1) / dt; v -= x * x + x + x + 1; }
  return v;
}

export function score({ duration, beat, questions = [], montage = [], riser, impact, main, captions = [], end }) {
  const n = Math.ceil((duration + .5) * SR);
  const L = new Float32Array(n), R = new Float32Array(n), send = new Float32Array(n); // send: to the reverb (mono)
  const pad = new Float32Array(n), bass = new Float32Array(n); // buses the kick pumps
  const lead = new Float32Array(n); // to the ping-pong delay
  const at = (t) => Math.max(0, Math.round(t * SR));
  const add = (i, l, r = l, s = 0) => { if (i >= 0 && i < n) { L[i] += l; R[i] += r; send[i] += s; } };
  const bar = beat * 4;
  const barOf = (t) => Math.floor((t - impact) / bar); // bar 0 starts on the drop
  const chordOf = (b) => ((b % 4) + 4) % 4;
  const [r0, r1] = riser ?? [impact - 2 * beat * 4, impact - beat / 2];
  const groove = (t) => t >= impact && t < end; // four-on-the-floor
  const fadeOut = (t) => 1 - Math.min(1, Math.max(0, (t - duration + 1.6) / 1.6));

  // ---------------- drums ----------------
  const kicks = [];
  const kick = (t0, g, tone = 1) => {
    kicks.push(t0);
    const i0 = at(t0);
    let ph = 0;
    for (let j = 0; j < SR * .45; j++) {
      const t = j / SR, f = 48 + 110 * Math.exp(-t / .03);
      ph += 2 * Math.PI * f / SR;
      const click = j < SR * .004 ? .5 * noise() * (1 - j / (SR * .004)) : 0;
      const v = g * (Math.tanh(1.6 * Math.sin(ph)) * Math.exp(-t / (.18 * tone)) + click);
      add(i0 + j, v, v, v * .05);
    }
  };
  /** Noise through a state-variable bandpass at f (q), a short envelope. */
  const burst = (t0, dur, f, q, g, decay, pan = 0, wet = .3) => {
    const i0 = at(t0);
    let lo = 0, bp = 0;
    const F = 2 * Math.sin(Math.PI * Math.min(f, SR / 6) / SR);
    for (let j = 0; j < dur * SR; j++) {
      const x = noise(), hp = x - lo - q * bp;
      bp += F * hp; lo += F * bp;
      const v = g * bp * Math.exp(-j / SR / decay);
      add(i0 + j, v * (1 - pan), v * (1 + pan), v * wet);
    }
  };
  const clap = (t0, g) => { for (const [d, k] of [[0, .7], [.011, .8], [.023, 1]]) burst(t0 + d, .25, 1300, .55, g * k, d < .02 ? .008 : .09, 0, .55); };
  const hat = (t0, g, open = false) => {
    const i0 = at(t0);
    let prev = 0;
    for (let j = 0; j < SR * (open ? .22 : .05); j++) {
      const x = noise(), h = x - prev; prev = x; // a first-order high-pass
      const v = g * h * Math.exp(-j / SR / (open ? .07 : .014));
      add(i0 + j, v * .85, v, v * .15);
    }
  };
  const snare = (t0, g) => {
    burst(t0, .18, 2600, .8, g, .05, 0, .4);
    const i0 = at(t0);
    for (let j = 0; j < SR * .08; j++) { const v = g * .6 * Math.sin(2 * Math.PI * 190 * j / SR) * Math.exp(-j / SR / .03); add(i0 + j, v, v, v * .2); }
  };
  const crash = (t0, g) => {
    const i0 = at(t0);
    let prev = 0;
    for (let j = 0; j < SR * 2.6; j++) {
      const x = noise(), h = x - prev; prev = x;
      const v = g * h * Math.exp(-j / SR / .8);
      add(i0 + j, v * (1 + .3 * Math.sin(j / 900)), v * (1 - .3 * Math.sin(j / 900)), v * .7);
    }
  };
  const boom = (t0, g) => {
    const i0 = at(t0);
    let ph = 0, lp = 0;
    for (let j = 0; j < SR * 3.5; j++) {
      const t = j / SR, f = 30 + 55 * Math.exp(-t / .2);
      ph += 2 * Math.PI * f / SR;
      lp += .06 * (noise() - lp);
      const v = g * (Math.sin(ph) * Math.exp(-t / 1.2) + 1.4 * lp * Math.exp(-t / .4));
      add(i0 + j, v, v, v * .6);
    }
  };
  /** Noise swept through a bandpass from f0 to f1: a whoosh (falling) or a swell (rising), bell-shaped or rising. */
  const sweep = (t0, dur, f0, f1, g, shape = 'bell', wet = .5) => {
    const i0 = at(t0);
    let lo = 0, bp = 0;
    for (let j = 0; j < dur * SR; j++) {
      const k = j / (dur * SR), f = f0 * (f1 / f0) ** k;
      const F = 2 * Math.sin(Math.PI * Math.min(f, SR / 6) / SR);
      const x = noise(), hp = x - lo - .3 * bp;
      bp += F * hp; lo += F * bp;
      const e = shape === 'rise' ? k ** 2.2 : Math.sin(Math.PI * k) ** 2;
      const v = g * bp * e;
      add(i0 + j, v * (1 - .4 * k), v * (.6 + .4 * k), v * wet);
    }
  };

  // ---------------- the opening ----------------
  if (questions.length) {
    for (let t = questions[0]; t < (montage[0] ?? r0) - .01; t += beat) kick(t, .32, .8); // a heartbeat
    for (const q of questions) { // a pluck: the chord's tones, quick, up
      sweep(q - .3, .45, 5000, 900, .07);
      const c = CHORDS[chordOf(barOf(q))];
      [0, 1, 2, 3].forEach((k) => pluck(q + k * .045, c[k] + 12, .07, .35));
    }
  }
  for (const t of montage) { kick(t, .8); clap(t, .28); sweep(t - .25, .4, 7000, 700, .16); }
  // the riser: a snare roll speeding up, a noise swell, a rising tone; a beat of silence before the drop
  for (let t = r0, k = 0; t < r1; k++) {
    const p = (t - r0) / (r1 - r0);
    snare(t, .1 + .42 * p * p);
    t += beat / (p < .5 ? 2 : p < .8 ? 4 : 8);
  }
  sweep(r0, r1 - r0 + .15, 250, 9000, .32, 'rise', .7);
  for (let i = at(r0); i < at(r1); i++) {
    const p = (i / SR - r0) / (r1 - r0), f = 150 * 2 ** (p * 3.2);
    const v = .07 * p * p * saw((f * i / SR) % 1, f / SR);
    add(i, v, v, v * .5);
  }
  // the drop
  boom(impact, .9);
  crash(impact, .32);
  stab(impact, CHORDS[0], .6);

  // ---------------- the groove ----------------
  for (let t = impact; t < end - .01; t += beat) {
    const b = Math.round((t - impact) / beat);
    kick(t, .85);
    if (b % 4 === 1 || b % 4 === 3) clap(t, .3);
    const soft = t >= main ? .65 : 1; // under the take: the hats step back
    hat(t + beat / 2, .09 * soft, true); // the off-beat
    for (const s of [.25, .75]) hat(t + beat * s, .03 * soft);
  }
  // a fill into the closing: the last beat, sixteenths
  for (let k = 0; k < 4; k++) snare(end - beat + k * beat / 4, .12 + .06 * k);
  crash(end, .25);
  boom(end, .55);
  stab(end, CHORDS[0], .5, 3.5);

  // bass: eighths on the chord's root, an octave up on the off-beats
  for (let t = impact; t < end - .01; t += beat / 2) {
    const s = Math.round((t - impact) / (beat / 2)), root = ROOTS[chordOf(barOf(t + .001))] + (s % 2 ? 12 : 0);
    const f = hz(root), i0 = at(t);
    let p = 0, lp = 0;
    for (let j = 0; j < SR * beat * .48; j++) {
      const tt = j / SR;
      p = (p + f / SR) % 1;
      const raw = .6 * saw(p, f / SR) + .9 * Math.sin(2 * Math.PI * p);
      const cut = 300 + 1600 * Math.exp(-tt / .06);
      lp += (1 - Math.exp(-2 * Math.PI * cut / SR)) * (raw - lp);
      const v = .26 * lp * Math.min(1, tt / .003) * Math.exp(-tt / .35);
      if (i0 + j < n) bass[i0 + j] += v;
    }
  }

  // supersaw pad: the chord of each bar, five detuned saws a note, a lowpass that opens with the film
  const padCut = (t) => (t < impact ? 350 + 1300 * Math.max(0, (t - (questions[0] ?? 0)) / Math.max(.1, r1 - (questions[0] ?? 0))) ** 1.5 : t < main ? 3400 : t < end ? 2100 : 1600);
  const padLevel = (t) => (t < impact ? .55 * Math.min(1, t / 2.5) * (t > r1 ? Math.max(0, 1 - (t - r1) / .1) : 1) : t < main ? 1 : .8) * fadeOut(t);
  for (let b = barOf(0); impact + b * bar < duration; b++) {
    const t0 = impact + b * bar, t1 = t0 + bar;
    const chord = CHORDS[chordOf(b)];
    const i0 = at(Math.max(0, t0 - .03)), i1 = Math.min(n, at(t1 + .35));
    for (const m of chord) {
      for (const d of DET) {
        const f = hz(m + d), dt = f / SR;
        let p = (m * 7 + d * 13) % 1;
        for (let i = i0; i < i1; i++) {
          const t = i / SR, e = Math.min(1, (t - t0 + .03) / .06) * (t > t1 ? Math.max(0, 1 - (t - t1) / .35) : 1);
          p += dt; if (p >= 1) p -= 1;
          pad[i] += .018 * e * saw(p, dt) * (d < 0 ? 1.15 : .85);
        }
      }
    }
  }
  // the pad through its lowpass, its level, and stereo spread: written into L / R below with the pump
  const lp = [0, 0];
  for (let i = 0; i < n; i++) {
    const t = i / SR, a = 1 - Math.exp(-2 * Math.PI * padCut(t) / SR);
    lp[0] += a * (pad[i] - lp[0]);
    lp[1] += a * (lp[0] - lp[1]);
    pad[i] = lp[1] * padLevel(t);
  }

  // the lead: the hook on the title, then every other four-bar phrase under the take, softer
  const hookAt = (t0, g) => {
    for (const [step, m, len] of HOOK) {
      const s = t0 + step * beat / 2;
      if (s >= end) break;
      leadNote(s, m, len * beat / 2 * .92, g);
    }
  };
  hookAt(impact, .16);
  for (let k = 2; impact + k * 4 * bar < end; k += 2) hookAt(impact + k * 4 * bar, .1);
  // between the hooks: an arpeggio of the chord's tones, an octave up
  for (let t = main, s = 0; t < end - .01; t += beat / 2, s++) {
    const phrase = Math.floor((t - impact) / (4 * bar));
    if (phrase % 2 === 0 && t >= impact) continue;
    const c = CHORDS[chordOf(barOf(t + .001))];
    pluck(t, c[[0, 1, 2, 3, 2, 1, 2, 3][s % 8]] + 12, .045, .2);
  }

  // captions: a swell into each, a soft hit on it
  for (const c of captions) { sweep(c - .55, .6, 400, 6000, .07, 'rise', .6); burst(c, .3, 900, .9, .05, .12, 0, .8); }

  // ---------------- the pump, the delay, the reverb, the master ----------------
  kicks.sort((a, b) => a - b);
  let k = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    while (k + 1 < kicks.length && kicks[k + 1] <= t) k++;
    const since = kicks[k] !== undefined && kicks[k] <= t ? t - kicks[k] : 9;
    const pump = groove(t) || since < .5 ? 1 - .75 * Math.exp(-since / .11) : 1;
    const p = pad[i] * pump, bs = bass[i] * pump;
    add(i, p * 1.08 + bs, p * .92 + bs, p * .45);
  }
  // the lead's ping-pong delay (dotted eighth)
  const D = Math.round(beat * .75 * SR);
  const dl = new Float32Array(n), dr = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const inL = lead[i] + (i >= D ? .45 * dr[i - D] : 0), inR = i >= D ? .45 * dl[i - D] : 0;
    dl[i] = inL; dr[i] = inR;
    add(i, lead[i] + .5 * (dl[i] - lead[i]), lead[i] + .5 * dr[i], lead[i] * .4);
  }
  const verb = (x, offs) => {
    const out = new Float32Array(n);
    for (const [d0, fb] of [[1557, .83], [1617, .83], [1491, .83], [1422, .83]]) {
      const d = Math.round((d0 + offs) * SR / 44100) * 2, buf = new Float32Array(d);
      let p = 0, lo = 0;
      for (let i = 0; i < n; i++) { const y = buf[p]; lo += .35 * (y - lo); buf[p] = x[i] + fb * lo; p = (p + 1) % d; out[i] += y * .25; }
    }
    for (const d0 of [225, 556]) {
      const d = Math.round((d0 + offs) * SR / 44100), buf = new Float32Array(d);
      let p = 0;
      for (let i = 0; i < n; i++) { const b = buf[p], y = -out[i] * .5 + b; buf[p] = out[i] + b * .5; out[i] = y; p = (p + 1) % d; }
    }
    return out;
  };
  const vl = verb(send, 0), vr = verb(send, 23);
  let peak = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR, f = Math.min(1, t / .25) * fadeOut(t);
    L[i] = Math.tanh((L[i] + .4 * vl[i]) * 1.25) * f;
    R[i] = Math.tanh((R[i] + .4 * vr[i]) * 1.25) * f;
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

  // ---------------- voices ----------------
  /** A pluck: two detuned saws through a lowpass closing fast, panned. */
  function pluck(t0, m, g, wet) {
    const f = hz(m), i0 = at(t0), pan = (m % 3 - 1) * .35;
    let p1 = 0, p2 = .3, lo = 0;
    for (let j = 0; j < SR * .5; j++) {
      const tt = j / SR;
      p1 = (p1 + f / SR) % 1; p2 = (p2 + f * 1.006 / SR) % 1;
      const raw = saw(p1, f / SR) + saw(p2, f * 1.006 / SR);
      const cut = 600 + 5200 * Math.exp(-tt / .05);
      lo += (1 - Math.exp(-2 * Math.PI * cut / SR)) * (raw - lo);
      const v = g * lo * Math.min(1, tt / .002) * Math.exp(-tt / .18);
      add(i0 + j, v * (1 - pan), v * (1 + pan), v * wet);
    }
  }
  /** The lead: two saws a fifth of a cent apart and a square an octave down, a gentle vibrato, into the delay. */
  function leadNote(t0, m, dur, g) {
    const f = hz(m), i0 = at(t0);
    let p1 = 0, p2 = .5, p3 = 0, lo = 0;
    for (let j = 0; j < SR * (dur + .25); j++) {
      const tt = j / SR, vib = 1 + .004 * Math.sin(2 * Math.PI * 5.5 * tt) * Math.min(1, tt / .2);
      const ff = f * vib;
      p1 = (p1 + ff / SR) % 1; p2 = (p2 + ff * 1.004 / SR) % 1; p3 = (p3 + ff / 2 / SR) % 1;
      const raw = saw(p1, ff / SR) + saw(p2, ff / SR) + .5 * (p3 < .5 ? 1 : -1);
      const cut = 1800 + 2600 * Math.exp(-tt / .12);
      lo += (1 - Math.exp(-2 * Math.PI * cut / SR)) * (raw - lo);
      const env = Math.min(1, tt / .008) * (tt < dur ? 1 - .25 * Math.min(1, tt / .3) : .75 * Math.exp(-(tt - dur) / .06));
      if (i0 + j < n) lead[i0 + j] += g * lo * env * .5;
    }
  }
  /** A wide chord hit: the supersaw, bright, decaying over `dur`. */
  function stab(t0, chord, g, dur = 1.6) {
    const i0 = at(t0);
    for (const m of [...chord, chord[0] - 12, chord[2] + 12]) {
      for (const d of DET) {
        const f = hz(m + d), dt = f / SR, pan = d * 3;
        let p = (m * 3 + d * 7) % 1;
        for (let j = 0; j < SR * dur; j++) {
          p += dt; if (p >= 1) p -= 1;
          const v = g * .012 * saw(p, dt) * Math.min(1, j / SR / .005) * Math.exp(-j / SR / (dur / 3));
          add(i0 + j, v * (1 - pan), v * (1 + pan), v * .6);
        }
      }
    }
  }
}
