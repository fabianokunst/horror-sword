// Hand-crafted valley: designed heightmap (river, lake, hills, castle crag, mountain ring),
// painted terrain, forests, roads and the unique landmarks from structures.js.
import * as THREE from 'three';
import { createNoise2D } from 'simplex-noise';
import { lambert, basic, canvasTexture, noiseTexture, glowSprite } from './ps1.js';
import { mulberry32 } from './rng.js';
import * as S from './structures.js';
import { LimbBatch, deadTree } from './deadtree.js';
import { L } from './i18n.js';

export { mulberry32 };
export const WATER = 0;
export const CASTLE = { x: 0, z: -205, h: 40 };
const MAP = { cx: 0, cz: -30, ax: 215, az: 235 };
const TER = { x0: -240, z0: -275, size: 480, seg: 160 };
const MAX_LIGHTS = 8;

const smooth = (e0, e1, x) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};
const lerp = (a, b, t) => a + (b - a) * t;

const nA = createNoise2D(mulberry32(1337));
const nB = createNoise2D(mulberry32(7331));
const nC = createNoise2D(mulberry32(4242));

export const mapE = (x, z) => Math.hypot((x - MAP.cx) / MAP.ax, (z - MAP.cz) / MAP.az);
export const riverZ = (x) => 42 + Math.sin(x * 0.018) * 14 + Math.sin(x * 0.045 + 1) * 4;
export const LAKE = { x: -150, z: -50, r: 30 };
const RZ0 = riverZ(0);

export const PLACES = [
  { id: 'village', x: 0, z: 110, r: 38, name: L('Vilarejo de Borgo', 'Borgo Village'), sub: L('O último refúgio dos vivos', 'The last refuge of the living') },
  { id: 'cemetery', x: -95, z: 90, r: 26, name: L('Cemitério dos Esquecidos', 'Cemetery of the Forgotten'), sub: L('Os mortos não descansam aqui', 'The dead find no rest here') },
  { id: 'bridge', x: 0, z: RZ0, r: 16, name: L('Ponte do Rio Argeș', 'Argeș River Bridge'), sub: '' },
  { id: 'windmill', x: 120, z: -10, r: 24, name: L('O Moinho Queimado', 'The Burnt Mill'), sub: L('Ainda arde desde a última caçada', 'Still smouldering since the last hunt') },
  { id: 'gallows', x: -40, z: -40, r: 14, name: L('Colina da Forca', 'Gallows Hill'), sub: '' },
  { id: 'abbey', x: -105, z: -95, r: 26, name: L('Abadia de São Miguel', 'Abbey of Saint Michael'), sub: L('Profanada pelo Conde', 'Desecrated by the Count') },
  { id: 'castle', x: CASTLE.x, z: CASTLE.z, r: 42, name: L('Castelo Drácula', 'Castle Dracula'), sub: L('Lar do Senhor da Noite', 'Home of the Lord of the Night') },
];
const P = Object.fromEntries(PLACES.map((p) => [p.id, p]));

const HILLS = [
  { x: 120, z: -10, r: 50, h: 14 },
  { x: -40, z: -40, r: 30, h: 10 },
  { x: 120, z: -120, r: 55, h: 18 },
  { x: -140, z: -140, r: 50, h: 16 },
  { x: 70, z: 95, r: 35, h: 7 },
  { x: -150, z: 30, r: 40, h: 8 },
  { x: 60, z: -170, r: 40, h: 14 },
];

export const ROADS = [
  [[0, 205], [0, 150], [0, 110], [0, 75], [0, RZ0 + 16], [0, RZ0 - 16], [8, 10], [25, -40], [10, -85], [-12, -125], [2, -160], [0, -172]],
  [[0, 98], [-40, 95], [-74, 90]],
  [[8, 10], [50, 2], [90, -6], [110, -9]],
  [[10, -85], [-40, -90], [-88, -95]],
  [[8, 10], [-15, -12], [-34, -34]],
];

function rawHeight(x, z) {
  let h = 4 + nA(x * 0.008, z * 0.008) * 3 + nB(x * 0.035, z * 0.035) * 0.6;
  for (const k of HILLS) h += k.h * smooth(k.r, 0, Math.hypot(x - k.x, z - k.z));
  h += (CASTLE.h - 6) * smooth(130, 40, Math.hypot(x - CASTLE.x, z - CASTLE.z));
  h += smooth(0.8, 1.05, mapE(x, z)) * (55 + nC(x * 0.02, z * 0.02) * 20);
  return h;
}

const FLATS = [
  { x: P.village.x, z: P.village.z, r: 46, h: 5 },
  { x: P.cemetery.x, z: P.cemetery.z, r: 26 },
  { x: P.windmill.x, z: P.windmill.z, r: 14 },
  { x: P.abbey.x, z: P.abbey.z, r: 22 },
  { x: P.gallows.x, z: P.gallows.z, r: 7 },
  { x: CASTLE.x, z: CASTLE.z, r: 46, h: CASTLE.h },
];
for (const f of FLATS) f.h ??= rawHeight(f.x, f.z);

export function heightAt(x, z) {
  let h = rawHeight(x, z);
  for (const f of FLATS) h = lerp(h, f.h, smooth(f.r + 12, f.r, Math.hypot(x - f.x, z - f.z)));
  h = lerp(h, -2.4, smooth(10, 4, Math.abs(z - riverZ(x))));
  h = lerp(h, -3, smooth(LAKE.r, LAKE.r - 12, Math.hypot(x - LAKE.x, z - LAKE.z)));
  return h;
}

// walkable platforms (bridge deck) on top of the terrain
const PLATFORMS = [];
export function groundAt(x, z) {
  let h = heightAt(x, z);
  for (const p of PLATFORMS) if (x > p.x0 && x < p.x1 && z > p.z0 && z < p.z1) h = Math.max(h, p.h(z));
  return h;
}

function roadDist(x, z) {
  let best = Infinity;
  for (const r of ROADS)
    for (let i = 0; i < r.length - 1; i++) {
      const [ax, az] = r[i], [bx, bz] = r[i + 1];
      const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
      best = Math.min(best, Math.hypot(x - ax - dx * t, z - az - dz * t));
    }
  return best;
}

export const FORESTS = [
  { x: 75, z: 125, r: 45, d: 0.012 },
  { x: -60, z: 150, r: 30, d: 0.01 },
  { x: -150, z: 120, r: 35, d: 0.01 },
  { x: -60, z: 30, r: 35, d: 0.009 },
  { x: 85, z: 60, r: 30, d: 0.008 },
  { x: -70, z: -15, r: 40, d: 0.012 },
  { x: 70, z: -80, r: 50, d: 0.012 },
  { x: -150, z: -130, r: 45, d: 0.01, dead: 0.6 },
  { x: 45, z: -150, r: 35, d: 0.01, dead: 0.8 },
  { x: -50, z: -160, r: 40, d: 0.01, dead: 0.8 },
  { x: 160, z: 50, r: 35, d: 0.01 },
  { x: 150, z: -60, r: 30, d: 0.009 },
];
const inForest = (x, z) => FORESTS.some((f) => Math.hypot(x - f.x, z - f.z) < f.r * 0.9);

const COL = {
  mud: new THREE.Color(0x4d3b2a), grass: new THREE.Color(0x3f6a32), grassL: new THREE.Color(0x5a7a34),
  grassD: new THREE.Color(0x2c5030), heather: new THREE.Color(0x6a3a7a), forest: new THREE.Color(0x24402a),
  road: new THREE.Color(0x7a5a3a), cobble: new THREE.Color(0x6a6058), dead: new THREE.Color(0x4e4258),
  ash: new THREE.Color(0x4a4450), rock: new THREE.Color(0x5c5c6e), snow: new THREE.Color(0xd8d8e8),
};

function groundColor(x, z, h, out) {
  if (h < 0.9) return out.copy(COL.mud);
  const n = nA(x * 0.02 + 30, z * 0.02);
  out.copy(n > 0.3 ? COL.grassL : n < -0.3 ? COL.grassD : COL.grass);
  if (nB(x * 0.015 + 40, z * 0.015) > 0.55) out.copy(COL.heather);
  if (inForest(x, z)) out.lerp(COL.forest, 0.7);
  out.lerp(COL.dead, smooth(30, 20, Math.hypot(x - P.cemetery.x, z - P.cemetery.z)));
  out.lerp(COL.ash, smooth(150, 70, Math.hypot(x - CASTLE.x, z - CASTLE.z)));
  if (Math.hypot(x - P.village.x, z - P.village.z) < 18) out.copy(COL.cobble);
  const rd = roadDist(x, z);
  if (rd < 3.2) out.copy(COL.road);
  else if (rd < 4.5) out.lerp(COL.road, 0.5);
  const slope = Math.abs(heightAt(x + 1.5, z) - h) + Math.abs(heightAt(x, z + 1.5) - h);
  out.lerp(COL.rock, smooth(1.6, 2.6, slope));
  if (h > 18 && mapE(x, z) > 0.85) out.lerp(COL.rock, 0.7);
  if (h > 52) out.copy(COL.snow);
  return out;
}

// ------------------------------------------------------------------ instanced vegetation
let KINDS = null;
function kinds() {
  if (KINDS) return KINDS;
  const bark = canvasTexture(16, (g, s, r) => {
    for (let x = 0; x < s; x++) {
      const v = 120 + Math.floor(r() * 100);
      for (let y = 0; y < s; y++) {
        const w = v + Math.floor(r() * 30);
        g.fillStyle = `rgb(${w},${w},${w})`;
        g.fillRect(x, y, 1, 1);
      }
    }
  }, 3);
  const base = (geo) => geo.translate(0, 0.5, 0);
  const cap = new THREE.SphereGeometry(1, 6, 3, 0, Math.PI * 2, 0, Math.PI / 2);
  KINDS = {
    trunk: { geo: base(new THREE.CylinderGeometry(0.12, 0.22, 1, 5)), mat: lambert(0x5b3f2c, { map: bark }) },
    dead: { mat: lambert(0x7a7266, { map: bark }) }, // merged per sector (deadtree.js), not instanced
    pine: { geo: base(new THREE.ConeGeometry(1, 1, 6)), mat: lambert(0x1f4a3a) },
    pineB: { geo: base(new THREE.ConeGeometry(1, 1, 6)), mat: lambert(0x2a5a34) },
    rock: { geo: new THREE.DodecahedronGeometry(1, 0), mat: lambert(0x6c6c80, { map: noiseTexture(16, 150, 255, 5) }) },
    stem: { geo: base(new THREE.CylinderGeometry(0.04, 0.07, 1, 5)), mat: lambert(0xd8d0c0) },
    capCyan: { geo: cap, mat: basic(0x30e8ff, 1.8), glow: true },
    capPink: { geo: cap, mat: basic(0xff40c8, 1.8), glow: true },
  };
  return KINDS;
}

const _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3();
// instances bucketed into map sectors so frustum culling still works on a finite map
class SectorBatch {
  constructor(size = 96) { this.size = size; this.items = new Map(); this.dead = new Map(); }
  sector(x, z) { return Math.floor(x / this.size) + ',' + Math.floor(z / this.size); }
  // the dead trees of one sector, grown straight into one geometry
  deadTrees(x, z) {
    const key = this.sector(x, z);
    let b = this.dead.get(key);
    if (!b) this.dead.set(key, (b = new LimbBatch()));
    return b;
  }
  add(kind, x, y, z, ry = 0, sx = 1, sy = 1, sz = 1, rx = 0, rz = 0) {
    const key = kind + ':' + this.sector(x, z);
    let a = this.items.get(key);
    if (!a) this.items.set(key, (a = []));
    _p.set(x, y, z);
    _q.setFromEuler(_e.set(rx, ry, rz));
    _s.set(sx, sy, sz);
    a.push(new THREE.Matrix4().compose(_p, _q, _s));
  }
  build(parent) {
    const K = kinds();
    for (const [key, arr] of this.items) {
      const k = K[key.split(':')[0]];
      const mesh = new THREE.InstancedMesh(k.geo, k.mat, arr.length);
      arr.forEach((m, i) => mesh.setMatrixAt(i, m));
      mesh.castShadow = mesh.receiveShadow = !k.glow;
      mesh.computeBoundingSphere();
      parent.add(mesh);
    }
    for (const b of this.dead.values()) {
      const mesh = new THREE.Mesh(b.geometry(), K.dead.mat);
      mesh.castShadow = mesh.receiveShadow = true;
      parent.add(mesh);
    }
  }
}

function addTree(B, obstacles, rnd, x, z, kind) {
  const h = heightAt(x, z);
  if (kind === 'pine') {
    const s = 0.8 + rnd() * 0.9, ry = rnd() * 6, k = rnd() < 0.5 ? 'pine' : 'pineB';
    B.add('trunk', x, h - 0.2, z, 0, s, 2 * s, s);
    B.add(k, x, h + 1.2 * s, z, ry, 1.7 * s, 2.4 * s, 1.7 * s);
    B.add(k, x, h + 2.6 * s, z, ry + 1, 1.3 * s, 2.1 * s, 1.3 * s);
    B.add(k, x, h + 3.9 * s, z, ry + 2, 0.85 * s, 1.8 * s, 0.85 * s);
    obstacles.push({ x, z, r: 0.35 * s });
  } else {
    const s = 0.8 + rnd() * 0.7, th = 3.5 * s + rnd() * 2, seed = Math.floor(rnd() * 4294967296);
    // the shape grows from its own seed; these draws keep the valley's layout (rnd) where it always was
    rnd(); rnd();
    for (let i = 4 * (2 + Math.floor(rnd() * 3)); i > 0; i--) rnd();
    deadTree(B.deadTrees(x, z), seed, x, h, z, s * 1.2, th, heightAt);
    obstacles.push({ x, z, r: 0.3 * s });
  }
}

// ------------------------------------------------------------------ world
export class World {
  constructor(scene) {
    this.scene = scene;
    this.grid = new Map();
    this.lights = [];
    this.visibleLights = [];
    this.places = PLACES;
    this.entered = new Set();
    this.onPlaceEnter = null;
    this.onCoffinDestroyed = null;
    this.siteTrees = [];
    this.sites = []; // every landmark (camcollide.js keeps the camera out of them)
    this.buildTerrain();
    this.buildSites();
    this.buildVegetation();
    this.pool = [];
    for (let i = 0; i < MAX_LIGHTS; i++) {
      const l = new THREE.PointLight(0xffa040, 0, 18, 1.2);
      scene.add(l);
      this.pool.push(l);
    }
  }

  addObstacle(o) {
    const k = Math.floor(o.x / 16) + ',' + Math.floor(o.z / 16);
    let a = this.grid.get(k);
    if (!a) this.grid.set(k, (a = []));
    a.push(o);
  }

  buildTerrain() {
    kinds();
    const geo = new THREE.PlaneGeometry(TER.size, TER.size, TER.seg, TER.seg);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position, uv = geo.attributes.uv, n = pos.count;
    const col = new Float32Array(n * 3), c = new THREE.Color();
    const cx = TER.x0 + TER.size / 2, cz = TER.z0 + TER.size / 2;
    const side = TER.seg + 1;
    const map = document.createElement('canvas');
    map.width = map.height = side;
    const mctx = map.getContext('2d'), img = mctx.createImageData(side, side), rgb = { r: 0, g: 0, b: 0 };
    for (let i = 0; i < n; i++) {
      const x = pos.getX(i) + cx, z = pos.getZ(i) + cz, h = heightAt(x, z);
      pos.setY(i, h);
      uv.setXY(i, x / 5, z / 5);
      groundColor(x, z, h, c);
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
      // minimap pixel (plane vertices are laid out row by row from -z to +z)
      if (h < WATER) c.set(0x1a3a5a);
      c.getRGB(rgb, THREE.SRGBColorSpace);
      img.data.set([rgb.r * 255, rgb.g * 255, rgb.b * 255, 255], i * 4);
    }
    mctx.putImageData(img, 0, 0);
    this.map = { canvas: map, x0: TER.x0, z0: TER.z0, size: TER.size };
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.computeVertexNormals();
    const mat = lambert(0xffffff, { vertexColors: true, map: noiseTexture(16, 160, 255, 11) });
    const terrain = new THREE.Mesh(geo, mat);
    terrain.position.set(cx, 0, cz);
    terrain.receiveShadow = true;
    this.scene.add(terrain);
  }

  addSite(site) {
    this.sites.push(site);
    this.scene.add(site.root);
    for (const o of site.obstacles) this.addObstacle(o);
    this.lights.push(...site.lights);
    this.siteTrees.push(...site.trees);
    return site;
  }

  buildSites() {
    const site = (id, build, ...args) => this.addSite(build(P[id].x, heightAt(P[id].x, P[id].z), P[id].z, ...args));
    site('village', S.buildVillage);
    const cem = site('cemetery', S.buildCemetery);
    const mill = site('windmill', S.buildWindmill, -Math.PI / 2 + 0.2);
    site('gallows', S.buildGallows, 0.6);
    const abbey = site('abbey', S.buildAbbey, Math.PI / 2);
    this.windmillBlades = mill.root.getObjectByName('blades');

    const bl = 32, h0 = heightAt(0, RZ0 - bl / 2), h1 = heightAt(0, RZ0 + bl / 2);
    const bridge = this.addSite(S.buildBridge(0, RZ0, h0, h1, bl));
    PLATFORMS.push(bridge.platform);

    // wayside shrines: rest points (interact.js) — the hunter prays in front of them
    this.shrines = [];
    for (const [x, z, ry] of [[4, 80, 0], [10, 14, -0.5], [31, -52, -1.2], [-18, -120, 1], [-50, 101, 0.3], [62, -2, -0.2], [-62, -94, 0.4], [-22, -20, 0.8]]) {
      const s = this.addSite(S.buildShrine(x, heightAt(x, z), z, ry));
      this.shrines.push({ x, z, ry, light: s.lights[0] });
    }
    // Borgo's merchant stands by the red market stall, facing the square
    const vil = this.sites[0], m = vil.world(-5.4, 5.6);
    this.merchantSpot = { x: m.x, z: m.z, facing: Math.atan2(vil.x - m.x, vil.z - m.z) };

    const castle = this.addSite(S.buildCastle(CASTLE.x, CASTLE.h, CASTLE.z));
    this.castle = castle.root;
    this.gate = { x: CASTLE.x, z: CASTLE.z + 30, open: false, obj: castle.root.getObjectByName('gate'), obstacles: castle.gateObstacles, lift: 0 };
    for (const o of this.gate.obstacles) this.addObstacle(o);
    this.arena = { x: CASTLE.x, z: CASTLE.z + 8, r: 24 };

    // the count's three earth-filled coffins
    this.coffins = [];
    const coffin = (id, s, lx, lz, ry) => {
      const p = s.world(lx, lz), y = heightAt(p.x, p.z);
      const c = this.addSite(S.buildCoffin(p.x, y, p.z, s.ry + ry));
      this.coffins.push({ id, x: p.x, y, z: p.z, hp: 8, maxHp: 8, destroyed: false, site: c, obstacle: c.obstacles[0], light: c.coffinLight });
    };
    coffin('cemetery', cem, -5, 0, Math.PI / 2);
    coffin('windmill', mill, 0, 7, 0);
    coffin('abbey', abbey, 0, -7, 0);

  }

  buildVegetation() {
    const B = new SectorBatch(), rnd = mulberry32(2024), obs = [];
    const blocked = (x, z) =>
      roadDist(x, z) < 5 || heightAt(x, z) < 1 || mapE(x, z) > 0.97 ||
      FLATS.some((f) => Math.hypot(x - f.x, z - f.z) < f.r + 4) ||
      (Math.abs(x) < 6 && Math.abs(z - RZ0) < 20);
    for (const f of FORESTS) {
      const count = Math.floor(f.d * Math.PI * f.r * f.r);
      for (let i = 0; i < count; i++) {
        const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * f.r;
        const x = f.x + Math.cos(a) * r, z = f.z + Math.sin(a) * r;
        if (blocked(x, z)) continue;
        const dead = (f.dead ?? 0.25) + smooth(160, 80, Math.hypot(x - CASTLE.x, z - CASTLE.z)) * 0.6;
        addTree(B, obs, rnd, x, z, rnd() < dead ? 'dead' : 'pine');
        if (rnd() < 0.05) {
          const kind = rnd() < 0.5 ? 'capCyan' : 'capPink';
          for (let m = 0; m < 4; m++) {
            const mx = x + (rnd() - 0.5) * 2.5, mz = z + (rnd() - 0.5) * 2.5, mh = heightAt(mx, mz);
            const st = 0.2 + rnd() * 0.35, rr = 0.12 + rnd() * 0.18;
            B.add('stem', mx, mh - 0.05, mz, 0, 1, st, 1);
            B.add(kind, mx, mh + st - 0.08, mz, 0, rr, rr * 0.8, rr);
          }
          const g = glowSprite(kind === 'capCyan' ? 0x30e8ff : 0xff40c8, 2.6, 0.45);
          g.position.set(x, heightAt(x, z) + 0.5, z);
          this.scene.add(g);
        }
      }
    }
    // pines climbing the mountain ring and lone trees across the valley
    for (let i = 0; i < 1400; i++) {
      const x = TER.x0 + rnd() * TER.size, z = TER.z0 + rnd() * TER.size, e = mapE(x, z);
      const ring = e > 0.8 && e < 1.0 && heightAt(x, z) < 45;
      if ((!ring && rnd() > 0.06) || blocked(x, z)) continue;
      addTree(B, obs, rnd, x, z, rnd() < (ring ? 0.15 : 0.5) ? 'dead' : 'pine');
    }
    for (const t of this.siteTrees) addTree(B, obs, rnd, t.x, t.z, t.kind);
    for (let i = 0; i < 160; i++) {
      const x = TER.x0 + rnd() * TER.size, z = TER.z0 + rnd() * TER.size, sc = 0.3 + rnd() * 1.3;
      if (blocked(x, z) || mapE(x, z) > 0.95) continue;
      B.add('rock', x, heightAt(x, z) - 0.25 * sc, z, rnd() * 6, sc * (1 + rnd() * 0.5), sc * 0.7, sc, rnd(), rnd());
      if (sc > 0.7) obs.push({ x, z, r: sc * 0.9 });
    }
    const g = new THREE.Group();
    B.build(g);
    this.scene.add(g);
    for (const o of obs) this.addObstacle(o);
  }

  // ---------------------------------------------------------------- interactables
  // Instantly sets objective state (loading a save / new cycle): no effects, no callbacks.
  restore({ destroyed = [], gateOpen = false } = {}) {
    for (const c of this.coffins) {
      c.destroyed = destroyed.includes(c.id);
      c.hp = c.maxHp;
      c.obstacle.r = c.destroyed ? 0 : 1.2;
      c.light.power = c.destroyed ? 0 : 3;
      if (c.destroyed) this.scene.remove(c.site.root);
      else if (!c.site.root.parent) this.scene.add(c.site.root);
    }
    this.gate.open = gateOpen;
    this.gate.lift = gateOpen ? 13 : 0;
    this.gate.obj.position.y = this.gate.lift;
    for (const o of this.gate.obstacles) o.r = gateOpen ? 0 : 1.5;
  }

  openGate() {
    if (this.gate.open) return;
    this.gate.open = true;
    for (const o of this.gate.obstacles) o.r = 0;
  }

  inArena(x, z) {
    return Math.hypot(x - this.arena.x, z - this.arena.z) < this.arena.r;
  }

  // sword swing against the coffins; returns how many were hit
  hitCoffins(player, def, fx) {
    const fxv = Math.sin(player.facing), fzv = Math.cos(player.facing);
    let n = 0;
    for (const c of this.coffins) {
      if (c.destroyed) continue;
      const dx = c.x - player.pos.x, dz = c.z - player.pos.z, d = Math.hypot(dx, dz) || 0.001;
      if (d > def.range + 1.2 || (d > 1.5 && (dx * fxv + dz * fzv) / d < def.arc)) continue;
      if (c.sealed) {
        // protected by the campaign until its chapter: sparks + a throttled callback for feedback
        fx?.burst(new THREE.Vector3(c.x, c.y + 0.9, c.z), 0xa060ff, 8, { speed: 3, up: 2, life: 0.35 });
        const now = performance.now();
        if (now - (c.sealedMsgAt || 0) > 2000) { c.sealedMsgAt = now; this.onCoffinSealed?.(c); }
        continue;
      }
      c.hp -= def.dmg;
      n++;
      const p = new THREE.Vector3(c.x, c.y + 0.8, c.z);
      fx?.burst(p, 0x5a2a18, 10, { speed: 4, up: 3 });
      fx?.burst(p, 0xff1030, 6, { speed: 3, up: 2, life: 0.4 });
      if (c.hp <= 0) {
        c.destroyed = true;
        fx?.burst(p, 0xff1030, 50, { speed: 8, up: 7, life: 1.1, size: 0.18 });
        fx?.burst(p, 0x200818, 30, { speed: 4, up: 3, gravity: 2, life: 1.5, size: 0.3 });
        this.scene.remove(c.site.root);
        c.obstacle.r = 0;
        c.light.power = 0;
        this.onCoffinDestroyed?.(c);
      }
    }
    return n;
  }

  // a valid ground position for spawning creatures around (px, pz)
  spawnPoint(px, pz, minD, maxD) {
    for (let tries = 0; tries < 12; tries++) {
      const a = Math.random() * Math.PI * 2, d = minD + Math.random() * (maxD - minD);
      const x = px + Math.cos(a) * d, z = pz + Math.sin(a) * d;
      if (mapE(x, z) > 0.86 || groundAt(x, z) < WATER + 0.5) continue;
      if (!this.gate.open && Math.hypot(x - CASTLE.x, z - CASTLE.z) < 42) continue;
      return { x, z };
    }
    return null;
  }

  clamp(pos) {
    const e = mapE(pos.x, pos.z), max = 0.9;
    if (e > max) {
      pos.x = MAP.cx + (pos.x - MAP.cx) * (max / e);
      pos.z = MAP.cz + (pos.z - MAP.cz) * (max / e);
    }
  }

  collide(pos, radius) {
    const cx = Math.floor(pos.x / 16), cz = Math.floor(pos.z / 16);
    for (let dz = -1; dz <= 1; dz++)
      for (let dx = -1; dx <= 1; dx++) {
        const a = this.grid.get(cx + dx + ',' + (cz + dz));
        if (!a) continue;
        for (const o of a) {
          if (!o.r) continue;
          const ox = pos.x - o.x, oz = pos.z - o.z, rr = o.r + radius, d2 = ox * ox + oz * oz;
          if (d2 < rr * rr && d2 > 1e-6) {
            const d = Math.sqrt(d2);
            pos.x = o.x + (ox / d) * rr;
            pos.z = o.z + (oz / d) * rr;
          }
        }
      }
    this.clamp(pos);
  }

  update(px, pz, time, dt = 0.016) {
    if (this.windmillBlades) this.windmillBlades.rotation.z = time * 0.35;
    if (this.gate.open && this.gate.lift < 13) {
      this.gate.lift = Math.min(13, this.gate.lift + dt * 4);
      this.gate.obj.position.y = this.gate.lift;
    }
    for (const p of this.places) {
      if (!this.entered.has(p.id) && Math.hypot(px - p.x, pz - p.z) < p.r) {
        this.entered.add(p.id);
        this.onPlaceEnter?.(p);
      }
    }
    this.updateLights(px, pz, time);
  }

  updateLights(px, pz, time) {
    const all = [];
    for (const l of this.lights) {
      if (!l.power) continue;
      const d = Math.hypot(l.x - px, l.z - pz);
      if (d < 75) all.push({ l, d });
    }
    all.sort((a, b) => a.d - b.d);
    this.visibleLights = all;
    for (let i = 0; i < this.pool.length; i++) {
      const p = this.pool[i], e = all[i];
      if (!e) { p.intensity = 0; continue; }
      const l = e.l;
      p.position.set(l.x, l.y, l.z);
      p.color.copy(l.color);
      const flicker = 0.82 + 0.18 * Math.sin(time * 13 + l.phase) * Math.sin(time * 7.3 + l.phase * 2);
      p.intensity = l.power * flicker * Math.min(1, (75 - e.d) / 20);
    }
  }
}

// player start: the village square, facing north toward the castle
export function findSpawn() {
  return { x: P.village.x, z: P.village.z + 20 };
}
