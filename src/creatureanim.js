// Creature animation, all procedural on the skinned rigs (characters.js). enemies.js runs the AI and calls
// animateCreature() once per frame per creature with what it decided (speed, waiting its turn, windup length).
// Each kind has its own body language:
// - ghoul: a limping shamble, swaying torso, lolling and twitching head; a two-armed overhead slam;
// - vampire / the Count: a smooth stalking glide with claws ready, cape on springs; a one-armed swipe that
//   alternates sides, a coiled crouch before the lunge, a flying dash; the Count raises his arms to cast, crosses
//   them while changing phase, and lunges forward when he throws;
// - werewolf: on all fours (a walk that turns into a bounding gallop), prowling low while waiting, rearing up for
//   a double claw rake, a trembling crouch before the pounce, stretched out in the air and a squash on landing;
// - bride: drifts with her gown rippling and arms flowing, wings beating with a real downstroke; swoops claws
//   first, throws her head back and spreads her wings to scream;
// - witch: hunched hobble on her staff; raises the lantern high to cast and thrusts it forward to throw;
// - bat: asymmetric flapping with the body bobbing on each stroke, banking into turns, wings folding to dive.
// Every kind flinches away from a blow, and the walkers collapse onto the ground when they die.
import { Poser, Spring, clip, sample, stride, flatFeet, E, clamp, clamp01, damp, smooth, wrap } from './anim.js';

const PI = Math.PI, HALF = PI / 2;
// compiled static pose: [[bone, axis, value], ...]
const pose = (o) => Object.entries(o).map(([k, v]) => [...k.split('.'), v]);
const add = (q, P, w = 1) => { for (const [b, a, v] of P) if (q[b]) q[b][a] += v * w; };

// ------------------------------------------------------------------ shared: falling dead on the ground
// keyed in seconds; tipping over backward about the heels so the body ends flat on the ground (then enemies.js
// sinks it into the earth)
const DIE = clip([
  [0, { 'spin.ky': 0.05, 'spin.kz': -0.12 }],
  [0.15, { 'spine.x': -0.4, 'chest.x': -0.1, 'head.x': -0.4, 'armL.x': -1.8, 'armL.z': 0.6, 'armR.x': -1.6, 'armR.z': -0.6,
    'foreL.x': -0.4, 'foreR.x': -0.4, 'legL.x': -0.3, 'shinL.x': 0.4, 'hips.py': -0.05 }, E.out3],
  [0.55, { 'spin.x': -HALF - 0.04, 'spine.x': 0, 'chest.x': 0, 'head.x': -0.2, 'armL.x': -2.6, 'armL.z': 0.5, 'armR.x': -2.4, 'armR.z': -0.5,
    'legL.x': -0.4, 'shinL.x': 0.6, 'legR.x': -0.2, 'shinR.x': 0.4 }, E.in],
  [0.68, { 'spin.x': -HALF + 0.1 }, E.out],
  [0.82, { 'spin.x': -HALF, 'legL.x': -0.15, 'shinL.x': 0.3, 'head.y': 0.6 }],
]);

// ------------------------------------------------------------------ ghoul
const G_RAISE = {
  'armL.x': -2.7, 'armL.z': 0.35, 'armR.x': -2.7, 'armR.z': -0.35, 'foreL.x': -0.7, 'foreR.x': -0.7, 'handL.x': -0.3, 'handR.x': -0.3,
  'spine.x': -0.1, 'chest.x': -0.15, 'neck.x': -0.1, 'head.x': -0.25, 'hips.py': 0.03,
  'legL.x': -0.25, 'shinL.x': 0.3, 'legR.x': 0.25, 'shinR.x': 0.2, 'spin.x': 0,
};
const G_SLAM = {
  'armL.x': -0.55, 'armL.z': 0.1, 'armR.x': -0.55, 'armR.z': -0.1, 'foreL.x': -0.2, 'foreR.x': -0.2, 'handL.x': 0.2, 'handR.x': 0.2,
  'spine.x': 0.8, 'chest.x': 0.25, 'neck.x': -0.6, 'head.x': 0, 'hips.py': -0.12,
  'legL.x': -0.55, 'shinL.x': 0.6, 'legR.x': 0.4, 'shinR.x': 0.3, 'spin.x': 0.12,
};
const G_BASE = {
  'armL.x': -1.2, 'armL.z': 0.12, 'armR.x': -1.0, 'armR.z': -0.22, 'foreL.x': -0.35, 'foreR.x': -0.15, 'handL.x': 0.45, 'handR.x': 0.35,
  'spine.x': 0.45, 'chest.x': 0.15, 'neck.x': -0.4, 'head.x': 0, 'hips.py': -0.05,
  'legL.x': 0, 'shinL.x': 0.1, 'legR.x': 0, 'shinR.x': 0.1, 'spin.x': 0,
};
const G_ATK = clip([[0, G_RAISE], [0.8, G_RAISE], [1, { ...G_RAISE, 'armL.x': -2.9, 'armR.x': -2.9, 'spine.x': -0.2 }], [1.12, G_SLAM, E.in3], [1.5, G_SLAM], [2, G_BASE]]);

function ghoul(e, a, q, s, dt, time) {
  const amt = clamp01(s.sp / 3.6), ph = a.ph, sn = Math.sin(ph);
  stride(q, 'L', ph, 0.6 * amt, 0.9 * amt, s.dx, s.dz);
  stride(q, 'R', ph + PI, 0.38 * amt, 0.5 * amt, s.dx, s.dz); // the bad leg drags
  q.footR.x += 0.35 * amt;
  q.hips.py += amt * (-0.03 + 0.06 * Math.abs(sn));
  // the head twitches to a new angle every second or two
  if ((a.twT -= dt) <= 0) { a.twT = 0.6 + Math.random() * 1.8; a.twTo = (Math.random() - 0.5) * 0.9; }
  a.tw = damp(a.tw, a.twTo, 25, dt);
  a.twTo *= Math.exp(-2 * dt);
  if (s.act === 'atk') sample(G_ATK, s.u, q);
  else {
    add(q, G_BASE_P);
    q.spine.z += 0.16 * sn * amt + 0.05 * Math.sin(time * 1.3 + e.phase);
    q.chest.z += 0.08 * Math.sin(ph + 0.6) * amt;
    q.head.z += 0.25 * Math.sin(ph * 0.5 + e.phase) * (0.3 + amt) + a.tw;
    q.head.x += 0.1 * Math.sin(time * 1.7 + e.phase);
    q.armL.x += 0.22 * Math.sin(ph + 1) * amt + 0.06 * Math.sin(time * 2.1);
    q.armR.x += 0.22 * Math.sin(ph + 2.6) * amt + 0.05 * Math.sin(time * 1.7 + 1);
    q.foreL.x += 0.15 * Math.sin(ph + 1.5) * amt;
  }
  if (s.act === 'atk' && s.u < 1) { // the raised arms quiver before they fall
    const tr = Math.sin(time * 40) * 0.05 * s.u;
    q.armL.z += tr; q.armR.z -= tr;
  }
}
const G_BASE_P = pose(G_BASE);

// ------------------------------------------------------------------ vampires and the Count
const V_BASE = {
  'armL.x': -0.35, 'armL.z': 0.38, 'foreL.x': -0.75, 'handL.x': -0.3, 'armR.x': -0.35, 'armR.z': -0.38, 'foreR.x': -0.75, 'handR.x': -0.3,
  'spine.x': 0.06, 'chest.x': -0.06, 'neck.x': 0.08, 'head.x': 0.05, 'hips.py': 0,
  'armR.y': 0, 'chest.y': 0, 'spine.y': 0, 'hips.y': 0, 'head.y': 0, 'neck.y': 0, 'spin.x': 0,
  'legL.x': 0, 'shinL.x': 0.08, 'legR.x': 0, 'shinR.x': 0.08,
};
const V_WIND = {
  'armR.x': -2.5, 'armR.y': -0.5, 'armR.z': 0, 'foreR.x': -0.9, 'handR.x': -0.5,
  'chest.y': -0.5, 'spine.y': -0.2, 'spine.x': -0.05, 'hips.y': -0.15, 'head.y': 0.4, 'neck.y': 0.2,
  'armL.x': -0.7, 'armL.z': 0.5, 'foreL.x': -0.8,
  'legR.x': 0.3, 'shinR.x': 0.3, 'legL.x': -0.2, 'shinL.x': 0.25, 'hips.py': -0.05,
};
const V_SWIPE = {
  'armR.x': -0.5, 'armR.y': 0.9, 'foreR.x': -0.15, 'handR.x': 0.2,
  'chest.y': 0.55, 'spine.y': 0.25, 'spine.x': 0.35, 'hips.y': 0.15, 'head.y': -0.3, 'neck.y': -0.2,
  'armL.x': 0.3, 'armL.z': 0.7, 'foreL.x': -0.5,
  'legR.x': -0.5, 'shinR.x': 0.5, 'legL.x': 0.4, 'shinL.x': 0.2, 'hips.py': -0.12, 'spin.x': 0.1,
};
const V_ATK = clip([[0, V_WIND], [0.8, V_WIND], [1, { ...V_WIND, 'armR.x': -2.7, 'chest.y': -0.6 }], [1.12, V_SWIPE, E.whip], [1.5, V_SWIPE], [2, V_BASE]]);
const V_COIL = pose({
  'hips.py': -0.32, 'spine.x': 0.55, 'chest.x': 0.1, 'neck.x': -0.45, 'head.x': -0.1,
  'armL.x': 0.35, 'armL.z': 1.25, 'foreL.x': -0.4, 'handL.x': -0.4, 'armR.x': 0.35, 'armR.z': -1.25, 'foreR.x': -0.4, 'handR.x': -0.4,
  'legL.x': -0.65, 'shinL.x': 1.15, 'legR.x': 0.35, 'shinR.x': 0.95,
});
const V_DASH = pose({
  'spin.x': 0.7, 'spin.py': 0.15, 'spine.x': 0.2, 'neck.x': -0.6,
  'armL.x': -2.4, 'armL.z': 0.25, 'foreL.x': -0.1, 'armR.x': -2.4, 'armR.z': -0.25, 'foreR.x': -0.1,
  'legL.x': 0.5, 'shinL.x': 0.7, 'legR.x': 0.9, 'shinR.x': 0.5, 'footL.x': 0.6, 'footR.x': 0.6,
});
const V_CAST = pose({
  'armL.x': -2.75, 'armL.z': 0.55, 'foreL.x': -0.3, 'handL.x': 0.4, 'armR.x': -2.75, 'armR.z': -0.55, 'foreR.x': -0.3, 'handR.x': 0.4,
  'spine.x': -0.3, 'chest.x': -0.1, 'head.x': -0.35,
});
const V_THROW = pose({
  'armL.x': -1.6, 'armL.z': 0.25, 'foreL.x': -0.1, 'armR.x': -1.6, 'armR.z': -0.25, 'foreR.x': -0.1,
  'spine.x': 0.3, 'head.x': 0.1, 'legL.x': -0.4, 'shinL.x': 0.4, 'legR.x': 0.3, 'shinR.x': 0.2, 'hips.py': -0.08,
});
const V_SHIELD = pose({
  'armL.x': -1.3, 'armL.y': -0.9, 'foreL.x': -1.3, 'armR.x': -1.3, 'armR.y': 0.9, 'foreR.x': -1.3,
  'neck.x': 0.45, 'spine.x': 0.25, 'legL.x': 0.2, 'shinL.x': 0.4, 'legR.x': -0.1, 'shinR.x': 0.3, 'footL.x': 0.6, 'footR.x': 0.6,
});

function vampire(e, a, q, s, dt, time) {
  const boss = !!e.T.boss, amt = clamp01(s.sp / 5), ph = a.ph, sn = Math.sin(ph);
  const tr = Math.sin(time * 45) * 0.03; // trembling with intent
  if (s.act === 'atk') { sample(V_ATK, s.u, q, 1, a.side < 0); s.flat = 1; return; }
  if (s.act === 'shield') {
    add(q, V_SHIELD);
    q.spin.py = 0.35 + Math.sin(time * 3) * 0.08;
    s.flat = 0;
    return;
  }
  stride(q, 'L', ph, 0.5 * amt, 0.7 * amt, s.dx, s.dz);
  stride(q, 'R', ph + PI, 0.5 * amt, 0.7 * amt, s.dx, s.dz);
  q.hips.py += amt * (-0.02 + 0.025 * Math.abs(sn));
  q.hips.y += 0.12 * sn * amt * s.dz;
  q.chest.y -= 0.18 * sn * amt * s.dz;
  add(q, V_BASE_P);
  q.spine.x += 0.12 * amt;
  q.armL.x += 0.18 * sn * amt; q.armR.x -= 0.18 * sn * amt;
  // waiting its turn: lower, claws wider, head tilting like a cat's
  const w = a.waitW;
  q.hips.py -= 0.1 * w; q.spine.x += 0.2 * w; q.armL.z += 0.25 * w; q.armR.z -= 0.25 * w;
  q.head.z += 0.15 * Math.sin(time * 0.8 + e.phase) * w;
  q.chest.x += 0.02 * Math.sin(time * 2 + e.phase); // breath
  if (s.act === 'coil') {
    const k = s.k;
    add(q, V_COIL, smooth(0, 0.4, k));
    q.hips.py -= 0.12 * k;
    q.spine.z += tr; q.armL.z += tr * 2; q.armR.z -= tr * 2;
  } else if (s.act === 'dash') {
    for (const ch of ['armL', 'armR', 'foreL', 'foreR', 'legL', 'legR', 'shinL', 'shinR', 'spine', 'neck']) q[ch].x = 0;
    q.armL.z = q.armR.z = 0;
    add(q, V_DASH);
    s.flat = 0;
  } else if (s.act === 'cast') {
    add(q, V_CAST, smooth(0, 0.35, s.k));
    q.spin.py += 0.14 * s.k + tr * 0.5; // he rises a little off the ground
    q.armL.z += tr * 3; q.armR.z -= tr * 3;
  } else if (s.act === 'throw') {
    add(q, V_THROW, Math.sin(clamp01(s.k) * PI));
  }
  if (boss && e.stage >= 3) q.spine.x += 0.08; // fury: hunched, savage
}
const V_BASE_P = pose(V_BASE);

// ------------------------------------------------------------------ werewolf
const W_REAR = {
  'spine.x': -0.15, 'chest.x': -0.1, 'neck.x': -0.2, 'head.x': -0.35,
  'armL.x': -2.6, 'armL.z': 0.55, 'foreL.x': -0.7, 'handL.x': -0.5, 'armR.x': -2.6, 'armR.z': -0.55, 'foreR.x': -0.7, 'handR.x': -0.5,
  'legL.x': -0.2, 'shinL.x': 0.35, 'legR.x': 0.2, 'shinR.x': 0.3, 'hips.py': 0.04, 'spin.x': 0,
};
const W_RAKE = {
  'spine.x': 0.75, 'chest.x': 0.25, 'neck.x': -0.5, 'head.x': 0.1,
  'armL.x': -0.35, 'armL.z': 0.15, 'foreL.x': -0.3, 'handL.x': 0.3, 'armR.x': -0.35, 'armR.z': -0.15, 'foreR.x': -0.3, 'handR.x': 0.3,
  'legL.x': -0.55, 'shinL.x': 0.6, 'legR.x': 0.45, 'shinR.x': 0.3, 'hips.py': -0.14, 'spin.x': 0.1,
};
const W_UP = {
  'spine.x': 0.4, 'chest.x': 0, 'neck.x': -0.35, 'head.x': 0,
  'armL.x': -1.0, 'armL.z': 0.3, 'foreL.x': -0.5, 'handL.x': 0, 'armR.x': -1.0, 'armR.z': -0.3, 'foreR.x': -0.5, 'handR.x': 0,
  'legL.x': 0, 'shinL.x': 0.15, 'legR.x': 0, 'shinR.x': 0.15, 'hips.py': -0.06, 'spin.x': 0,
};
const W_ATK = clip([[0, W_REAR], [0.8, W_REAR], [1, { ...W_REAR, 'spine.x': -0.25, 'armL.x': -2.8, 'armR.x': -2.8 }], [1.12, W_RAKE, E.whip], [1.5, W_RAKE], [2, W_UP]]);
const W_CROUCH = pose({
  'hips.py': -0.42, 'legL.x': -0.75, 'shinL.x': 1.55, 'legR.x': -0.75, 'shinR.x': 1.55,
  'spine.x': 1.0, 'chest.x': 0.35, 'neck.x': -0.85, 'head.x': -0.3,
  'armL.x': -0.9, 'armL.z': 0.2, 'foreL.x': -1.1, 'handL.x': -0.6, 'armR.x': -0.9, 'armR.z': -0.2, 'foreR.x': -1.1, 'handR.x': -0.6,
});
const W_LEAP = pose({
  'spine.x': 1.0, 'chest.x': 0.3, 'neck.x': -1.05, 'head.x': -0.2,
  'armL.x': -2.6, 'armL.z': 0.25, 'foreL.x': -0.2, 'handL.x': -0.6, 'armR.x': -2.6, 'armR.z': -0.25, 'foreR.x': -0.2, 'handR.x': -0.6,
  'legL.x': 0.9, 'shinL.x': 0.25, 'legR.x': 0.75, 'shinR.x': 0.35, 'footL.x': 0.7, 'footR.x': 0.7, 'hips.py': -0.1,
});
const W_UP_P = pose(W_UP);

function wolf(e, a, q, s, dt, time) {
  if (s.act === 'atk') { sample(W_ATK, s.u, q); a.quad = 0; return; }
  if (s.act === 'crouch') {
    add(q, W_CROUCH, smooth(0, 0.5, s.k));
    const tr = Math.sin(time * 50) * 0.025;
    q.spine.z += tr; q.hips.px += tr * 0.5;
    q.spin.sy = -0.06 * s.k;
    a.quad = 1;
    return;
  }
  if (s.act === 'leap') {
    add(q, W_LEAP);
    q.spin.x = (s.k - 0.5) * 0.8; // nose up leaving the ground, nose down coming in
    q.spin.ky = 0.9; q.spin.kz = 0.2;
    q.spin.sy = 0.05;
    s.flat = 0;
    a.quad = 1;
    return;
  }
  // on all fours unless it rears up to strike (blended, so it drops down / stands up smoothly)
  a.quad = damp(a.quad, 1, 6, dt);
  const Q = a.quad, U = 1 - Q;
  const amt = clamp01(s.sp / 8), gal = smooth(4.5, 7, s.sp), ph = a.ph;
  // upright gait
  if (U > 0.01) {
    stride(q, 'L', ph, 0.6 * amt * U, 0.8 * amt * U, s.dx, s.dz);
    stride(q, 'R', ph + PI, 0.6 * amt * U, 0.8 * amt * U, s.dx, s.dz);
    add(q, W_UP_P, U);
  }
  // four-legged: a lateral walk that turns into a bound (hind legs together, then the front pair)
  const off = (w, g) => w + (g - w) * gal;
  const hL = ph, hR = ph + off(PI, 0.35), fL = ph + off(HALF, PI + 0.2), fR = ph + off(PI + HALF, PI + 0.55);
  const A = (0.45 + 0.3 * gal) * amt * Q, lowW = a.waitW;
  stride(q, 'L', hL, A, (0.9 + 0.4 * gal) * amt * Q, s.dx, s.dz, 0.3 * Q);
  stride(q, 'R', hR, A, (0.9 + 0.4 * gal) * amt * Q, s.dx, s.dz, 0.3 * Q);
  q.armL.x += (-1.25 + 0.85 * Math.sin(fL) * amt * s.dz) * Q;
  q.armR.x += (-1.25 + 0.85 * Math.sin(fR) * amt * s.dz) * Q;
  q.armL.z += 0.12 * Q; q.armR.z -= 0.12 * Q;
  q.foreL.x += (-0.25 - Math.max(0, -Math.cos(fL)) * 1.0 * amt) * Q;
  q.foreR.x += (-0.25 - Math.max(0, -Math.cos(fR)) * 1.0 * amt) * Q;
  q.handL.x -= 0.9 * Q; q.handR.x -= 0.9 * Q;
  q.spine.x += (0.95 + 0.12 * Math.sin(ph) * gal + 0.1 * lowW) * Q;
  q.chest.x += 0.35 * Q;
  q.neck.x += (-0.95 + 0.2 * lowW) * Q;
  q.head.x += -0.25 * Q;
  q.hips.py += (-0.2 - 0.12 * lowW + amt * (0.08 * Math.sin(ph) * gal - 0.03 * Math.cos(2 * ph) * (1 - gal))) * Q;
  q.spin.x += 0.06 * Math.sin(ph + 1) * gal * Q;
  q.spin.ky = 0.8 * Q; q.spin.kz = 0.2 * Q;
  // landing from a pounce: squash and crouch
  if (s.act === 'land') {
    const k = 1 - clamp01(s.k);
    q.spin.sy = -0.14 * k;
    add(q, W_CROUCH, k * 0.7);
  }
  // breathing / panting
  q.chest.x += 0.03 * Math.sin(time * 7 + e.phase) * (1 - amt);
}

// ------------------------------------------------------------------ bride
const B_WIND = {
  'armL.x': 0.5, 'armL.z': 0.9, 'foreL.x': -0.9, 'handL.x': -0.5, 'armR.x': 0.5, 'armR.z': -0.9, 'foreR.x': -0.9, 'handR.x': -0.5,
  'spine.x': -0.3, 'chest.x': -0.15, 'neck.x': -0.25, 'head.x': -0.2, 'spin.x': 0.05,
  'wingL.y': -0.3, 'wingL.z': 0.75, 'wingL2.z': 0.4, 'wingR.y': 0.3, 'wingR.z': -0.75, 'wingR2.z': -0.4,
};
const B_SLASH = {
  'armL.x': -1.9, 'armL.z': 0.15, 'foreL.x': -0.1, 'handL.x': 0.3, 'armR.x': -1.9, 'armR.z': -0.15, 'foreR.x': -0.1, 'handR.x': 0.3,
  'spine.x': 0.35, 'chest.x': 0.1, 'neck.x': -0.1, 'head.x': 0.15, 'spin.x': 0.6,
  'wingL.y': 0.7, 'wingL.z': -0.1, 'wingL2.z': -0.2, 'wingR.y': -0.7, 'wingR.z': 0.1, 'wingR2.z': 0.2,
};
const B_BASE = {
  'armL.x': -0.6, 'armL.z': 0.45, 'foreL.x': -0.7, 'handL.x': 0.3, 'armR.x': -0.6, 'armR.z': -0.45, 'foreR.x': -0.7, 'handR.x': 0.3,
  'spine.x': 0, 'chest.x': 0, 'neck.x': 0, 'head.x': 0.08, 'spin.x': 0.3,
  'wingL.y': 0, 'wingL.z': 0.25, 'wingL2.z': 0, 'wingR.y': 0, 'wingR.z': -0.25, 'wingR2.z': 0,
};
const B_ATK = clip([[0, B_WIND], [0.8, B_WIND], [1.12, B_SLASH, E.whip], [1.5, B_SLASH], [2, B_BASE]]);
const B_INHALE = pose({
  'neck.x': -0.55, 'head.x': -0.45, 'armL.x': 0.45, 'armL.z': 1.35, 'foreL.x': -0.3, 'armR.x': 0.45, 'armR.z': -1.35, 'foreR.x': -0.3,
  'spine.x': -0.4, 'chest.x': -0.2, 'spin.x': -0.1,
  'wingL.y': -0.2, 'wingL.z': 0.75, 'wingL2.z': 0.3, 'wingR.y': 0.2, 'wingR.z': -0.75, 'wingR2.z': -0.3,
});
const B_SCREAM = pose({
  'neck.x': 0.35, 'head.x': 0.35, 'armL.x': -1.1, 'armL.z': 1.0, 'foreL.x': -0.2, 'armR.x': -1.1, 'armR.z': -1.0, 'foreR.x': -0.2,
  'spine.x': 0.3, 'spin.x': 0.45,
  'wingL.y': -0.4, 'wingL.z': 0.5, 'wingR.y': 0.4, 'wingR.z': -0.5,
});
const flap = (x) => Math.sin(x) - 0.3 * Math.sin(2 * x); // quick downstroke, slower recovery

function bride(e, a, q, s, dt, time) {
  const ph = e.phase, t = time;
  q.spin.ky = 1.0;
  // the gown ripples: the (hidden) legs sway under it
  q.legL.x += 0.22 * Math.sin(t * 1.6 + ph); q.legR.x += 0.22 * Math.sin(t * 1.6 + ph + 1.4);
  q.legL.z += 0.1 + 0.08 * Math.sin(t * 1.2); q.legR.z += -0.1 - 0.08 * Math.sin(t * 1.2 + 0.5);
  q.shinL.x += 0.2; q.shinR.x += 0.2;
  s.flat = 0;
  if (s.act === 'atk') { sample(B_ATK, s.u, q); return; }
  a.wph += dt * (6 + s.sp * 0.4);
  const f = flap(a.wph), f2 = flap(a.wph - 0.8);
  q.wingL.z += 0.25 + 0.5 * f; q.wingL2.z += 0.35 * f2;
  q.wingR.z -= 0.25 + 0.5 * f; q.wingR2.z -= 0.35 * f2;
  // flowing arms, a slow tilt of the head, leaning into the flight
  q.armL.x += -0.55 + 0.3 * Math.sin(t * 1.9 + ph); q.armL.z += 0.45 + 0.2 * Math.sin(t * 1.3 + ph);
  q.foreL.x += -0.7 + 0.3 * Math.sin(t * 2.3 + ph + 1); q.handL.x += 0.35 + 0.2 * Math.sin(t * 2.1);
  q.armR.x += -0.55 + 0.3 * Math.sin(t * 1.9 + ph + 1.2); q.armR.z -= 0.45 + 0.2 * Math.sin(t * 1.3 + ph + 1.2);
  q.foreR.x += -0.7 + 0.3 * Math.sin(t * 2.3 + ph + 2.2); q.handR.x += 0.35 + 0.2 * Math.sin(t * 2.1 + 1);
  q.spine.x += 0.05 * Math.sin(t * 1.5); q.chest.z += 0.06 * Math.sin(t * 1.1);
  q.head.z += 0.18 * Math.sin(t * 0.8 + ph); q.head.x += 0.08;
  q.spin.x += 0.25 + clamp(s.lz * 0.04, -0.2, 0.35);
  q.spin.z += a.bank * 2;
  q.spin.py += -0.04 * Math.cos(a.wph); // she rises on each downstroke
  if (s.act === 'inhale') {
    const tr = Math.sin(time * 48) * 0.04, w = smooth(0, 0.3, s.k);
    for (const [b, ax, v] of B_INHALE) q[b][ax] += (v - q[b][ax]) * w;
    q.wingL.z += tr; q.wingR.z -= tr; q.head.y += tr; q.spine.z += tr;
  } else if (s.act === 'scream') {
    const w = Math.sin(clamp01(s.k) * PI) ** 0.5, tr = Math.sin(time * 55) * 0.05;
    for (const [b, ax, v] of B_SCREAM) q[b][ax] += (v - q[b][ax]) * w;
    q.head.y += tr; q.armL.z += tr; q.armR.z -= tr;
  }
}

// ------------------------------------------------------------------ witch
const H_CAST = pose({
  'armL.x': -2.8, 'armL.z': 0.15, 'foreL.x': -0.2, 'handL.x': 0.5,
  'armR.x': -1.5, 'armR.z': -0.1, 'foreR.x': -0.1, 'handR.x': -0.2,
  'spine.x': -0.45, 'chest.x': -0.25, 'neck.x': 0.15, 'head.x': -0.1, 'hips.py': 0.02,
});
const H_THROW = pose({
  'armL.x': -1.8, 'foreL.x': -0.1, 'handL.x': 0.3, 'spine.x': 0.1, 'armR.x': -1.2, 'head.x': 0.1,
  'legL.x': -0.4, 'shinL.x': 0.4, 'legR.x': 0.3, 'shinR.x': 0.2,
});

function witch(e, a, q, s, dt, time) {
  const amt = clamp01(s.sp / 4.6), ph = a.ph, sn = Math.sin(ph);
  if (s.act === 'atk') { sample(V_ATK, s.u, q); return; } // cornered: a claw swipe with the free hand
  stride(q, 'L', ph, 0.38 * amt, 0.5 * amt, s.dx, s.dz);
  stride(q, 'R', ph + PI, 0.38 * amt, 0.5 * amt, s.dx, s.dz);
  const back = clamp01(-s.lz / 3); // backing away from the hunter
  q.spine.x += 0.42 - 0.25 * back; q.chest.x += 0.15; q.neck.x += -0.32 + 0.1 * back; q.head.x += 0.05;
  q.spine.z += 0.12 * sn * amt + 0.04 * Math.sin(time + e.phase);
  q.hips.py += -0.06 + 0.04 * Math.abs(sn) * amt;
  // the staff: planted with each step, kept upright whatever the back is doing
  q.armL.x += -0.3 + 0.28 * Math.sin(ph + 0.5) * amt; q.armL.z += 0.1; q.foreL.x += -0.35;
  // the free hand beckons, fingers curling
  q.armR.x += -0.75 + 0.1 * Math.sin(time * 1.4); q.armR.z -= 0.15;
  q.foreR.x += -0.9 + 0.25 * Math.sin(time * 3.1); q.handR.x += -0.4 + 0.3 * Math.sin(time * 5);
  if (s.act === 'cast') {
    const w = smooth(0, 0.3, s.k);
    for (const [b, ax, v] of H_CAST) q[b][ax] += (v - q[b][ax]) * w;
    q.armL.z += 0.15 * Math.sin(time * 12) * w; q.armL.x += 0.12 * Math.cos(time * 12) * w; // the lantern swirls
  } else if (s.act === 'throw') {
    const w = Math.sin(clamp01(s.k) * PI);
    for (const [b, ax, v] of H_THROW) q[b][ax] += (v - q[b][ax]) * w;
  }
  q.handL.x = -(q.spine.x + q.chest.x + q.armL.x + q.foreL.x) * 0.85 + (s.act === 'cast' ? 0.3 : 0);
}

// ------------------------------------------------------------------ bat
function bat(e, a, q, s, dt, time) {
  const dive = s.act === 'atk' && s.u < 1, strike = s.act === 'atk' && s.u >= 1;
  a.wph += dt * (dive ? 8 : 22);
  const f = flap(a.wph), f2 = flap(a.wph - 0.8);
  if (dive) {
    // wings fold back for the dive, then snap open as it strikes
    q.wingL.z = -0.3; q.wingL.y = 0.6; q.wingR.z = 0.3; q.wingR.y = -0.6;
    q.wingL2.z = -0.4; q.wingR2.z = 0.4;
    q.spin.x = 0.5;
  } else {
    const k = strike ? 1.3 : 0.9;
    q.wingL.z = 0.1 + k * f; q.wingL2.z = 0.5 * f2;
    q.wingR.z = -0.1 - k * f; q.wingR2.z = -0.5 * f2;
    q.spin.py = -0.05 * Math.cos(a.wph); // up on every downstroke
    q.spin.x = clamp(-a.vy * 0.08, -0.6, 0.6) + (strike ? -0.3 : 0);
  }
  q.spin.z = clamp(a.bank * 5, -0.7, 0.7);
  s.flat = 0;
}

const KINDS = { ghoul, vampire, dracula: vampire, wolf, bride, witch, bat };

// enemies.js calls this right after damage(): the body recoils away from the blow
export function hitReact(e, dirX, dirZ, heavy) {
  const a = e.anim;
  if (!a) return;
  const sf = Math.sin(e.facing), cf = Math.cos(e.facing);
  const pz = dirX * sf + dirZ * cf, px = dirX * cf - dirZ * sf, k = (e.T.boss ? 0.4 : 1) * (heavy ? 1.4 : 1);
  a.fp.kick(pz * 10 * k);
  a.fr.kick(-px * 10 * k);
  a.jolt.kick(8 * k);
}

// o: { sp (commanded speed), wait (circling, waiting for an attack turn), W (windup), cast, lunge, scream, crouch (durations) }
export function animateCreature(e, dt, time, o) {
  const m = e.m, T = e.T;
  let a = e.anim;
  if (!a) {
    if (m.armL) m.armL.rotation.order = m.armR.rotation.order = 'YXZ';
    a = e.anim = {
      P: new Poser(m), act: '', ph: e.phase, wph: e.phase, px: e.pos.x, pz: e.pos.z, py: e.pos.y, vx: 0, vz: 0, vy: 0,
      prevF: e.facing, bank: 0, waitW: 0, quad: 1, side: 1, lastAtk: -1, after: '', afterT: 0, afterDur: 1, dieSpin: 0,
      twT: 0, tw: 0, twTo: 0,
      fp: new Spring(160, 12), fr: new Spring(160, 12), jolt: new Spring(140, 11),
      capeX: new Spring(60, 6), capeZ: new Spring(50, 5), tailX: new Spring(40, 5), tailY: new Spring(35, 4),
    };
  }
  const P = a.P, q = P.q, pos = e.pos;
  // real velocity (knockback slides and blocked walls included), in the creature's frame
  if (dt > 1e-4) {
    a.vx = damp(a.vx, (pos.x - a.px) / dt, 12, dt);
    a.vz = damp(a.vz, (pos.z - a.pz) / dt, 12, dt);
    a.vy = damp(a.vy, (pos.y - a.py) / dt, 10, dt);
    const w = wrap(e.facing - a.prevF) / dt;
    a.bank = damp(a.bank, clamp(-w * 0.03, -0.15, 0.15), 8, dt);
  }
  a.px = pos.x; a.pz = pos.z; a.py = pos.y; a.prevF = e.facing;
  const sf = Math.sin(e.facing), cf = Math.cos(e.facing);
  const lz = a.vx * sf + a.vz * cf, lx = a.vx * cf - a.vz * sf;
  let sp = Math.hypot(lx, lz);
  if (e.dash || e.leap) sp = 0;
  a.ph += sp * dt * (T.leap ? 1.25 : e.type === 'ghoul' ? 1.9 : e.type === 'witch' ? 2.1 : e.T.lunge || T.boss ? 1.35 : 1.6);
  a.waitW = damp(a.waitW, o.wait ? 1 : 0, 4, dt);

  // what the body is doing
  let act = 'move', k = 0;
  const W = o.W;
  if (e.dying) act = 'die';
  else if (e.shield > 0) act = 'shield';
  else if (e.atk >= 0) act = 'atk';
  else if (e.cast > 0) { act = 'cast'; k = 1 - e.cast / o.cast; }
  else if (e.prep > 0) { act = e.prepKind === 'lunge' ? 'coil' : 'inhale'; k = 1 - e.prep / (e.prepKind === 'lunge' ? o.lunge : o.scream); }
  else if (e.dash) act = 'dash';
  else if (e.crouch > 0) { act = 'crouch'; k = 1 - e.crouch / o.crouch; }
  else if (e.leap) { act = 'leap'; k = Math.min(1, e.leap.t / 0.5); }
  // follow-throughs that outlive the AI state: the throw after a cast, the scream itself, a pounce's landing
  if (act === 'move' && a.after) {
    if ((a.afterT += dt) < a.afterDur) { act = a.after; k = a.afterT / a.afterDur; } else a.after = '';
  }
  if (act !== a.act || (act === 'atk' && e.atk < a.lastAtk)) {
    const prev = a.act;
    if (!e.stun && !e.dying && act === 'move') {
      const next = prev === 'cast' ? ['throw', 0.35] : prev === 'inhale' ? ['scream', 0.5] : prev === 'leap' ? ['land', 0.3] : null;
      if (next) { a.after = next[0]; a.afterDur = next[1]; a.afterT = 0; act = next[0]; }
    }
    if (act === 'atk') a.side = -a.side; // vampires alternate claws
    P.fade(act === 'atk' ? Math.min(0.14, W * 0.5) : act === 'die' ? 0.1 : act === 'shield' ? 0.3 : act === 'dash' || act === 'leap' ? 0.06 : act === 'move' ? 0.25 : 0.12);
    a.act = act;
  }
  a.lastAtk = e.atk;
  const u = e.atk < 0 ? 0 : e.atk < W ? e.atk / W : 1 + Math.min(1, (e.atk - W) / 0.3);
  const s = { act, k, u, sp, lz, lx, dx: sp > 0.05 ? lx / sp : 0, dz: sp > 0.05 ? lz / sp : 1, flat: 1 };

  P.zero();
  if (act === 'die') {
    if (T.fly) {
      // flyers tumble out of the air (enemies.js drops them), limp
      a.dieSpin += dt * (e.type === 'bat' ? 14 : 4);
      q.spin.z = a.dieSpin;
      q.spin.x = e.type === 'bat' ? a.dieSpin * 0.4 : 0.4 + Math.min(1.1, e.dying * 1.6); // the bride pitches over as she falls
      if (e.type === 'bride') {
        q.spin.ky = 1;
        q.armL.x = -2.6; q.armL.z = 0.4; q.armR.x = -2.6; q.armR.z = -0.4; q.neck.x = -0.5; q.head.x = -0.3;
      }
      if (q.wingL) { q.wingL.z = -0.6; q.wingL.y = 0.5; q.wingR.z = 0.6; q.wingR.y = -0.5; }
      s.flat = 0;
    } else {
      sample(DIE, e.dying, q);
      s.flat = 0;
    }
  } else {
    (KINDS[e.type] || ghoul)(e, a, q, s, dt, time);
    // recoil from blows, on top of anything
    const fp = a.fp.step(0, dt), fr = a.fr.step(0, dt), j = Math.abs(a.jolt.step(0, dt));
    if (e.type === 'bat') { q.spin.x += fp * 0.8; q.wingL.z += j * 0.5; q.wingR.z -= j * 0.5; }
    else {
      q.spine.x += fp * 0.7; q.chest.x += fp * 0.3; q.neck.x += fp * 0.5; q.head.x += fp * 0.3;
      q.spine.z += fr * 0.5;
      q.armL.z += j * 0.5; q.armR.z -= j * 0.5; q.armL.x -= j * 0.3; q.armR.x -= j * 0.3;
      q.hips.py -= j * 0.05;
    }
    if (!T.fly) q.spin.z += a.bank;
  }
  flatFeet(q, s.flat);
  P.apply(dt);

  // capes and tails on springs
  const flut = Math.sin(time * 6 + e.phase) * 0.05;
  if (m.cape) {
    const up = act === 'dash' ? 1.0 : act === 'coil' ? 0.45 : act === 'cast' || act === 'shield' ? 0.45 : 0;
    m.cape.rotation.x = Math.max(-0.1, a.capeX.step(0.1 + clamp(lz, -3, 10) * 0.045 + up + clamp(-a.vy * 0.05, -0.2, 0.4), dt) + flut);
    m.cape.rotation.z = a.capeZ.step(clamp(-lx * 0.05 - a.bank * 2, -0.4, 0.4), dt);
    if (m.cape2) m.cape2.rotation.x = 0.08 + m.cape.rotation.x * 0.4 + Math.sin(time * 5 + e.phase + 1) * 0.08;
  }
  if (m.tail) {
    const excited = act === 'crouch' || act === 'leap' || act === 'atk' ? 0.5 : 0;
    m.tail.rotation.x = a.tailX.step(-0.25 + excited + clamp01(sp / 8) * 0.25 - a.waitW * 0.35 - (1 - a.quad) * 0.3, dt);
    m.tail.rotation.y = a.tailY.step(Math.sin(time * 8 + e.phase) * 0.45 * (0.3 + clamp01(sp / 8)), dt);
    if (m.tail2) {
      m.tail2.rotation.x = m.tail.rotation.x * 0.5;
      m.tail2.rotation.y = m.tail.rotation.y * 1.2 + Math.sin(time * 8 + e.phase - 0.8) * 0.2;
    }
  }
}
