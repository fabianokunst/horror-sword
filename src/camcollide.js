// Third-person camera collision: keeps the camera on the hunter's side of walls, roofs, the bridge deck and hills.
// One ray per frame from the hunter's head toward where the camera wants to be, tested against the solid
// meshes of every landmark (glowing windows, lamps and runes never block) and sampled against the terrain.
// Trees are left out on purpose: forests would make the camera pump in and out all the time.
import * as THREE from 'three';
import { heightAt } from './world.js';

const PAD = 0.35; // gap kept between the camera and what it hit
const MIN = 0.25; // closest the camera gets to the head
const STEPS = 10; // terrain samples along the ray
const CHUNK = 6; // big meshes (the castle) are split into cells this size, so a ray only tests nearby triangles
const SMALL = 300; // triangles below which a mesh is kept whole
// raycast-only stand-in: double sided, so a ray that starts inside a wall's volume still finds its far face
const RAY_MAT = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });

// Splits a geometry into index-only pieces by cell (in its own local space, so moving meshes still work).
// Each piece shares the position buffer and carries its own bounds, which Mesh.raycast tests first.
function chunks(geo) {
  const pos = geo.attributes.position;
  const idx = geo.index ? geo.index.array : null;
  const tris = idx ? idx.length / 3 : pos.count / 3;
  if (tris <= SMALL) {
    if (!geo.boundingSphere) geo.computeBoundingSphere(); // near() reads it before Mesh.raycast would
    return [geo];
  }
  const v = (t, k) => (idx ? idx[t * 3 + k] : t * 3 + k);
  const cells = new Map();
  for (let t = 0; t < tris; t++) {
    let cx = 0, cy = 0, cz = 0;
    for (let k = 0; k < 3; k++) { const i = v(t, k); cx += pos.getX(i); cy += pos.getY(i); cz += pos.getZ(i); }
    const key = Math.floor(cx / 3 / CHUNK) + ',' + Math.floor(cy / 3 / CHUNK) + ',' + Math.floor(cz / 3 / CHUNK);
    let c = cells.get(key);
    if (!c) cells.set(key, (c = []));
    c.push(v(t, 0), v(t, 1), v(t, 2));
  }
  const out = [], p = new THREE.Vector3();
  for (const list of cells.values()) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', pos);
    g.setIndex(list);
    // bounds of this piece only (computeBoundingBox would read the whole shared buffer)
    const box = new THREE.Box3();
    for (const i of list) box.expandByPoint(p.fromBufferAttribute(pos, i));
    g.boundingBox = box;
    g.boundingSphere = box.getBoundingSphere(new THREE.Sphere());
    out.push(g);
  }
  return out;
}

export class CameraCollider {
  constructor(world) {
    this.proxies = [];
    for (const site of world.sites) {
      site.root.updateMatrixWorld(true);
      site.root.traverse((o) => {
        if (!o.isMesh || o.material.isMeshBasicMaterial) return;
        for (const geo of chunks(o.geometry)) {
          const p = new THREE.Mesh(geo, RAY_MAT);
          // share the live matrix, so the lifting gate and the turning mill blades stay in sync
          p.matrixWorld = o.matrixWorld;
          p.userData.root = site.root;
          this.proxies.push(p);
        }
      });
    }
    this.ray = new THREE.Raycaster();
    this.hits = [];
    this.p = new THREE.Vector3();
    this.s = new THREE.Sphere();
  }

  // the ray is a short segment: Mesh.raycast's own sphere test treats it as infinite
  near(p, from, dir, len) {
    const s = this.s.copy(p.geometry.boundingSphere).applyMatrix4(p.matrixWorld);
    const t = Math.max(0, Math.min(len, this.p.subVectors(s.center, from).dot(dir)));
    return this.p.copy(from).addScaledVector(dir, t).distanceToSquared(s.center) <= s.radius * s.radius;
  }

  // How far from `from`, along the unit vector `dir`, the camera can sit (up to maxD).
  clear(from, dir, maxD) {
    let d = maxD;
    // hills: stop at the last sample above the ground
    for (let i = 1; i <= STEPS; i++) {
      const t = (maxD * i) / STEPS;
      this.p.copy(from).addScaledVector(dir, t);
      if (this.p.y < heightAt(this.p.x, this.p.z) + 0.3) {
        d = (maxD * (i - 1)) / STEPS + PAD;
        break;
      }
    }
    // landmarks (a destroyed coffin's site is detached from the scene and skipped)
    this.ray.set(from, dir);
    this.ray.far = d;
    this.hits.length = 0;
    for (const p of this.proxies) if (p.userData.root.parent && this.near(p, from, dir, d)) p.raycast(this.ray, this.hits);
    for (const h of this.hits) if (h.distance < d) d = h.distance;
    return Math.max(MIN, d - PAD);
  }
}
