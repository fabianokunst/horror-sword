// Target lock: R (touch: the ALVO button) pins the camera, the sword and the crossbow on one creature.
// While locked, a quick sideways flick of the mouse (or a swipe on the camera side of a touch screen)
// jumps to the next creature on that side; a kill hands the lock to the nearest creature still standing.
import * as THREE from 'three';
import { sfx } from './audio.js';

const RANGE = 28; // how far a new lock reaches (m)
const KEEP = 34; // a locked creature further than this is let go
const NEXT = 12; // after a kill, the lock moves to a creature this close
const FLICK = 70; // look input (px, decaying) that switches target

const flat = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

// a small downward chevron, white on a dark outline, tinted by the sprite color (the hunter's rank)
function markerTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 16;
  const g = c.getContext('2d');
  const tri = (x0, x1, y0, y1, color) => {
    g.fillStyle = color;
    g.beginPath();
    g.moveTo(x0, y0);
    g.lineTo(x1, y0);
    g.lineTo(8, y1);
    g.closePath();
    g.fill();
  };
  tri(1, 15, 2, 15, '#000');
  tri(4, 12, 4, 11, '#fff');
  const t = new THREE.CanvasTexture(c);
  t.magFilter = t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  return t;
}

export class LockOn {
  constructor(scene) {
    this.target = null;
    this.flick = 0;
    this.marker = new THREE.Sprite(new THREE.SpriteMaterial({
      map: markerTexture(), transparent: true, depthTest: false, depthWrite: false, fog: false,
    }));
    this.marker.scale.setScalar(0.5);
    this.marker.renderOrder = 999;
    this.marker.visible = false;
    scene.add(this.marker);
    this.btn = null; // the touch button, lit while a lock is held
  }

  // R / ALVO: lock the creature the camera points at (or the closest one), or let go
  toggle(player, enemies, camAim) {
    if (this.target) return this.release(true);
    const t = enemies.target(player, camAim, RANGE, 1.2) || this.nearest(player, enemies, 14);
    if (!t) return sfx.deny();
    this.target = t;
    this.flick = 0;
    sfx.lock(true);
  }

  release(sound = false) {
    if (sound && this.target) sfx.lock(false);
    this.target = null;
    this.marker.visible = false;
  }

  nearest(player, enemies, maxD, skip = null) {
    let best = null, bd = maxD;
    for (const e of enemies.list) {
      if (e.dying || e === skip) continue;
      const d = flat(e.pos, player.pos);
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }

  // the next creature to the right (dir 1) or left (-1) of the current one, as seen by the camera
  switchSide(dir, player, enemies, camYaw) {
    const cur = this.target;
    const rx = Math.cos(camYaw), rz = -Math.sin(camYaw); // camera right vector
    const fx = -Math.sin(camYaw), fz = -Math.cos(camYaw); // camera forward
    let best = null, bs = Infinity;
    for (const e of enemies.list) {
      if (e.dying || e === cur || flat(e.pos, player.pos) > RANGE) continue;
      const side = (e.pos.x - cur.pos.x) * rx + (e.pos.z - cur.pos.z) * rz;
      if (side * dir <= 0.3) continue;
      if ((e.pos.x - player.pos.x) * fx + (e.pos.z - player.pos.z) * fz < -3) continue; // well behind the hunter
      const score = Math.abs(side) + flat(e.pos, cur.pos) * 0.3;
      if (score < bs) { bs = score; best = e; }
    }
    if (best) {
      this.target = best;
      sfx.lock(true);
    }
  }

  // camera yaw that looks past the hunter at the target (main.js eases toward it)
  yaw(player) {
    const t = this.target;
    return Math.atan2(-(t.pos.x - player.pos.x), -(t.pos.z - player.pos.z));
  }

  // where the target's body is, for the camera framing and the crossbow
  center(out) {
    const t = this.target;
    return out.set(t.pos.x, t.pos.y + (t.T.center ?? 1.1 * (t.T.scale || 1)), t.pos.z);
  }

  update(dt, { player, enemies, lookDx, camYaw, color, time }) {
    let t = this.target;
    if (t && (player.dead || !enemies.list.includes(t) || flat(t.pos, player.pos) > KEEP || t.dying)) {
      // a kill passes the lock on to the next creature close by; anything else ends it
      t = this.target = t.dying && !player.dead ? this.nearest(player, enemies, NEXT, t) : null;
      this.flick = 0;
    }
    this.btn?.classList.toggle('on', !!t);
    if (!t) {
      this.marker.visible = false;
      return;
    }
    this.flick = this.flick * Math.exp(-8 * dt) + lookDx;
    if (Math.abs(this.flick) > FLICK) {
      this.switchSide(Math.sign(this.flick), player, enemies, camYaw);
      this.flick = 0;
      t = this.target;
    }
    // the chevron floats over the head (bats: over the body)
    const s = t.m.root.scale.y;
    this.marker.position.set(t.pos.x, t.pos.y + (t.T.center === 0 ? 0.55 : 2.1) * s + 0.3 + Math.sin(time * 5) * 0.06, t.pos.z);
    this.marker.material.color.set(color);
    this.marker.visible = true;
  }
}
