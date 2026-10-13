// The intro film's score, synthesized (no samples, no dependency) on the film's cues (window.MUSIC of tools/intro.html):
// 124 BPM in D major (D · A · Bm · G), a section an act of the picture.
//   intro     a soft chord bed, a heartbeat under the button, marimba under the drafting, a riser into the drop
//   drop      four-on-the-floor, house organ and bass on the off-beats, the marimba hook (the slides, the tunnel, the panel)
//   act A     electro-pop: a bouncing pluck hook through a ping-pong delay, a syncopated bass, accented sixteenths; in its
//             second half vocal chops answer the pluck; two bars building into
//   act B     the big drop: supersaw chords on a syncopated rhythm, ducking hard under the kick, an 808, the vocal-chop hook
//   act C     dark, half time, in B minor (Bm · G · D · A): a big snare on three, an 808 gliding, trap hat rolls, a dark
//             arpeggio, a far "oh"
//   act D     back to the light: act A's groove and its hook again, two bars (the themes, the languages), falling away
//   the end   a break (the pad, the marimba, a held "ah"), a riser, the second drop with the hook, the last chord ringing
// Each act comes in on a reversed cymbal or a riser and a hit. Every motion of the picture has its sound (cues.sfx): put on
// the beat's grid, one at a time, the pitched ones on the chord playing; the melody steps aside for them.
// score(cues) → a 48 kHz stereo 16-bit WAV, as a Buffer.
const SR = 48000;
const hz = (m) => 440 * 2 ** ((m - 69) / 12);
const CHORDS = [[62, 66, 69, 74], [61, 64, 69, 73], [62, 66, 71, 74], [62, 67, 71, 74]]; // D · A · Bm · G
const ROOTS = [38, 33, 35, 31]; // D2 · A1 · B1 · G1
const DARK = [2, 3, 0, 1]; // act C: Bm · G · D · A
const DET = [-.16, -.07, 0, .07, .16]; // a supersaw's voices, in semitones
// the drop's marimba hook, over four bars of eighths: [step, note]
const HOOK = [[0, 78], [1, 81], [3, 81], [4, 78], [6, 76], [7, 74], [8, 76], [9, 73], [11, 76], [12, 81], [14, 76], [15, 73],
  [16, 74], [17, 78], [19, 83], [20, 81], [22, 78], [23, 74], [24, 74], [25, 79], [27, 78], [28, 76], [30, 74], [31, 73]];
// act A's pluck hook, four bars of sixteenths: [step, note]
const PLUCK = [[0, 78], [2, 81], [4, 86], [6, 81], [7, 83], [8, 81], [10, 78], [12, 76], [14, 78],
  [16, 76], [18, 81], [20, 85], [22, 81], [23, 83], [24, 81], [26, 76], [28, 73], [30, 76],
  [32, 78], [34, 83], [36, 86], [38, 83], [39, 85], [40, 86], [42, 83], [44, 81], [46, 78],
  [48, 79], [50, 83], [52, 86], [54, 88], [56, 86], [58, 83], [60, 81], [62, 78]];
// the vocal-chop hook, four bars of sixteenths: [step, note, vowel, length in sixteenths]
const VOX = [[0, 81, 'a', 1.5], [2, 81, 'a', 1], [3, 83, 'e', 1], [4, 81, 'a', 1.5], [6, 78, 'o', 2], [8, 81, 'a', 1.5], [10, 83, 'e', 1], [11, 86, 'i', 1], [12, 83, 'e', 1.5], [14, 81, 'a', 2],
  [16, 81, 'a', 1.5], [18, 81, 'a', 1], [19, 85, 'e', 1], [20, 81, 'a', 1.5], [22, 76, 'o', 2], [24, 81, 'a', 1.5], [26, 85, 'e', 1], [27, 88, 'i', 1], [28, 85, 'e', 1.5], [30, 81, 'a', 2],
  [32, 83, 'a', 1.5], [34, 83, 'a', 1], [35, 86, 'e', 1], [36, 83, 'a', 1.5], [38, 78, 'o', 2], [40, 83, 'a', 1.5], [42, 86, 'e', 1], [43, 90, 'i', 1], [44, 86, 'e', 1.5], [46, 83, 'a', 2],
  [48, 83, 'a', 1.5], [50, 83, 'a', 1], [51, 86, 'e', 1], [52, 83, 'a', 1.5], [54, 79, 'o', 2], [56, 81, 'a', 1.5], [58, 83, 'e', 1], [59, 81, 'a', 1], [60, 78, 'o', 4]];
// the formants of the vowels, in Hz
const VOWELS = { a: [800, 1150, 2900], e: [530, 1840, 2480], i: [300, 2200, 3000], o: [450, 800, 2830] };
let seed = 7;
const noise = () => ((seed = (seed * 16807) % 2147483647) / 1073741823.5) - 1; // deterministic: the same score every time

/** A band-limited sawtooth (polyBLEP) at phase p (0..1) advancing by dt per sample. */
function saw(p, dt) {
  let v = 2 * p - 1;
  if (p < dt) { const x = p / dt; v -= x + x - x * x - 1; } else if (p > 1 - dt) { const x = (p - 1) / dt; v -= x * x + x + x + 1; }
  return v;
}

export function score({ duration, beat, sfx = [], marks }) {
  const n = Math.ceil((duration + .5) * SR);
  const L = new Float32Array(n), R = new Float32Array(n), send = new Float32Array(n); // send: to the reverb (mono)
  const pumped = new Float32Array(n); // bass, chords, pads: ducked by the kick
  const lead = new Float32Array(n); // plucks and voices: into the ping-pong delay
  const at = (t) => Math.max(0, Math.round(t * SR));
  const add = (i, l, r = l, s = 0) => { if (i >= 0 && i < n) { L[i] += l; R[i] += r; send[i] += s; } };
  const bar = beat * 4, s16 = beat / 4;
  const { drop, drop2, land } = marks, [r0, r1] = marks.riser, [b0, b1] = marks.break, [q0, q1] = marks.riser2;
  const [a0, a1] = marks.A, [bb0, bb1] = marks.B, [c0, c1] = marks.C, [d0, d1] = marks.D;
  // the progression starts again with every section, so its melodies (written from its first chord) fall on their chords
  const STARTS = [0, drop, a0, bb0, c0, d0, b0, drop2, land];
  const chordAt = (t) => { const b = Math.floor((t - STARTS.findLast((x) => x <= t + 1e-6)) / bar + 1e-6) % 4; return t >= c0 && t < c1 ? DARK[b] : b; };
  const fadeOut = (t) => 1 - Math.min(1, Math.max(0, (t - duration + 1.8) / 1.8));

  // the picture's sounds, on the beat's grid (a 32nd; a key or a thud on a 16th), one of a kind a slot, the pitched ones
  // (blips, pops) one a 16th at most; two whooshes never on one another. The melody steps aside where they sound.
  const grid = (t, d) => Math.round(t / d) * d;
  const cues = [], last = {};
  for (const c of [...sfx].sort((a, b) => a.t - b.t)) {
    const air = c.k === 'whoosh' || c.k === 'swish';
    const cls = air ? 'air' : c.k === 'blip' || c.k === 'pop' ? 'pitched' : c.k;
    const t = air ? c.t : grid(c.t, c.k === 'tick' || c.k === 'thud' ? s16 : beat / 8);
    const gap = air ? .3 : cls === 'pitched' || cls === 'tick' ? s16 - 1e-3 : beat / 8 - 1e-3;
    if (last[cls] != null && t - last[cls] < gap) continue;
    last[cls] = t;
    cues.push({ ...c, t });
  }
  const pitched = cues.filter((c) => ['blip', 'pop', 'ding', 'shine'].includes(c.k)).map((c) => c.t);
  const free = (t) => !pitched.some((x) => Math.abs(x - t) < s16); // no pitched sound of the picture there

  // ---------------- drums ----------------
  const kicks = [];
  const kick = (t0, g, tone = 1) => {
    kicks.push(t0);
    const i0 = at(t0);
    let ph = 0;
    for (let j = 0; j < SR * .4; j++) {
      const t = j / SR, f = 50 + 125 * Math.exp(-t / .028);
      ph += 2 * Math.PI * f / SR;
      const click = j < SR * .003 ? .6 * noise() * (1 - j / (SR * .003)) : 0;
      const v = g * (Math.tanh(1.9 * Math.sin(ph)) * Math.exp(-t / (.17 * tone)) + click);
      add(i0 + j, v, v, v * .04);
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
  const clap = (t0, g) => { for (const [d, k] of [[0, .6], [.009, .8], [.019, 1]]) burst(t0 + d, .22, 1500, .5, g * k, d < .015 ? .007 : .08, 0, .5); };
  const hat = (t0, g, open = false, pan = .15) => {
    const i0 = at(t0);
    let prev = 0;
    for (let j = 0; j < SR * (open ? .2 : .04); j++) {
      const x = noise(), hh = x - prev; prev = x;
      const v = g * hh * Math.exp(-j / SR / (open ? .06 : .011));
      add(i0 + j, v * (1 - pan), v * (1 + pan), v * .12);
    }
  };
  const snare = (t0, g, wet = .35) => {
    burst(t0, .18, 2300, .8, g, .05, 0, wet);
    const i0 = at(t0);
    for (let j = 0; j < SR * .08; j++) { const v = g * .55 * Math.sin(2 * Math.PI * 200 * j / SR) * Math.exp(-j / SR / .028); add(i0 + j, v, v, v * wet * .5); }
  };
  const crash = (t0, g) => {
    const i0 = at(t0);
    let prev = 0;
    for (let j = 0; j < SR * 2.4; j++) {
      const x = noise(), hh = x - prev; prev = x;
      const v = g * hh * Math.exp(-j / SR / .7);
      add(i0 + j, v * (1 + .3 * Math.sin(j / 800)), v * (1 - .3 * Math.sin(j / 800)), v * .6);
    }
  };
  const boom = (t0, g) => {
    const i0 = at(t0);
    let ph = 0, lp = 0;
    for (let j = 0; j < SR * 3; j++) {
      const t = j / SR, f = 32 + 60 * Math.exp(-t / .18);
      ph += 2 * Math.PI * f / SR;
      lp += .05 * (noise() - lp);
      const v = g * (Math.sin(ph) * Math.exp(-t / 1) + 1.2 * lp * Math.exp(-t / .35));
      add(i0 + j, v, v, v * .5);
    }
  };
  /** Noise swept through a bandpass from f0 to f1: bell-shaped (a whoosh), rising (a riser) or falling away, panned. */
  const sweep = (t0, dur, f0, f1, g, shape = 'bell', wet = .5, p0 = -.3, p1 = .3) => {
    const i0 = at(t0);
    let lo = 0, bp = 0;
    for (let j = 0; j < dur * SR; j++) {
      const k = j / (dur * SR), f = f0 * (f1 / f0) ** k, pan = p0 + (p1 - p0) * k;
      const F = 2 * Math.sin(Math.PI * Math.min(f, SR / 6) / SR);
      const x = noise(), hp = x - lo - .35 * bp;
      bp += F * hp; lo += F * bp;
      const e = shape === 'rise' ? k ** 2.2 : shape === 'fall' ? (1 - k) ** 2 : Math.sin(Math.PI * k) ** 2;
      add(i0 + j, g * bp * e * (1 - pan), g * bp * e * (1 + pan), g * bp * e * wet);
    }
  };
  /** A cymbal reversed: bright noise swelling into tEnd, cut there. */
  const reverse = (tEnd, dur, g) => {
    const i0 = at(tEnd - dur);
    let prev = 0;
    for (let j = 0; j < dur * SR; j++) {
      const k = j / (dur * SR), x = noise(), hh = x - prev; prev = x;
      const v = g * hh * k ** 3;
      add(i0 + j, v * (1 - .3 * k), v * (.7 + .3 * k), v * .4);
    }
  };

  // ---------------- voices ----------------
  /** A marimba: the note and its fourth partial, a knock of noise, panned by pitch. */
  const marimba = (t0, m, g, wet = .35) => {
    const f = hz(m), i0 = at(t0), pan = ((m % 12) / 12 - .5) * .5;
    for (let j = 0; j < SR * .9; j++) {
      const t = j / SR;
      const v = g * (Math.sin(2 * Math.PI * f * t) * Math.exp(-t / .32) + .3 * Math.sin(2 * Math.PI * f * 3.93 * t) * Math.exp(-t / .05)
        + (j < SR * .002 ? .3 * noise() : 0)) * Math.min(1, t / .001);
      add(i0 + j, v * (1 - pan), v * (1 + pan), v * wet);
    }
  };
  /** A house organ stab: the chord's notes and their harmonics, a short decay; into the pumped bus. */
  const organ = (t0, chord, g, dur = .2) => {
    const i0 = at(t0);
    for (const m of chord) {
      const f = hz(m);
      for (let j = 0; j < SR * (dur + .1); j++) {
        const t = j / SR, env = Math.min(1, t / .004) * Math.exp(-t / dur);
        const v = g * env * (Math.sin(2 * Math.PI * f * t) + .5 * Math.sin(4 * Math.PI * f * t) + .25 * Math.sin(6 * Math.PI * f * t) + .12 * Math.sin(8 * Math.PI * f * t));
        if (i0 + j < n) { pumped[i0 + j] += v; send[i0 + j] += v * .25; }
      }
    }
  };
  /** A bass note: a sine and a little saw through a lowpass closing fast; into the pumped bus. */
  const bass = (t0, m, g, dur, bright = 1400) => {
    const f = hz(m), i0 = at(t0);
    let p = 0, lp = 0;
    for (let j = 0; j < SR * dur; j++) {
      const t = j / SR;
      p = (p + f / SR) % 1;
      const raw = Math.sin(2 * Math.PI * p) + .4 * saw(p, f / SR);
      lp += (1 - Math.exp(-2 * Math.PI * (220 + bright * Math.exp(-t / .05)) / SR)) * (raw - lp);
      if (i0 + j < n) pumped[i0 + j] += g * lp * Math.min(1, t / .004) * Math.min(1, (dur - t) / .02);
    }
  };
  /** An 808: a sine falling into its note, held, gliding to the next one at its end; saturated; into the pumped bus. */
  const b808 = (t0, m, dur, g, m2 = m) => {
    const i0 = at(t0);
    let ph = 0;
    for (let j = 0; j < SR * dur; j++) {
      const t = j / SR, glide = Math.min(1, Math.max(0, (t - dur + .12) / .12)), f = hz(m + (m2 - m) * glide) * (1 + 1.5 * Math.exp(-t / .02));
      ph += 2 * Math.PI * f / SR;
      if (i0 + j < n) pumped[i0 + j] += g * Math.tanh(2.2 * Math.sin(ph)) * Math.min(1, t / .003) * Math.min(1, (dur - t) / .03);
    }
  };
  /** A soft pad: the chord's notes, two sines a few cents apart each, slow in and out; into the pumped bus. */
  const pad = (t0, t1, chord, g) => {
    const i0 = at(t0), i1 = Math.min(n, at(t1 + .6));
    for (const m of chord) {
      const f = hz(m);
      for (let i = i0; i < i1; i++) {
        const t = i / SR, e = Math.min(1, (t - t0) / .5) * (t > t1 ? Math.max(0, 1 - (t - t1) / .6) : 1);
        pumped[i] += g * e * (Math.sin(2 * Math.PI * f * .997 * t) + Math.sin(2 * Math.PI * f * 1.003 * t)) * .5;
      }
    }
  };
  /** Supersaw chords: five detuned saws a note through a lowpass; into the pumped bus (they breathe with the kick). */
  const supersaw = (t0, dur, chord, g, cut = 3200) => {
    const i0 = at(t0), len = Math.round((dur + .08) * SR), tmp = new Float32Array(len);
    for (const m of chord) for (const d of DET) {
      const f = hz(m + d), dt = f / SR;
      let p = (m * 7 + d * 13) % 1;
      for (let j = 0; j < len; j++) { p += dt; if (p >= 1) p -= 1; tmp[j] += saw(p, dt) * (d < 0 ? 1.1 : .9); }
    }
    let lp = 0, lp2 = 0;
    for (let j = 0; j < len; j++) {
      const t = j / SR, a = 1 - Math.exp(-2 * Math.PI * cut * (.55 + .45 * Math.exp(-t / .15)) / SR);
      lp += a * (tmp[j] - lp); lp2 += a * (lp - lp2);
      const env = Math.min(1, t / .005) * (t > dur ? Math.max(0, 1 - (t - dur) / .08) : 1);
      if (i0 + j < n) { pumped[i0 + j] += g * .02 * lp2 * env; send[i0 + j] += g * .006 * lp2 * env; }
    }
  };
  /** A pluck: two detuned saws through a lowpass closing fast; into the lead bus (the delay). */
  const pluck = (t0, m, g, decay = .16, cut = 5200) => {
    const f = hz(m), i0 = at(t0);
    let p1 = 0, p2 = .3, lo = 0;
    for (let j = 0; j < SR * .5; j++) {
      const tt = j / SR;
      p1 = (p1 + f / SR) % 1; p2 = (p2 + f * 1.007 / SR) % 1;
      const raw = saw(p1, f / SR) + saw(p2, f * 1.007 / SR);
      lo += (1 - Math.exp(-2 * Math.PI * (500 + cut * Math.exp(-tt / .05)) / SR)) * (raw - lo);
      if (i0 + j < n) lead[i0 + j] += g * lo * Math.min(1, tt / .002) * Math.exp(-tt / decay);
    }
  };
  /** A vocal chop: a saw scooping up into its note with a little vibrato, through the vowel's three formants; into the lead bus. */
  const vox = (t0, m, vowel, dur, g) => {
    const i0 = at(t0), F = VOWELS[vowel], W = [1, .55, .3], st = F.map(() => [0, 0]);
    let p = 0;
    for (let j = 0; j < SR * (dur + .06); j++) {
      const t = j / SR, f = hz(m - Math.exp(-t / .03)) * (1 + .006 * Math.sin(2 * Math.PI * 5.5 * t) * Math.min(1, t / .15)), dt = f / SR;
      p += dt; if (p >= 1) p -= 1;
      const x = saw(p, dt) + .05 * noise();
      let y = 0;
      F.forEach((ff, k) => { const c = 2 * Math.sin(Math.PI * ff / SR), s = st[k], hp = x - s[0] - .12 * s[1]; s[1] += c * hp; s[0] += c * s[1]; y += W[k] * s[1]; });
      const env = Math.min(1, t / .008) * (t > dur ? Math.max(0, 1 - (t - dur) / .06) : 1);
      if (i0 + j < n) lead[i0 + j] += g * .35 * y * env;
    }
  };
  const bell = (t0, f, g) => {
    const i0 = at(t0);
    for (let j = 0; j < SR * 1.2; j++) {
      const t = j / SR;
      const v = g * (Math.sin(2 * Math.PI * f * t) * Math.exp(-t / .5) + .5 * Math.sin(2 * Math.PI * f * 2.76 * t) * Math.exp(-t / .18) + .25 * Math.sin(2 * Math.PI * f * 5.4 * t) * Math.exp(-t / .07));
      add(i0 + j, v, v, v * .6);
    }
  };
  const riser = (a, z, g = 1) => {
    for (let t = a; t < z - beat / 2;) { const p = (t - a) / (z - a); snare(t, (.08 + .35 * p * p) * g); t += beat / (p < .5 ? 2 : p < .8 ? 4 : 8); }
    sweep(a, z - a, 300, 9000, .3 * g, 'rise', .7);
  };
  const impact = (t, chord = CHORDS[0], g = 1) => { boom(t, .8 * g); crash(t, .28 * g); organ(t, [...chord, chord[0] - 12], .05 * g, .5); };

  // ---------------- the intro and the first drop ----------------
  for (let k = 0; k < 4; k++) kick(k * beat, .35, .7); // a heartbeat under the button
  for (let b = 0; b * bar < drop; b++) pad(b * bar, (b + 1) * bar, CHORDS[b % 4], .05 * Math.min(1, (b + 1) / 2));
  for (let t = 4 * beat, s = 0; t < r0 - .01; t += beat / 2, s++) if (free(t)) marimba(t, CHORDS[chordAt(t + .001)][[0, 1, 2, 3, 2, 1, 2, 3][s % 8]] + 12, .045);
  for (let t = 8 * beat; t < r0 - .01; t += beat) kick(t, .45, .8);
  for (let t = 8 * beat; t < r0 - .01; t += beat / 2) hat(t, .03 + .02 * ((t - 8 * beat) / (r0 - 8 * beat)));
  riser(r0, r1);
  impact(drop);
  for (let t = drop; t < a0 - .01; t += beat) {
    const b = Math.round((t - drop) / beat), c = chordAt(t + .001);
    kick(t, .8);
    if (b % 2 === 1) clap(t, .26);
    hat(t + beat / 2, .07, true);
    for (const s of [.25, .75]) hat(t + beat * s, .028, false, -.25);
    organ(t + beat / 2, CHORDS[c], .028);
    bass(t + beat / 2, ROOTS[c] + 12 * (b % 4 === 3 ? 1 : 0), .3, beat * .45);
  }
  for (const [step, m] of HOOK) { const t = drop + step * beat / 2; if (free(t)) marimba(t, m, .11); }
  reverse(a0, beat, .1); crash(a0, .2);

  // ---------------- act A: electro-pop ----------------
  const BASS_A = [[0, 0, 3], [3, 12, 1], [6, 0, 2], [8, 7, 2], [11, 12, 1], [14, 0, 2]]; // a bar: [16th, interval, length]
  for (let t = a0; t < a1 - .01; t += bar) {
    const bi = Math.round((t - a0) / bar), c = chordAt(t + .001), build = bi >= 8; // the last two bars build into act B
    for (let k = 0; k < 4; k++) {
      const tb = t + k * beat;
      kick(tb, .8);
      if (k % 2) clap(tb, .27);
      hat(tb + beat / 2, .06, true);
      for (let s = 0; s < 4; s++) if (s !== 2) hat(tb + s * s16, s % 2 ? .022 : .035, false, -.25);
    }
    if (!build) for (const [st, iv, len] of BASS_A) bass(t + st * s16, ROOTS[c] + iv, .3, len * s16 * .9, 1800);
    else for (let s = 0; s < 16; s += 2) bass(t + s * s16, ROOTS[c] + (s % 4 ? 12 : 0), .28, s16 * 1.8);
    organ(t, CHORDS[c], .02, .3); organ(t + 6 * s16, CHORDS[c], .016, .2); organ(t + 10 * s16, CHORDS[c], .016, .2);
    // the pluck hook; from the fifth bar it plays the first half of each bar, and voices answer in the second
    for (const [st, m] of PLUCK) {
      const s = st % 16, tt = t + s * s16;
      if (Math.floor(st / 16) !== bi % 4 || build || (bi >= 4 && s >= 8) || !free(tt)) continue;
      pluck(tt, m, .085);
    }
    if (bi >= 4 && !build) for (const [st, m, v, len] of VOX) {
      const s = st % 16, tt = t + s * s16;
      if (Math.floor(st / 16) === bi % 4 && s >= 8 && free(tt)) vox(tt, m - 12, v, len * s16 * .85, .1);
    }
    if (build) for (let s = 0; s < 16; s++) { const tt = t + s * s16; if (free(tt)) pluck(tt, CHORDS[c][s % 4] + 12 * (1 + bi - 8), .05, .1); }
    if (bi % 4 === 3 && !build) for (let k = 0; k < 4; k++) snare(t + 3 * beat + k * s16, .08 + .04 * k);
  }
  riser(a1 - 2 * bar, a1, .9);

  // ---------------- act B: the big drop ----------------
  const RHY = [[0, 3], [3, 3], [6, 4], [10, 2], [12, 2], [14, 2]]; // the chords' rhythm: [16th, length]
  impact(bb0, CHORDS[0], .9);
  for (let t = bb0; t < bb1 - .01; t += bar) {
    const bi = Math.round((t - bb0) / bar), c = chordAt(t + .001), fall = bi >= 9; // the last bar falls away into the dark
    for (let k = 0; k < 4; k++) {
      const tb = t + k * beat;
      if (!(fall && k >= 2)) kick(tb, .9);
      if (k % 2) { clap(tb, .3); snare(tb, .12); }
      hat(tb + beat / 2, .07, true);
      for (const s of [1, 3]) hat(tb + s * s16, .026, false, -.25);
    }
    for (const [st, len] of RHY) supersaw(t + st * s16, len * s16 * .92, [...CHORDS[c], CHORDS[c][0] - 12], fall ? .7 : 1);
    b808(t, ROOTS[c] + 12, bar * .95, .22);
    for (const [st, m, v, len] of VOX) {
      const tt = t + (st % 16) * s16;
      if (Math.floor(st / 16) === bi % 4 && free(tt)) vox(tt, m, v, len * s16 * .85, .14);
    }
    if (bi % 4 === 3) crash(t + bar, .14);
  }
  sweep(bb1 - beat * 2, beat * 2, 6000, 120, .3, 'fall', .6); // a downlifter into the dark
  reverse(c0, beat, .1);

  // ---------------- act C: dark, half time ----------------
  boom(c0, .9); crash(c0, .22);
  for (let t = c0; t < c1 - .01; t += bar) {
    const bi = Math.round((t - c0) / bar), c = chordAt(t + .001), nc = chordAt(t + bar + .001), last = t + bar >= c1 - .01;
    kick(t, .95); kick(t + 10 * s16, .8);
    if (bi % 2) kick(t + 7 * s16, .45, .8);
    snare(t + 8 * s16, .42, .55); clap(t + 8 * s16, .2);
    for (let s = 0; s < 16; s += 2) hat(t + s * s16, s % 4 ? .03 : .045, false, .3);
    if (bi % 2) for (let k = 0; k < 6; k++) hat(t + 13 * s16 + k * s16 / 2, .02 + .006 * k, false, -.3); // a trap roll
    b808(t, ROOTS[c], 9 * s16, .3, ROOTS[c] + 12); b808(t + 10 * s16, ROOTS[c] + 12, 6 * s16 * .95, .24, ROOTS[nc]);
    pad(t, t + bar, CHORDS[c].map((m) => m - 12), .03);
    for (let s = 0; s < 8; s++) { const tt = t + s * beat / 2; if (free(tt)) pluck(tt, CHORDS[c][[0, 1, 2, 1, 3, 2, 1, 2][s]] + 12, .045, .2, 2600); }
    if (bi % 2 === 0 && !last) vox(t, CHORDS[c][1] + 12, 'o', beat * 1.8, .06);
    if (last) reverse(t + bar, beat * 2, .14); // a cymbal reversed into the light
  }

  // ---------------- act D: back to the light: act A's groove and its hook, two bars, falling away into the break ----------------
  crash(d0, .2); boom(d0, .45);
  for (let t = d0; t < d1 - .01; t += bar) {
    const bi = Math.round((t - d0) / bar), c = chordAt(t + .001);
    for (let k = 0; k < 4; k++) {
      const tb = t + k * beat;
      kick(tb, .8);
      if (k % 2) clap(tb, .27);
      hat(tb + beat / 2, .06, true);
      for (let s = 0; s < 4; s++) if (s !== 2) hat(tb + s * s16, s % 2 ? .022 : .035, false, -.25);
    }
    for (const [st, iv, len] of BASS_A) bass(t + st * s16, ROOTS[c] + iv, .3, len * s16 * .9, 1800);
    organ(t, CHORDS[c], .02, .3); organ(t + 6 * s16, CHORDS[c], .016, .2); organ(t + 10 * s16, CHORDS[c], .016, .2);
    for (const [st, m] of PLUCK) { const tt = t + (st % 16) * s16; if (Math.floor(st / 16) === bi && free(tt)) pluck(tt, m, .085); }
  }
  sweep(d1 - beat, beat * 2.5, 6000, 150, .25, 'fall', .6);

  // ---------------- the end: the break, the second drop, the last chord ----------------
  for (let t = b0; t < b1; t += bar) { const c = chordAt(t + .001); pad(t, t + bar, CHORDS[c], .035); vox(t, CHORDS[c][1] + 12, 'a', bar * .9, .045); }
  for (let t = b0, s = 0; t < q0; t += beat / 2, s++) if (free(t)) marimba(t, CHORDS[chordAt(t + .001)][[0, 2, 1, 3][s % 4]] + 12, .045);
  riser(q0, q1);
  impact(drop2, CHORDS[0], .9);
  for (let t = drop2; t < land - .01; t += bar) {
    const bi = Math.round((t - drop2) / bar), c = chordAt(t + .001);
    for (let k = 0; k < 4; k++) { const tb = t + k * beat; kick(tb, .9); if (k % 2) { clap(tb, .3); snare(tb, .12); } hat(tb + beat / 2, .07, true); }
    for (const [st, len] of RHY) supersaw(t + st * s16, len * s16 * .92, [...CHORDS[c], CHORDS[c][0] - 12], 1);
    b808(t, ROOTS[c] + 12, bar * .95, .22);
    for (const [st, m, v, len] of VOX) { const tt = t + (st % 16) * s16; if (Math.floor(st / 16) === bi % 4 && free(tt)) vox(tt, m, v, len * s16 * .85, .15); }
  }
  for (let k = 0; k < 4; k++) snare(land - beat + k * s16, .1 + .05 * k);
  impact(land, CHORDS[0], 1.1);
  supersaw(land, 3.2, [...CHORDS[0], 50, 81], .9, 2400);
  pad(land, duration, [...CHORDS[0], 57, 81], .03);
  for (const [k, m] of [[0, 74], [.5, 78], [1, 81], [1.5, 86]]) marimba(land + k * beat, m, .1);
  vox(land + beat, 81, 'a', 1.6, .06);

  // ---------------- the picture's sounds ----------------
  /** A note of the chord playing at t (p: which, upwards), `oct` octaves above its voicing. */
  const tone = (t, p, oct) => { const c = CHORDS[chordAt(t)]; return c[p % 4] + 12 * (oct + (Math.floor(p / 4) % 2)); };
  /** A glassy note: the tone, its third harmonic, a short ring; high above the music. */
  const glass = (t0, m, g) => {
    const f = hz(m), i0 = at(t0);
    for (let j = 0; j < SR * .5; j++) {
      const tt = j / SR, v = g * (Math.sin(2 * Math.PI * f * tt) * Math.exp(-tt / .14) + .25 * Math.sin(6 * Math.PI * f * tt) * Math.exp(-tt / .04)) * Math.min(1, tt / .002);
      add(i0 + j, v * .9, v * 1.1, v * .5);
    }
  };
  for (const { t, k, g, p } of cues) {
    if (k === 'tick') burst(t, .02, 6500, .5, .05 * g, .004, .25 * Math.sin(t * 13), .03);
    else if (k === 'click') { burst(t, .02, 2600, .6, .13 * g, .004, 0, .08); burst(t + .045, .02, 3400, .6, .09 * g, .003, 0, .08); }
    else if (k === 'pop') { // a bubble: a quick fall onto a note of the chord
      const i0 = at(t), f = hz(tone(t, p, 2));
      let ph = 0;
      for (let j = 0; j < SR * .09; j++) { const tt = j / SR; ph += 2 * Math.PI * f * (1 + .5 * Math.exp(-tt / .012)) / SR; const v = .07 * g * Math.sin(ph) * Math.exp(-tt / .03) * Math.min(1, tt / .001); add(i0 + j, v, v, v * .25); }
    } else if (k === 'blip') glass(t, tone(t, p, 2), .045 * g);
    else if (k === 'swish') sweep(t - .05, .3, 5000, 900, .07 * g, 'bell', .3, -.5, .5);
    else if (k === 'whoosh') sweep(t - .1, .55, 7000, 350, .11 * g, 'bell', .4, .6, -.6);
    else if (k === 'ding') bell(t, hz(tone(t, 3, 2)), .05 * g);
    else if (k === 'thud') { // a low knock; not a kick: nothing pumps on it
      const i0 = at(t);
      let ph = 0;
      for (let j = 0; j < SR * .3; j++) { const tt = j / SR; ph += 2 * Math.PI * (45 + 55 * Math.exp(-tt / .04)) / SR; const v = .3 * g * Math.sin(ph) * Math.exp(-tt / .1); add(i0 + j, v, v, v * .1); }
      burst(t, .1, 600, .6, .1 * g, .025, 0, .2);
    } else if (k === 'shine') for (let j = 0; j < 6; j++) glass(t + j * beat / 8, tone(t, j, 2), .025 * g);
    else if (k === 'glitch') for (let j = 0; j < 6; j++) burst(t + j * .022, .02, 800 + 4000 * ((j * 7) % 5) / 5, .3, .1 * g, .01, j % 2 ? .6 : -.6, .1);
    else if (k === 'scan') { // a beam: a soft tone sweeping up, trembling
      const i0 = at(t);
      let ph = 0;
      for (let j = 0; j < SR * .55; j++) { const tt = j / SR; ph += 2 * Math.PI * 500 * 4 ** (tt / .55) / SR; const v = .035 * g * Math.sin(ph) * Math.sin(Math.PI * tt / .55) * (.6 + .4 * Math.sin(2 * Math.PI * 24 * tt)); add(i0 + j, v * .7, v, v * .4); }
    } else if (k === 'zap') { // a packet sent: a fast falling tone, a spark of noise
      const i0 = at(t);
      let ph = 0;
      for (let j = 0; j < SR * .16; j++) { const tt = j / SR; ph += 2 * Math.PI * (2400 * Math.exp(-tt / .04) + 180) / SR; const v = .07 * g * Math.sin(ph) * Math.exp(-tt / .06); add(i0 + j, v, v, v * .3); }
      burst(t, .04, 5000, .5, .06 * g, .01, .3, .1);
    } else if (k === 'rewind') { // a tape rewinding: a chopped noise rising fast
      const i0 = at(t);
      let lo = 0, bp = 0;
      for (let j = 0; j < SR * .8; j++) {
        const tt = j / SR, F = 2 * Math.sin(Math.PI * Math.min(300 * 12 ** (tt / .8), SR / 6) / SR), x = noise(), hp = x - lo - .4 * bp;
        bp += F * hp; lo += F * bp;
        const v = .12 * g * bp * (Math.sin(2 * Math.PI * (8 + 30 * tt) * tt) > 0 ? 1 : .2) * Math.min(1, (.8 - tt) / .05);
        add(i0 + j, v, v, v * .2);
      }
    }
  }

  // ---------------- the pump, the delay, the reverb, the master ----------------
  kicks.sort((a, b) => a - b);
  let ki = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    while (ki + 1 < kicks.length && kicks[ki + 1] <= t) ki++;
    const since = kicks[ki] !== undefined && kicks[ki] <= t ? t - kicks[ki] : 9;
    const v = pumped[i] * (1 - .75 * Math.exp(-since / .1)) * fadeOut(t);
    add(i, v, v, v * .3);
  }
  // the leads' ping-pong delay (a dotted eighth)
  const D = Math.round(beat * .75 * SR), dl = new Float32Array(n), dr = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    dl[i] = lead[i] + (i >= D ? .38 * dr[i - D] : 0); dr[i] = i >= D ? .38 * dl[i - D] : 0;
    add(i, lead[i] + .35 * (dl[i] - lead[i]), lead[i] + .35 * dr[i], lead[i] * .35);
  }
  const verb = (x, offs) => {
    const out = new Float32Array(n);
    for (const [d0, fb] of [[1557, .78], [1617, .78], [1491, .78], [1422, .78]]) {
      const d = Math.round((d0 + offs) * SR / 44100) * 2, buf = new Float32Array(d);
      let p = 0, lo = 0;
      for (let i = 0; i < n; i++) { const y = buf[p]; lo += .38 * (y - lo); buf[p] = x[i] + fb * lo; p = (p + 1) % d; out[i] += y * .25; }
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
    const t = i / SR, f = Math.min(1, t / .02) * fadeOut(t);
    L[i] = Math.tanh((L[i] + .28 * vl[i]) * 1.2) * f;
    R[i] = Math.tanh((R[i] + .28 * vr[i]) * 1.2) * f;
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
