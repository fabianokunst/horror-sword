// Procedural sound design: every effect, the ambience and the score are synthesized at runtime with WebAudio.
// No audio files are shipped, so there is nothing to license. Routing: sfx / music / ambience buses -> master ->
// pause filter -> compressor, with a generated cathedral reverb on a send. Positional sounds are panned and
// attenuated relative to the listener (player position + camera yaw).
let ctx = null, master, duck, verb, noiseBuf, sfxBus, musBus, musIn, ambBus, amb = null;
let muted = false, prevTime = 0;
const VOL = 0.9;
const last = {};
const L = { x: 0, z: 0, yaw: 0 };
try { muted = localStorage.getItem('hs-muted') === '1'; } catch {}

const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const hz = (m) => 440 * 2 ** ((m - 69) / 12);

export function initAudio() {
  if (ctx) { ctx.resume(); return; }
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  const comp = ctx.createDynamicsCompressor();
  for (const [k, v] of Object.entries({ threshold: -14, knee: 12, ratio: 6, attack: 0.003, release: 0.25 })) comp[k].value = v;
  comp.connect(ctx.destination);
  duck = ctx.createBiquadFilter();
  duck.frequency.value = 20000;
  duck.connect(comp);
  master = gain(muted ? 0 : VOL, duck);
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  verb = ctx.createConvolver();
  verb.buffer = impulse(3.4, 2.5);
  verb.connect(gain(0.8, master));
  sfxBus = gain(1, master);
  musBus = gain(0.3, master);
  musIn = gain(1, musBus);
  musIn.connect(gain(0.5, verb));
  ambBus = gain(0.8, master);
  document.addEventListener('visibilitychange', () => (document.hidden ? ctx.suspend() : ctx.resume()));
}

export function setListener(x, z, yaw) { L.x = x; L.z = z; L.yaw = yaw; }

// pause menu: everything goes muffled, as if heard through a wall
export function setPaused(p) {
  if (ctx) duck.frequency.setTargetAtTime(p ? 450 : 20000, ctx.currentTime, 0.12);
}

export function toggleMute() {
  muted = !muted;
  try { localStorage.setItem('hs-muted', muted ? '1' : '0'); } catch {}
  if (ctx) master.gain.setTargetAtTime(muted ? 0 : VOL, ctx.currentTime, 0.05);
  return muted;
}
export const isMuted = () => muted;

// ------------------------------------------------------------------ building blocks
function gain(v, to) {
  const g = ctx.createGain();
  g.gain.value = v;
  if (to) g.connect(to);
  return g;
}

// Cathedral-ish impulse response: decaying stereo noise that darkens as it fades.
function impulse(sec, decay) {
  const n = Math.floor(ctx.sampleRate * sec), b = ctx.createBuffer(2, n, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = b.getChannelData(c);
    let lp = 0;
    for (let i = 0; i < n; i++) {
      const k = i / n;
      lp += (Math.random() * 2 - 1 - lp) * (0.85 - 0.75 * k);
      d[i] = lp * (1 - k) ** decay * Math.min(1, i / 400);
    }
  }
  return b;
}

// Entry node for one sound. With a position: distance attenuation, air absorption and stereo pan; far sounds get more reverb.
function out(pos, wet = 0.2, bus = sfxBus) {
  const inp = ctx.createGain();
  let node = inp, att = 1;
  if (pos) {
    const dx = pos.x - L.x, dz = pos.z - L.z, d = Math.hypot(dx, dz);
    att = 1 / (1 + (d * d) / 150);
    const lp = ctx.createBiquadFilter();
    lp.frequency.value = 16000 / (1 + d / 10);
    lp.Q.value = 0.7;
    node = node.connect(lp);
    if (ctx.createStereoPanner && d > 0.5) {
      const p = ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, (dx * Math.cos(L.yaw) - dz * Math.sin(L.yaw)) / d)) * Math.min(1, d / 3) * 0.85;
      node = node.connect(p);
    }
    wet = Math.min(0.9, wet + d / 70);
  }
  node.connect(gain(att, bus));
  if (wet > 0) inp.connect(gain(wet * Math.sqrt(att), verb));
  return inp;
}

const around = (r0, r1) => {
  const a = Math.random() * Math.PI * 2, d = rnd(r0, r1);
  return { x: L.x + Math.cos(a) * d, z: L.z + Math.sin(a) * d };
};

// throttle: true at most once per `gap` seconds for key `k`
function free(k, gap) {
  const t = ctx.currentTime;
  if (t - (last[k] ?? -1e9) < gap) return false;
  last[k] = t;
  return true;
}

function env(p, t, a, peak, dur) {
  a = Math.min(a, dur * 0.5);
  p.setValueAtTime(0.0001, t);
  p.exponentialRampToValueAtTime(peak, t + a);
  p.exponentialRampToValueAtTime(0.0001, t + dur);
}

function asr(p, t, a, peak, dur) {
  p.setValueAtTime(0, t);
  p.linearRampToValueAtTime(peak, t + a);
  p.setValueAtTime(peak, t + dur - a);
  p.linearRampToValueAtTime(0, t + dur);
}

function lfo(param, t, end, f, depth, type = 'sine') {
  const l = ctx.createOscillator();
  l.type = type;
  l.frequency.value = f;
  l.connect(gain(depth, param));
  l.start(t);
  l.stop(end);
}

function osc(to, t, type, f0, f1, dur, peak, a = 0.005) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
  env(g.gain, t, a, peak, dur);
  o.connect(g).connect(to);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function noise(to, t, type, f0, f1, dur, peak, q = 1, a = 0.005) {
  const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
  s.buffer = noiseBuf;
  s.loop = true;
  f.type = type;
  f.Q.value = q;
  f.frequency.setValueAtTime(f0, t);
  f.frequency.exponentialRampToValueAtTime(f1, t + dur);
  env(g.gain, t, a, peak, dur);
  s.connect(f).connect(g).connect(to);
  s.start(t, Math.random() * 1.9);
  s.stop(t + dur + 0.02);
}

// Throat-like voice: an oscillator through three formant filters gliding from vowel v to v2.
// rough = growl (amplitude modulation), vib = vibrato depth, shift scales the formants (small creature > 1).
const VOWELS = { a: [730, 1090, 2440], o: [570, 840, 2410], u: [300, 870, 2240], e: [530, 1840, 2480], i: [270, 2290, 3010] };
function voice(to, t, pitch, dur, peak, v = 'a', { v2 = v, shift = 1, rough = 0, vib = 0, a = 0.03, wave = 'sawtooth', sus = false } = {}) {
  const o = ctx.createOscillator(), g = ctx.createGain(), end = t + dur + 0.05;
  o.type = wave;
  pitch.forEach((f, i) => (i ? o.frequency.exponentialRampToValueAtTime(f, t + (dur * i) / (pitch.length - 1)) : o.frequency.setValueAtTime(f, t)));
  (sus ? asr : env)(g.gain, t, a, peak, dur);
  if (vib) lfo(o.frequency, t, end, rnd(5, 7), pitch[0] * vib);
  let src = o;
  if (rough) {
    const am = gain(1 - rough);
    lfo(am.gain, t, end, rnd(28, 45), rough);
    src = o.connect(am);
  }
  VOWELS[v].forEach((f, i) => {
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 6;
    bp.frequency.setValueAtTime(f * shift, t);
    bp.frequency.linearRampToValueAtTime(VOWELS[v2][i] * shift, t + dur);
    src.connect(bp).connect(gain([2.5, 1.6, 0.8][i], g));
  });
  g.connect(to);
  o.start(t);
  o.stop(end);
}

// Church bell: inharmonic partials (hum, prime, minor-third tierce, quint, nominal...) with slow beating.
function bell(to, t, f, peak, dur = 6) {
  for (const [r, a, d] of [[0.5, 0.9, 1], [1, 0.7, 0.8], [1.19, 0.5, 0.6], [1.5, 0.3, 0.45], [2, 0.45, 0.4], [2.52, 0.2, 0.25], [3.01, 0.15, 0.2], [4.17, 0.1, 0.12]]) {
    osc(to, t, 'sine', f * r, f * r, dur * d, peak * a, 0.003);
    if (r <= 1) osc(to, t, 'sine', f * r * 1.004, f * r * 1.004, dur * d, peak * a * 0.6, 0.003);
  }
  noise(to, t, 'bandpass', f * 6, f * 3, 0.08, peak * 0.5, 2);
}

// Pipe organ: additive 16' 8' 4' 2 2/3' 2' 1 1/3' stops with a soft attack "chiff".
function organ(to, t, f, dur, peak) {
  for (const [r, a] of [[0.5, 0.45], [1, 1], [2, 0.6], [3, 0.3], [4, 0.25], [6, 0.1]]) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.value = f * r;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak * a, t + 0.04);
    g.gain.setValueAtTime(peak * a, t + dur);
    g.gain.linearRampToValueAtTime(0, t + dur + 0.3);
    o.connect(g).connect(to);
    o.start(t);
    o.stop(t + dur + 0.35);
  }
  noise(to, t, 'bandpass', f * 6, f * 4, 0.06, peak * 0.4, 3);
}

function thunder(to, t, k = 1) {
  noise(to, t, 'bandpass', 2200, 300, 0.35, 0.7 * k, 0.6, 0.002);
  noise(to, t + 0.05, 'lowpass', 420, 50, 3.5, 0.9 * k, 0.7, 0.12);
  noise(to, t + 0.9, 'lowpass', 220, 40, 3, 0.6 * k, 0.7, 0.3);
}

const hiss = (o, t, dur, peak) => noise(o, t, 'highpass', 3500, 6500, dur, peak, 0.7, 0.04);
const squeak = (o, t, k = 1, p = 1) => osc(o, t, 'sine', 4300 * k, 2600 * k, 0.07, 0.35 * p, 0.004);

function flutter(to, t, dur) {
  const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), am = gain(0.5), g = ctx.createGain();
  s.buffer = noiseBuf;
  s.loop = true;
  f.frequency.value = 900;
  lfo(am.gain, t, t + dur, 22, 0.5);
  env(g.gain, t, 0.08, 0.5, dur);
  s.connect(f).connect(am).connect(g).connect(to);
  s.start(t, Math.random());
  s.stop(t + dur + 0.02);
}

// ------------------------------------------------------------------ creatures
// Per creature: death cry, attack telegraph (plays at the start of the windup, so it can be dodged) and idle presence.
const CREATURE = {
  ghoul: {
    die: (o, t) => voice(o, t, [130, 90, 50], 1.1, 0.9, 'o', { v2: 'u', rough: 0.45 }),
    attack: (o, t) => voice(o, t, [110, 150, 100], 0.4, 0.8, 'a', { rough: 0.5, shift: 0.9 }),
    idle: (o, t) => voice(o, t, [rnd(85, 110), 120, 80], rnd(1, 1.6), 0.5, 'o', { v2: 'u', rough: 0.35, a: 0.3 }),
  },
  vampire: {
    die: (o, t) => { hiss(o, t, 0.8, 0.3); voice(o, t, [600, 820, 260], 0.8, 0.6, 'i', { v2: 'a', vib: 0.03 }); },
    attack: (o, t) => { hiss(o, t, 0.35, 0.4); voice(o, t, [300, 380], 0.25, 0.3, 'e', { rough: 0.3 }); },
    // breathy whisper, two "syllables"
    idle: (o, t) => { noise(o, t, 'bandpass', 2600, 1900, 0.5, 0.25, 5, 0.2); noise(o, t + 0.6, 'bandpass', 2300, 1600, 0.6, 0.2, 5, 0.25); },
  },
  bat: {
    die: (o, t) => { for (let i = 0; i < 3; i++) squeak(o, t + i * 0.08, 1 - i * 0.12); },
    attack: (o, t) => squeak(o, t, 1.15),
    idle: (o, t) => { flutter(o, t, 0.5); squeak(o, t + rnd(0, 0.3), rnd(0.9, 1.1), 0.5); },
  },
  bride: {
    die: (o, t) => voice(o, t, [700, 900, 420], 1.5, 0.6, 'a', { v2: 'u', vib: 0.035, shift: 1.25, a: 0.05 }),
    attack: (o, t) => voice(o, t, [880, 1200], 0.35, 0.5, 'i', { vib: 0.04, shift: 1.25 }),
    // eerie wordless humming
    idle: (o, t) => { const f = rnd(400, 480); voice(o, t, [f, f * 1.06, f * 0.95], 2, 0.5, 'u', { vib: 0.015, wave: 'triangle', a: 0.5, shift: 1.2 }); },
  },
  wolf: {
    die: (o, t) => { voice(o, t, [950, 700], 0.2, 0.6, 'a', { shift: 1.1 }); voice(o, t + 0.22, [760, 560, 380], 0.8, 0.6, 'u', { vib: 0.02, wave: 'triangle' }); },
    attack: (o, t) => voice(o, t, [150, 190, 130], 0.4, 0.9, 'o', { rough: 0.55 }),
    idle: (o, t) => voice(o, t, [95, 110, 90], 1.2, 0.6, 'o', { v2: 'u', rough: 0.6, a: 0.3 }),
  },
  dracula: {
    die: (o, t) => {
      voice(o, t, [170, 120, 42], 3, 1, 'a', { v2: 'o', rough: 0.35, shift: 0.8 });
      hiss(o, t + 0.2, 2, 0.3);
      thunder(o, t + 0.5, 0.7);
      S.bell(t + 1.2, 2);
    },
    attack: (o, t) => { voice(o, t, [90, 120, 80], 0.5, 0.9, 'a', { rough: 0.5, shift: 0.8 }); hiss(o, t, 0.4, 0.25); },
    // low "ha-ha-ha-ha"
    idle: (o, t) => { for (let i = 0; i < 4; i++) voice(o, t + i * 0.2, [125 - i * 6, 105 - i * 6], 0.16, 0.8, 'a', { shift: 0.85, rough: 0.2, a: 0.01 }); },
  },
};
const creature = (type) => CREATURE[type] || CREATURE.ghoul;

// ------------------------------------------------------------------ sound effects
let pickN = 0, pickT = -9;
const S = {
  // whoosh + the runic blade's shimmer; the third hit of the combo is a heavy overhead
  swing(t, combo = 0) {
    const o = out(null, 0.12);
    if (combo === 2) {
      noise(o, t, 'lowpass', 400, 2600, 0.34, 0.5, 1.5, 0.06);
      osc(o, t, 'sine', 160, 55, 0.3, 0.25, 0.04);
    } else {
      const k = combo ? 1.2 : 1;
      noise(o, t, 'bandpass', 700 * k, 3200 * k, 0.2, 0.7, 1.8, 0.04);
    }
    const b = (combo === 2 ? 1580 : 2100) * rnd(0.97, 1.03);
    osc(o, t + 0.02, 'sine', b, b * 1.01, 0.35, 0.04);
    osc(o, t + 0.02, 'sine', b * 1.503, b * 1.5, 0.28, 0.025);
  },
  // blade into flesh: thump + crunch + a short metallic ring
  hit(t, heavy = false) {
    if (!free('hit', 0.03)) return;
    const o = out(null, 0.15), k = heavy ? 1.5 : 1;
    osc(o, t, 'sine', heavy ? 120 : 160, 42, 0.16 * k, 0.6, 0.002);
    noise(o, t, 'lowpass', 4000, 300, 0.12 * k, 0.6, 1, 0.002);
    noise(o, t + 0.01, 'bandpass', 900, 400, 0.15, 0.3, 0.8);
    const m = rnd(1150, 1350);
    for (const [r, a] of [[1, 0.07], [1.47, 0.05], [2.09, 0.035], [2.56, 0.025]]) osc(o, t, 'sine', m * r, m * r, 0.3, a * k, 0.001);
  },
  kill(t, type, pos) {
    if (!free('kill', 0.04)) return;
    const o = out(pos, 0.3);
    noise(o, t, 'lowpass', 2500, 120, 0.45, 0.45);
    creature(type).die(o, t);
    // the soul tears loose
    osc(out(pos, 0.6), t + 0.15, 'sine', 600, 1800, 0.6, 0.05, 0.2);
  },
  attack(t, type, pos) {
    if (free('atk' + type, 0.15)) creature(type).attack(out(pos, 0.15), t);
  },
  idle(t, type, pos) {
    creature(type).idle(out(pos, 0.3), t);
  },
  hurt(t) {
    const o = out(null, 0.1);
    voice(o, t, [200, 140], 0.2, 0.6, 'u', { rough: 0.2 });
    osc(o, t, 'sine', 120, 50, 0.18, 0.5, 0.002);
    noise(o, t, 'lowpass', 1500, 200, 0.15, 0.4, 1, 0.002);
  },
  // the hunter falls; a single funeral toll
  die(t) {
    const o = out(null, 0.3);
    voice(o, t, [190, 150, 80], 1, 0.7, 'o', { v2: 'u', rough: 0.25 });
    osc(o, t + 0.35, 'sine', 90, 30, 0.6, 0.7, 0.002);
    noise(o, t + 0.35, 'lowpass', 600, 80, 0.5, 0.5, 1, 0.002);
    S.bell(t + 1, 1);
  },
  dodge(t) {
    const o = out(null, 0.05);
    noise(o, t, 'bandpass', 300, 1100, 0.28, 0.55, 1.2, 0.05);
    noise(o, t + 0.3, 'lowpass', 500, 150, 0.12, 0.25);
  },
  step(t, swim = false, sprint = false) {
    const o = out(null, 0.03);
    if (swim) {
      noise(o, t, 'bandpass', 1400, 600, 0.25, 0.3, 1.5, 0.04);
      osc(o, t + 0.05, 'sine', rnd(300, 450), rnd(700, 900), 0.06, 0.03);
    } else {
      noise(o, t, 'lowpass', rnd(500, 800), 150, 0.07, sprint ? 0.45 : 0.3, 1, 0.003);
      osc(o, t, 'sine', 90, 60, 0.05, 0.15);
    }
  },
  jump(t) { noise(out(null, 0.03), t, 'bandpass', 400, 900, 0.15, 0.4, 1.2, 0.02); },
  land(t) {
    const o = out(null, 0.05);
    osc(o, t, 'sine', 110, 45, 0.15, 0.35, 0.002);
    noise(o, t, 'lowpass', 900, 100, 0.18, 0.3, 1, 0.002);
  },
  // silver crossbow: trigger clack, string twang, bolt whoosh
  bolt(t) {
    const o = out(null, 0.12);
    noise(o, t, 'highpass', 6000, 2500, 0.04, 0.35, 0.7, 0.001);
    osc(o, t, 'triangle', 330, 220, 0.22, 0.3, 0.001);
    osc(o, t, 'sine', 660, 440, 0.15, 0.12, 0.001);
    noise(o, t + 0.01, 'bandpass', 2500, 900, 0.18, 0.2, 2, 0.01);
    osc(o, t, 'sine', 3200, 3150, 0.25, 0.02, 0.002);
  },
  // bolt lands: wet hit in a creature, or a wooden "thock" that quivers in the ground
  thunk(t, pos, flesh) {
    const o = out(pos, 0.2);
    if (flesh) {
      noise(o, t, 'lowpass', 1800, 200, 0.1, 0.5, 1, 0.002);
      osc(o, t, 'sine', 200, 80, 0.08, 0.4, 0.002);
    } else {
      osc(o, t, 'triangle', 600, 300, 0.06, 0.5, 0.001);
      noise(o, t, 'bandpass', 1200, 900, 0.05, 0.3, 3, 0.001);
      osc(o, t + 0.02, 'sine', 180, 170, 0.25, 0.08, 0.005);
    }
  },
  reload(t) {
    const o = out(null, 0.05);
    for (const s of [0, 0.08]) {
      noise(o, t + s, 'highpass', 5000, 4000, 0.025, 0.15, 1, 0.001);
      osc(o, t + s, 'square', 1800, 1500, 0.015, 0.03, 0.001);
    }
  },
  empty(t) {
    if (!free('empty', 0.15)) return;
    const o = out(null, 0.05);
    noise(o, t, 'bandpass', 1500, 1200, 0.03, 0.6, 2, 0.001);
    osc(o, t, 'square', 400, 300, 0.02, 0.1, 0.001);
  },
  // soul chime: consecutive pickups climb the scale
  pickup(t) {
    pickN = t - pickT < 1.2 ? Math.min(pickN + 1, 7) : 0;
    pickT = t;
    const o = out(null, 0.5), f = hz([74, 77, 81, 86, 89, 93, 98, 101][pickN]);
    osc(o, t, 'sine', f, f, 0.6, 0.25, 0.003);
    osc(o, t, 'sine', f * 2, f * 2, 0.3, 0.08, 0.003);
    osc(o, t + 0.05, 'triangle', f * 1.5, f * 1.5, 0.4, 0.06, 0.003);
  },
  // vampire dissolves into mist and reappears (pos = where it reappears, usually behind the player)
  blink(t, pos) {
    const o = out(pos, 0.5);
    noise(o, t, 'bandpass', 600, 3500, 0.45, 0.35, 2.5, 0.3);
    osc(o, t + 0.25, 'sine', 1400, 180, 0.4, 0.12);
    noise(o, t + 0.3, 'lowpass', 1200, 100, 0.25, 0.3);
  },
  howl(t, pos) {
    const k = rnd(0.9, 1.1);
    voice(out(pos, 0.6), t, [280 * k, 520 * k, 560 * k, 540 * k, 400 * k], 2.6, 0.6, 'u', { v2: 'o', vib: 0.012, a: 0.35, wave: 'triangle' });
  },
  // werewolf pounce: snarling bark
  leap(t, pos) {
    const o = out(pos, 0.15);
    voice(o, t, [220, 300, 160], 0.3, 0.9, 'a', { rough: 0.4 });
    noise(o, t, 'bandpass', 1500, 600, 0.2, 0.2, 1);
  },
  // undead burning in sunlight: sizzle and crackle
  burn(t, pos) {
    if (!free('burn', 0.12)) return;
    const o = out(pos, 0.1);
    noise(o, t, 'highpass', 3000, 5000, 0.4, 0.12, 0.5, 0.05);
    for (let i = 0; i < 3; i++) noise(o, t + rnd(0, 0.35), 'bandpass', rnd(2000, 6000), 1500, 0.015, 0.2, 2, 0.001);
  },
  bell(t, times = 1) {
    const o = out(null, 0.6);
    for (let i = 0; i < times; i++) bell(o, t + i * 2.3, 180, 0.25);
  },
  bloodMoon(t) {
    S.bell(t, 3);
    thunder(out(null, 0.4), t + 0.4, 0.8);
    // dissonant swell: D against E-flat
    const o = out(null, 0.5), f = ctx.createBiquadFilter();
    f.frequency.value = 400;
    f.connect(o);
    for (const m of [38, 39, 50]) voice(f, t, [hz(m)], 5, 0.18, 'o', { sus: true, a: 2 });
  },
  dawn(t) {
    const o = out(null, 0.6);
    for (const [i, m] of [62, 66, 69, 74].entries()) voice(o, t + i * 0.25, [hz(m)], 4.5, 0.06, 'o', { wave: 'triangle', sus: true, a: 1.5, vib: 0.006 });
    birds(t + 1.5, around(15, 25), 1);
    birds(t + 3, around(15, 25), 1);
  },
  // Count Dracula arrives: thunder, then the opening of J.S. Bach's Toccata in D minor, BWV 565
  // (an early-1700s composition, public domain) played on the synthesized organ above.
  boss(t) {
    thunder(out(null, 0.4), t);
    const o = out(null, 0.7), T = t + 0.6;
    const n = (m, s, d, v = 0.05) => { organ(o, T + s, hz(m), d, v); organ(o, T + s, hz(m - 12), d, v * 0.8); };
    for (const [m, s, d] of [[69, 0, 0.1], [67, 0.1, 0.1], [69, 0.2, 0.9]]) n(m, s, d);
    [67, 65, 64, 62, 61].forEach((m, i) => n(m, 1.4 + i * 0.1, 0.1));
    n(62, 1.9, 1.1);
    // low pedal under a diminished seventh piling up, resolving to D minor
    organ(o, T + 3.2, hz(38), 3.6, 0.06);
    [49, 52, 55, 58, 61, 64].forEach((m, i) => organ(o, T + 3.2 + i * 0.09, hz(m), 1.6 - i * 0.09, 0.03));
    for (const m of [50, 53, 57, 62, 65, 69]) organ(o, T + 4.9, hz(m), 1.9, 0.03);
  },
  // coffin of earth splintering: wood cracks, debris and a sigh of escaping evil
  smash(t) {
    const o = out(null, 0.35);
    for (let i = 0; i < 4; i++) {
      const s = t + i * rnd(0.03, 0.07);
      osc(o, s, 'triangle', rnd(250, 420), 120, 0.08, 0.3, 0.001);
      noise(o, s, 'bandpass', rnd(1500, 3000), 600, 0.06, 0.4, 2, 0.001);
    }
    noise(o, t, 'lowpass', 1200, 80, 0.6, 0.5, 1, 0.002);
    voice(o, t + 0.2, [110, 70], 1.2, 0.5, 'o', { v2: 'u', rough: 0.3, a: 0.2 });
  },
  click(t) { osc(out(null, 0), t, 'square', 900, 600, 0.03, 0.15, 0.001); },
  // inventory / menus
  cursor(t) { osc(out(null, 0), t, 'triangle', 1200, 1100, 0.04, 0.22, 0.001); },
  select(t) {
    const o = out(null, 0.2);
    osc(o, t, 'sine', 880, 880, 0.12, 0.18, 0.002);
    osc(o, t + 0.06, 'sine', 1320, 1320, 0.15, 0.14, 0.002);
  },
  cancel(t) { osc(out(null, 0.1), t, 'triangle', 700, 450, 0.1, 0.25, 0.002); },
  deny(t) {
    const o = out(null, 0);
    osc(o, t, 'square', 150, 140, 0.08, 0.1, 0.002);
    osc(o, t + 0.11, 'square', 120, 110, 0.12, 0.1, 0.002);
  },
  // potion: gulps, then a warm rising arpeggio
  heal(t) {
    const o = out(null, 0.4);
    for (let i = 0; i < 3; i++) osc(o, t + i * 0.12, 'sine', rnd(250, 320), rnd(550, 700), 0.07, 0.15, 0.01);
    [74, 78, 81, 86].forEach((m, i) => osc(o, t + 0.4 + i * 0.07, 'sine', hz(m), hz(m), 0.5, 0.06, 0.003));
  },
  // holy water / blessing: a bright chord sung by a distant choir, plus a high bell
  bless(t) {
    const o = out(null, 0.7);
    for (const m of [62, 66, 69, 74]) voice(o, t, [hz(m)], 1.8, 0.1, 'a', { v2: 'o', sus: true, a: 0.3, vib: 0.008 });
    bell(o, t, 880, 0.04, 2.5);
  },
};

export const sfx = {};
for (const k in S) sfx[k] = (...a) => { if (ctx && !muted) S[k](ctx.currentTime + 0.005, ...a); };

// ------------------------------------------------------------------ ambience
function birds(t, pos, k) {
  const o = out(pos, 0.25, ambBus), f = rnd(2600, 3800), n = 2 + Math.floor(Math.random() * 5), gap = rnd(0.08, 0.13);
  for (let i = 0; i < n; i++) {
    const up = Math.random() < 0.5;
    osc(o, t + i * gap, 'sine', up ? f : f * 1.35, up ? f * 1.35 : f, 0.06, 0.1 * k, 0.005);
  }
}

function cricket(t, pos, k) {
  const o = out(pos, 0.1, ambBus), f = rnd(4300, 4900);
  for (let i = 0; i < 3; i++) osc(o, t + i * 0.05, 'sine', f, f * 0.98, 0.028, 0.06 * k, 0.004);
}

// great horned owl: hoo, hoo-hoo, hooo, hooo
function owl(t, pos) {
  const o = out(pos, 0.4, ambBus), f = rnd(300, 360);
  for (const [s, d] of [[0, 0.3], [0.55, 0.13], [0.72, 0.13], [1.15, 0.4], [1.7, 0.4]]) osc(o, t + s, 'sine', f * 1.04, f * 0.94, d, 0.25, 0.05);
}

function crow(t, pos) {
  const o = out(pos, 0.35, ambBus), n = 2 + Math.floor(Math.random() * 2);
  for (let i = 0; i < n; i++) voice(o, t + i * rnd(0.35, 0.5), [720, 560], 0.28, 0.8, 'a', { shift: 1.6, rough: 0.5, a: 0.02 });
}

function heartbeat(t, k) {
  const o = out(null, 0);
  osc(o, t, 'sine', 75, 42, 0.16, 0.6 * k, 0.01);
  osc(o, t, 'triangle', 140, 70, 0.08, 0.08 * k);
  osc(o, t + 0.2, 'sine', 65, 40, 0.14, 0.42 * k, 0.01);
}

function startAmbience() {
  const now = ctx.currentTime;
  const wind = (pan) => {
    const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = gain(0);
    s.buffer = noiseBuf;
    s.loop = true;
    f.type = 'bandpass';
    f.Q.value = 0.8;
    s.connect(f).connect(g);
    if (ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      g.connect(p).connect(ambBus);
    } else g.connect(ambBus);
    s.start(now, Math.random() * 1.9);
    return { f, g };
  };
  // night drone: D and A with slow beating; an E-flat creeps in under the blood moon
  const lp = ctx.createBiquadFilter();
  lp.frequency.value = 260;
  lp.connect(ambBus);
  const drone = gain(0, lp), blood = gain(0, lp);
  for (const [m, g] of [[38, drone], [38.05, drone], [45, drone], [39, blood]]) {
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = hz(m);
    o.connect(g);
    o.start(now);
  }
  amb = { w: [wind(-0.7), wind(0.7)], drone, blood, critter: 0, owl: now + 8, crow: now + 5, heart: 0 };
}

// ------------------------------------------------------------------ score
// Generative and in D minor. Each chord lasts 16 eighth notes: a slow saw pad, a music-box melody that wanders over the
// scale, and with danger (creatures close by) taiko drums and a low string ostinato. The Count adds a choir.
const BEAT = 60 / 72, STEP = BEAT / 2;
const PROG = {
  day: [[50, 57, 62, 65], [46, 53, 58, 62], [41, 53, 57, 60], [48, 55, 60, 64]],
  night: [[50, 57, 62, 65], [46, 53, 58, 62], [43, 55, 58, 62], [45, 52, 57, 61], [50, 57, 62, 65], [43, 55, 58, 62], [51, 55, 58, 63], [45, 55, 61, 64]],
  blood: [[50, 57, 62, 65], [51, 55, 58, 63], [50, 57, 62, 65], [49, 52, 55, 58], [46, 53, 58, 62], [51, 55, 58, 63], [43, 55, 58, 62], [45, 52, 57, 61]],
};
const SCALE = {
  day: [62, 64, 65, 67, 69, 70, 72, 74, 76, 77, 79, 81],
  night: [62, 64, 65, 67, 69, 70, 73, 74, 76, 77, 79, 81],
  blood: [62, 63, 66, 67, 69, 70, 72, 74, 75, 78, 79, 81],
};
const KICK = [1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 1, 1, 0, 0, 1, 0];
const M = { next: 0, step: 0, mel: 4, danger: 0, boss: false };

function pad(t, notes, dur, vol, bright) {
  const f = ctx.createBiquadFilter(), g = ctx.createGain(), end = t + dur + 3;
  f.frequency.value = 450 + bright * 700;
  lfo(f.frequency, t, end, rnd(0.1, 0.2), 200);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vol, t + 2.5);
  g.gain.setValueAtTime(vol, t + dur);
  g.gain.linearRampToValueAtTime(0, end);
  f.connect(g).connect(musIn);
  for (const m of notes)
    for (const det of [-8, 8]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = hz(m);
      o.detune.value = det + rnd(-3, 3);
      o.connect(f);
      o.start(t);
      o.stop(end);
    }
  const sub = ctx.createOscillator();
  sub.frequency.value = hz(notes[0] - 12);
  sub.connect(gain(1.5, g));
  sub.start(t);
  sub.stop(end);
}

// music-box tine: fundamental plus fast-decaying inharmonic overtones
function tine(t, f, peak) {
  osc(musIn, t, 'sine', f, f, 1.6, peak, 0.002);
  osc(musIn, t, 'sine', f * 2.76, f * 2.76, 0.35, peak * 0.35, 0.001);
  osc(musIn, t, 'sine', f * 5.4, f * 5.4, 0.12, peak * 0.2, 0.001);
}

function taiko(t, v) {
  osc(musIn, t, 'sine', 130, 48, 0.45, 0.6 * v, 0.004);
  noise(musIn, t, 'lowpass', 900, 120, 0.12, 0.35 * v, 1, 0.002);
}

function stab(t, m, v) {
  const f = ctx.createBiquadFilter();
  f.frequency.value = 900;
  f.connect(musIn);
  osc(f, t, 'sawtooth', hz(m), hz(m), 0.2, 0.12 * v, 0.01);
  osc(f, t, 'sawtooth', hz(m + 12), hz(m + 12), 0.2, 0.06 * v, 0.01);
}

function scoreStep(t, nightAmt, blood) {
  const mode = nightAmt < 0.5 ? 'day' : blood ? 'blood' : 'night';
  const s = M.step % 16, prog = PROG[mode], chord = prog[Math.floor(M.step / 16) % prog.length], scale = SCALE[mode], d = M.danger;
  if (s === 0) {
    pad(t, chord, 16 * STEP, 0.022 * (0.4 + 0.6 * nightAmt), nightAmt);
    if (M.boss) for (const m of chord) voice(musIn, t, [hz(m)], 16 * STEP + 1, 0.22, pick(['a', 'o']), { sus: true, a: 1.2, vib: 0.008 });
  }
  // the melody thins out as the fight takes over
  if (s % 2 === 0 && Math.random() < (s === 0 ? 0.8 : mode === 'day' ? 0.3 : 0.45) * (1 - d * 0.7)) {
    if (s === 0) {
      // land on the chord tone nearest to the current note
      const pcs = chord.map((m) => m % 12);
      let best = M.mel, bd = 99;
      scale.forEach((m, i) => { if (pcs.includes(m % 12) && Math.abs(i - M.mel) < bd) { bd = Math.abs(i - M.mel); best = i; } });
      M.mel = best;
    } else M.mel = Math.max(0, Math.min(scale.length - 1, M.mel + pick([-2, -1, -1, 1, 1, 2])));
    tine(t, hz(scale[M.mel] + 12), 0.07 * (mode === 'day' ? 0.7 : 1));
  }
  if (d > 0.06 && KICK[s]) taiko(t, (s % 8 === 0 ? 1 : 0.65) * Math.min(1, d * 1.4));
  if (d > 0.3) stab(t, chord[0] - 12, (d - 0.3) / 0.7);
}

// Called every frame while playing. s: danger 0..1 (creatures near), hp 0..1, blood (blood-moon night), boss (Count alive).
export function updateAmbient(time, nightAmt, { danger = 0, hp = 1, blood = false, boss = false } = {}) {
  if (!ctx) return;
  if (!amb) startAmbience();
  const now = ctx.currentTime, dt = Math.min(0.1, Math.max(0, time - prevTime));
  prevTime = time;
  M.danger += ((boss ? 1 : Math.min(1, danger)) - M.danger) * (1 - Math.exp(-dt * 1.5));
  M.boss = boss;
  amb.w.forEach((w, i) => {
    w.f.frequency.setTargetAtTime(280 + Math.sin(time * 0.3 + i * 2) * 140 + Math.sin(time * 0.71 + i) * 70, now, 0.1);
    w.g.gain.setTargetAtTime((0.1 + 0.08 * Math.sin(time * 0.23 + i * 1.3) ** 2) * (0.7 + 0.5 * nightAmt), now, 0.1);
  });
  amb.drone.gain.setTargetAtTime(0.05 * nightAmt, now, 0.5);
  amb.blood.gain.setTargetAtTime(blood ? 0.04 * nightAmt : 0, now, 1);
  musBus.gain.setTargetAtTime(hp > 0 ? 0.3 : 0.12, now, 1);
  if (muted) return;

  // wildlife: crickets at night (they hush when creatures are near), birds by day, owls, crows at dusk
  if (now > amb.critter) {
    if (nightAmt > 0.5) {
      amb.critter = now + rnd(0.12, 0.6);
      cricket(now + 0.05, around(6, 25), nightAmt * (1 - M.danger * 0.8));
    } else {
      amb.critter = now + rnd(1.5, 5);
      if (nightAmt < 0.3) birds(now + 0.05, around(15, 35), 1 - nightAmt);
    }
  }
  if (now > amb.owl) {
    amb.owl = now + rnd(14, 30);
    if (nightAmt > 0.6 && M.danger < 0.5) owl(now + 0.05, around(25, 40));
  }
  if (now > amb.crow) {
    amb.crow = now + rnd(18, 40);
    if (nightAmt < 0.8) crow(now + 0.05, around(20, 35));
  }
  if (hp > 0 && hp < 0.35 && now > amb.heart) {
    const r = hp / 0.35;
    amb.heart = now + 0.5 + r * 0.6;
    heartbeat(now + 0.02, 1 - r * 0.5);
  }

  if (M.next < now - 0.2) M.next = now + 0.05;
  while (M.next < now + 0.25) {
    scoreStep(M.next, nightAmt, blood);
    M.next += STEP;
    M.step++;
  }
}
