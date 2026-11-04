// Hand-built landmarks. Each Site is authored in local coordinates with colored boxes, then baked
// into a handful of vertex-colored meshes; obstacles and lights are registered in world space.
import * as THREE from 'three';
import { box, cyl, gable, group, bake } from './models.js';
import { ps1, glowSprite } from './ps1.js';
import { mulberry32 } from './rng.js';

export const WORLD_MAT = ps1(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }), 0.06);
export const WORLD_GLOW = ps1(new THREE.MeshBasicMaterial({ vertexColors: true }));
// the castle ignores fog so its silhouette is always visible; emissive is driven by the sky as fake haze
export const CASTLE_MAT = ps1(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, fog: false }));
export const CASTLE_GLOW = ps1(new THREE.MeshBasicMaterial({ vertexColors: true, fog: false }));

const P = {
  plaster: 0xe6d6b0, beam: 0x3a2414, stone: 0x8a8494, dark: 0x4a4454, wood: 0x6a4428, win: 0xffb040,
  roofs: [0xb03030, 0x2a7a8a, 0x6a3a9a, 0xc07a20, 0x3a7a3a], gold: 0xf0bc40, iron: 0x1c1a22,
  slate: 0x3a3a5a, marble: 0xc8c4d8,
};

const rot = (x, z, r) => ({ x: x * Math.cos(r) + z * Math.sin(r), z: -x * Math.sin(r) + z * Math.cos(r) });

export class Site {
  constructor(x, y, z, ry = 0) {
    Object.assign(this, { x, y, z, ry });
    this.root = new THREE.Group();
    this.root.position.set(x, y, z);
    this.root.rotation.y = ry;
    this.g = group(this.root, 'main');
    this.obstacles = [];
    this.lights = [];
    this.trees = [];
  }
  world(lx, lz) {
    const p = rot(lx, lz, this.ry);
    return { x: this.x + p.x, z: this.z + p.z };
  }
  block(lx, lz, r) {
    const p = this.world(lx, lz);
    this.obstacles.push({ x: p.x, z: p.z, r });
  }
  wall(x1, z1, x2, z2, r = 0.8) {
    const n = Math.max(1, Math.ceil(Math.hypot(x2 - x1, z2 - z1) / r));
    for (let i = 0; i <= n; i++) this.block(x1 + ((x2 - x1) * i) / n, z1 + ((z2 - z1) * i) / n, r);
  }
  // perimeter of a (possibly rotated) rectangle in site-local space
  rect(cx, cz, w, d, ry = 0, r = 0.8) {
    const c = [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]].map(([a, b]) => {
      const p = rot(a, b, ry);
      return [cx + p.x, cz + p.z];
    });
    for (let i = 0; i < 4; i++) this.wall(...c[i], ...c[(i + 1) % 4], r);
  }
  light(lx, ly, lz, color, power, glow = 2.4) {
    const p = this.world(lx, lz);
    const l = { x: p.x, y: this.y + ly, z: p.z, color: new THREE.Color(color), power, phase: Math.random() * 10 };
    this.lights.push(l);
    if (glow) {
      const s = glowSprite(color, glow, 0.75);
      s.position.set(lx, ly, lz);
      this.root.add(s);
      l.sprite = s;
    }
    return l;
  }
  tree(lx, lz, kind = 'dead') {
    this.trees.push({ ...this.world(lx, lz), kind });
  }
  finish(solid = WORLD_MAT, glow = WORLD_GLOW) {
    bake(this.root, solid, glow, true, true);
    return this;
  }
}

// ------------------------------------------------------------------ small pieces
function lamp(s, x, z, color = 0xffb050, h = 2.8, power = 2.4) {
  const p = s.g;
  box(p, 0.16, h, 0.16, P.iron, x, h / 2, z);
  box(p, 0.5, 0.08, 0.08, P.iron, x + 0.2, h - 0.05, z);
  box(p, 0.3, 0.4, 0.3, color, x + 0.4, h - 0.35, z, { glow: 2.4 });
  box(p, 0.38, 0.06, 0.38, P.iron, x + 0.4, h - 0.12, z);
  s.light(x + 0.4, h - 0.3, z, color, power);
  s.block(x, z, 0.25);
}

function fire(p, x, y, z, color = 0xff7020, size = 1) {
  cyl(p, 0, 0.45 * size, 1.1 * size, 5, color, x, y + 0.55 * size, z, { glow: 2.8 });
  cyl(p, 0, 0.28 * size, 1.5 * size, 5, 0xffd040, x, y + 0.75 * size, z, { glow: 3, ry: 0.6 });
}

function brazier(s, x, z, color = 0xff7020, power = 3.2) {
  cyl(s.g, 0.7, 0.4, 0.5, 6, P.iron, x, 1.35, z);
  cyl(s.g, 0.12, 0.2, 1.2, 5, P.iron, x, 0.6, z);
  fire(s.g, x, 1.5, z, color);
  s.light(x, 2.4, z, color, power, 3);
  s.block(x, z, 0.7);
}

function barrel(s, x, z) {
  cyl(s.g, 0.42, 0.42, 1, 8, P.wood, x, 0.5, z);
  cyl(s.g, 0.44, 0.44, 0.07, 8, P.iron, x, 0.75, z);
  cyl(s.g, 0.44, 0.44, 0.07, 8, P.iron, x, 0.25, z);
  s.block(x, z, 0.5);
}

function house(s, x, z, ry, o = {}) {
  const { w = 5, d = 6, h = 3.4, roof = P.roofs[0], shutter = 0x2a6a8a, wall = P.plaster } = o;
  const g = group(s.g, '', x, 0, z);
  g.rotation.y = ry;
  box(g, w, h + 2, d, wall, 0, h / 2 - 1, 0);
  box(g, w + 0.12, 0.9, d + 0.12, P.stone, 0, 0.1, 0);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(g, 0.24, h, 0.24, P.beam, (sx * w) / 2, h / 2, (sz * d) / 2);
  for (const sz of [-1, 1]) {
    box(g, w, 0.2, 0.08, P.beam, 0, h * 0.55, sz * (d / 2 + 0.03));
    box(g, w, 0.2, 0.08, P.beam, 0, h - 0.1, sz * (d / 2 + 0.03));
    for (const sx of [-1, 1]) box(g, 0.14, h * 0.45, 0.08, P.beam, (sx * w) / 4, h * 0.775, sz * (d / 2 + 0.03));
  }
  for (const sx of [-1, 1]) box(g, 0.08, 0.2, d, P.beam, sx * (w / 2 + 0.03), h * 0.55, 0);
  const rh = w * 0.45, slope = Math.atan2(rh, w / 2), len = Math.hypot(w / 2, rh) + 0.5;
  for (const sx of [-1, 1]) box(g, len, 0.25, d + 0.9, roof, (sx * w) / 4, h + rh / 2 + 0.1, 0, { rz: -sx * slope });
  gable(g, w, rh, d - 0.05, wall, 0, h, 0);
  box(g, 0.3, 0.3, d + 1, P.beam, 0, h + rh + 0.12, 0);
  box(g, 0.7, 2.6, 0.7, P.stone, w * 0.25, h + rh * 0.5 + 0.6, -d * 0.2);
  box(g, 1.1, 2.1, 0.12, P.wood, 0, 1.05, d / 2 + 0.05);
  box(g, 0.1, 0.1, 0.06, P.gold, 0.35, 1.0, d / 2 + 0.13);
  for (const wx of [-w * 0.32, w * 0.32]) {
    box(g, 0.8, 0.8, 0.08, P.win, wx, 1.3, d / 2 + 0.06, { glow: 2 });
    box(g, 0.32, 0.9, 0.06, shutter, wx - 0.6, 1.3, d / 2 + 0.07);
    box(g, 0.32, 0.9, 0.06, shutter, wx + 0.6, 1.3, d / 2 + 0.07);
  }
  box(g, 0.7, 0.7, 0.08, P.win, 0, h * 0.78, d / 2 + 0.06, { glow: 2 });
  for (const sx of [-1, 1]) box(g, 0.08, 0.8, 0.8, P.win, sx * (w / 2 + 0.05), 1.3, 0, { glow: 2 });
  s.rect(x, z, w + 0.2, d + 0.2, ry, 0.7);
  const f = rot(0, d / 2 + 1.4, ry);
  s.light(x + f.x, 1.8, z + f.z, 0xffa040, 1.6, 1.4);
}

// ------------------------------------------------------------------ village of Borgo
function church(s, x, z, ry) {
  const W = 8, L = 14, H = 7;
  const g = group(s.g, '', x, 0, z);
  g.rotation.y = ry;
  box(g, W, H + 2, L, P.stone, 0, H / 2 - 1, 0);
  const rh = W * 0.5, slope = Math.atan2(rh, W / 2), len = Math.hypot(W / 2, rh) + 0.6;
  for (const sx of [-1, 1]) box(g, len, 0.3, L + 0.8, P.slate, (sx * W) / 4, H + rh / 2 + 0.1, 0, { rz: -sx * slope });
  gable(g, W, rh, L - 0.1, P.stone, 0, H, 0);
  for (const i of [-6, -2, 2, 6]) for (const sx of [-1, 1]) box(g, 0.8, 4, 0.8, P.stone, sx * (W / 2 + 0.4), 2, i);
  for (const [i, c] of [[-4, 0x4060ff], [0, 0xff4060], [4, 0x40ff90]])
    for (const sx of [-1, 1]) box(g, 0.1, 2.4, 1, c, sx * (W / 2 + 0.05), 3.6, i, { glow: 2 });
  const tz = L / 2 + 1.5, TH = H + 9;
  box(g, 4, TH, 4, P.stone, 0, TH / 2, tz);
  box(g, 1.4, 2, 4.1, 0x101018, 0, TH - 2.5, tz);
  box(g, 4.1, 2, 1.4, 0x101018, 0, TH - 2.5, tz);
  box(g, 0.8, 0.9, 0.8, P.gold, 0, TH - 2.5, tz);
  cyl(g, 0, 3.2, 7, 4, P.slate, 0, TH + 3.5, tz, { ry: Math.PI / 4 });
  box(g, 0.2, 1.6, 0.2, P.gold, 0, TH + 7.8, tz);
  box(g, 0.9, 0.2, 0.2, P.gold, 0, TH + 8.1, tz);
  box(g, 2, 3.2, 0.2, P.wood, 0, 1.6, tz + 2.05);
  box(g, 2.4, 0.3, 0.25, P.gold, 0, 3.3, tz + 2.05);
  cyl(g, 1.1, 1.1, 0.2, 8, 0x6040ff, 0, 5.6, tz + 2.05, { rx: Math.PI / 2, glow: 2.2 });
  cyl(g, 0.5, 0.5, 0.26, 8, 0xff4080, 0, 5.6, tz + 2.05, { rx: Math.PI / 2, glow: 2.6 });
  s.rect(x, z, W + 1.2, L + 0.4, ry);
  const t = rot(0, tz, ry);
  s.rect(x + t.x, z + t.z, 4.4, 4.4, ry);
  const d = rot(0, tz + 4, ry);
  s.light(x + d.x, 3, z + d.z, 0x9060ff, 2.6, 2);
}

function well(s, x, z) {
  cyl(s.g, 1.3, 1.4, 1, 10, P.stone, x, 0.5, z);
  cyl(s.g, 1.0, 1.0, 1.02, 10, 0x0a0a14, x, 0.52, z);
  for (const sx of [-1, 1]) {
    box(s.g, 0.15, 2.6, 0.15, P.wood, x + sx * 1.1, 1.3, z);
    box(s.g, 1.6, 0.12, 1.6, P.roofs[0], x + sx * 0.65, 2.75, z, { rz: -sx * 0.6 });
  }
  box(s.g, 2.4, 0.1, 0.1, P.wood, x, 2.2, z);
  cyl(s.g, 0.2, 0.16, 0.3, 6, P.wood, x, 1.7, z);
  s.block(x, z, 1.5);
}

function stall(s, x, z, ry, c1, c2) {
  const g = group(s.g, '', x, 0, z);
  g.rotation.y = ry;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(g, 0.12, 2.4, 0.12, P.wood, sx * 1.4, 1.2, sz * 0.8);
  for (let i = 0; i < 6; i++) box(g, 0.5, 0.08, 2.1, i % 2 ? c1 : c2, -1.25 + i * 0.5, 2.5, 0, { rx: 0.25 });
  box(g, 2.8, 0.12, 1.4, P.wood, 0, 0.9, 0);
  box(g, 2.6, 0.8, 1.2, P.beam, 0, 0.45, 0);
  [0xff7a10, 0xd01818, 0x60c030, 0xf0d040, 0x8a30c0].forEach((c, i) => box(g, 0.3, 0.3, 0.3, c, -1 + i * 0.5, 1.12, 0.2));
  s.rect(x, z, 3, 1.8, ry, 0.6);
}

function cart(s, x, z, ry) {
  const g = group(s.g, '', x, 0, z);
  g.rotation.y = ry;
  box(g, 1.6, 0.5, 2.8, P.wood, 0, 0.9, 0);
  for (const sx of [-1, 1]) cyl(g, 0.6, 0.6, 0.12, 8, P.beam, sx * 0.9, 0.6, -0.5, { rz: Math.PI / 2 });
  box(g, 1.4, 0.6, 2.2, 0xd8b040, 0, 1.4, 0);
  for (const sx of [-1, 1]) box(g, 0.1, 0.1, 2, P.wood, sx * 0.3, 0.75, 2.2);
  s.rect(x, z, 1.8, 3, ry, 0.6);
}

export function buildVillage(x, y, z) {
  const s = new Site(x, y, z, 0);
  box(s.g, 30, 0.12, 30, 0x6a6058, 0, 0.02, 0); // cobbled square
  well(s, 0, 0);
  const houses = [
    [-14, -14, 0], [15, -13, 1], [-19, 3, 2], [19, 4, 3], [-15, 19, 4],
    [15, 21, 0], [-32, -6, 1], [33, 12, 2], [-30, 30, 3], [-12, 42, 4], [13, 44, 1], [30, -28, 3],
  ];
  const shutters = [0x2a6a8a, 0x8a2a3a, 0x3a7a3a, 0x6a3a9a, 0xc07a20];
  houses.forEach(([hx, hz, c], i) => {
    house(s, hx, hz, Math.atan2(-hx, -hz), {
      roof: P.roofs[c], shutter: shutters[(i * 2) % 5], w: 4.6 + (i % 3) * 0.7, d: 5.5 + (i % 2), h: 3.2 + (i % 3) * 0.4,
      wall: i % 4 === 3 ? 0xd8b8a0 : P.plaster,
    });
  });
  church(s, -24, -34, Math.PI / 2 - 0.2);
  stall(s, -7, 7, 0.3, 0xd02030, 0xf0e8d8);
  stall(s, 7.5, 6, -0.3, 0x20a060, 0xf0e8d8);
  stall(s, 8, -6, -2.6, 0x3050d0, 0xf0d040);
  cart(s, -6, -8, 0.8);
  for (const [bx, bz] of [[-10, 10], [-9.2, 10.6], [10, -9], [21, -8], [-22, 9]]) barrel(s, bx, bz);
  for (const [lx, lz] of [[-4, -12], [4, 12], [-4, 28], [4, -26], [4, 55], [-4, 40], [11, 0], [-11, -2]]) lamp(s, lx, lz);
  s.tree(-26, -20, 'pine'); s.tree(25, 30, 'pine'); s.tree(-38, 15, 'pine'); s.tree(38, -10, 'dead');
  return s.finish();
}

// ------------------------------------------------------------------ cemetery of the forgotten
function angel(p, x, z, ry = 0) {
  const g = group(p, '', x, 0, z);
  g.rotation.y = ry;
  box(g, 1.4, 1.2, 1.4, P.stone, 0, 0.6, 0);
  cyl(g, 0.3, 0.45, 1.6, 6, P.marble, 0, 2, 0);
  box(g, 0.34, 0.36, 0.34, P.marble, 0, 3.0, 0);
  for (const sx of [-1, 1]) box(g, 0.9, 1.4, 0.12, P.marble, sx * 0.45, 2.4, -0.3, { rz: sx * 0.5, ry: sx * 0.3 });
  box(g, 0.12, 0.6, 0.12, P.marble, 0.3, 2.4, 0.25, { rx: -0.6 });
  cyl(g, 0.22, 0.22, 0.04, 8, 0xffe080, 0, 3.3, 0, { glow: 1.6 });
}

export function buildCemetery(x, y, z) {
  const s = new Site(x, y, z, 0);
  const rnd = mulberry32(77);
  const W = 18, D = 15;
  // low walls with iron bars and pillars
  const wallSeg = (x1, z1, x2, z2) => {
    const len = Math.hypot(x2 - x1, z2 - z1), cx = (x1 + x2) / 2, cz = (z1 + z2) / 2, horiz = Math.abs(z2 - z1) < 0.01;
    box(s.g, horiz ? len : 0.6, 1.1, horiz ? 0.6 : len, 0x6a6474, cx, 0.4, cz);
    const n = Math.floor(len / 0.7);
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      box(s.g, 0.06, 1.2, 0.06, P.iron, x1 + (x2 - x1) * t, 1.5, z1 + (z2 - z1) * t);
    }
    for (let i = 0; i <= Math.floor(len / 5); i++) {
      const t = Math.min(1, (i * 5) / len), px = x1 + (x2 - x1) * t, pz = z1 + (z2 - z1) * t;
      box(s.g, 0.8, 2, 0.8, P.stone, px, 1, pz);
      cyl(s.g, 0, 0.55, 0.5, 4, P.dark, px, 2.25, pz, { ry: Math.PI / 4 });
    }
    s.wall(x1, z1, x2, z2, 0.6);
  };
  wallSeg(-W, -D, W, -D);
  wallSeg(-W, D, W, D);
  wallSeg(-W, -D, -W, D);
  wallSeg(W, -D, W, -3.2);
  wallSeg(W, 3.2, W, D);
  // gate pillars with ghost lanterns and open iron gates
  for (const sz of [-1, 1]) {
    box(s.g, 1.1, 3.4, 1.1, P.stone, W, 1.7, sz * 3.4);
    box(s.g, 0.5, 0.6, 0.5, 0x50ffa8, W, 3.7, sz * 3.4, { glow: 2.4 });
    s.light(W, 3.8, sz * 3.4, 0x50ffa8, 2.8);
    for (let i = 0; i < 5; i++) box(s.g, 0.06, 2.4, 0.06, P.iron, W + 0.4 + i * 0.5, 1.3, sz * (2.9 - i * 0.12));
    box(s.g, 2.6, 0.08, 0.06, P.iron, W + 1.3, 2.4, sz * 2.65, { ry: sz * 0.25 });
  }
  // gravestones in rows, path down the middle
  for (let gx = -5; gx <= 14; gx += 2.6)
    for (let gz = -12; gz <= 12; gz += 2.8) {
      if (Math.abs(gz) < 2 || rnd() < 0.12) continue;
      const tilt = (rnd() - 0.5) * 0.3, kind = rnd(), shade = [0x8e8ea0, 0x7a8476, 0x9a92a6][Math.floor(rnd() * 3)];
      const gxx = gx + (rnd() - 0.5) * 0.5;
      if (kind < 0.45) {
        box(s.g, 0.7, 1 + rnd() * 0.4, 0.18, shade, gxx, 0.5, gz, { rz: tilt, ry: Math.PI / 2 });
        cyl(s.g, 0.35, 0.35, 0.18, 8, shade, gxx, 1.05, gz, { rx: Math.PI / 2, rz: Math.PI / 2 });
      } else if (kind < 0.75) {
        box(s.g, 0.14, 1.5, 0.14, shade, gxx, 0.75, gz, { rx: tilt });
        box(s.g, 0.14, 0.14, 0.7, shade, gxx, 1.1, gz, { rx: tilt });
      } else if (kind < 0.9) {
        cyl(s.g, 0.15, 0.3, 2.2, 4, shade, gxx, 1.1, gz, { ry: Math.PI / 4 });
      } else {
        box(s.g, 1, 0.7, 2, shade, gxx, 0.35, gz);
        box(s.g, 1.1, 0.12, 2.1, P.dark, gxx, 0.75, gz);
      }
      s.block(gxx, gz, 0.4);
    }
  angel(s.g, 4, 0, -Math.PI / 2);
  s.block(4, 0, 1);
  // open grave with dirt mound and shovel
  box(s.g, 1.2, 0.1, 2.2, 0x0a0806, -1, 0.03, -9);
  box(s.g, 1.4, 0.6, 1.2, 0x4a3420, 0.6, 0.2, -9, { rz: 0.3 });
  box(s.g, 0.06, 1.4, 0.06, P.wood, 1.2, 0.8, -8.2, { rz: -0.4 });
  // mausoleum
  const m = group(s.g, '', -11, 0, 0);
  m.rotation.y = Math.PI / 2;
  box(m, 7.4, 0.4, 8.4, P.stone, 0, 0.2, 0);
  box(m, 6.6, 0.4, 7.6, P.stone, 0, 0.6, -0.1);
  box(m, 5.6, 4.6, 5.2, 0x7a7488, 0, 3.1, -1.2);
  for (const cx of [-2.3, -0.8, 0.8, 2.3]) cyl(m, 0.3, 0.36, 3.8, 6, P.marble, cx, 2.7, 2.4);
  box(m, 6.2, 0.6, 6.8, 0x8a8498, 0, 4.9, -0.4);
  gable(m, 6.4, 2.2, 7, 0x8a8498, 0, 5.2, -0.4);
  cyl(m, 0.7, 0.7, 0.15, 8, 0x50ffa8, 0, 6.1, 3.0, { rx: Math.PI / 2, glow: 1.8 });
  box(m, 1.7, 2.8, 0.1, 0x50ffa8, 0, 2.2, 1.42, { glow: 1.8 });
  box(m, 0.2, 1.2, 0.2, P.marble, 0, 7.8, -0.4);
  box(m, 0.7, 0.2, 0.2, P.marble, 0, 8.1, -0.4);
  s.rect(-12.2, 0, 5.9, 5.5, Math.PI / 2);
  for (const cx of [-2.3, -0.8, 0.8, 2.3]) s.block(-8.6, -cx, 0.4);
  s.light(-7, 2.6, 0, 0x50ffa8, 3);
  for (const [tx, tz] of [[-15, -12], [12, 12], [-15, 11], [16, -11], [24, 8]]) s.tree(tx, tz, 'dead');
  return s.finish();
}

// ------------------------------------------------------------------ the burnt windmill
export function buildWindmill(x, y, z, ry) {
  const s = new Site(x, y, z, ry);
  cyl(s.g, 2.4, 3.5, 11, 8, 0x4a4040, 0, 5.5, 0);
  cyl(s.g, 3.6, 3.7, 1, 8, P.stone, 0, 0.5, 0);
  for (const h of [3.5, 7.5]) cyl(s.g, 3.4 - h * 0.09, 3.4 - h * 0.09, 0.25, 8, P.beam, 0, h, 0);
  cyl(s.g, 0, 3.3, 3.6, 8, 0x2a1a14, 0, 12.8, 0);
  box(s.g, 1.3, 2.3, 0.15, P.wood, 0, 1.15, 3.35);
  for (const [wx, wy] of [[0, 5], [-1.6, 8.5], [1.6, 8.5]]) box(s.g, 0.7, 1, 0.2, 0xff6020, wx, wy, 3.2 - wy * 0.08, { glow: 2.4 });
  // embers still burning on the cap and the ground
  for (const [fx, fy, fz, sz] of [[1.5, 12, 1.2, 0.8], [-1.2, 12.5, -1, 0.7], [2.5, 0, 4, 0.8], [-3, 0, 3, 0.6]]) fire(s.g, fx, fy, fz, 0xff6a20, sz);
  s.light(0, 13.5, 0, 0xff6a20, 4, 4);
  s.light(0, 2, 5.5, 0xff8030, 2.6, 0);
  // sails: a named group so the world can spin it
  const blades = group(s.root, 'blades', 0, 10, 3.6);
  cyl(blades, 0.5, 0.5, 0.8, 6, P.beam, 0, 0, 0, { rx: Math.PI / 2 });
  for (let k = 0; k < 4; k++) {
    const arm = group(blades, '', 0, 0, 0.3);
    arm.rotation.z = (k * Math.PI) / 2;
    box(arm, 0.25, 9.5, 0.2, P.beam, 0, 4.75, 0);
    box(arm, 1.9, 7, 0.06, k % 2 ? 0x9a2020 : 0xd8ccb0, 1.05, 5.4, 0.08);
    for (let i = 0; i < 4; i++) box(arm, 2, 0.08, 0.1, P.beam, 1.0, 2.4 + i * 2, 0.1);
  }
  s.block(0, 0, 3.8);
  // keeper's hut, hay and a scarecrow with a jack-o'-lantern head
  house(s, -9, -5, 1.2, { w: 4, d: 4.5, h: 2.8, roof: 0x3a2a24, wall: 0x9a8a70 });
  for (const [hx, hz] of [[6, -4], [7.5, -1.5]]) {
    cyl(s.g, 1.1, 1.4, 1.6, 8, 0xd8b040, hx, 0.8, hz);
    cyl(s.g, 0, 1.1, 0.8, 8, 0xc8a030, hx, 2, hz);
    s.block(hx, hz, 1.4);
  }
  box(s.g, 0.12, 2.6, 0.12, P.wood, 5, 1.3, 6);
  box(s.g, 1.8, 0.1, 0.1, P.wood, 5, 2.1, 6);
  box(s.g, 0.7, 0.9, 0.4, 0x6a4a8a, 5, 1.9, 6);
  box(s.g, 0.5, 0.45, 0.5, 0xff7a10, 5, 2.65, 6);
  box(s.g, 0.08, 0.08, 0.02, 0xffe040, 4.88, 2.7, 6.26, { glow: 3 });
  box(s.g, 0.08, 0.08, 0.02, 0xffe040, 5.12, 2.7, 6.26, { glow: 3 });
  box(s.g, 0.6, 0.12, 0.6, 0x1a1414, 5, 2.92, 6);
  box(s.g, 0.4, 0.3, 0.4, 0x1a1414, 5, 3.12, 6);
  s.block(5, 6, 0.3);
  s.tree(-6, 8, 'dead'); s.tree(9, 9, 'dead');
  return s.finish();
}

// ------------------------------------------------------------------ abbey of Saint Michael (ruins)
export function buildAbbey(x, y, z, ry) {
  const s = new Site(x, y, z, ry);
  const rnd = mulberry32(5);
  const stone = 0x8a8078, mossy = 0x6a7a62;
  box(s.g, 12, 0.2, 26, 0x5a5462, 0, 0.05, -2);
  // broken side walls with window gaps
  for (let wz = -12; wz <= 8; wz += 4)
    for (const sx of [-1, 1]) {
      if (rnd() < 0.15) continue;
      const h = 3 + rnd() * 6;
      box(s.g, 1, h, 2.6, rnd() < 0.4 ? mossy : stone, sx * 6, h / 2 - 0.3, wz);
      s.wall(sx * 6, wz - 1.3, sx * 6, wz + 1.3, 0.6);
    }
  // facade (entrance at +z) broken into two jagged halves
  for (const sx of [-1, 1]) {
    box(s.g, 4.6, sx < 0 ? 11 : 7, 1.2, stone, sx * 3.7, (sx < 0 ? 11 : 7) / 2 - 0.3, 11);
    s.wall(sx * 1.6, 11, sx * 6, 11, 0.7);
  }
  box(s.g, 3.2, 1.2, 1.2, stone, -2.2, 10, 11, { rz: 0.3 });
  // apse wall with the rose window
  box(s.g, 13, 12, 1.4, stone, 0, 5.7, -14);
  gable(s.g, 13, 4, 1.4, stone, 0, 11.7, -14);
  cyl(s.g, 2.6, 2.6, 0.3, 12, 0x2a2440, 0, 7, -13.2, { rx: Math.PI / 2 });
  cyl(s.g, 2.2, 2.2, 0.35, 12, 0x7a40ff, 0, 7, -13.15, { rx: Math.PI / 2, glow: 2.2 });
  cyl(s.g, 1.3, 1.3, 0.4, 8, 0x30a0ff, 0, 7, -13.1, { rx: Math.PI / 2, glow: 2.4 });
  cyl(s.g, 0.5, 0.5, 0.45, 6, 0xff3060, 0, 7, -13.05, { rx: Math.PI / 2, glow: 2.6 });
  for (let a = 0; a < 6; a++) box(s.g, 0.12, 4.4, 0.5, 0x2a2440, 0, 7, -13.0, { rz: (a * Math.PI) / 6 });
  s.wall(-6.5, -14, 6.5, -14, 0.8);
  // colonnade, some columns broken, one fallen
  for (let cz = -9; cz <= 6; cz += 5)
    for (const sx of [-1, 1]) {
      const h = rnd() < 0.35 ? 1.5 + rnd() * 2 : 7;
      cyl(s.g, 0.45, 0.5, h, 6, 0xa098a8, sx * 3.2, h / 2, cz);
      if (h > 6) box(s.g, 1.2, 0.4, 1.2, 0xa098a8, sx * 3.2, h + 0.2, cz);
      s.block(sx * 3.2, cz, 0.6);
    }
  cyl(s.g, 0.45, 0.45, 6, 6, 0xa098a8, 2, 0.45, 2.5, { rz: Math.PI / 2, ry: 0.5 });
  // altar with blood-red candles
  box(s.g, 3.4, 1.1, 1.4, P.marble, 0, 0.55, -11);
  box(s.g, 3.5, 0.06, 1.5, 0xb01030, 0, 1.12, -11);
  box(s.g, 0.4, 1.0, 1.52, P.gold, 0, 0.6, -11);
  for (const cx of [-1.3, -0.6, 0.6, 1.3]) box(s.g, 0.12, 0.4 + Math.abs(cx) * 0.2, 0.12, 0xff3050, cx, 1.35, -11.3, { glow: 2.6 });
  s.rect(0, -11, 3.6, 1.6, 0, 0.6);
  s.light(0, 2.2, -10, 0xff3050, 3.2, 2);
  s.light(0, 6, -11.5, 0x8050ff, 3, 0);
  box(s.g, 1.6, 1.4, 1.6, 0x6a5a30, 4.5, 0.4, -6, { rx: 0.5, rz: 0.4 }); // fallen bell
  for (const [tx, tz] of [[-9, -6], [9, 4], [8, -12], [-10, 8]]) s.tree(tx, tz, 'dead');
  return s.finish();
}

// ------------------------------------------------------------------ hangman's hill
export function buildGallows(x, y, z, ry) {
  const s = new Site(x, y, z, ry);
  box(s.g, 5, 1.6, 5, P.wood, 0, 0.6, 0);
  for (let i = 0; i < 4; i++) box(s.g, 1.4, 0.25, 0.6, P.beam, 0, 0.15 + i * 0.4, 3 + (3 - i) * 0.6);
  for (const sx of [-1, 1]) box(s.g, 0.35, 6.4, 0.35, P.beam, sx * 1.9, 4.2, 0);
  box(s.g, 4.6, 0.35, 0.35, P.beam, 0, 7.3, 0);
  box(s.g, 0.25, 1.2, 0.25, P.beam, -1.4, 6.6, 0, { rz: 0.8 });
  box(s.g, 0.06, 1.8, 0.06, 0xb09060, 0.8, 6.2, 0);
  cyl(s.g, 0.25, 0.25, 0.08, 8, 0xb09060, 0.8, 5.2, 0, { rx: Math.PI / 2 });
  for (const cx of [-1.2, -0.5, 1.6]) {
    box(s.g, 0.22, 0.2, 0.36, 0x101014, cx, 7.6, 0);
    box(s.g, 0.04, 0.04, 0.02, 0xffe040, cx + 0.06, 7.66, 0.18, { glow: 3 });
  }
  box(s.g, 0.08, 0.6, 0.08, P.iron, -1.5, 6.8, 0.3);
  box(s.g, 0.3, 0.4, 0.3, 0xffb050, -1.5, 6.4, 0.3, { glow: 2.4 });
  s.light(-1.5, 6.4, 0.6, 0xffb050, 2.4, 2);
  s.rect(0, 0, 5.2, 5.2, 0, 0.7);
  s.tree(5, -4, 'dead');
  return s.finish();
}

// ------------------------------------------------------------------ stone bridge (with walkable deck)
export function buildBridge(x, z, h0, h1, len) {
  const s = new Site(x, 0, z, 0);
  const n = 16, seg = len / n;
  const deckY = (t) => h0 + (h1 - h0) * t + Math.sin(t * Math.PI) * 1.4;
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n, y = deckY(t), lz = -len / 2 + (i + 0.5) * seg;
    box(s.g, 6, 0.8, seg + 0.05, 0x8a8494, 0, y - 0.4, lz);
    for (const sx of [-1, 1]) box(s.g, 0.5, 1.1, seg + 0.05, 0x9a94a4, sx * 3, y + 0.35, lz);
  }
  for (const pz of [-5, 5]) box(s.g, 6.6, 8, 2.6, 0x7a7484, 0, -2.6, pz);
  for (const pz of [-len / 2 + 0.6, len / 2 - 0.6]) for (const sx of [-1, 1]) {
    const y = deckY(pz < 0 ? 0 : 1);
    box(s.g, 0.8, 2.2, 0.8, P.stone, sx * 3, y + 0.6, pz);
    box(s.g, 0.4, 0.5, 0.4, 0xffb050, sx * 3, y + 2, pz, { glow: 2.4 });
    s.light(sx * 3, y + 2, pz, 0xffb050, 2.4, 2);
  }
  for (const sx of [-1, 1]) s.wall(sx * 3, -len / 2, sx * 3, len / 2, 0.45);
  s.platform = { x0: x - 2.8, x1: x + 2.8, z0: z - len / 2, z1: z + len / 2, h: (wz) => deckY((wz - (z - len / 2)) / len) };
  return s.finish();
}

// ------------------------------------------------------------------ wayside shrine
export function buildShrine(x, y, z, ry) {
  const s = new Site(x, y, z, ry);
  box(s.g, 0.7, 2.2, 0.5, P.stone, 0, 1.1, 0);
  gable(s.g, 1.3, 0.6, 0.9, P.roofs[0], 0, 2.2, 0);
  box(s.g, 0.4, 0.5, 0.05, 0x40a0ff, 0, 1.6, 0.26, { glow: 1.8 });
  box(s.g, 0.12, 0.25, 0.12, 0xffd080, 0.25, 0.55, 0.45, { glow: 2.6 });
  box(s.g, 0.12, 0.18, 0.12, 0xffd080, -0.2, 0.5, 0.45, { glow: 2.6 });
  s.light(0, 1, 0.8, 0xffc070, 1.8, 1.4);
  s.block(0, 0, 0.5);
  return s.finish();
}

// ------------------------------------------------------------------ castle Dracula
export function buildCastle(x, y, z) {
  const s = new Site(x, y, z, 0);
  const g = s.g, stone = 0x3a3448, dark = 0x262230, roof = 0x5a1030, win = 0xffb040, red = 0xff2040;
  box(g, 64, 0.3, 56, 0x2e2a38, 0, 0.0, 0);
  // curtain walls with battlements (gate gap on the south side)
  const walls = [[-34, -30, 34, -30], [-34, -30, -34, 30], [34, -30, 34, 30], [-34, 30, -5, 30], [5, 30, 34, 30]];
  for (const [x1, z1, x2, z2] of walls) {
    const len = Math.hypot(x2 - x1, z2 - z1), horiz = z1 === z2;
    box(g, horiz ? len : 3, 14, horiz ? 3 : len, dark, (x1 + x2) / 2, 7, (z1 + z2) / 2);
    const n = Math.floor(len / 2.5);
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      box(g, 1.2, 1.6, 1.2, dark, x1 + (x2 - x1) * t, 14.8, z1 + (z2 - z1) * t);
    }
    s.wall(x1, z1, x2, z2, 1.8);
  }
  // corner towers
  for (const [tx, tz] of [[-34, -30], [34, -30], [-34, 30], [34, 30]]) {
    cyl(g, 4.6, 5.2, 28, 8, stone, tx, 14, tz);
    cyl(g, 5.6, 5.6, 1.8, 8, dark, tx, 28.6, tz);
    cyl(g, 0, 6, 13, 8, roof, tx, 36, tz);
    box(g, 0.9, 1.8, 0.3, win, tx, 20, tz + (tz > 0 ? 5 : -5), { glow: 2.4 });
    s.block(tx, tz, 5.6);
  }
  // gatehouse + sealed portcullis (named so it can be lifted)
  for (const sx of [-1, 1]) {
    cyl(g, 3.6, 4, 21, 8, stone, sx * 7.5, 10.5, 30);
    cyl(g, 0, 4.4, 9, 8, roof, sx * 7.5, 25.5, 30);
    box(g, 0.8, 1.6, 0.3, red, sx * 7.5, 15, 34, { glow: 2.4 });
    s.block(sx * 7.5, 30, 4.2);
  }
  box(g, 11, 6, 4, dark, 0, 15, 30);
  box(g, 3, 3, 0.3, 0xb00c24, 0, 15, 32.1);
  const gate = group(s.root, 'gate', 0, 0, 30);
  for (let i = -4; i <= 4; i++) box(gate, 0.18, 12, 0.18, P.iron, i, 6, 0);
  for (let j = 1; j < 12; j += 2.2) box(gate, 10, 0.18, 0.18, P.iron, 0, j, 0);
  cyl(gate, 2.4, 2.4, 0.2, 12, red, 0, 6, 0.3, { rx: Math.PI / 2, glow: 2.4 });
  cyl(gate, 1.6, 1.6, 0.25, 12, 0x200008, 0, 6, 0.35, { rx: Math.PI / 2 });
  box(gate, 0.3, 2.6, 0.3, red, 0, 6, 0.45, { glow: 2.6 });
  box(gate, 1.6, 0.3, 0.3, red, 0, 6.6, 0.45, { glow: 2.6 });
  const before = s.obstacles.length;
  s.wall(-5, 30, 5, 30, 1.5);
  s.gateObstacles = s.obstacles.splice(before);
  // keep with banners, door and lit windows
  box(g, 36, 26, 16, stone, 0, 13, -20);
  const kr = group(g, '', 0, 0, -20);
  kr.rotation.y = Math.PI / 2;
  gable(kr, 16, 9, 36.5, roof, 0, 26, 0);
  box(g, 6, 9, 0.5, 0x200008, 0, 4.5, -11.8);
  box(g, 5, 8, 0.4, red, 0, 4, -11.6, { glow: 1.6 });
  box(g, 12, 0.6, 3, stone, 0, 0.3, -10.5);
  for (const row of [9, 15, 21]) for (let i = -3; i <= 3; i++) if (i !== 0 || row > 9)
    box(g, 1, 2, 0.3, (i + row) % 3 === 0 ? red : win, i * 4.6, row, -11.9, { glow: 2.2 });
  for (const bx of [-7, 7]) {
    box(g, 2.2, 8, 0.15, 0xa0102a, bx, 15, -11.7);
    box(g, 2.3, 0.3, 0.2, P.gold, bx, 19, -11.65);
    box(g, 0.6, 0.6, 0.2, P.gold, bx, 15, -11.62);
  }
  s.rect(0, -20, 36.4, 16.4, 0, 1.6);
  // spires
  cyl(g, 5, 6, 54, 8, stone, 12, 27, -24);
  cyl(g, 0, 6.4, 22, 8, roof, 12, 65, -24);
  box(g, 1.2, 2.6, 0.3, red, 12, 46, -18.2, { glow: 3 });
  cyl(g, 3.4, 4, 40, 8, stone, -13, 20, -25);
  cyl(g, 0, 4.4, 14, 8, roof, -13, 47, -25);
  box(g, 0.9, 1.8, 0.3, win, -13, 33, -21, { glow: 2.4 });
  // courtyard: blood fountain, braziers, gargoyles
  cyl(g, 4.2, 4.6, 1.2, 10, stone, 0, 0.6, 6);
  cyl(g, 3.8, 3.8, 0.1, 10, 0xc00020, 0, 1.15, 6, { glow: 1.4 });
  cyl(g, 0.5, 0.6, 3, 6, stone, 0, 2, 6);
  cyl(g, 1.4, 0.8, 0.5, 8, stone, 0, 3.6, 6);
  cyl(g, 1.2, 1.2, 0.06, 8, 0xc00020, 0, 3.86, 6, { glow: 1.6 });
  s.block(0, 6, 4.6);
  s.light(0, 2.5, 6, 0xff1030, 2.8, 3);
  for (const [bx, bz] of [[-14, 16], [14, 16], [-14, -4], [14, -4]]) brazier(s, bx, bz);
  for (const sx of [-1, 1]) {
    const gx = sx * 5;
    box(g, 1.6, 2, 1.6, stone, gx, 1, -9.5);
    box(g, 1, 1.2, 1.2, dark, gx, 2.6, -9.4);
    box(g, 0.8, 0.7, 0.8, dark, gx, 3.5, -9);
    for (const w of [-1, 1]) box(g, 1.2, 0.8, 0.1, dark, gx + w * 0.8, 3.2, -9.6, { rz: w * 0.5 });
    box(g, 0.1, 0.08, 0.05, red, gx - 0.15, 3.6, -8.6, { glow: 3 });
    box(g, 0.1, 0.08, 0.05, red, gx + 0.15, 3.6, -8.6, { glow: 3 });
    s.block(gx, -9.5, 1);
  }
  // ghostly purple fires flanking the approach
  for (const sx of [-1, 1]) brazier(s, sx * 9, 37, 0xb040ff, 3);
  return s.finish(CASTLE_MAT, CASTLE_GLOW);
}

// ------------------------------------------------------------------ the count's earth-filled coffins
export function buildCoffin(x, y, z, ry) {
  const s = new Site(x, y, z, ry);
  const c = group(s.root, 'coffin');
  box(c, 1.6, 0.25, 2.8, 0x3a2a1a, 0, 0.1, 0);
  box(c, 0.9, 0.55, 2.1, 0x3a1a10, 0, 0.5, 0);
  box(c, 0.98, 0.14, 2.18, 0x5a2a18, 0, 0.84, 0);
  box(c, 0.1, 0.05, 1.0, P.gold, 0, 0.93, 0.1);
  box(c, 0.55, 0.05, 0.1, P.gold, 0, 0.93, 0.35);
  for (const sx of [-1, 1]) box(c, 0.02, 0.06, 1.8, 0xff1030, sx * 0.46, 0.76, 0, { glow: 3 });
  for (const [cx, cz] of [[-0.7, -1.2], [0.7, -1.2], [-0.7, 1.2], [0.7, 1.2]]) {
    box(c, 0.1, 0.35, 0.1, 0xf0e8d0, cx, 0.4, cz);
    box(c, 0.08, 0.1, 0.08, 0xff8030, cx, 0.62, cz, { glow: 3 });
  }
  s.coffinLight = s.light(0, 1.4, 0, 0xff1030, 3, 3.5);
  s.block(0, 0, 1.2);
  return s.finish();
}
