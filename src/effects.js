// Particles (instanced cubes), sword slash arcs, fireflies and camera shake.
import * as THREE from 'three';
import { ps1 } from './ps1.js';

const MAX = 600;
const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _c = new THREE.Color();

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

    for (const a of this.arcs) {
      if (!a.mesh) continue;
      a.t += dt;
      const k = a.t / 0.2;
      a.mat.opacity = Math.max(0, 0.8 * (1 - k));
      a.mesh.scale.setScalar(0.85 + k * 0.25);
      if (k >= 1) { a.mesh.visible = false; a.mesh = null; }
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
