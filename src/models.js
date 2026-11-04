// Box/cylinder authoring helpers for landmarks and rigid props. Parts are authored as colored
// primitives and then baked into one vertex-colored mesh per group, so each costs few draw calls.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ps1 } from './ps1.js';

export const CHAR_MAT = ps1(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }), 0.28);
export const CHAR_GLOW = ps1(new THREE.MeshBasicMaterial({ vertexColors: true }));

const geoCache = new Map();
function cached(key, make) {
  let g = geoCache.get(key);
  if (!g) geoCache.set(key, (g = make()));
  return g;
}

function part(parent, geo, color, x, y, z, o = {}) {
  const m = new THREE.Mesh(geo);
  m.position.set(x, y, z);
  m.rotation.set(o.rx || 0, o.ry || 0, o.rz || 0);
  if (o.s) m.scale.set(o.s[0], o.s[1], o.s[2]);
  m.userData.color = new THREE.Color(color).multiplyScalar(o.glow || 1);
  m.userData.glow = !!o.glow;
  parent.add(m);
  return m;
}

export const box = (p, w, h, d, color, x, y, z, o) =>
  part(p, cached(`b${w},${h},${d}`, () => new THREE.BoxGeometry(w, h, d)), color, x, y, z, o);

export const cyl = (p, rt, rb, h, seg, color, x, y, z, o) =>
  part(p, cached(`c${rt},${rb},${h},${seg}`, () => new THREE.CylinderGeometry(rt, rb, h, seg)), color, x, y, z, o);

// Triangular prism (gable/pediment): base width w at yBase, apex h above it, depth d along z.
export const gable = (p, w, h, d, color, x, yBase, z, o = {}) =>
  part(p, cached('gable', () => new THREE.CylinderGeometry(1, 1, 1, 3)), color, x, yBase + h / 3, z,
    { ...o, rx: -Math.PI / 2, s: [w / 1.732, d, h / 1.5] });

export function group(parent, name, x = 0, y = 0, z = 0) {
  const g = new THREE.Group();
  g.name = name;
  g.position.set(x, y, z);
  parent.add(g);
  return g;
}

export function bake(root, solidMat = CHAR_MAT, glowMat = CHAR_GLOW, shadows = true, receive = false) {
  const holders = [];
  root.traverse((o) => { if (!o.isMesh) holders.push(o); });
  for (const g of holders) {
    const meshes = g.children.filter((c) => c.isMesh);
    if (!meshes.length) continue;
    const buckets = { solid: [], glow: [] };
    for (const m of meshes) {
      m.updateMatrix();
      const geo = m.geometry.clone().applyMatrix4(m.matrix);
      const n = geo.attributes.position.count;
      const c = m.userData.color;
      const arr = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
      geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
      buckets[m.userData.glow ? 'glow' : 'solid'].push(geo);
      g.remove(m);
    }
    for (const k of ['solid', 'glow']) {
      if (!buckets[k].length) continue;
      const mesh = new THREE.Mesh(mergeGeometries(buckets[k]), k === 'glow' ? glowMat : solidMat);
      mesh.castShadow = shadows && k === 'solid';
      mesh.receiveShadow = receive && k === 'solid';
      g.add(mesh);
      buckets[k].forEach((geo) => geo.dispose());
    }
  }
  return root;
}
