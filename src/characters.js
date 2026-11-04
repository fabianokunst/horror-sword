// Skinned characters: each one is a single continuous mesh (smooth tubes and ellipsoids merged
// together) deformed by a bone skeleton with automatically computed, blended skin weights.
// Only rigid props (sword, hat, crown, crossbow) are separate meshes parented to bones.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { ps1 } from './ps1.js';
import { box, cyl, bake } from './models.js';

export const SKIN_MAT = ps1(new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }), 0.3, false);
export const SKIN_GLOW = new THREE.MeshBasicMaterial({ vertexColors: true });
export const FLASH_MAT = new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 3, 3) });
const PROP_MAT = ps1(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }), 0.3, false);
const PROP_GLOW = new THREE.MeshBasicMaterial({ vertexColors: true });

const V = (a) => new THREE.Vector3(a[0], a[1], a[2]);

// ------------------------------------------------------------------ geometry generators
function finishGeo(pos, col, idx) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// Generalized cylinder through a list of rings { p:[x,y,z], r: radius | [r1, r2], c: color }.
// opts.arc = [t0, t1] makes an open shell (capes, coat skirts); opts.closed loops the path.
function tube(rings, o = {}) {
  const segs = o.segs || 12, arc = o.arc, closed = !!o.closed;
  const cols = arc ? segs + 1 : segs, n = rings.length;
  const P = rings.map((r) => V(r.p));
  const pos = [], col = [], idx = [];
  const c = new THREE.Color(), v = new THREE.Vector3(), d = new THREE.Vector3();
  const up = new THREE.Vector3(), a1 = new THREE.Vector3(), a2 = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    const prev = closed ? P[(i - 1 + n) % n] : P[Math.max(0, i - 1)];
    const next = closed ? P[(i + 1) % n] : P[Math.min(n - 1, i + 1)];
    d.subVectors(next, prev).normalize();
    up.set(0, Math.abs(d.y) > 0.7 ? 0 : 1, Math.abs(d.y) > 0.7 ? 1 : 0);
    a1.crossVectors(up, d).normalize();
    a2.crossVectors(d, a1).normalize();
    const r = rings[i].r, rx = Array.isArray(r) ? r[0] : r, rz = Array.isArray(r) ? r[1] : r;
    c.set(rings[i].c);
    for (let j = 0; j < cols; j++) {
      const t = arc ? arc[0] + ((arc[1] - arc[0]) * j) / segs : (j / segs) * Math.PI * 2;
      v.copy(P[i]).addScaledVector(a1, Math.cos(t) * rx).addScaledVector(a2, Math.sin(t) * rz);
      pos.push(v.x, v.y, v.z);
      col.push(c.r, c.g, c.b);
    }
  }
  const rows = closed ? n : n - 1;
  for (let i = 0; i < rows; i++) {
    const i2 = (i + 1) % n;
    for (let j = 0; j < segs; j++) {
      const j2 = arc ? j + 1 : (j + 1) % segs;
      const a = i * cols + j, b = i * cols + j2, cc = i2 * cols + j, dd = i2 * cols + j2;
      idx.push(a, b, cc, b, dd, cc);
    }
  }
  if (!closed && !arc) {
    for (const [ri, first] of [[0, true], [n - 1, false]]) {
      const ci = pos.length / 3;
      c.set(rings[ri].c);
      pos.push(P[ri].x, P[ri].y, P[ri].z);
      col.push(c.r, c.g, c.b);
      for (let j = 0; j < segs; j++) {
        const a = ri * cols + j, b = ri * cols + ((j + 1) % segs);
        if (first) idx.push(ci, b, a);
        else idx.push(ci, a, b);
      }
    }
  }
  return finishGeo(pos, col, idx);
}

function ellipsoid(center, radii, color, o = {}) {
  const g = new THREE.SphereGeometry(1, o.w || 12, o.h || 9, 0, Math.PI * 2, 0, o.theta || Math.PI);
  g.deleteAttribute('uv');
  g.scale(radii[0], radii[1], radii[2]);
  if (o.rx || o.ry || o.rz) g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(o.rx || 0, o.ry || 0, o.rz || 0)));
  g.translate(center[0], center[1], center[2]);
  const c = new THREE.Color(color), n = g.attributes.position.count, arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) arr.set([c.r, c.g, c.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  g.computeVertexNormals();
  return g;
}

const spike = (base, tip, r, color, segs = 6) => tube([{ p: base, r, c: color }, { p: tip, r: 0.002, c: color }], { segs });

// Wing membrane: a strip between a top edge (along the wing bones) and a bottom edge.
function membrane(top, bottom, color) {
  const pos = [], col = [], idx = [], c = new THREE.Color(color);
  for (const p of [...top, ...bottom]) { pos.push(...p); col.push(c.r, c.g, c.b); }
  const n = top.length;
  for (let i = 0; i < n - 1; i++) idx.push(i, n + i, i + 1, i + 1, n + i, n + i + 1);
  return finishGeo(pos, col, idx);
}

function distSeg(p, a, b) {
  const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
  const l2 = abx * abx + aby * aby + abz * abz;
  let t = l2 > 0 ? ((p.x - a.x) * abx + (p.y - a.y) * aby + (p.z - a.z) * abz) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - a.x - abx * t, p.y - a.y - aby * t, p.z - a.z - abz * t);
}

// ------------------------------------------------------------------ rig builder
class Rig {
  constructor(spinY = 0.9) {
    this.bones = [];
    this.map = {};
    this.parts = [];
    this.props = [];
    this.spinY = spinY;
  }
  bone(name, parent, p, tip) {
    const b = new THREE.Bone();
    b.name = name;
    b.userData.abs = V(p);
    b.userData.tip = tip ? V(tip) : null;
    const par = parent ? this.map[parent] : null;
    b.position.copy(b.userData.abs);
    if (par) { b.position.sub(par.userData.abs); par.add(b); }
    this.bones.push(b);
    this.map[name] = b;
    return this;
  }
  add(geo, bones, glow = false) {
    this.parts.push({ geo, bones: Array.isArray(bones) ? bones : [bones], glow });
    return this;
  }
  // props are authored in model space and re-parented to a bone
  prop(bone, build) {
    const g = new THREE.Group();
    build(g);
    bake(g, PROP_MAT, PROP_GLOW, true);
    this.props.push({ bone, obj: g });
    return this;
  }
  build() {
    const segs = this.bones.map((b) => {
      const a = b.userData.abs;
      let t = b.userData.tip;
      if (!t) {
        const ch = b.children.find((c) => c.isBone);
        t = ch ? ch.userData.abs : a;
      }
      return { a, b: t };
    });
    const idxOf = Object.fromEntries(this.bones.map((b, i) => [b.name, i]));
    const solid = [], glow = [], p = new THREE.Vector3();
    for (const part of this.parts) {
      const g = part.geo, pos = g.attributes.position, n = pos.count;
      const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
      const cand = part.bones.map((nm) => idxOf[nm]);
      for (let i = 0; i < n; i++) {
        p.fromBufferAttribute(pos, i);
        // inverse-distance weights to each candidate bone segment, top 4, normalized
        const ws = cand
          .map((bi) => { const d = distSeg(p, segs[bi].a, segs[bi].b); return [bi, 1 / (d * d + 1e-4) ** 2]; })
          .sort((x, y) => y[1] - x[1])
          .slice(0, 4);
        const tot = ws.reduce((s, w) => s + w[1], 0);
        ws.forEach(([bi, w], k) => { si[i * 4 + k] = bi; sw[i * 4 + k] = w / tot; });
      }
      g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
      g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
      (part.glow ? glow : solid).push(g);
    }
    const lists = [solid, glow].filter((l) => l.length).map((l) => mergeGeometries(l));
    const geo = lists.length > 1 ? mergeGeometries(lists, true) : lists[0];
    const mat = lists.length > 1 ? [SKIN_MAT, SKIN_GLOW] : solid.length ? SKIN_MAT : SKIN_GLOW;
    const mesh = new THREE.SkinnedMesh(geo, mat);
    mesh.add(this.bones[0]);
    mesh.updateMatrixWorld(true);
    mesh.bind(new THREE.Skeleton(this.bones));
    mesh.castShadow = true;
    mesh.frustumCulled = false;
    for (const { bone, obj } of this.props) {
      const b = this.map[bone];
      obj.position.sub(b.userData.abs);
      b.add(obj);
    }
    const root = new THREE.Group();
    const spin = new THREE.Group();
    spin.name = 'spin';
    spin.position.y = this.spinY;
    const inner = new THREE.Group();
    inner.position.y = -this.spinY;
    root.add(spin);
    spin.add(inner);
    inner.add(mesh);
    return root;
  }
}

// ------------------------------------------------------------------ shared humanoid body
function humanBones(R, o = {}) {
  const s = o.arm || 1;
  R.bone('hips', null, [0, 0.98, 0])
    .bone('spine', 'hips', [0, 1.15, 0])
    .bone('chest', 'spine', [0, 1.36, 0])
    .bone('neck', 'chest', [0, 1.6, 0])
    .bone('head', 'neck', [0, 1.7, 0], [0, 1.95, 0]);
  for (const [sd, sx] of [['L', 1], ['R', -1]]) {
    R.bone('arm' + sd, 'chest', [0.2 * sx, 1.5, 0])
      .bone('fore' + sd, 'arm' + sd, [0.25 * sx, 1.5 - 0.3 * s, 0])
      .bone('hand' + sd, 'fore' + sd, [0.28 * sx, 1.5 - 0.56 * s, 0], [0.29 * sx, 1.5 - 0.68 * s, 0.01])
      .bone('leg' + sd, 'hips', [0.1 * sx, 0.95, 0])
      .bone('shin' + sd, 'leg' + sd, [0.12 * sx, 0.52, 0.01])
      .bone('foot' + sd, 'shin' + sd, [0.12 * sx, 0.09, 0], [0.12 * sx, 0.04, 0.17]);
  }
}

// C: { skin, top, pants, boot?, sleeve, cuff?, glove?, belt?, collar? }  o: { w (girth), arm, legsHidden }
function humanBody(R, C, o = {}) {
  const w = o.w || 1, s = o.arm || 1;
  const T = (y, rx, rz, c, z = 0) => ({ p: [0, y, z], r: [rx * w, rz * w], c });
  R.add(tube([
    T(0.8, 0.06, 0.05, C.pants), T(0.88, 0.17, 0.11, C.pants), T(0.97, 0.185, 0.12, C.pants),
    T(0.985, 0.186, 0.121, C.belt ?? C.top), T(1.06, 0.178, 0.117, C.belt ?? C.top), T(1.075, 0.172, 0.115, C.top),
    T(1.3, 0.2, 0.13, C.top, 0.01), T(1.45, 0.235, 0.125, C.top), T(1.54, 0.19, 0.1, C.top), T(1.6, 0.07, 0.06, C.collar ?? C.skin),
  ]), ['hips', 'spine', 'chest', 'neck']);
  R.add(tube([{ p: [0, 1.55, 0], r: 0.056, c: C.skin }, { p: [0, 1.73, 0.01], r: 0.05, c: C.skin }], { segs: 8 }), ['chest', 'neck', 'head']);
  R.add(ellipsoid([0, 1.8, 0.005], [0.105, 0.125, 0.115], C.skin), 'head');
  R.add(ellipsoid([0, 1.785, 0.115], [0.016, 0.026, 0.02], C.skin, { w: 6, h: 5 }), 'head');
  R.add(ellipsoid([0, 1.738, 0.104], [0.03, 0.006, 0.008], C.mouth ?? 0x502020, { w: 6, h: 4 }), 'head');
  for (const sx of [1, -1]) {
    const sd = sx > 0 ? 'L' : 'R', y = (k) => 1.5 - k * s;
    R.add(tube([
      { p: [0.19 * sx, 1.53, 0], r: 0.07, c: C.sleeve }, { p: [0.215 * sx, y(0.08), 0], r: 0.068, c: C.sleeve },
      { p: [0.25 * sx, y(0.3), 0], r: 0.055, c: C.sleeve }, { p: [0.265 * sx, y(0.43), 0.005], r: 0.052, c: C.sleeve },
      { p: [0.277 * sx, y(0.52), 0], r: 0.046, c: C.sleeve }, { p: [0.278 * sx, y(0.525), 0], r: 0.054, c: C.cuff ?? C.sleeve },
      { p: [0.28 * sx, y(0.56), 0], r: 0.052, c: C.cuff ?? C.sleeve }, { p: [0.281 * sx, y(0.565), 0], r: 0.036, c: C.glove ?? C.skin },
    ]), ['chest', 'arm' + sd, 'fore' + sd, 'hand' + sd]);
    R.add(ellipsoid([0.285 * sx, y(0.625), 0.012], [0.036, 0.058, 0.046], C.glove ?? C.skin), ['fore' + sd, 'hand' + sd]);
    if (o.legsHidden) continue;
    const boot = C.boot ?? C.pants, kneeC = C.bootHigh ? boot : C.pants;
    R.add(tube([
      { p: [0.1 * sx, 1.0, 0], r: 0.1, c: C.pants }, { p: [0.11 * sx, 0.78, 0], r: 0.087, c: C.pants },
      { p: [0.12 * sx, 0.56, 0.01], r: 0.066, c: C.pants }, { p: [0.12 * sx, 0.54, 0.01], r: 0.07, c: kneeC },
      { p: [0.12 * sx, 0.5, 0.012], r: 0.074, c: boot }, { p: [0.12 * sx, 0.36, -0.01], r: 0.07, c: boot },
      { p: [0.12 * sx, 0.14, 0], r: 0.054, c: boot }, { p: [0.12 * sx, 0.07, 0], r: 0.05, c: boot },
    ]), ['hips', 'leg' + sd, 'shin' + sd, 'foot' + sd]);
    R.add(ellipsoid([0.12 * sx, 0.055, 0.06], [0.06, 0.05, 0.125], boot), ['shin' + sd, 'foot' + sd]);
  }
}

function eyes(R, color, glow, y = 1.81, spread = 0.04, size = 0.019) {
  for (const sx of [1, -1]) R.add(ellipsoid([spread * sx, y, 0.1], [size, size * 0.75, size * 0.55], color, { w: 8, h: 6 }), 'head', glow);
}

// ------------------------------------------------------------------ characters
function buildHunter() {
  const C = {
    coat: 0x9e1530, coatDk: 0x6a0c22, pants: 0x283a78, boot: 0x5a3418, gold: 0xf0bc40, skin: 0xf0b088,
    hair: 0x4a2a14, scarf: 0x18c0b0, shirt: 0xf4ecd8, hat: 0x1c1626, band: 0xd8203c, leather: 0x7a4422,
  };
  const R = new Rig();
  humanBones(R);
  R.bone('scarf', 'chest', [0.06, 1.55, -0.13], [0.09, 1.12, -0.2]);
  humanBody(R, { skin: C.skin, top: C.coat, pants: C.pants, boot: C.boot, sleeve: C.coat, cuff: C.gold, glove: C.leather, belt: C.leather, collar: C.shirt });
  // open long coat skirt (front left open so the legs read)
  R.add(tube([
    { p: [0, 1.08, 0], r: [0.19, 0.125], c: C.coat }, { p: [0, 0.9, -0.01], r: [0.235, 0.16], c: C.coatDk },
    { p: [0, 0.65, -0.03], r: [0.29, 0.2], c: C.coatDk }, { p: [0, 0.43, -0.05], r: [0.32, 0.23], c: C.coatDk },
    { p: [0, 0.4, -0.05], r: [0.322, 0.232], c: C.gold },
  ], { arc: [Math.PI / 2 + 0.55, Math.PI * 2.5 - 0.55], segs: 16 }), ['spine', 'hips', 'legL', 'legR']);
  // shirt front, gold trims, bandolier with holy-water vials, shoulder guards
  R.add(ellipsoid([0, 1.42, 0.095], [0.075, 0.12, 0.04], C.shirt), ['chest']);
  for (const sx of [1, -1]) R.add(tube([{ p: [0.085 * sx, 1.52, 0.11], r: 0.012, c: C.gold }, { p: [0.1 * sx, 1.1, 0.12], r: 0.012, c: C.gold }], { segs: 5 }), ['chest', 'spine']);
  const strap = [];
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    strap.push({ p: [0.215 * Math.cos(a), 1.3 + 0.17 * Math.cos(a), 0.142 * Math.sin(a) + 0.008], r: [0.026, 0.012], c: C.leather });
  }
  R.add(tube(strap, { closed: true, segs: 5 }), ['chest', 'spine']);
  [[0x40ff90, 0.11], [0x4090ff, 0], [0xff40c8, -0.11]].forEach(([c, x]) =>
    R.add(ellipsoid([x, 1.3 + 0.17 * (x / 0.215), 0.155], [0.022, 0.035, 0.018], c, { w: 6, h: 5 }), ['chest'], true));
  R.add(ellipsoid([0, 1.025, 0.125], [0.04, 0.035, 0.015], C.gold, { w: 6, h: 5 }), ['hips']);
  for (const sx of [1, -1]) R.add(ellipsoid([0.215 * sx, 1.54, 0], [0.105, 0.06, 0.1], C.gold), ['chest', sx > 0 ? 'armL' : 'armR']);
  // scarf: collar wrap + a tail tied to its own bone
  R.add(tube([{ p: [0, 1.62, 0], r: [0.095, 0.085], c: C.scarf }, { p: [0, 1.54, 0], r: [0.14, 0.11], c: C.scarf }], { segs: 12 }), ['chest', 'neck']);
  R.add(tube([
    { p: [0.06, 1.56, -0.12], r: [0.05, 0.016], c: C.scarf }, { p: [0.075, 1.35, -0.16], r: [0.055, 0.016], c: C.scarf },
    { p: [0.09, 1.13, -0.2], r: [0.05, 0.016], c: C.scarf }, { p: [0.09, 1.12, -0.2], r: [0.054, 0.018], c: C.gold },
  ], { segs: 6 }), ['scarf']);
  // face & hair
  eyes(R, 0x2a60d0, false);
  for (const sx of [1, -1]) R.add(tube([{ p: [0.065 * sx, 1.845, 0.108], r: [0.032, 0.008], c: C.hair }, { p: [0.02 * sx, 1.85, 0.112], r: [0.03, 0.008], c: C.hair }], { segs: 5 }), 'head');
  R.add(ellipsoid([0, 1.75, 0.085], [0.07, 0.035, 0.045], C.hair, { w: 8, h: 5 }), 'head');
  R.add(ellipsoid([0, 1.83, -0.015], [0.115, 0.115, 0.125], C.hair, { theta: Math.PI * 0.55, rx: -0.5 }), 'head');
  R.add(tube([{ p: [0, 1.82, -0.06], r: [0.1, 0.06], c: C.hair }, { p: [0, 1.66, -0.1], r: [0.09, 0.05], c: C.hair }, { p: [0, 1.6, -0.1], r: [0.05, 0.02], c: C.hair }]), ['head', 'neck']);
  R.prop('head', (g) => {
    cyl(g, 0.3, 0.3, 0.025, 14, C.hat, 0, 1.9, 0);
    cyl(g, 0.12, 0.14, 0.17, 12, C.hat, 0, 1.99, 0);
    cyl(g, 0.145, 0.145, 0.04, 12, C.band, 0, 1.93, 0);
    box(g, 0.04, 0.05, 0.02, C.gold, 0.08, 1.93, 0.13);
  });
  // crossbow slung on the back
  R.prop('chest', (g) => {
    box(g, 0.06, 0.6, 0.06, C.leather, 0.02, 1.3, -0.17, { rz: -0.5 });
    box(g, 0.55, 0.04, 0.04, C.gold, -0.04, 1.42, -0.2, { rz: -0.5 });
  });
  // runic sword: blade continues the arm line (local -y of the hand) so arm swings aim it
  R.prop('handR', (g) => {
    const hx = -0.285, hy = 0.875;
    box(g, 0.045, 0.16, 0.045, 0x3a2010, hx, hy, 0.012);
    box(g, 0.32, 0.045, 0.06, C.gold, hx, hy - 0.1, 0.012);
    box(g, 0.07, 0.07, 0.07, 0xff1a40, hx, hy - 0.1, 0.012, { glow: 2 });
    box(g, 0.085, 1.15, 0.02, 0xdce6f4, hx, hy - 0.7, 0.012);
  });
  const root = R.build();
  // glowing rune on its own material so the blade color can change with the hunter's rank
  const rune = new THREE.Mesh(
    new THREE.BoxGeometry(0.026, 0.95, 0.026),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(0x40e8ff).multiplyScalar(2.6) })
  );
  rune.name = 'bladeRune';
  rune.position.set(-0.005, -0.745, 0.012); // relative to the right hand bone
  root.getObjectByName('handR').add(rune);
  return root;
}

function vampireRig(C, o = {}) {
  const R = new Rig();
  humanBones(R);
  R.bone('cape', 'chest', [0, 1.55, -0.12]).bone('cape2', 'cape', [0, 1.0, -0.2], [0, 0.15, -0.3]);
  humanBody(R, { skin: C.skin, top: C.suit, pants: C.suit, boot: 0x0a0810, sleeve: C.suit, cuff: 0xf4f0ff, collar: 0xf4f0ff });
  R.add(ellipsoid([0, 1.28, 0.1], [0.1, 0.18, 0.045], C.vest), ['chest', 'spine']);
  for (let i = 0; i < 3; i++) R.add(ellipsoid([0, 1.17 + i * 0.09, 0.143], [0.012, 0.012, 0.01], C.gold, { w: 5, h: 4 }), ['chest', 'spine']);
  R.add(ellipsoid([0, 1.5, 0.1], [0.06, 0.07, 0.04], 0xf4f0ff), ['chest']);
  R.add(ellipsoid([0, 1.36, 0.13], [0.04, 0.04, 0.012], C.gold, { w: 8, h: 6 }), ['chest']);
  R.add(ellipsoid([0, 1.36, 0.14], [0.02, 0.02, 0.01], C.gem, { w: 6, h: 5 }), ['chest'], true);
  // cape: outer shell + colored lining, open at the front
  const capeRings = (k, c) => [
    { p: [0, 1.6, -0.01], r: [0.2 * k, 0.12 * k], c }, { p: [0, 1.46, -0.03], r: [0.3 * k, 0.18 * k], c },
    { p: [0, 1.0, -0.07], r: [0.37 * k, 0.25 * k], c }, { p: [0, 0.1, -0.12], r: [0.45 * k, 0.32 * k], c },
  ];
  const capeArc = [Math.PI / 2 + 0.45, Math.PI * 2.5 - 0.45];
  R.add(tube(capeRings(1, C.cape), { arc: capeArc, segs: 18 }), ['chest', 'cape', 'cape2']);
  R.add(tube(capeRings(0.96, C.lining), { arc: capeArc, segs: 18 }), ['chest', 'cape', 'cape2']);
  // tall flared collar
  const collar = (k, c) => [{ p: [0, 1.55, -0.02], r: [0.15 * k, 0.11 * k], c }, { p: [0, 1.86, -0.07], r: [0.24 * k, 0.17 * k], c }];
  R.add(tube(collar(1, C.cape), { arc: [Math.PI + 0.5, Math.PI * 2 - 0.5], segs: 10 }), ['chest', 'neck']);
  R.add(tube(collar(0.95, C.lining), { arc: [Math.PI + 0.5, Math.PI * 2 - 0.5], segs: 10 }), ['chest', 'neck']);
  // face: glowing eyes, fangs, pointed ears, slicked hair with a widow's peak
  eyes(R, C.eye, true);
  for (const sx of [1, -1]) {
    R.add(spike([0.026 * sx, 1.742, 0.104], [0.028 * sx, 1.71, 0.106], 0.008, 0xffffff, 4), 'head');
    R.add(spike([0.1 * sx, 1.8, -0.01], [0.15 * sx, 1.9, -0.05], 0.03, C.skin, 6), 'head');
    R.add(tube([{ p: [0.065 * sx, 1.84, 0.106], r: [0.03, 0.007], c: C.hair }, { p: [0.02 * sx, 1.83, 0.112], r: [0.025, 0.007], c: C.hair }], { segs: 5 }), 'head');
  }
  R.add(ellipsoid([0, 1.835, -0.01], [0.112, 0.11, 0.122], C.hair, { theta: Math.PI * 0.52, rx: -0.45 }), 'head');
  R.add(spike([0, 1.9, 0.08], [0, 1.855, 0.115], 0.025, C.hair, 5), 'head');
  if (o.mustache) for (const sx of [1, -1]) R.add(spike([0.005 * sx, 1.758, 0.112], [0.05 * sx, 1.745, 0.1], 0.01, C.hair, 5), 'head');
  for (const sx of [1, -1]) for (let i = -1; i <= 1; i++)
    R.add(spike([0.285 * sx + i * 0.018, 0.84, 0.03], [0.29 * sx + i * 0.02, 0.79, 0.045], 0.008, 0xf8f0e0, 4), sx > 0 ? 'handL' : 'handR');
  if (o.crown) R.prop('head', (g) => {
    cyl(g, 0.125, 0.115, 0.07, 8, C.gold, 0, 1.94, 0);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      cyl(g, 0, 0.025, 0.07, 4, C.gold, Math.sin(a) * 0.12, 2.0, Math.cos(a) * 0.12);
    }
    box(g, 0.04, 0.04, 0.02, 0xff1030, 0, 1.94, 0.125, { glow: 2.5 });
  });
  return R.build();
}

const VAMPIRES = [
  { vest: 0x8a1ad0, lining: 0xc81848, cape: 0x24103a, gem: 0x40ff80 },
  { vest: 0x0c9a6a, lining: 0x7a20d0, cape: 0x101828, gem: 0xff3060 },
  { vest: 0xd03018, lining: 0xe0a020, cape: 0x2a0a14, gem: 0x40c0ff },
];
const buildVampire = (v) => vampireRig({ suit: 0x1c1426, skin: 0xc8cbee, hair: 0x0e0a14, gold: 0xe8b53a, eye: 0xff2840, ...VAMPIRES[v] });
const buildDracula = () => vampireRig(
  { suit: 0x1a1424, vest: 0xb00c24, cape: 0x3a0a1c, lining: 0xe0102a, skin: 0xdcdcf4, hair: 0x1a1a24, gold: 0xffc840, eye: 0xff1020, gem: 0xff1020 },
  { mustache: true, crown: true }
);

function wings(R, side, color, bone = 0x2a1030, span = 1) {
  const sx = side === 'L' ? 1 : -1, w = 'wing' + side;
  const sh = [0.12 * sx, 1.45, -0.14], el = [0.7 * span * sx, 1.62, -0.22], tip = [1.3 * span * sx, 1.35, -0.22];
  R.bone(w, 'chest', sh).bone(w + '2', w, el, tip);
  R.add(tube([{ p: sh, r: 0.025, c: bone }, { p: el, r: 0.02, c: bone }, { p: tip, r: 0.004, c: bone }], { segs: 5 }), ['chest', w, w + '2']);
  R.add(membrane(
    [sh, [0.4 * span * sx, 1.56, -0.18], el, [1.0 * span * sx, 1.5, -0.22], tip],
    [[0.12 * sx, 1.05, -0.16], [0.35 * span * sx, 1.05, -0.2], [0.65 * span * sx, 1.15, -0.22], [0.95 * span * sx, 1.15, -0.22], [1.25 * span * sx, 1.2, -0.22]],
    color
  ), ['chest', w, w + '2']);
}

function buildBride(v) {
  const V3 = [
    { dress: 0xc0103a, hair: 0xd8381c, trim: 0xf0c040 },
    { dress: 0x10a070, hair: 0xf0d050, trim: 0xe0e0ff },
    { dress: 0x7a20d0, hair: 0x14101c, trim: 0xff60b0 },
  ][v];
  const skin = 0xd8d4f4;
  const R = new Rig();
  humanBones(R);
  wings(R, 'L', 0x6a1a5a);
  wings(R, 'R', 0x6a1a5a);
  humanBody(R, { skin, top: V3.dress, pants: V3.dress, sleeve: skin, cuff: V3.trim, collar: skin }, { legsHidden: true, w: 0.88 });
  // flowing gown down to the ground
  R.add(tube([
    { p: [0, 1.1, 0], r: [0.16, 0.11], c: V3.dress }, { p: [0, 0.85, 0], r: [0.24, 0.18], c: V3.dress },
    { p: [0, 0.4, -0.02], r: [0.36, 0.3], c: V3.dress }, { p: [0, 0.06, -0.04], r: [0.46, 0.4], c: V3.dress },
    { p: [0, 0.02, -0.04], r: [0.47, 0.41], c: V3.trim },
  ], { segs: 16 }), ['spine', 'hips', 'legL', 'legR']);
  R.add(tube([{ p: [0, 1.53, 0.0], r: [0.17, 0.1], c: V3.trim }, { p: [0, 1.5, 0.0], r: [0.175, 0.105], c: V3.trim }], { segs: 12 }), ['chest']);
  eyes(R, 0xffe040, true, 1.81, 0.038, 0.017);
  R.add(ellipsoid([0, 1.835, -0.01], [0.115, 0.115, 0.125], V3.hair, { theta: Math.PI * 0.55, rx: -0.35 }), 'head');
  R.add(tube([
    { p: [0, 1.84, -0.05], r: [0.12, 0.08], c: V3.hair }, { p: [0, 1.6, -0.12], r: [0.13, 0.05], c: V3.hair },
    { p: [0, 1.3, -0.14], r: [0.11, 0.035], c: V3.hair }, { p: [0, 1.15, -0.14], r: [0.05, 0.02], c: V3.hair },
  ]), ['head', 'neck', 'chest']);
  for (const sx of [1, -1]) R.add(tube([{ p: [0.1 * sx, 1.84, 0.02], r: 0.03, c: V3.hair }, { p: [0.12 * sx, 1.6, 0.02], r: 0.025, c: V3.hair }]), ['head', 'neck']);
  return R.build();
}

function buildGhoul() {
  const C = { skin: 0x7c9a4e, dark: 0x4e6a30, rag: 0x9a5a28, patch: 0x6a3a8a, bone: 0xe0d8b8 };
  const R = new Rig();
  humanBones(R, { arm: 1.3 });
  humanBody(R, { skin: C.skin, top: C.skin, pants: C.rag, boot: C.skin, sleeve: C.skin, belt: C.rag }, { arm: 1.3, w: 1.05 });
  for (let i = 0; i < 3; i++) R.add(tube([{ p: [-0.12, 1.22 + i * 0.07, 0.12], r: 0.012, c: C.dark }, { p: [0.12, 1.22 + i * 0.07, 0.12], r: 0.012, c: C.dark }], { segs: 4 }), ['chest', 'spine']);
  R.add(ellipsoid([0.1, 0.9, 0.14], [0.07, 0.06, 0.02], C.patch, { w: 6, h: 5 }), ['hips']);
  eyes(R, 0xffd020, true, 1.81, 0.042, 0.024);
  for (let i = 0; i < 5; i++) R.add(spike([-0.04 + i * 0.02, 1.745, 0.105], [-0.04 + i * 0.02, 1.725, 0.108], 0.008, C.bone, 4), 'head');
  for (const sx of [1, -1]) {
    R.add(spike([0.1 * sx, 1.81, -0.01], [0.17 * sx, 1.86, -0.06], 0.035, C.skin, 6), 'head');
    for (let i = -1; i <= 1; i++)
      R.add(spike([0.285 * sx + i * 0.02, 0.73, 0.03], [0.29 * sx + i * 0.025, 0.64, 0.06], 0.01, C.bone, 4), sx > 0 ? 'handL' : 'handR');
  }
  return R.build();
}

function buildWolf() {
  const C = { fur: 0x6a4a38, dark: 0x3a2820, belly: 0xb0987a, pants: 0x2a3a8a, claw: 0xf0e8d0 };
  const R = new Rig();
  humanBones(R, { arm: 1.2 });
  R.bone('tail', 'hips', [0, 0.95, -0.14]).bone('tail2', 'tail', [0, 0.82, -0.45], [0, 0.72, -0.75]);
  humanBody(R, { skin: C.fur, top: C.fur, pants: C.pants, boot: C.fur, bootHigh: true, sleeve: C.fur, collar: C.dark }, { arm: 1.2, w: 1.3 });
  R.add(ellipsoid([0, 1.3, 0.11], [0.15, 0.17, 0.06], C.belly), ['chest', 'spine']);
  R.add(ellipsoid([0, 1.55, -0.06], [0.24, 0.12, 0.14], C.dark), ['chest', 'neck']);
  R.add(tube([{ p: [0, 1.8, 0.07], r: [0.07, 0.06], c: C.fur }, { p: [0, 1.77, 0.2], r: [0.055, 0.045], c: C.fur }, { p: [0, 1.775, 0.25], r: [0.035, 0.03], c: C.dark }]), 'head');
  R.add(ellipsoid([0, 1.79, 0.255], [0.025, 0.02, 0.02], 0x101010, { w: 6, h: 5 }), 'head');
  R.add(tube([{ p: [0, 1.745, 0.12], r: [0.05, 0.02], c: C.belly }, { p: [0, 1.75, 0.22], r: [0.035, 0.015], c: C.belly }]), 'head');
  eyes(R, 0xffc020, true, 1.835, 0.05, 0.022);
  for (const sx of [1, -1]) {
    R.add(spike([0.07 * sx, 1.9, -0.02], [0.1 * sx, 2.04, -0.05], 0.04, C.dark, 5), 'head');
    for (let i = -1; i <= 1; i++)
      R.add(spike([0.285 * sx + i * 0.025, 0.78, 0.03], [0.29 * sx + i * 0.03, 0.68, 0.07], 0.012, C.claw, 4), sx > 0 ? 'handL' : 'handR');
  }
  R.add(tube([
    { p: [0, 0.95, -0.12], r: 0.07, c: C.fur }, { p: [0, 0.82, -0.45], r: 0.08, c: C.fur },
    { p: [0, 0.72, -0.75], r: 0.05, c: C.dark }, { p: [0, 0.7, -0.85], r: 0.01, c: C.dark },
  ]), ['hips', 'tail', 'tail2']);
  return R.build();
}

// the Count's witch: hooded and hunched, keeps her distance and hexes with a lantern staff
function buildWitch() {
  const C = { skin: 0xa8b890, robe: 0x2a3a24, robeDk: 0x18241a, hood: 0x3a2a40, hair: 0xc8c8c0, wood: 0x5a3a1c, glow: 0x60ff90, bone: 0xe0d8b8 };
  const R = new Rig();
  humanBones(R, { arm: 1.1 });
  humanBody(R, { skin: C.skin, top: C.robe, pants: C.robe, sleeve: C.robe, cuff: C.robeDk, collar: C.hood }, { legsHidden: true, arm: 1.1, w: 0.95 });
  // ragged robe down to the ground
  R.add(tube([
    { p: [0, 1.1, 0], r: [0.18, 0.12], c: C.robe }, { p: [0, 0.8, 0], r: [0.26, 0.2], c: C.robe },
    { p: [0, 0.35, -0.02], r: [0.34, 0.28], c: C.robeDk }, { p: [0, 0.03, -0.03], r: [0.4, 0.34], c: C.robeDk },
  ], { segs: 14 }), ['spine', 'hips', 'legL', 'legR']);
  // pointed hood, open at the face
  R.add(tube([
    { p: [0, 1.6, -0.02], r: [0.17, 0.14], c: C.hood }, { p: [0, 1.86, -0.03], r: [0.155, 0.155], c: C.hood },
    { p: [0, 2.0, -0.09], r: [0.08, 0.08], c: C.hood }, { p: [0, 2.07, -0.18], r: [0.01, 0.01], c: C.hood },
  ], { arc: [Math.PI / 2 + 0.75, Math.PI * 2.5 - 0.75], segs: 12 }), ['chest', 'neck', 'head']);
  R.add(tube([{ p: [0, 1.58, 0], r: [0.2, 0.15], c: C.hood }, { p: [0, 1.46, 0], r: [0.24, 0.17], c: C.hood }], { segs: 12 }), ['chest']);
  // face: green eyes, hooked nose, grey hair hanging out of the hood
  eyes(R, C.glow, true, 1.81, 0.04, 0.02);
  R.add(spike([0, 1.79, 0.11], [0, 1.745, 0.19], 0.026, C.skin, 5), 'head');
  R.add(ellipsoid([0, 1.83, -0.02], [0.11, 0.11, 0.12], C.hair, { theta: Math.PI * 0.55, rx: -0.4 }), 'head');
  for (const sx of [1, -1]) R.add(tube([{ p: [0.09 * sx, 1.8, 0.03], r: 0.026, c: C.hair }, { p: [0.12 * sx, 1.45, 0.07], r: 0.012, c: C.hair }]), ['head', 'neck', 'chest']);
  for (const sx of [1, -1]) for (let i = -1; i <= 1; i++)
    R.add(spike([0.285 * sx + i * 0.018, 0.79, 0.03], [0.29 * sx + i * 0.02, 0.73, 0.05], 0.008, C.bone, 4), sx > 0 ? 'handL' : 'handR');
  // gnarled staff with a green lantern, held in the left hand
  R.prop('handL', (g) => {
    cyl(g, 0.022, 0.03, 1.9, 5, C.wood, 0.3, 1.0, 0.06);
    box(g, 0.05, 0.16, 0.05, C.wood, 0.3, 1.98, 0.06, { rz: 0.4 });
    box(g, 0.13, 0.15, 0.13, C.glow, 0.3, 2.08, 0.06, { glow: 2.4 });
    box(g, 0.16, 0.03, 0.16, 0x1a1a1a, 0.3, 2.17, 0.06);
  });
  return R.build();
}

function buildBat() {
  const R = new Rig(0);
  R.bone('body', null, [0, 0, -0.12], [0, 0, 0.2]);
  for (const [sd, sx] of [['L', 1], ['R', -1]]) {
    const w = 'wing' + sd;
    R.bone(w, 'body', [0.08 * sx, 0.02, 0]).bone(w + '2', w, [0.35 * sx, 0.05, 0], [0.62 * sx, 0.0, 0.0]);
    R.add(tube([{ p: [0.06 * sx, 0.02, 0.04], r: 0.016, c: 0x24102e }, { p: [0.35 * sx, 0.06, 0.03], r: 0.012, c: 0x24102e }, { p: [0.62 * sx, 0.0, 0.01], r: 0.003, c: 0x24102e }], { segs: 5 }), [w, w + '2']);
    R.add(membrane(
      [[0.06 * sx, 0.02, 0.04], [0.35 * sx, 0.06, 0.03], [0.62 * sx, 0.0, 0.01]],
      [[0.06 * sx, 0.0, -0.14], [0.3 * sx, 0.0, -0.18], [0.55 * sx, -0.01, -0.12]],
      0x8a1a7a
    ), ['body', w, w + '2']);
  }
  R.add(ellipsoid([0, 0, -0.02], [0.08, 0.075, 0.13], 0x3c1f52), 'body');
  R.add(ellipsoid([0, 0.03, 0.14], [0.065, 0.06, 0.06], 0x4a2860), 'body');
  for (const sx of [1, -1]) {
    R.add(spike([0.03 * sx, 0.07, 0.14], [0.05 * sx, 0.15, 0.13], 0.02, 0x3c1f52, 4), 'body');
    R.add(ellipsoid([0.025 * sx, 0.045, 0.19], [0.014, 0.012, 0.01], 0xff2030, { w: 5, h: 4 }), 'body', true);
  }
  return R.build();
}

const BUILDERS = {
  hunter: buildHunter,
  vampire0: () => buildVampire(0),
  vampire1: () => buildVampire(1),
  vampire2: () => buildVampire(2),
  dracula: buildDracula,
  bride0: () => buildBride(0),
  bride1: () => buildBride(1),
  bride2: () => buildBride(2),
  ghoul: buildGhoul,
  wolf: buildWolf,
  bat: buildBat,
  witch: buildWitch,
};

const templates = new Map();
// Returns a clone of the skinned template plus its named bones/groups ({ root, meshes, legL, armR, ... }).
export function makeModel(name) {
  let t = templates.get(name);
  if (!t) templates.set(name, (t = BUILDERS[name]()));
  const root = SkeletonUtils.clone(t);
  const parts = { root, meshes: [] };
  root.traverse((o) => {
    if (o.name) parts[o.name] = o;
    if (o.isMesh) { o.userData.orig = o.material; parts.meshes.push(o); }
  });
  if (parts.bladeRune) parts.bladeMat = parts.bladeRune.material = parts.bladeRune.material.clone();
  if (parts.bladeRune) parts.bladeRune.userData.orig = parts.bladeMat;
  return parts;
}
