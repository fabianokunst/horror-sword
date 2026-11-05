// Procedural dead trees: a crooked trunk with root flares and snapped stubs, reaching branches that fork into
// twigs and sub-twigs. Every limb is one seamless tapered tube that starts on its parent's axis (thinner than
// the parent there) and ends in a point, so nothing floats or shows an open end. Each tree is unique, grown
// from its own seed; world.js merges the trees of a map sector into a single mesh.
import * as THREE from 'three';
import { mulberry32 } from './rng.js';

const TAU = Math.PI * 2;

// plain arrays for one sector's trees; geometry() turns them into a BufferGeometry
export class LimbBatch {
  constructor() { this.pos = []; this.nor = []; this.uv = []; this.idx = []; }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.idx); // 32-bit indices when a sector outgrows 16 bits
    g.computeBoundingSphere();
    return g;
  }
}

const _t = new THREE.Vector3(), _n = new THREE.Vector3(), _b = new THREE.Vector3(), _d = new THREE.Vector3(), _a = new THREE.Vector3();

// Tube along a polyline with a radius per point. Rings sit on the bisector of the two segments (no gaps at the
// bends) and are parallel-transported (no twisting). A zero radius closes the tube in a point.
function tube(B, pts, rad, sides) {
  const first = B.pos.length / 3, n = pts.length, w = sides + 1;
  let v = 0;
  for (let i = 0; i < n; i++) {
    if (i === 0) _t.subVectors(pts[1], pts[0]).normalize();
    else if (i === n - 1) _t.subVectors(pts[i], pts[i - 1]).normalize();
    else _t.subVectors(pts[i + 1], pts[i]).normalize().add(_a.subVectors(pts[i], pts[i - 1]).normalize()).normalize();
    if (i === 0) _n.set(Math.abs(_t.y) > 0.9 ? 1 : 0, Math.abs(_t.y) > 0.9 ? 0 : 1, 0);
    _n.addScaledVector(_t, -_n.dot(_t)).normalize();
    _b.crossVectors(_t, _n);
    if (i) v += pts[i].distanceTo(pts[i - 1]) * 0.5;
    const p = pts[i], r = rad[i];
    for (let j = 0; j <= sides; j++) {
      const ang = (j / sides) * TAU;
      _d.copy(_n).multiplyScalar(Math.cos(ang)).addScaledVector(_b, Math.sin(ang));
      B.pos.push(p.x + _d.x * r, p.y + _d.y * r, p.z + _d.z * r);
      B.nor.push(_d.x, _d.y, _d.z);
      B.uv.push(j / sides, v);
    }
  }
  for (let i = 0; i < n - 1; i++)
    for (let j = 0; j < sides; j++) {
      const a = first + i * w + j, b = a + w;
      B.idx.push(a, a + 1, b);
      if (rad[i + 1] > 0) B.idx.push(a + 1, b + 1, b);
    }
}

// A crooked path: the first segment follows dir exactly (the angle it leaves its parent at), then at each joint
// the heading drifts at random (wob) and bends up or down (lift).
function path(rnd, from, dir, len, segs, wob, lift) {
  const pts = [from.clone()], d = dir.clone().normalize(), p = from.clone();
  for (let i = 0; i < segs; i++) {
    if (i) {
      d.x += (rnd() - 0.5) * wob;
      d.y += (rnd() - 0.5) * wob + lift;
      d.z += (rnd() - 0.5) * wob;
      d.normalize();
    }
    pts.push(p.addScaledVector(d, len / segs).clone());
  }
  return pts;
}

function measure(pts) {
  const L = [0];
  for (let i = 1; i < pts.length; i++) L.push(L[i - 1] + pts[i].distanceTo(pts[i - 1]));
  return L;
}

// point and heading at fraction f of a path's length
function at(pts, L, f, p, d) {
  const x = f * L[L.length - 1];
  let i = 1;
  while (i < L.length - 1 && L[i] < x) i++;
  p.lerpVectors(pts[i - 1], pts[i], (x - L[i - 1]) / (L[i] - L[i - 1] || 1));
  d.subVectors(pts[i], pts[i - 1]).normalize();
}

// d turned by angle th toward the side (sx, sy, sz)
function turn(d, sx, sy, sz, th) {
  const u = new THREE.Vector3(sx, sy, sz);
  u.addScaledVector(d, -u.dot(d));
  if (u.lengthSq() < 1e-6) u.set(-d.z, 0, d.x); // side parallel to d: any perpendicular will do
  if (u.lengthSq() < 1e-6) u.set(1, 0, 0);
  u.normalize();
  return d.clone().multiplyScalar(Math.cos(th)).addScaledVector(u, Math.sin(th));
}

const taper = (r0, f, k) => r0 * Math.pow(Math.max(0, 1 - f), k);

// level 1: branch (forks into 2-4 twigs), 2: twig (0-2 sub-twigs), 3: sub-twig
function limb(B, rnd, pts, r0, level) {
  const L = measure(pts), len = L[L.length - 1];
  tube(B, pts, L.map((l) => taper(r0, l / len, 0.7)), level === 1 ? 5 : 3);
  if (level === 3) return;
  const n = level === 1 ? 2 + Math.floor(rnd() * 3) : Math.floor(rnd() * 2.4);
  const p = new THREE.Vector3(), d = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    const f = 0.28 + ((i + rnd() * 0.8) / n) * 0.55;
    at(pts, L, f, p, d);
    const side = rnd() * TAU;
    // twigs leave at a sharp angle and mostly climb, like fingers clawing at the sky
    const dir = turn(d, Math.cos(side), 0.6 + rnd(), Math.sin(side), 0.45 + rnd() * 0.55);
    const segs = level === 2 ? 1 : 2 + Math.floor(rnd() * 2); // sub-twigs are straight spikes
    const twig = path(rnd, p, dir, len * (1 - f) * (0.65 + rnd() * 0.5), segs, 0.7, 0.05);
    limb(B, rnd, twig, taper(r0, f, 0.7) * 0.62, level + 1);
  }
}

// Adds one dead tree standing at (x, y, z): s scales its girth, height is the trunk's length above ground,
// ground(x, z) gives the terrain height so the roots dig in on slopes.
export function deadTree(B, seed, x, y, z, s, height, ground) {
  const rnd = mulberry32(seed);
  const lean = rnd() * TAU, tilt = rnd() * 0.2, r0 = (0.19 + rnd() * 0.07) * s;
  const trunk = path(rnd, new THREE.Vector3(x, y - 0.5, z), new THREE.Vector3(Math.sin(lean) * tilt, 1, Math.cos(lean) * tilt), height + 0.5, 6, 0.32, 0);
  const L = measure(trunk), len = L[L.length - 1];
  const trunkR = (f) => taper(r0, f, 0.6);
  const rad = L.map((l) => trunkR(l / len));
  rad[0] *= 1.7; // flared foot, below ground
  tube(B, trunk, rad, 6);
  const p = new THREE.Vector3(), d = new THREE.Vector3();

  // roots: from inside the foot, out and down into the soil
  const nr = 3 + Math.floor(rnd() * 2);
  at(trunk, L, 0.7 / len, p, d);
  for (let i = 0; i < nr; i++) {
    const a = lean + (i / nr) * TAU + rnd() * 0.9, reach = (0.7 + rnd() * 0.6) * s;
    const cx = Math.cos(a), cz = Math.sin(a);
    const mx = p.x + cx * reach * 0.4, mz = p.z + cz * reach * 0.4, ex = p.x + cx * reach, ez = p.z + cz * reach;
    const root = [p.clone(), new THREE.Vector3(mx, ground(mx, mz) + 0.02, mz), new THREE.Vector3(ex, ground(ex, ez) - 0.25, ez)];
    tube(B, root, [r0 * 0.7, r0 * 0.38, 0], 5);
  }

  // snapped-off stubs
  const ns = Math.floor(rnd() * 3);
  for (let i = 0; i < ns; i++) {
    const f = 0.15 + rnd() * 0.5;
    at(trunk, L, f, p, d);
    const a = rnd() * TAU, dir = turn(d, Math.cos(a), 0, Math.sin(a), 1 + rnd() * 0.4);
    tube(B, path(rnd, p, dir, trunkR(f) + (0.25 + rnd() * 0.35) * s, 2, 0.2, 0), [trunkR(f) * 0.5, trunkR(f) * 0.42, 0], 4);
  }

  // most trunks split into two or three leaders that climb as high as the trunk itself (an open, clawing crown
  // instead of a lone spike)
  let az = rnd() * TAU;
  const forks = rnd() < 0.7 ? 2 + Math.floor(rnd() * 2) : 0;
  const ff = 0.5 + rnd() * 0.2;
  for (let i = 0; i < forks; i++) {
    at(trunk, L, ff + i * 0.05, p, d);
    const a = az + (i / forks) * TAU + rnd() * 0.6;
    const lead = path(rnd, p, turn(d, Math.cos(a), 0, Math.sin(a), 0.35 + rnd() * 0.3), len * (1 - ff) * (0.85 + rnd() * 0.35), 4, 0.5, 0.04);
    limb(B, rnd, lead, trunkR(ff) * 0.72, 1);
  }

  // branches spiral up the trunk: the low ones long and reaching sideways, the high ones short and climbing;
  // a few droop like broken arms
  const nb = 6 + Math.floor(rnd() * 4) - forks;
  for (let i = 0; i < nb; i++) {
    const f = 0.28 + ((i + rnd() * 0.8) / nb) * 0.62, low = 1 - (f - 0.28) / 0.62;
    az += 2.4 + (rnd() - 0.5) * 0.9;
    at(trunk, L, f, p, d);
    const dir = turn(d, Math.cos(az), 0, Math.sin(az), 0.45 + low * 0.65 + rnd() * 0.3);
    const blen = height * (0.3 + low * 0.25 + rnd() * 0.15);
    const branch = path(rnd, p, dir, blen, 3, 0.6, rnd() < 0.25 ? -0.12 : 0.07);
    limb(B, rnd, branch, trunkR(f) * (0.55 + rnd() * 0.15), 1);
  }
}
