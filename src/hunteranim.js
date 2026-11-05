// The hunter's animation, all procedural on the skinned rig (characters.js):
// - moving: a gait that follows the real direction of travel (strafing and backpedalling while locked on), hips and
//   shoulders counter-twisting, leaning into speed, acceleration and turns, the sword trailing low when sprinting;
// - standing: a fencing guard that breathes and shifts its weight; after a few quiet seconds the blade twirls and
//   comes to rest on the shoulder;
// - sword combo: keyframed whole-body swings (wind-up, whip, follow-through, recovery) with a step into each one;
// - the Artes (runes.js), roll, jump/fall/landing, crossbow quick-draw, hit flinch, the scream's daze, swimming
//   and the death (stagger, knees, collapse face down);
// - secondary motion on springs: coat tail and scarf.
// Player.update owns the gameplay; it calls update() every frame and tells this module about hits, shots and landings.
import * as THREE from 'three';
import { Poser, Spring, clip, sample, stride, flatFeet, E, clamp, clamp01, damp, smooth, wrap } from './anim.js';

const PI = Math.PI, TAU = PI * 2;
const mix = (o, a, v, w) => { o[a] += (v - o[a]) * w; };

// ------------------------------------------------------------------ sword combo, keyed by swing progress (0..1)
// Key 0 repeats the wind-up: the cross-fade at the start of each swing blends from wherever the body was into it.
const WIND0 = {
  'hips.y': -0.25, 'spine.y': -0.3, 'chest.y': -0.35, 'neck.y': 0.3, 'head.y': 0.35, 'spine.x': 0.05,
  'armR.x': -1.45, 'armR.y': -1.3, 'armR.z': 0, 'foreR.x': -0.45, 'handR.x': -0.1, 'handR.z': 0,
  'armL.x': -0.8, 'armL.z': 0.35, 'foreL.x': -0.7,
  'legL.x': 0.25, 'shinL.x': 0.3, 'footL.x': 0.3, 'legR.x': -0.35, 'shinR.x': 0.35, 'legR.z': -0.08, 'hips.py': -0.08,
};
const STRIKE0 = {
  'hips.y': 0.3, 'spine.y': 0.3, 'chest.y': 0.35, 'neck.y': -0.4, 'head.y': -0.5, 'spine.x': 0.2,
  'armR.x': -1.5, 'armR.y': 1.15, 'foreR.x': -0.08, 'handR.x': 0, 'handR.z': 0.35,
  'armL.x': 0.55, 'armL.z': 0.6, 'foreL.x': -0.3,
  'legL.x': 0.45, 'shinL.x': 0.25, 'footL.x': 0.5, 'legR.x': -0.6, 'shinR.x': 0.55, 'hips.py': -0.15,
};
const REC0 = {
  'hips.y': 0.12, 'spine.y': 0.1, 'chest.y': 0.1, 'neck.y': -0.1, 'head.y': -0.15, 'spine.x': 0.1,
  'armR.x': -0.9, 'armR.y': 0.6, 'foreR.x': -0.8, 'handR.x': -0.3, 'handR.z': 0.3,
  'armL.x': -0.2, 'armL.z': 0.3, 'foreL.x': -0.7,
  'legL.x': 0.3, 'shinL.x': 0.25, 'footL.x': 0.2, 'legR.x': -0.35, 'shinR.x': 0.35, 'hips.py': -0.1,
};
const WIND1 = {
  'hips.y': 0.15, 'spine.y': 0.25, 'chest.y': 0.45, 'neck.y': -0.3, 'head.y': -0.4, 'spine.x': 0.05,
  'armR.x': -1.75, 'armR.y': 1.35, 'armR.z': 0, 'foreR.x': -1.25, 'handR.x': -0.2, 'handR.z': 0.5,
  'armL.x': -0.2, 'armL.z': 0.2, 'foreL.x': -1.3,
  'legL.x': -0.35, 'shinL.x': 0.35, 'legL.z': 0.08, 'footL.x': 0, 'legR.x': 0.3, 'shinR.x': 0.3, 'legR.z': 0, 'footR.x': 0.3,
  'hips.py': -0.08,
};
const STRIKE1 = {
  'hips.y': -0.3, 'spine.y': -0.3, 'chest.y': -0.45, 'neck.y': 0.4, 'head.y': 0.5, 'spine.x': 0.15,
  'armR.x': -1.45, 'armR.y': -1.25, 'foreR.x': -0.05, 'handR.x': 0, 'handR.z': -0.2,
  'armL.x': -0.5, 'armL.z': 1.0, 'foreL.x': -0.2,
  'legL.x': -0.6, 'shinL.x': 0.55, 'legR.x': 0.45, 'shinR.x': 0.25, 'footR.x': 0.5, 'hips.py': -0.15,
};
const REC1 = {
  'hips.y': -0.1, 'spine.y': -0.1, 'chest.y': -0.15, 'neck.y': 0.1, 'head.y': 0.2, 'spine.x': 0.1,
  'armR.x': -1.1, 'armR.y': -0.5, 'foreR.x': -0.7, 'handR.x': -0.3, 'handR.z': 0.1,
  'armL.x': -0.3, 'armL.z': 0.45, 'foreL.x': -0.6,
  'legL.x': -0.35, 'shinL.x': 0.35, 'legR.x': 0.3, 'shinR.x': 0.25, 'footR.x': 0.2, 'hips.py': -0.1,
};
// the finisher: rise on the toes with the blade cocked behind the head, then a slam into a deep lunge
const WIND2 = {
  'hips.y': 0, 'spine.y': 0, 'chest.y': 0, 'neck.y': 0, 'head.y': 0,
  'spine.x': -0.3, 'chest.x': -0.2, 'neck.x': 0.15, 'head.x': 0.05,
  'armR.x': -3.0, 'armR.y': 0.15, 'armR.z': 0, 'foreR.x': -0.4, 'handR.x': -0.25, 'handR.z': 0,
  'armL.x': -2.7, 'armL.z': -0.3, 'foreL.x': -0.7,
  'legL.x': -0.75, 'shinL.x': 0.95, 'legL.z': 0, 'footL.x': 0.6, 'legR.x': 0.1, 'shinR.x': 0.2, 'legR.z': 0, 'footR.x': 0.5,
  'hips.py': 0.04, 'spin.py': 0.14,
};
const SLAM2 = {
  'spine.x': 0.55, 'chest.x': 0.3, 'neck.x': -0.45, 'head.x': -0.2,
  'armR.x': -1.75, 'armR.y': 0.1, 'foreR.x': -0.05, 'handR.x': -0.15,
  'armL.x': -1.7, 'armL.z': 0.15, 'foreL.x': -0.4,
  'legL.x': -1.0, 'shinL.x': 1.1, 'footL.x': 0, 'legR.x': 0.75, 'shinR.x': 0.6, 'footR.x': 0.6,
  'hips.py': -0.34, 'spin.py': 0,
};
const REC2 = {
  'spine.x': 0.15, 'chest.x': 0.05, 'neck.x': -0.1, 'head.x': 0,
  'armR.x': -0.9, 'armR.y': 0, 'foreR.x': -0.75, 'handR.x': -0.35, 'handR.z': 0.2,
  'armL.x': -0.35, 'armL.z': 0.25, 'foreL.x': -0.7,
  'legL.x': -0.45, 'shinL.x': 0.55, 'legR.x': 0.4, 'shinR.x': 0.4, 'footR.x': 0.2, 'hips.py': -0.12,
};
const SWING = [
  clip([[0, WIND0], [0.24, WIND0], [0.52, STRIKE0, E.whip], [0.72, { 'armR.y': 1.5, 'armR.x': -1.3, 'chest.y': 0.45, 'foreR.x': -0.45, 'handR.z': 0.5 }, E.out3], [1, REC0]]),
  clip([[0, WIND1], [0.24, WIND1], [0.52, STRIKE1, E.whip], [0.72, { 'armR.y': -1.6, 'armR.x': -1.35, 'chest.y': -0.52, 'foreR.x': -0.35 }, E.out3], [1, REC1]]),
  clip([[0, WIND2], [0.32, WIND2], [0.5, SLAM2, E.in3], [0.72, { 'hips.py': -0.3, 'armR.x': -1.7, 'spine.x': 0.5 }, E.out], [1, REC2]]),
];
// fraction of each swing spent blending into its wind-up, and the stretch that leaves a blade trail
const SWING_IN = [0.24, 0.24, 0.32];
const SWING_TRAIL = [[0.22, 0.72], [0.22, 0.72], [0.36, 0.62]];

// ------------------------------------------------------------------ Artes (runes.js), keyed in seconds
const SPIN_PREP = {
  'hips.py': -0.2, 'spine.x': 0.25, 'spine.y': 0.2, 'chest.y': 0.5, 'head.y': -0.4,
  'armR.x': -1.5, 'armR.y': 1.2, 'foreR.x': -1.0, 'handR.z': 0.4, 'armL.x': -0.4, 'armL.z': 0.3, 'foreL.x': -1.0,
  'legL.x': -0.3, 'shinL.x': 0.6, 'legL.z': 0.2, 'legR.x': 0.35, 'shinR.x': 0.55, 'legR.z': -0.2,
};
const SPIN_OUT = {
  'hips.py': -0.16, 'spine.x': 0.2, 'spine.z': -0.12, 'spine.y': -0.1, 'chest.y': -0.2, 'head.y': 0.3,
  'armR.x': -1.5, 'armR.y': -1.2, 'armR.z': 0, 'foreR.x': -0.05, 'handR.x': 0, 'handR.z': -0.1,
  'armL.x': -1.3, 'armL.z': 1.1, 'foreL.x': -0.25,
  'legL.x': -0.1, 'shinL.x': 0.45, 'legL.z': 0.32, 'legR.x': 0.1, 'shinR.x': 0.45, 'legR.z': -0.32, 'spin.py': 0.06,
};
const ART_REC = {
  'hips.py': -0.08, 'spine.x': 0.1, 'spine.z': 0, 'spine.y': 0, 'chest.x': 0, 'chest.y': 0, 'neck.x': 0, 'head.x': 0, 'head.y': 0,
  'armR.x': -0.6, 'armR.y': 0, 'armR.z': -0.15, 'foreR.x': -0.9, 'handR.x': -0.4, 'handR.z': 0.25,
  'armL.x': -0.35, 'armL.z': 0.2, 'foreL.x': -0.9,
  'legL.x': 0.1, 'shinL.x': 0.25, 'legL.z': 0.1, 'legR.x': -0.15, 'shinR.x': 0.25, 'legR.z': -0.05, 'spin.py': 0,
};
// the slam leaps (startArt), somersaults once with the blade raised and drives it into the ground on landing
const SLAM_RISE = {
  'spin.ky': 1.0, 'spin.x': 0, 'spine.x': -0.35, 'chest.x': -0.2, 'neck.x': 0.1,
  'armR.x': -3.0, 'armR.y': 0.1, 'foreR.x': -0.4, 'handR.x': -0.3, 'armL.x': -2.8, 'armL.z': -0.3, 'foreL.x': -0.6,
  'legL.x': -0.9, 'shinL.x': 1.4, 'footL.x': 0.4, 'legR.x': -0.3, 'shinR.x': 1.1, 'footR.x': 0.4,
};
const SLAM_TUCK = {
  'spin.x': PI, 'spine.x': 0.7, 'chest.x': 0.3, 'neck.x': 0.4,
  'armR.x': -1.4, 'foreR.x': -1.4, 'handR.x': 0.6, 'armL.x': -1.2, 'armL.z': 0.1, 'foreL.x': -1.5,
  'legL.x': -1.6, 'shinL.x': 2.2, 'legR.x': -1.5, 'shinR.x': 2.1,
};
const SLAM_OPEN = {
  'spin.x': TAU, 'spine.x': -0.25, 'chest.x': -0.15, 'neck.x': 0.1,
  'armR.x': -3.0, 'foreR.x': -0.4, 'handR.x': -0.3, 'armL.x': -2.7, 'armL.z': -0.3, 'foreL.x': -0.6,
  'legL.x': -0.45, 'shinL.x': 0.6, 'footL.x': 0.2, 'legR.x': 0.1, 'shinR.x': 0.4, 'footR.x': 0.3,
};
const ARTS = {
  spin: clip([[0, SPIN_PREP], [0.06, SPIN_PREP], [0.13, SPIN_OUT, E.whip], [0.5, SPIN_OUT], [0.62, ART_REC]]),
  slam: clip([
    [0, SLAM_RISE], [0.12, SLAM_RISE], [0.24, SLAM_TUCK, E.in], [0.36, SLAM_OPEN, E.out], [0.46, SLAM_OPEN],
    [0.5, { ...SLAM2, 'spin.x': TAU, 'hips.py': -0.42 }, E.in3], [0.62, { 'hips.py': -0.38, 'armR.x': -1.7, 'spine.x': 0.5 }, E.out],
    [0.78, { ...ART_REC, 'spin.x': TAU }],
  ]),
};
const ART_TRAIL = { spin: [0.08, 0.54], slam: [0.4, 0.56] };

// ------------------------------------------------------------------ roll, death (keyed in progress / seconds)
const ROLL = clip([
  [0, { 'spine.x': 0.45, 'neck.x': 0.2, 'armL.x': -1.6, 'armL.z': 0.2, 'foreL.x': -0.3, 'armR.x': -1.3, 'armR.z': -0.2, 'foreR.x': -0.6, 'handR.x': 0.6,
    'legL.x': -0.5, 'shinL.x': 0.7, 'legR.x': 0.45, 'shinR.x': 0.3, 'footR.x': 0.5 }],
  [0.18, { 'spine.x': 0.85, 'chest.x': 0.4, 'neck.x': 0.6, 'head.x': 0.2, 'armL.x': -1.2, 'armL.z': 0.1, 'foreL.x': -1.7, 'armR.x': -0.7, 'armR.z': -0.1, 'foreR.x': -1.6, 'handR.x': 0.9,
    'legL.x': -1.75, 'shinL.x': 2.3, 'footL.x': 0.3, 'legR.x': -1.7, 'shinR.x': 2.3, 'footR.x': 0.3, 'hips.py': -0.08 }, E.out],
  [0.74, {}],
  [1, { 'spine.x': 0.35, 'chest.x': 0.1, 'neck.x': -0.1, 'head.x': 0, 'armL.x': -0.5, 'armL.z': 0.4, 'foreL.x': -0.6, 'armR.x': -0.6, 'armR.z': -0.3, 'foreR.x': -0.8, 'handR.x': -0.2,
    'legL.x': -0.85, 'shinL.x': 1.3, 'footL.x': 0, 'legR.x': 0.1, 'shinR.x': 1.1, 'footR.x': 0.5, 'hips.py': -0.3 }, E.out],
]);
const DEATH = clip([
  [0, { 'spin.ky': 0.12, 'spin.kz': 0.12 }],
  [0.18, { 'spine.x': -0.35, 'chest.x': -0.1, 'neck.x': -0.2, 'head.x': -0.3, 'armL.x': -0.7, 'armL.z': 0.9, 'foreL.x': -0.4,
    'armR.x': -0.5, 'armR.z': -0.8, 'foreR.x': -0.3, 'handR.x': 0.3, 'legL.x': 0.15, 'legR.x': -0.25, 'shinR.x': 0.2, 'hips.py': -0.04 }, E.out3],
  [0.55, { 'hips.py': -0.44, 'legL.x': 0, 'shinL.x': 1.55, 'footL.x': 0.5, 'legL.z': 0.06, 'legR.x': 0, 'shinR.x': 1.55, 'footR.x': 0.5, 'legR.z': -0.06,
    'spine.x': 0.3, 'chest.x': 0.1, 'neck.x': 0.25, 'head.x': 0.25, 'head.z': 0.1,
    'armL.x': 0.15, 'armL.z': 0.12, 'foreL.x': -0.2, 'armR.x': 0.1, 'armR.z': -0.2, 'foreR.x': -0.25, 'handR.x': 0.5 }],
  [0.75, { 'spine.x': 0.4, 'head.x': 0.4, 'spin.x': 0.12 }],
  [1.1, { 'spin.x': PI / 2 + 0.04, 'shinL.x': 0.05, 'shinR.x': 0.05, 'footL.x': 0.4, 'footR.x': 0.4, 'legL.x': -0.05, 'legR.x': -0.05,
    'armL.x': -1.6, 'armL.z': 0.5, 'foreL.x': -0.3, 'armR.x': -1.3, 'armR.z': -0.7, 'foreR.x': -0.2, 'handR.x': 0.6,
    'spine.x': 0, 'chest.x': 0, 'neck.x': -0.5, 'head.x': -0.2, 'head.y': 0.9, 'head.z': 0 }, E.in],
  [1.22, { 'spin.x': PI / 2 - 0.06 }, E.out],
  [1.38, { 'spin.x': PI / 2 }],
]);

const SHOOT = 0.45; // seconds the crossbow stays up after a shot
const RELAX_AFTER = 4; // quiet seconds before the blade goes to the shoulder

export class HunterAnim {
  constructor(m) {
    this.m = m;
    m.armR.rotation.order = 'YXZ'; // yaw after pitch: the sword arm sweeps around the body
    m.armL.rotation.order = 'YXZ';
    this.P = new Poser(m);
    this.act = null;
    this.phase = 0;
    this.swimPh = 0;
    this.airW = 0;
    this.relaxW = 0;
    this.idleT = 0;
    this.twirl = 0;
    this.shootT = 0;
    this.recoil = 0;
    this.accLean = 0;
    this.bank = 0;
    this.prevF = null;
    this.prevVF = 0;
    this.prevYaw = 0;
    this.torsoW = 0;
    // recoils: landing squash, hit flinch (pitch / roll / a general jolt)
    this.land = new Spring(220, 20);
    this.fp = new Spring(170, 13);
    this.fr = new Spring(170, 13);
    this.jolt = new Spring(150, 12);
    // cloth
    this.scarfX = new Spring(70, 7);
    this.scarfZ = new Spring(60, 6);
    this.coatX = new Spring(90, 9);
    this.coatZ = new Spring(80, 8);
    this.scarfX.reset(0.25);
    // blade trail, in world space (main.js hands it to fx.blade)
    this.trail = false;
    this.bladeBase = new THREE.Vector3();
    this.bladeTip = new THREE.Vector3();
  }

  // back on its feet at a checkpoint: no cross-fade out of the death pose
  reset() {
    this.act = 'loco';
    this.P.zero();
    this.P.cur.fill(0);
    this.P.fadeDur = 0;
    this.prevF = null;
    for (const s of [this.land, this.fp, this.fr, this.jolt, this.scarfZ, this.coatX, this.coatZ]) s.reset();
    this.scarfX.reset(0.25);
    this.shootT = this.twirl = this.idleT = this.relaxW = 0;
  }

  // a blow from world direction (fx, fz) → (the hunter's position): the body recoils away from it
  hurt(dx, dz, facing) {
    const d = Math.hypot(dx, dz) || 1, sf = Math.sin(facing), cf = Math.cos(facing);
    const az = -(dx * sf + dz * cf) / d, ax = -(dx * cf - dz * sf) / d; // where the attacker stands, local
    this.fp.kick(-az * 9);
    this.fr.kick(ax * 9);
    this.jolt.kick(8);
    this.idleT = 0;
  }

  shoot() {
    this.shootT = SHOOT;
    this.recoil = 1;
    this.idleT = 0;
  }

  landed(fall) {
    this.land.kick(clamp(fall / 14, 0.15, 1.3) * 11);
  }

  update(dt, time, p) {
    const m = this.m, P = this.P, q = P.q;
    const f = p.facing, sf = Math.sin(f), cf = Math.cos(f);
    const lz = p.vel.x * sf + p.vel.z * cf; // forward speed
    const lx = p.vel.x * cf - p.vel.z * sf; // sideways (+: the hunter's left)
    const hs = Math.hypot(lx, lz);
    const amt = clamp01(hs / 6.5), run = smooth(7.2, 10, hs);
    const dirX = hs > 0.05 ? lx / hs : 0, dirZ = hs > 0.05 ? lz / hs : 1;
    this.phase += hs * dt * (1.55 - 0.2 * run);
    const ph = this.phase;

    // turn rate (banking) and forward acceleration (leaning), smoothed
    if (dt > 1e-4) {
      const w = this.prevF == null ? 0 : wrap(f - this.prevF) / dt;
      this.bank = damp(this.bank, clamp(-w * 0.045 * amt - lx * 0.02, -0.3, 0.3), 10, dt);
      const a = (lz - this.prevVF) / dt;
      this.accLean = damp(this.accLean, clamp(a * 0.012, -0.25, 0.3), 8, dt);
    }
    this.prevF = f;
    this.prevVF = lz;

    // which action drives the body; a change cross-fades from the pose on screen
    const act = p.dead ? 'dead' : p.art || p.roll || (p.stun > 0 ? 'stun' : null) || p.attack || (p.swimming ? 'swim' : 'loco');
    if (act !== this.act) {
      const was = this.act;
      this.act = act;
      if (act === p.attack) P.fade(SWING_IN[act.combo] * act.def.dur);
      else if (act === 'loco') P.fade(was === p.roll ? 0.14 : was === 'swim' ? 0.3 : 0.2);
      else P.fade(act === 'swim' ? 0.3 : act === 'dead' || act === 'stun' ? 0.08 : 0.06);
      if (act !== 'loco') this.idleT = 0;
    }

    P.zero();
    let flat = 1;
    this.trail = false;
    if (act === 'dead') {
      sample(DEATH, p.deadT, q);
      flat = 0;
    } else if (act === p.art) {
      const a = p.art, c = ARTS[a.move] || ARTS.spin;
      sample(c, a.t, q);
      const tr = ART_TRAIL[a.move] || ART_TRAIL.spin;
      this.trail = a.t > tr[0] && a.t < tr[1];
      if (a.move === 'slam') flat = smooth(0.4, 0.48, a.t);
    } else if (act === p.roll) {
      const r = p.roll, k = clamp01(r.t / r.dur);
      sample(ROLL, k, q);
      // one forward roll about the tucked body's middle, sunk so the ball rolls on the ground
      q.spin.x = TAU * E.inOut(clamp01((k - 0.04) / 0.76));
      q.spin.ky = 0.9;
      q.spin.kz = 0.15;
      q.spin.py = -0.42 * smooth(0, 0.2, k) * (1 - smooth(0.7, 0.92, k));
      flat = smooth(0.8, 1, k);
    } else if (act === 'stun') {
      this.stunPose(q, time);
    } else if (act === p.attack) {
      const a = p.attack, k = a.t / a.def.dur;
      sample(SWING[a.combo], k, q);
      const tr = SWING_TRAIL[a.combo];
      this.trail = k > tr[0] && k < tr[1];
    } else if (act === 'swim') {
      this.swimPh += dt * (hs > 0.5 ? 5 : 2.2);
      this.swimPose(q, this.swimPh, amt);
      flat = 0;
    } else {
      flat = this.locoPose(q, dt, time, p, { hs, amt, run, dirX, dirZ, ph });
    }

    // recoils on top of any action
    const fp = this.fp.step(0, dt), fr = this.fr.step(0, dt), j = Math.abs(this.jolt.step(0, dt));
    if (act !== 'dead') {
      q.spine.x += fp * 0.7; q.chest.x += fp * 0.4; q.neck.x += fp * 0.4;
      q.spine.z += fr * 0.6; q.head.z += fr * 0.5;
      q.armL.z += j * 0.6; q.armR.z -= j * 0.5; q.armL.x -= j * 0.4;
      q.hips.py -= j * 0.06; q.shinL.x += j * 0.25; q.shinR.x += j * 0.25;
    }
    const sq = clamp(this.land.step(0, dt), 0, 1.2);
    if (act === 'loco' || act === p.attack) {
      q.hips.py -= 0.28 * sq;
      q.legL.x -= 0.55 * sq; q.legR.x -= 0.5 * sq;
      q.shinL.x += 1.1 * sq; q.shinR.x += 1.0 * sq;
      q.spine.x += 0.35 * sq;
      q.armL.z += 0.3 * sq; q.armR.z -= 0.25 * sq;
    }
    flatFeet(q, flat);
    P.apply(dt);

    this.cloth(dt, time, p, lx, lz, amt, act);

    // the crossbow: slung on the back, in the left hand while a shot is up
    const up = this.shootT > 0.06;
    if (m.handBow) m.handBow.visible = up;
    if (m.backBow) m.backBow.visible = !up;

    // blade trail endpoints (base of the blade to the tip), in world space
    if (this.trail) {
      m.handR.updateWorldMatrix(true, false);
      this.bladeBase.set(-0.005, -0.45, 0.012).applyMatrix4(m.handR.matrixWorld);
      this.bladeTip.set(-0.005, -1.34, 0.012).applyMatrix4(m.handR.matrixWorld);
    }
  }

  // walking, running, standing, jumping; returns how level the soles should be kept
  locoPose(q, dt, time, p, { hs, amt, run, dirX, dirZ, ph }) {
    const s = Math.sin(ph), c = Math.cos(ph);
    const sw = 1 - smooth(0.2, 2.5, hs), mw = 1 - sw; // standing / moving weights
    // --- gait along the real travel direction (strafing and backpedalling included)
    const A = (0.5 + 0.38 * run) * amt, K = (0.85 + 0.75 * run) * amt;
    stride(q, 'L', ph, A, K, dirX, dirZ, 0.08 * amt);
    stride(q, 'R', ph + PI, A, K, dirX, dirZ, 0.08 * amt);
    q.legL.x -= 0.08 * run; q.legR.x -= 0.08 * run;
    q.hips.py += amt * (-0.06 + 0.075 * Math.abs(s)) * (0.6 + 0.4 * run);
    const tw = amt * (Math.abs(dirZ) * 0.7 + 0.3) * Math.sign(dirZ || 1);
    q.hips.y += 0.2 * s * tw;
    q.chest.y += -0.32 * s * tw;
    q.head.y += 0.12 * s * tw;
    q.hips.z += 0.06 * c * amt;
    q.legL.z -= 0.06 * c * amt; q.legR.z -= 0.06 * c * amt;
    q.spine.x += 0.07 * amt + 0.22 * run + this.accLean + 0.03 * Math.abs(s) * amt;
    q.chest.x += 0.06 * run;
    q.neck.x -= (0.07 * amt + 0.28 * run + this.accLean) * 0.5;
    // the free arm swings against the legs and pumps when sprinting
    const Aa = (0.45 + 0.45 * run) * amt;
    q.armL.x += -s * Aa * dirZ;
    q.armL.z += (0.1 + 0.08 * run) * mw;
    q.foreL.x += (-0.3 - 0.95 * run) * mw - Math.max(0, s) * 0.35 * amt;
    // sword arm: on guard while walking, trailing low behind when sprinting
    const g = (1 - run) * mw, rn = run * mw;
    q.armR.x += g * (-0.35 + s * 0.1 * amt) + rn * (0.55 + s * 0.25);
    q.armR.z += g * -0.15 + rn * -0.22;
    q.foreR.x += g * -0.85 + rn * -0.25;
    q.handR.x += g * -0.45 + rn * 0.55;
    q.handR.z += g * 0.2 + rn * -0.15;

    // --- standing: a fencing guard (right foot forward) that breathes; later the blade rests on the shoulder
    const still = p.grounded && hs < 0.4 && !p.lockFace && this.shootT <= 0;
    this.idleT = still ? this.idleT + dt : 0;
    const relax = this.idleT > RELAX_AFTER ? 1 : 0;
    if (relax && this.relaxW < 0.02) this.twirl = 0.75;
    this.relaxW = damp(this.relaxW, relax, relax ? 3 : 10, dt);
    const rw = this.relaxW, gw = sw * (1 - rw), xw = sw * rw;
    const br = Math.sin(time * 2.3), ws = Math.sin(time * 0.7) * 0.03;
    // guard
    q.legR.x += -0.22 * gw; q.shinR.x += 0.22 * gw;
    q.legL.x += 0.18 * gw; q.shinL.x += 0.28 * gw; q.legL.z += 0.1 * gw; q.footL.x += 0.1 * gw;
    q.hips.y += 0.25 * gw; q.chest.y -= 0.12 * gw; q.neck.y -= 0.08 * gw; q.head.y -= 0.05 * gw;
    q.hips.py -= 0.05 * gw;
    q.armR.x += -0.45 * gw; q.armR.z += -0.18 * gw; q.foreR.x += -0.95 * gw; q.handR.x += -0.5 * gw; q.handR.z += 0.3 * gw;
    q.armL.x += -0.35 * gw; q.armL.z += 0.08 * gw; q.foreL.x += -1.0 * gw; q.handL.x += -0.2 * gw;
    // relaxed: feet together, sword on the right shoulder, looking around
    q.legL.z += 0.05 * xw; q.legR.z -= 0.05 * xw; q.shinL.x += 0.06 * xw; q.shinR.x += 0.06 * xw;
    q.armR.x += -0.5 * xw; q.armR.z += -0.35 * xw; q.foreR.x += -2.1 * xw; q.handR.x += -1.55 * xw; q.handR.z += -0.3 * xw;
    q.armL.x += 0.05 * xw; q.armL.z += 0.02 * xw; q.foreL.x += -0.2 * xw;
    q.head.y += 0.45 * Math.sin(time * 0.41) * Math.sin(time * 0.17 + 1) * xw;
    // breathing and weight shift
    q.chest.x += 0.03 * br * sw; q.armL.z += 0.02 * br * sw; q.head.x -= 0.015 * br * sw;
    q.armR.x += 0.025 * Math.sin(time * 2.3 + 0.6) * gw;
    q.hips.z += ws * sw; q.legL.z -= ws * sw; q.legR.z -= ws * sw; q.spine.z -= ws * 0.6 * sw;
    // a flourish on the way to the shoulder: the blade twirls once in the hand
    if (this.twirl > 0) {
      this.twirl = Math.max(0, this.twirl - dt);
      q.handR.x -= TAU * E.inOut(1 - this.twirl / 0.75);
    }

    // --- airborne: knee up on the way up, legs reaching for the ground on the way down
    this.airW = damp(this.airW, p.grounded ? 0 : 1, p.grounded ? 18 : 10, dt);
    const aw = this.airW;
    if (aw > 0.01) {
      // rising: one knee driven up, the other leg trailing; apex: both knees tucked; falling: legs reaching down, arms out
      const u = clamp(p.vel.y / 7, -1, 1), upw = clamp01(u), dn = clamp01(-u), mid = 1 - upw - dn;
      mix(q.legL, 'x', -1.25 * upw - 0.35 * dn - 1.1 * mid, aw); mix(q.shinL, 'x', 1.7 * upw + 0.5 * dn + 1.7 * mid, aw);
      mix(q.legR, 'x', 0.45 * upw + 0.25 * dn - 0.7 * mid, aw); mix(q.shinR, 'x', 0.9 * upw + 0.7 * dn + 1.6 * mid, aw);
      mix(q.footR, 'x', 0.6 * upw + 0.3 * mid, aw); mix(q.footL, 'x', 0.3 + 0.2 * dn, aw);
      mix(q.legL, 'z', 0.08 + 0.12 * dn, aw); mix(q.legR, 'z', -0.08 - 0.12 * dn, aw);
      mix(q.armL, 'x', -1.3 * upw - 0.4 * dn - 0.9 * mid, aw); mix(q.armL, 'z', 0.4 + 0.8 * dn, aw); mix(q.foreL, 'x', -0.7 + 0.4 * dn, aw);
      mix(q.armR, 'x', -1.1 * upw - 0.5 * dn - 0.9 * mid, aw); mix(q.armR, 'z', -0.3 - 0.6 * dn, aw);
      mix(q.foreR, 'x', -0.6, aw); mix(q.handR, 'x', -0.3 + 0.3 * dn, aw);
      q.spine.x += (-0.15 * upw + 0.2 * mid + 0.1 * dn) * aw;
      q.neck.x -= 0.15 * mid * aw;
      q.head.x += 0.15 * dn * aw;
    }

    // --- crossbow quick-draw: the left arm snaps up to aim, kicks on the shot, then the bow goes back
    if (this.shootT > 0) {
      const t = SHOOT - this.shootT;
      this.shootT = Math.max(0, this.shootT - dt);
      this.recoil = Math.max(0, this.recoil - dt * 7);
      const w = Math.min(1, t / 0.05) * Math.min(1, this.shootT / 0.12), r = E.out(this.recoil);
      mix(q.spine, 'y', -0.15, w); mix(q.chest, 'y', -0.45, w); mix(q.chest, 'x', -0.06 * r, w);
      mix(q.neck, 'y', 0.3, w); mix(q.head, 'y', 0.3, w);
      mix(q.armL, 'x', -1.57 - 0.35 * r, w); mix(q.armL, 'y', 0.5, w); mix(q.armL, 'z', 0, w);
      mix(q.foreL, 'x', -0.05, w); mix(q.handL, 'x', 0, w);
      mix(q.armR, 'x', 0.1, w); mix(q.armR, 'z', -0.25, w); mix(q.foreR, 'x', -0.4, w); mix(q.handR, 'x', 0.3, w);
    }

    // --- whole-body lean into turns and sideways steps, pivoting on the feet
    q.spin.z = this.bank * (1 - aw);
    return 1 - aw;
  }

  // the bride's scream: hands to the ears, hunched and reeling
  stunPose(q, time) {
    const k = Math.sin(time * 9);
    q.spine.x = 0.35; q.chest.x = 0.1; q.neck.x = 0.3; q.head.y = Math.sin(time * 25) * 0.15;
    q.armL.x = -1.0; q.armL.z = 0.9; q.foreL.x = -2.2;
    q.armR.x = -1.0; q.armR.z = -0.9; q.foreR.x = -2.2; q.handR.x = 0.6;
    q.hips.py = -0.12; q.legL.x = -0.2; q.shinL.x = 0.4; q.legR.x = 0.1; q.shinR.x = 0.35;
    q.spin.z = k * 0.08;
  }

  // breaststroke: tilted forward, arms sweeping out and back, frog kick
  swimPose(q, t, amt) {
    const s = Math.sin(t), c = Math.cos(t);
    q.spin.x = 0.85;
    q.spin.ky = 0.9;
    q.neck.x = -0.6; q.head.x = -0.3;
    q.armL.x = -2.2 + s * 0.6; q.armL.z = 0.5 + c * 0.6; q.foreL.x = -0.6 - Math.max(0, -s) * 1.0;
    q.armR.x = -2.2 + s * 0.6; q.armR.z = -0.5 - c * 0.6; q.foreR.x = -0.6 - Math.max(0, -s) * 1.0; q.handR.x = 0.4;
    q.legL.x = -0.3 + c * 0.35; q.legL.z = 0.3 + s * 0.2; q.shinL.x = 1.0 + c * 0.6;
    q.legR.x = -0.3 + c * 0.35; q.legR.z = -0.3 - s * 0.2; q.shinR.x = 1.0 + c * 0.6;
    q.footL.x = q.footR.x = 0.6;
    q.spine.x = -0.15 * (1 - amt);
  }

  // coat tail and scarf on springs: they stream behind with speed, lift when falling and swing out of turns
  cloth(dt, time, p, lx, lz, amt, act) {
    const m = this.m, q = this.P.q;
    const yaw = p.facing + q.hips.y + q.spine.y + q.chest.y;
    let w = 0;
    if (dt > 1e-4) w = clamp(wrap(yaw - this.prevYaw) / dt, -20, 20);
    this.prevYaw = yaw;
    this.torsoW = damp(this.torsoW, w, 20, dt);
    const tw = this.torsoW, fall = -p.vel.y, rolling = act === p.roll ? 1 : 0;
    const flutter = Math.sin(time * 11) * 0.08 * (0.2 + amt) + Math.sin(time * 17.3) * 0.04 * amt;
    if (m.scarf) {
      m.scarf.rotation.x = this.scarfX.step(0.25 + clamp(lz, -3, 11) * 0.1 + clamp(fall * 0.04, -0.3, 0.6) + rolling * 0.9, dt) + flutter;
      m.scarf.rotation.z = this.scarfZ.step(clamp(-lx * 0.08 - tw * 0.12, -0.8, 0.8), dt);
    }
    if (m.coat) {
      m.coat.rotation.x = Math.max(-0.15, this.coatX.step(0.05 + clamp(lz, -2, 11) * 0.045 + clamp(fall * 0.025, -0.2, 0.4)
        + 0.06 * Math.abs(Math.sin(this.phase)) * amt, dt) + flutter * 0.4);
      m.coat.rotation.z = this.coatZ.step(clamp(-lx * 0.04 - tw * 0.06, -0.5, 0.5), dt);
    }
  }
}
