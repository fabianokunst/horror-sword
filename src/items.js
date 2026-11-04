// Item catalog, low-poly item models and the glinting pickups scattered across the valley.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import * as W from './world.js';
import { mulberry32 } from './rng.js';
import { ps1, glowSprite } from './ps1.js';

export const ITEMS = {
  herbG: { name: 'Erva Verde', desc: 'Erva medicinal colhida nos Cárpatos. Cura parte dos ferimentos.', heal: 30 },
  herbR: { name: 'Erva Vermelha', desc: 'Sozinha não tem efeito. Misture com uma Erva Verde para potencializar a cura.' },
  mixGG: { name: 'Ervas Mistas (V+V)', desc: 'Duas ervas verdes moídas juntas. Cura boa parte dos ferimentos.', heal: 60 },
  mixGR: { name: 'Ervas Mistas (V+R)', desc: 'Erva verde e vermelha moídas juntas. Cura todos os ferimentos.', heal: Infinity },
  mixGGG: { name: 'Ervas Mistas (V+V+V)', desc: 'Três ervas verdes moídas juntas. Cura todos os ferimentos.', heal: Infinity },
  water: { name: 'Água Benta', desc: 'Frasco abençoado na abadia. Unja a lâmina: dano em dobro por 30 segundos.', bless: 30 },
};

export const EQUIP = {
  sword: { name: 'Espada Rúnica' },
  crossbow: { name: 'Besta de Prata' },
};

// unordered pairs -> result
const MIX = { 'herbG+herbG': 'mixGG', 'herbG+herbR': 'mixGR', 'herbG+mixGG': 'mixGGG' };
export const combine = (a, b) => MIX[[a, b].sort().join('+')] || null;

const groundAt = (x, z) => Math.max((W.groundAt ?? W.heightAt)(x, z), W.WATER);

// ---------------------------------------------------------------- models
// Parts are colored boxes/cylinders merged into one solid + one glowing mesh per item.
const MAT = ps1(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }), 0.28);
const GLOW = ps1(new THREE.MeshBasicMaterial({ vertexColors: true }));

function build(draw) {
  const parts = { solid: [], glow: [] };
  const c = new THREE.Color(), m = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), e = new THREE.Euler(), one = new THREE.Vector3(1, 1, 1);
  const add = (geo, color, x, y, z, o = {}) => {
    geo.applyMatrix4(m.compose(p.set(x, y, z), q.setFromEuler(e.set(o.rx || 0, o.ry || 0, o.rz || 0)), one));
    c.set(color).multiplyScalar(o.glow || 1);
    const arr = new Float32Array(geo.attributes.position.count * 3);
    for (let i = 0; i < arr.length; i += 3) c.toArray(arr, i);
    geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    parts[o.glow ? 'glow' : 'solid'].push(geo);
  };
  const box = (w, h, d, ...rest) => add(new THREE.BoxGeometry(w, h, d), ...rest);
  const cyl = (rt, rb, h, seg, ...rest) => add(new THREE.CylinderGeometry(rt, rb, h, seg), ...rest);
  draw(box, cyl);
  const root = new THREE.Group();
  if (parts.solid.length) {
    const mesh = new THREE.Mesh(mergeGeometries(parts.solid), MAT);
    mesh.castShadow = true;
    root.add(mesh);
  }
  if (parts.glow.length) root.add(new THREE.Mesh(mergeGeometries(parts.glow), GLOW));
  return root;
}

const herbPot = ([leaf, dark]) => (box, cyl) => {
  cyl(0.17, 0.12, 0.2, 8, 0xb05a2e, 0, 0.1, 0);
  cyl(0.19, 0.19, 0.05, 8, 0xd0703a, 0, 0.2, 0);
  cyl(0.16, 0.16, 0.02, 8, 0x3a2414, 0, 0.22, 0);
  for (let i = 0; i < 7; i++) {
    const a = i * 2.4, t = i ? 0.55 : 0, h = i ? 0.22 : 0.3, off = 0.03 + (h / 2) * Math.sin(t);
    box(0.07, h, 0.03, i % 2 ? dark : leaf, Math.sin(a) * off, 0.22 + (h / 2) * Math.cos(t), Math.cos(a) * off,
      { rx: Math.cos(a) * t, rz: -Math.sin(a) * t });
  }
};

const mortar = (colors) => (box, cyl) => {
  cyl(0.2, 0.14, 0.16, 8, 0x8a8478, 0, 0.08, 0);
  cyl(0.22, 0.22, 0.03, 8, 0xa8a090, 0, 0.165, 0);
  cyl(0.18, 0.18, 0.02, 8, 0x2a1a10, 0, 0.17, 0);
  colors.forEach((c, i) => {
    const a = i * 2.4, d = 0.03 + (i % 3) * 0.035;
    box(0.1, 0.05, 0.07, c, Math.sin(a) * d, 0.19 + (i % 2) * 0.02, Math.cos(a) * d, { ry: a, rx: 0.3 });
  });
  cyl(0.035, 0.05, 0.3, 6, 0x6a5a48, 0.07, 0.27, 0, { rz: -0.5 });
};

function vial(box, cyl) {
  cyl(0.1, 0.13, 0.26, 6, 0x4aa8ff, 0, 0.13, 0, { glow: 1.1 });
  cyl(0.04, 0.08, 0.08, 6, 0xc8ecff, 0, 0.3, 0);
  cyl(0.04, 0.04, 0.06, 6, 0xc8ecff, 0, 0.37, 0);
  cyl(0.05, 0.045, 0.06, 6, 0x8a5a2a, 0, 0.42, 0);
  box(0.035, 0.14, 0.02, 0xf0bc40, 0, 0.14, 0.12);
  box(0.1, 0.035, 0.02, 0xf0bc40, 0, 0.17, 0.12);
}

function sword(box) {
  box(0.07, 0.95, 0.025, 0xdce6f4, 0, 0.6, 0);
  box(0.02, 0.8, 0.03, 0x40e8ff, 0, 0.58, 0, { glow: 1.6 });
  box(0.3, 0.05, 0.06, 0xf0bc40, 0, 0.13, 0);
  box(0.045, 0.22, 0.045, 0x7a4422, 0, 0, 0);
  box(0.07, 0.07, 0.07, 0xff1a40, 0, -0.13, 0, { glow: 1.3 });
}

function crossbow(box) {
  box(0.08, 0.06, 0.6, 0x7a4422, 0, 0, 0);
  box(0.7, 0.04, 0.05, 0xc8d0dc, 0, 0.02, 0.24);
  box(0.66, 0.012, 0.012, 0xe8dcc8, 0, 0.03, 0.15);
  box(0.03, 0.03, 0.5, 0xc0f8ff, 0, 0.05, 0.12, { glow: 1.3 });
  box(0.05, 0.12, 0.06, 0x5a3418, 0, -0.07, -0.12);
}

const GREEN = [0x3cc040, 0x1f8a2a], RED = [0xe0283a, 0x9a1020];
const BUILDERS = {
  herbG: herbPot(GREEN),
  herbR: herbPot(RED),
  mixGG: mortar([...GREEN, ...GREEN]),
  mixGR: mortar([GREEN[0], RED[0], GREEN[1], RED[1]]),
  mixGGG: mortar([...GREEN, 0x58e050, ...GREEN]),
  water: vial,
  sword,
  crossbow,
};

const templates = new Map();
export function itemModel(id) {
  let t = templates.get(id);
  if (!t) templates.set(id, (t = build(BUILDERS[id])));
  return t.clone(true);
}

// ---------------------------------------------------------------- pickups in the world
const GRID = 34; // the valley is split in cells; a few of them hide an item
const CHANCE = 0.14;
const NEAR = 1.8;
const FAR = 130;

const cellSeed = (x, z) => (Math.imul(x | 0, 73856093) ^ Math.imul(z | 0, 19349663) ^ 0x5bd1e995) >>> 0;

export class Pickups {
  constructor(scene) {
    this.scene = scene;
    this.list = [];
    this.cells = new Map(); // cell key -> pickup | null (already decided)
    this.taken = new Set(); // cells whose item was collected
  }

  spawn(id, x, z, o = {}) {
    const mesh = itemModel(id);
    mesh.scale.setScalar(1.6);
    mesh.rotation.y = Math.random() * Math.PI * 2;
    const glint = glowSprite(0xfff4d0, 1, 0.9);
    const p = { id, mesh, glint, x, z, y: groundAt(x, z), t: Math.random() * 10, life: o.life ?? Infinity, cell: o.cell ?? null, pop: o.pop ? 0 : 1 };
    this.scene.add(mesh, glint);
    this.list.push(p);
    this.place(p);
    return p;
  }

  remove(p, taken = false) {
    this.scene.remove(p.mesh, p.glint);
    this.list.splice(this.list.indexOf(p), 1);
    if (p.cell) {
      this.cells.delete(p.cell);
      if (taken) this.taken.add(p.cell);
    }
  }

  nearest(pos) {
    let best = null, bd = NEAR;
    for (const p of this.list) {
      const d = Math.hypot(p.x - pos.x, p.z - pos.z);
      if (d < bd && Math.abs(p.y - pos.y) < 2) { bd = d; best = p; }
    }
    return best;
  }

  place(p) {
    const hop = Math.sin(p.pop * Math.PI) * 1.2;
    p.mesh.position.set(p.x, p.y + hop, p.z);
    p.glint.position.set(p.x, p.y + hop + 0.85, p.z);
  }

  // decide (deterministically) whether the cells around the player hold an item
  populate(pos, world) {
    const cx = Math.floor(pos.x / GRID), cz = Math.floor(pos.z / GRID);
    for (let dz = -2; dz <= 2; dz++)
      for (let dx = -2; dx <= 2; dx++) {
        const key = cx + dx + ':' + (cz + dz);
        if (this.cells.has(key) || this.taken.has(key)) continue;
        const rnd = mulberry32(cellSeed(cx + dx, cz + dz));
        const q = { x: (cx + dx + 0.15 + rnd() * 0.7) * GRID, z: (cz + dz + 0.15 + rnd() * 0.7) * GRID };
        if (rnd() > CHANCE || (W.mapE && W.mapE(q.x, q.z) > 0.86)) { this.cells.set(key, null); continue; }
        world.collide(q, 0.7);
        if (W.heightAt(q.x, q.z) < W.WATER + 0.4) { this.cells.set(key, null); continue; }
        const r = rnd();
        this.cells.set(key, this.spawn(r < 0.55 ? 'herbG' : r < 0.8 ? 'herbR' : 'water', q.x, q.z, { cell: key }));
      }
  }

  update(dt, player, world, active) {
    if (active) this.populate(player.pos, world);
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      p.t += dt;
      p.life -= dt;
      if (p.pop < 1) p.pop = Math.min(1, p.pop + dt * 2.2);
      if (p.life <= 0 || Math.hypot(p.x - player.pos.x, p.z - player.pos.z) > FAR) { this.remove(p); continue; }
      this.place(p);
      p.mesh.rotation.y += dt * 0.7;
      // the classic survival-horror glint: a sharp flash every couple of seconds
      const g = Math.max(0, Math.sin(p.t * 2.4)) ** 14;
      p.glint.scale.setScalar(0.3 + g * 1.5);
      p.mesh.visible = p.glint.visible = p.life > 5 || Math.floor(p.t * 8) % 2 === 0;
    }
  }
}
