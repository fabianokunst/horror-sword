// Particles (instanced cubes), sword slash arcs, ground shockwave rings, lightning, fireflies and camera shake.
import * as THREE from 'three';
import { ps1 } from './ps1.js';

const MAX = 600;
const ZAP_SEG = 9; // points per lightning bolt
const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _c = new THREE.Color();

// Blade trail: a ribbon swept by the sword (blade base → tip, sampled every frame of a swing), smoothed with
// Catmull-Rom between the samples and fading with age. Additive, so the fade is just the color going dark.
const TRAIL_LIFE = 0.16; // seconds a sample stays visible
const TRAIL_KEEP = 16; // samples kept
const TRAIL_SUB = 4; // ribbon segments between two samples
const TRAIL_MAX = (TRAIL_KEEP - 1) * TRAIL_SUB + 1;
const cr = (a, b, c, d, t) => {
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (3 * b - a - 3 * c + d) * t3);
};
class BladeTrail {
  constructor(scene) {
    this.s = []; // { b: [x,y,z], t: [x,y,z], age }
    this.color = new THREE.Color();
    const g = (this.geo = new THREE.BufferGeometry());
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TRAIL_MAX * 2 * 3), 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(TRAIL_MAX * 2 * 3), 3));
    const idx = [];
    for (let i = 0; i < TRAIL_MAX - 1; i++) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    g.setIndex(idx);
    g.setDrawRange(0, 0);
    this.mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }

  push(base, tip, color) {
    this.color.set(color);
    // the ribbon covers the outer part of the blade
    this.s.push({ b: [base.x + (tip.x - base.x) * 0.2, base.y + (tip.y - base.y) * 0.2, base.z + (tip.z - base.z) * 0.2], t: [tip.x, tip.y, tip.z], age: 0 });
    if (this.s.length > TRAIL_KEEP) this.s.shift();
  }

  update(dt) {
    const S = this.s;
    for (const p of S) p.age += dt;
    while (S.length && S[0].age > TRAIL_LIFE) S.shift();
    if (S.length < 2) { this.geo.setDrawRange(0, 0); return; }
    const pos = this.geo.attributes.position.array, col = this.geo.attributes.color.array;
    const c = this.color;
    let n = 0;
    for (let i = 0; i < S.length - 1; i++) {
      const p0 = S[Math.max(0, i - 1)], p1 = S[i], p2 = S[i + 1], p3 = S[Math.min(S.length - 1, i + 2)];
      const last = i === S.length - 2;
      for (let k = 0; k < (last ? TRAIL_SUB + 1 : TRAIL_SUB); k++) {
        const t = k / TRAIL_SUB;
        const age = p1.age + (p2.age - p1.age) * t;
        const a = Math.max(0, 1 - age / TRAIL_LIFE) ** 1.5 * 1.6;
        for (const [key, o] of [['b', 0], ['t', 3]]) {
          for (let ax = 0; ax < 3; ax++) pos[n * 6 + o + ax] = cr(p0[key][ax], p1[key][ax], p2[key][ax], p3[key][ax], t);
        }
        // the edge (tip side) glows brighter than the inner side
        col[n * 6] = c.r * a * 0.35; col[n * 6 + 1] = c.g * a * 0.35; col[n * 6 + 2] = c.b * a * 0.35;
        col[n * 6 + 3] = c.r * a; col[n * 6 + 4] = c.g * a; col[n * 6 + 5] = c.b * a;
        n++;
      }
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
    this.geo.setDrawRange(0, (n - 1) * 6);
  }
}

export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.parts = [];
    this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), ps1(new THREE.MeshBasicMaterial()), MAX);
    for (let i = 0; i < MAX; i++) this.mesh.setColorAt(i, _c.set(0xffffff));
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);

    const flat = new THREE.RingGeometry(1.1, 3.2, 18, 1, -Math.PI / 2 - 1.4, 2.8).rotateX(-Math.PI / 2);
    const vert = new THREE.RingGeometry(1.1, 3.4, 18, 1, -1.3, 2.9);
    this.arcs = [];
    for (let i = 0; i < 4; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0x60e8ff, transparent: true, opacity: 0, side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending, depthWrite: false,
      });
      const h = new THREE.Mesh(flat, mat), v = new THREE.Mesh(vert, mat);
      h.visible = v.visible = false;
      scene.add(h, v);
      this.arcs.push({ h, v, mat, t: 1, mesh: null });
    }
    this.arcIdx = 0;
    this.shake = 0;

    // ground shockwaves (blade arts, holy blasts): a thin ring that grows to its radius and fades
    const ringGeo = new THREE.RingGeometry(0.84, 1, 40, 1).rotateX(-Math.PI / 2);
    this.rings = [];
    for (let i = 0; i < 10; i++) {
      const mat = new THREE.MeshBasicMaterial({
        transparent: true, opacity: 0, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false,
      });
      const mesh = new THREE.Mesh(ringGeo, mat);
      mesh.visible = false;
      scene.add(mesh);
      this.rings.push({ mesh, mat, t: 1, dur: 1, r: 1 });
    }
    this.ringIdx = 0;

    // lightning: jagged lines (one pixel wide at the game's low resolution reads as a chunky bolt)
    this.zaps = [];
    for (let i = 0; i < 12; i++) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(ZAP_SEG * 3), 3));
      const mat = new THREE.LineBasicMaterial({ transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
      const line = new THREE.Line(g, mat);
      line.frustumCulled = false;
      line.visible = false;
      scene.add(line);
      this.zaps.push({ line, mat, t: 1, life: 1 });
    }
    this.zapIdx = 0;

    this.trail = new BladeTrail(scene);

    const N = 140;
    const g = new THREE.BufferGeometry();
    this.ffBase = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      this.ffBase[i * 3] = (Math.random() - 0.5) * 60;
      this.ffBase[i * 3 + 1] = 0.5 + Math.random() * 3;
      this.ffBase[i * 3 + 2] = (Math.random() - 0.5) * 60;
    }
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
    this.fireflies = new THREE.Points(g, new THREE.PointsMaterial({
      color: 0xd8ff60, size: 2, sizeAttenuation: false, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    this.fireflies.frustumCulled = false;
    scene.add(this.fireflies);
  }

  burst(pos, color, n, o = {}) {
    const { speed = 5, up = 3, gravity = -14, life = 0.6, size = 0.13, spread = 0.3 } = o;
    for (let i = 0; i < n && this.parts.length < MAX; i++) {
      const a = Math.random() * Math.PI * 2, s = speed * (0.3 + Math.random() * 0.7);
      this.parts.push({
        x: pos.x + (Math.random() - 0.5) * spread, y: pos.y + (Math.random() - 0.5) * spread, z: pos.z + (Math.random() - 0.5) * spread,
        vx: Math.cos(a) * s, vy: up * (0.4 + Math.random()), vz: Math.sin(a) * s,
        g: gravity, life: life * (0.6 + Math.random() * 0.6), max: life, size: size * (0.6 + Math.random() * 0.8),
        color: new THREE.Color(color),
      });
    }
  }

  // one sample of the swinging blade per frame (world-space base and tip)
  blade(base, tip, color) { this.trail.push(base, tip, color); }

  slash(pos, facing, vertical, color = 0x60e8ff) {
    const a = this.arcs[this.arcIdx++ % this.arcs.length];
    a.h.visible = a.v.visible = false;
    a.mesh = vertical ? a.v : a.h;
    a.mesh.visible = true;
    a.mesh.position.set(pos.x, pos.y + (vertical ? 1.0 : 1.15), pos.z);
    a.mesh.rotation.set(0, vertical ? facing - Math.PI / 2 : facing, 0);
    a.mat.color.set(color);
    a.t = 0;
  }

  ring(pos, color, radius, dur = 0.45) {
    const r = this.rings[this.ringIdx++ % this.rings.length];
    r.mesh.position.set(pos.x, pos.y + 0.3, pos.z);
    r.mesh.scale.setScalar(0.3);
    r.mesh.visible = true;
    r.mat.color.set(color);
    Object.assign(r, { t: 0, dur, r: radius });
  }

  lightning(a, b, color, life = 0.24) {
    const z = this.zaps[this.zapIdx++ % this.zaps.length];
    const arr = z.line.geometry.attributes.position.array;
    const jag = Math.min(1.4, a.distanceTo(b) * 0.12);
    for (let i = 0; i < ZAP_SEG; i++) {
      const k = i / (ZAP_SEG - 1), j = i === 0 || i === ZAP_SEG - 1 ? 0 : jag;
      arr[i * 3] = a.x + (b.x - a.x) * k + (Math.random() - 0.5) * j;
      arr[i * 3 + 1] = a.y + (b.y - a.y) * k + (Math.random() - 0.5) * j;
      arr[i * 3 + 2] = a.z + (b.z - a.z) * k + (Math.random() - 0.5) * j;
      // sparks along the bolt so it reads thicker than one pixel
      if (i % 2) this.burst(_p.set(arr[i * 3], arr[i * 3 + 1], arr[i * 3 + 2]), color, 1, { speed: 0.6, up: 0, gravity: 0, life: 0.22, size: 0.14, spread: 0 });
    }
    z.line.geometry.attributes.position.needsUpdate = true;
    z.mat.color.set(color);
    z.line.visible = true;
    Object.assign(z, { t: 0, life });
    this.burst(b, color, 8, { speed: 4, up: 2, life: 0.3, size: 0.1 });
  }

  update(dt, time, player, nightAmt) {
    let n = 0;
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i];
      p.life -= dt;
      if (p.life <= 0) { this.parts.splice(i, 1); continue; }
      p.vy += p.g * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
    }
    for (const p of this.parts) {
      const s = p.size * Math.min(1, (p.life / p.max) * 2);
      _s.set(s, s, s);
      _m.compose(_p.set(p.x, p.y, p.z), _q, _s);
      this.mesh.setMatrixAt(n, _m);
      this.mesh.setColorAt(n, p.color);
      n++;
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;

    this.trail.update(dt);
    for (const a of this.arcs) {
      if (!a.mesh) continue;
      a.t += dt;
      const k = a.t / 0.2;
      a.mat.opacity = Math.max(0, 0.8 * (1 - k));
      a.mesh.scale.setScalar(0.85 + k * 0.25);
      if (k >= 1) { a.mesh.visible = false; a.mesh = null; }
    }
    for (const r of this.rings) {
      if (!r.mesh.visible) continue;
      r.t += dt;
      const k = Math.min(1, r.t / r.dur);
      r.mesh.scale.setScalar(0.3 + (r.r - 0.3) * (1 - (1 - k) ** 2));
      r.mat.opacity = 0.9 * (1 - k);
      if (k >= 1) r.mesh.visible = false;
    }
    for (const z of this.zaps) {
      if (!z.line.visible) continue;
      z.t += dt;
      const k = z.t / z.life;
      z.mat.opacity = Math.max(0, 1 - k) * (Math.random() < 0.3 ? 0.4 : 1); // flicker
      if (k >= 1) z.line.visible = false;
    }

    this.shake = Math.max(0, this.shake - dt * 3);

    const arr = this.fireflies.geometry.attributes.position.array;
    for (let i = 0; i < arr.length; i += 3) {
      const bx = this.ffBase[i], bz = this.ffBase[i + 2];
      const wx = ((((bx - player.x) % 60) + 90) % 60) - 30 + player.x;
      const wz = ((((bz - player.z) % 60) + 90) % 60) - 30 + player.z;
      arr[i] = wx + Math.sin(time * 0.7 + i) * 0.8;
      arr[i + 1] = player.y + this.ffBase[i + 1] + Math.sin(time * 1.3 + i * 0.5) * 0.4;
      arr[i + 2] = wz + Math.cos(time * 0.6 + i) * 0.8;
    }
    this.fireflies.geometry.attributes.position.needsUpdate = true;
    this.fireflies.material.opacity = nightAmt * (0.6 + 0.4 * Math.sin(time * 3));
  }
}
