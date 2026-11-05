// Procedural animation toolkit shared by the hunter (hunteranim.js) and the creatures (creatureanim.js).
// - Poser: every frame an animation writes a whole target pose (bone rotations, hip offsets, a body tilt about a
//   chosen pivot); switching action cross-fades from the last shown pose, so nothing snaps.
// - clip/sample: keyframed poses ('bone.axis' channels, a held value carries to later keys, an ease per segment).
// - Spring: damped springs for secondary motion (coat, scarf, capes, tails) and hit/landing recoils.
import * as THREE from 'three';

export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
export const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
export const lerp = (a, b, t) => a + (b - a) * t;
export const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));
export const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
export const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

export const E = {
  linear: (t) => t,
  smooth: (t) => t * t * (3 - 2 * t),
  in: (t) => t * t,
  in3: (t) => t * t * t,
  out: (t) => 1 - (1 - t) * (1 - t),
  out3: (t) => 1 - (1 - t) ** 3,
  inOut: (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2),
  // a blade or a claw: slow start, very fast middle, a short settle
  whip: (t) => (t < 0.5 ? 16 * t ** 5 : 1 - (-2 * t + 2) ** 5 / 2),
  // overshoots and comes back
  back: (t) => { const c = 1.9; return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2; },
};

// Bones a pose may drive, with the axes it may write (rotations x/y/z, position offsets px/py/pz).
const HUMAN = {
  hips: ['x', 'y', 'z', 'px', 'py', 'pz'], spine: ['x', 'y', 'z'], chest: ['x', 'y', 'z'], neck: ['x', 'y', 'z'], head: ['x', 'y', 'z'],
  armL: ['x', 'y', 'z'], foreL: ['x', 'y'], handL: ['x', 'y', 'z'], armR: ['x', 'y', 'z'], foreR: ['x', 'y'], handR: ['x', 'y', 'z'],
  legL: ['x', 'y', 'z'], shinL: ['x'], footL: ['x', 'z'], legR: ['x', 'y', 'z'], shinR: ['x'], footR: ['x', 'z'],
  body: ['x', 'y', 'z'], wingL: ['x', 'y', 'z'], wingL2: ['y', 'z'], wingR: ['x', 'y', 'z'], wingR2: ['y', 'z'],
};
// the whole-body tilt: rotation x/z about the pivot k (model space, from the feet), offset p, squash sy
const SPIN = ['x', 'z', 'kx', 'ky', 'kz', 'px', 'py', 'pz', 'sy'];

const _v = new THREE.Vector3();

export class Poser {
  constructor(m) {
    this.m = m;
    this.q = {}; // the target pose the animation fills every frame
    this.ch = []; // [object3d, 'rotation' | 'position', axis, rest, bone name, key]
    for (const [b, axes] of Object.entries(HUMAN)) {
      if (!m[b]) continue;
      this.q[b] = {};
      for (const a of axes) {
        this.q[b][a] = 0;
        const pos = a[0] === 'p';
        const ax = pos ? a[1] : a;
        this.ch.push([m[b], pos ? 'position' : 'rotation', ax, pos ? m[b].position[ax] : 0, b, a]);
      }
    }
    this.q.spin = Object.fromEntries(SPIN.map((a) => [a, 0]));
    this.spinRest = m.spin ? m.spin.position.y : 0;
    this.n = this.ch.length + SPIN.length;
    this.cur = new Float32Array(this.n);
    this.from = new Float32Array(this.n);
    this.fadeT = 0;
    this.fadeDur = 0;
  }

  // every channel back to rest before an animation writes this frame's pose
  zero() {
    for (const b in this.q) { const o = this.q[b]; for (const a in o) o[a] = 0; }
  }

  // cross-fade from what is on screen now to whatever gets written next, over `dur` seconds
  fade(dur) {
    this.from.set(this.cur);
    // the body tilt (a full roll ends at 2π) eases back the short way round
    const s = this.ch.length;
    this.from[s] = wrap(this.from[s]);
    this.from[s + 1] = wrap(this.from[s + 1]);
    this.fadeT = 0;
    this.fadeDur = dur;
  }

  apply(dt) {
    let w = 1;
    if (this.fadeDur > 0) {
      this.fadeT += dt;
      w = E.smooth(clamp01(this.fadeT / this.fadeDur));
      if (w >= 1) this.fadeDur = 0;
    }
    const q = this.q, cur = this.cur, from = this.from;
    let i = 0;
    for (const c of this.ch) {
      const t = q[c[4]][c[5]];
      const v = w < 1 ? from[i] + (t - from[i]) * w : t;
      cur[i++] = v;
      c[0][c[1]][c[2]] = c[3] + v;
    }
    const sp = this.m.spin;
    const s = q.spin, base = i;
    for (const a of SPIN) {
      const v = w < 1 ? from[i] + (s[a] - from[i]) * w : s[a];
      cur[i++] = v;
    }
    if (!sp) return;
    const rx = cur[base], rz = cur[base + 1], kx = cur[base + 2], ky = cur[base + 3], kz = cur[base + 4];
    const px = cur[base + 5], py = cur[base + 6], pz = cur[base + 7], sy = cur[base + 8];
    sp.rotation.set(rx, 0, rz);
    const sq = 1 + sy, sxz = 1 / Math.sqrt(Math.max(0.2, sq));
    sp.scale.set(sxz, sq, sxz);
    // keep the pivot k where it is while the body turns about it
    _v.set(kx * sxz, (ky - this.spinRest) * sq, kz * sxz).applyEuler(sp.rotation);
    sp.position.set(kx + px - _v.x, ky + py - _v.y, kz + pz - _v.z);
  }
}

// Keyframed pose: keys = [[t, { 'armR.x': v, 'spin.py': v, ... }, ease?], ...]; the ease shapes the segment that
// ends at that key. A channel a key leaves out holds its previous value (0 before the first mention).
export function clip(keys) {
  const names = [...new Set(keys.flatMap((k) => Object.keys(k[1])))];
  const vals = [];
  keys.forEach((k, i) => vals.push(names.map((n, j) => (n in k[1] ? k[1][n] : i ? vals[i - 1][j] : 0))));
  const mirror = (n) => {
    const [b, a] = n.split('.');
    const nb = /[LR]2?$/.test(b) ? b.replace(/L(2?)$/, '\u0000$1').replace(/R(2?)$/, 'L$1').replace('\u0000', 'R') : b;
    return [nb, a, a === 'y' || a === 'z' || a === 'kx' || a === 'px' ? -1 : 1];
  };
  return {
    names: names.map((n) => [...n.split('.'), 1]),
    mirrored: names.map(mirror),
    times: keys.map((k) => k[0]),
    eases: keys.map((k) => k[2] || E.smooth),
    vals,
    end: keys[keys.length - 1][0],
  };
}

// Writes the clip at time t into the pose (weight < 1 blends over what is already there; mirror swaps sides).
export function sample(c, t, q, w = 1, mirror = false) {
  const T = c.times;
  let i = 0;
  while (i < T.length - 2 && t > T[i + 1]) i++;
  const k = T.length > 1 ? c.eases[i + 1](clamp01((t - T[i]) / (T[i + 1] - T[i] || 1))) : 0;
  const a = c.vals[i], b = c.vals[Math.min(i + 1, T.length - 1)];
  const names = mirror ? c.mirrored : c.names;
  for (let j = 0; j < names.length; j++) {
    const [bone, ax, sg] = names[j];
    const o = q[bone];
    if (!o || !(ax in o)) continue;
    const v = (a[j] + (b[j] - a[j]) * k) * sg;
    o[ax] = w >= 1 ? v : o[ax] + (v - o[ax]) * w;
  }
}

// Damped spring toward a target; kick() adds velocity (a recoil that springs back).
export class Spring {
  constructor(k = 120, d = 12) {
    this.k = k;
    this.d = d;
    this.x = 0;
    this.v = 0;
  }
  step(target, dt) {
    const n = Math.min(8, Math.ceil(dt / (1 / 120)));
    const h = dt / Math.max(1, n);
    for (let i = 0; i < n; i++) {
      this.v += (this.k * (target - this.x) - this.d * this.v) * h;
      this.x += this.v * h;
    }
    return this.x;
  }
  kick(v) { this.v += v; }
  reset(x = 0) { this.x = x; this.v = 0; }
}

// Gait helper: thigh swing for one leg along the local walking direction (dx, dz) and the knee folding while that
// leg swings forward. ph: the leg's phase; amp: thigh swing (radians); knee: extra knee bend at mid-swing.
// The foot gets only toe offsets (heel strike, push-off); flatFeet() later keeps the sole level with the ground.
export function stride(q, side, ph, amp, knee, dx, dz, kneeBase = 0.08) {
  const s = Math.sin(ph), c = Math.cos(ph);
  const g = -s; // > 0: foot ahead along the walking direction
  const leg = q['leg' + side], shin = q['shin' + side], foot = q['foot' + side];
  leg.x += -g * amp * dz;
  leg.z += g * amp * dx * 0.6;
  const lift = Math.max(0, -c) ** 1.3; // g grows (the foot swings forward) while cos < 0
  shin.x += kneeBase + lift * knee;
  if (foot && amp > 0) foot.x += (-0.3 * Math.max(0, g) + 0.5 * Math.max(0, -g) * Math.max(0, c) + 0.2 * lift) * Math.min(1, amp * 2);
}

// Keeps the soles level with the ground (weight 0..1) whatever the thigh and knee are doing.
export function flatFeet(q, w) {
  if (!w || !q.footL) return;
  q.footL.x -= (q.legL.x + q.shinL.x) * w;
  q.footR.x -= (q.legR.x + q.shinR.x) * w;
  q.footL.z -= q.legL.z * w;
  q.footR.z -= q.legR.z * w;
}
