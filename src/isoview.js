// Isometric view (Configurações → Controles → Perspectiva): an orthographic camera high above the hunter at the
// true isometric angle. The mouse, the right stick and the right thumb still turn it around him; it doesn't tilt.
// - Walls, roofs, trees and hills between the camera and the hunter would hide him, so wherever something stands
//   in front of him his silhouette shows through it, in a checker dither of his rank's color. The silhouette is a
//   twin of each of his meshes drawn right before him: it only lands where the scene is already closer to the
//   camera than he is, and where he is in plain sight he is drawn over it.
// - The mist (fog.js) is measured from a point just behind his head instead of from the far-away camera, so the
//   picture is as misty as from over his shoulder.
import * as THREE from 'three';
import { FOG_EYE } from './fog.js';

export const ISO_PITCH = Math.atan(Math.SQRT1_2); // 35.26°: the three world axes look equally foreshortened
const DIST = 50; // camera distance; an orthographic picture doesn't change with it, it only has to stay above roofs and trees
const HALF = 7.5; // half the picture's height in meters (landscape)
const HALF_W = 6.5; // portrait: at least this much on each side of the hunter...
const HALF_MAX = 14; // ...up to this
const EYE = 5.4; // the mist is measured from this far behind his head (like the third-person camera)
const LIFT = 0.5; // the silhouette needs something at least this much closer than him (not his feet in a slope)

const back = new THREE.Vector3();

export class IsoView {
  constructor(player) {
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 400);
    this.player = player;
    this.on = false;
    const mat = (this.mat = new THREE.MeshBasicMaterial({ fog: false, depthWrite: false, depthFunc: THREE.GreaterDepth }));
    mat.onBeforeCompile = (s) => {
      // pulled toward the camera in view space: an orthographic projection keeps it on the same pixels
      s.vertexShader = s.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>
        gl_Position = projectionMatrix * (mvPosition + vec4(0.0, 0.0, ${LIFT.toFixed(2)}, 0.0));`);
      s.fragmentShader = s.fragmentShader.replace('void main() {', `void main() {
        if (mod(floor(gl_FragCoord.x) + floor(gl_FragCoord.y), 2.0) > 0.5) discard;`);
    };
    mat.customProgramCacheKey = () => 'hs-xray';
    // each twin rides inside its mesh (same transform; a skinned one shares the skeleton), so it follows every pose
    // and the invulnerability flicker without any bookkeeping
    this.twins = player.m.meshes.map((mesh) => {
      let t;
      if (mesh.isSkinnedMesh) {
        t = new THREE.SkinnedMesh(mesh.geometry, mat);
        t.bind(mesh.skeleton, mesh.bindMatrix);
      } else t = new THREE.Mesh(mesh.geometry, mat);
      t.frustumCulled = false;
      t.renderOrder = 1;
      t.visible = false;
      mesh.add(t);
      return t;
    });
  }

  // the nearest diagonal heading: streets and walls run corner to corner, like a classic isometric map
  static diagonal(yaw) {
    const q = Math.PI / 2;
    return Math.round((yaw - q / 2) / q) * q + q / 2;
  }

  enable(on) {
    this.on = on;
    FOG_EYE.w = on ? 1 : 0;
    for (const t of this.twins) t.visible = on;
    // the hunter after his silhouette, everything else before it
    for (const m of this.player.m.meshes) m.renderOrder = on ? 2 : 0;
  }

  resize(aspect) {
    const c = this.camera, h = Math.min(HALF_MAX, Math.max(HALF, HALF_W / aspect));
    c.top = h;
    c.bottom = -h;
    c.right = h * aspect;
    c.left = -h * aspect;
    c.updateProjectionMatrix();
  }

  // looks at `target` from the `yaw` side (same convention as the third-person camera)
  place(target, yaw, shake, color) {
    const c = this.camera, h = Math.cos(ISO_PITCH);
    back.set(Math.sin(yaw) * h, Math.sin(ISO_PITCH), Math.cos(yaw) * h);
    c.position.copy(target).addScaledVector(back, DIST);
    c.lookAt(target);
    // turning an orthographic camera barely shows, so a shake moves the whole picture
    if (shake) c.position.add(back.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(shake));
    FOG_EYE.x = target.x + Math.sin(yaw) * h * EYE;
    FOG_EYE.y = target.y + Math.sin(ISO_PITCH) * EYE;
    FOG_EYE.z = target.z + Math.cos(yaw) * h * EYE;
    this.mat.color.set(color);
  }
}
