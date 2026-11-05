import * as THREE from 'three';
import { makeModel, FLASH_MAT } from './characters.js';
import { groundAt, WATER } from './world.js';
import { computeStats, newSave, RANKS } from './progress.js';
import { HunterAnim } from './hunteranim.js';

// Three-hit combo (the poses live in hunteranim.js): forehand, backhand, overhead slam.
// step: [from, to, m/s], a step forward into the blow between those fractions of the swing.
export const COMBO = [
  { dur: 0.3, hitAt: 0.42, dmg: 1, range: 3.2, arc: 0.15, vertical: false, step: [0.2, 0.5, 3.2] },
  { dur: 0.3, hitAt: 0.42, dmg: 1, range: 3.2, arc: 0.15, vertical: false, step: [0.2, 0.5, 3.2] },
  { dur: 0.46, hitAt: 0.5, dmg: 2.5, range: 3.8, arc: 0.4, vertical: true, step: [0.3, 0.55, 4.5] },
];

// sword damage while the counter window after a perfect dodge is open
export const COUNTER_MUL = 1.75;

const lerpAngle = (a, b, t) => {
  let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
};
export class Player {
  constructor(scene) {
    this.m = makeModel('hunter');
    this.anim = new HunterAnim(this.m);
    this.lockFace = false; // keeping a locked target in front (the guard stays up)
    scene.add(this.m.root);
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.facing = Math.PI;
    this.stats = computeStats(newSave());
    this.rank = RANKS[0];
    this.maxHp = 100;
    this.hp = 100;
    this.stamina = 100;
    this.stDelay = 0;
    this.bolts = 6;
    this.boltTimer = 0;
    this.shootCd = 0;
    this.grounded = true;
    this.swimming = false;
    this.attack = null;
    this.queued = false;
    this.pendingAim = null;
    this.roll = null;
    this.invuln = 0;
    this.dead = false;
    this.deadT = 0;
    this.flash = 0;
    this.counter = 0; // seconds left of the counter window opened by a perfect dodge
    this.stun = 0; // seconds left stunned (see stagger)
    this.onSwing = null;
    // Arte (runes.js): the blade art in progress; onArt fires at the moment it lands
    this.art = null;
    this.onArt = null;
    this.glow = 0; // lantern flare after an Arte
    this.runeColor = null; // the blade glows in the rune's color (null: the rank's)
    this.light = new THREE.PointLight(0x70d8ff, 2.2, 12, 1);
    scene.add(this.light);
  }

  get busy() { return this.dead || !!this.roll || this.stun > 0 || !!this.art; }

  // stunned (a bride's scream): no moving, striking or dodging for a moment
  stagger(t) {
    if (this.dead || this.art) return;
    this.stun = Math.max(this.stun, t);
    this.attack = null;
    this.queued = false;
  }

  // New stats from levels/perks; a higher max HP is granted immediately, not as an empty bar.
  applyStats(stats) {
    const gain = Math.max(0, stats.maxHp - this.maxHp);
    this.stats = stats;
    this.maxHp = stats.maxHp;
    this.hp = Math.min(this.maxHp, this.hp + gain);
    this.stamina = Math.min(this.stamina, stats.maxSt);
    this.bolts = Math.min(this.bolts + Math.max(0, stats.maxBolts - this.bolts), stats.maxBolts);
  }

  setRank(rank) {
    this.rank = rank;
    this.light.color.set(rank.color);
    this.m.bladeMat?.color.set(this.runeColor ?? rank.color);
  }

  // the rune set in the blade (runes.js); runes glow brighter than the bare rank color
  setRuneColor(c) {
    this.runeColor = c;
    if (c == null) this.m.bladeMat?.color.set(this.rank.color);
    else this.m.bladeMat?.color.set(c).multiplyScalar(1.8);
  }

  // Arte: 'slam' leaps and drives the blade into the ground, 'spin' whirls around with the arm out.
  // The hunter can't be hurt or stunned while it plays; it can cut a combo short but not a roll.
  startArt(move) {
    if (this.busy) return false;
    const spin = move === 'spin';
    this.art = { t: 0, move, dur: spin ? 0.62 : 0.78, hitAt: spin ? 0.3 : 0.48, fired: false, f0: this.facing };
    this.attack = null;
    this.queued = false;
    if (!spin && this.grounded && !this.swimming) { this.vel.y = 5.5; this.grounded = false; }
    return true;
  }

  // Back on your feet at a checkpoint: full health, no lingering action state.
  reset() {
    this.hp = this.maxHp;
    this.stamina = this.stats.maxSt;
    this.bolts = this.stats.maxBolts;
    this.vel.set(0, 0, 0);
    this.attack = this.roll = null;
    this.queued = false;
    this.invuln = 1.5;
    this.dead = false;
    this.deadT = 0;
    this.flash = 0;
    this.counter = 0;
    this.stun = 0;
    this.art = null;
    this.glow = 0;
    this.anim.reset();
  }

  // A blow dodged at the last instant: stamina back and a window of stronger sword hits.
  perfectDodge(window) {
    this.counter = window;
    this.stamina = Math.min(this.stats.maxSt, this.stamina + 25);
  }

  tryAttack(aim) {
    if (this.busy) return;
    if (!this.attack) {
      if (this.stamina < 6) return;
      this.startSwing(0, aim);
    } else if (this.attack.combo < 2 && this.attack.t > this.attack.def.dur * 0.3) {
      this.queued = true;
      this.pendingAim = aim;
    }
  }

  startSwing(i, aim) {
    this.attack = { combo: i, def: COMBO[i], t: 0, hit: false };
    this.stamina -= i === 2 ? 14 : 8;
    this.stDelay = 0.6;
    if (aim != null) this.facing = aim;
    this.queued = false;
  }

  tryRoll(dx, dz) {
    const cost = this.stats.rollCost;
    if (this.busy || this.stamina < cost) return false;
    let len = Math.hypot(dx, dz);
    if (len < 0.01) { dx = -Math.sin(this.facing); dz = -Math.cos(this.facing); len = 1; }
    this.roll = { t: 0, dur: 0.42, dx: dx / len, dz: dz / len };
    this.attack = null;
    this.queued = false;
    this.stamina -= cost;
    this.stDelay = 0.6;
    return true;
  }

  tryShoot() {
    if (this.busy || this.bolts <= 0 || this.shootCd > 0) return false;
    this.bolts--;
    this.shootCd = 0.22;
    this.anim.shoot();
    return true;
  }

  hurt(dmg, fx, fz) {
    if (this.dead || this.roll || this.art || this.invuln > 0) return false;
    this.hp -= dmg * this.stats.armor;
    this.invuln = 0.6;
    this.flash = 0.12;
    const dx = this.pos.x - fx, dz = this.pos.z - fz, d = Math.hypot(dx, dz) || 1;
    this.vel.x += (dx / d) * 9;
    this.vel.z += (dz / d) * 9;
    this.anim.hurt(dx, dz, this.facing);
    if (this.hp <= 0) { this.hp = 0; this.dead = true; this.attack = null; }
    return true;
  }

  heal(n) { this.hp = Math.min(this.maxHp, this.hp + n); }

  update(dt, mv, world, time) {
    const m = this.m, pos = this.pos, vel = this.vel, s = this.stats;
    this.invuln = Math.max(0, this.invuln - dt);
    this.shootCd = Math.max(0, this.shootCd - dt);
    this.counter = Math.max(0, this.counter - dt);
    this.stun = Math.max(0, this.stun - dt);
    if (this.bolts < s.maxBolts && (this.boltTimer += dt) > s.boltReload) { this.bolts++; this.boltTimer = 0; }

    let tx = 0, tz = 0;
    const moveLen = Math.hypot(mv.x, mv.z);
    this.lockFace = false;
    if (this.dead) {
      this.deadT += dt;
    } else if (this.roll) {
      const r = this.roll;
      r.t += dt;
      const p = Math.min(1, r.t / r.dur), sp = s.rollSpeed * (1 - p * 0.6);
      tx = r.dx * sp;
      tz = r.dz * sp;
      this.facing = Math.atan2(r.dx, r.dz);
      if (p >= 1) this.roll = null;
    } else if (this.stun > 0) {
      // stunned: reels in place (hunteranim.js)
    } else if (this.art) {
      // an Arte roots the hunter where it started (the slam's leap is set in startArt)
    } else {
      const sprint = mv.sprint && moveLen > 0 && this.stamina > 1 && !this.swimming && !this.attack;
      let speed = (this.swimming ? 3 : sprint ? 10.5 : 6.5) * s.speedMul;
      if (this.attack) speed = 1.5;
      // mv.face: a locked target the hunter keeps facing while walking (sprinting breaks it)
      const face = sprint ? null : mv.face ?? null;
      this.lockFace = face != null;
      if (moveLen > 0) {
        tx = (mv.x / moveLen) * speed;
        tz = (mv.z / moveLen) * speed;
        if (!this.attack) this.facing = lerpAngle(this.facing, face ?? Math.atan2(mv.x, mv.z), 1 - Math.exp(-14 * dt));
      } else if (face != null && !this.attack) this.facing = lerpAngle(this.facing, face, 1 - Math.exp(-10 * dt));
      if (this.attack) {
        // each swing steps into the blow
        const a = this.attack, [s0, s1, v] = a.def.step, k = (a.t / a.def.dur - s0) / (s1 - s0);
        if (k > 0 && k < 1) {
          const push = v * Math.sin(k * Math.PI);
          tx += Math.sin(this.facing) * push;
          tz += Math.cos(this.facing) * push;
        }
      }
      if (sprint) { this.stamina -= 20 * dt; this.stDelay = 0.4; }
      if (mv.jump && this.grounded && !this.swimming && !this.attack) { vel.y = 8.5; this.grounded = false; }
    }
    if ((this.stDelay -= dt) <= 0) this.stamina = Math.min(s.maxSt, this.stamina + s.stRegen * dt);

    const k = 1 - Math.exp(-14 * dt);
    vel.x += (tx - vel.x) * k;
    vel.z += (tz - vel.z) * k;
    pos.x += vel.x * dt;
    pos.z += vel.z * dt;
    world.collide(pos, 0.4);

    const g = groundAt(pos.x, pos.z);
    this.swimming = g < WATER - 1.1;
    if (this.swimming) {
      pos.y += (WATER - 1.2 - pos.y) * Math.min(1, dt * 6);
      vel.y = 0;
      this.grounded = true;
    } else {
      vel.y -= 26 * dt;
      pos.y += vel.y * dt;
      if (pos.y <= g || (this.grounded && vel.y <= 0 && pos.y - g < 0.7)) {
        if (!this.grounded && vel.y < -3) this.anim.landed(-vel.y); // knees soak up the fall
        pos.y = g;
        vel.y = 0;
        this.grounded = true;
      } else this.grounded = false;
    }

    // --- sword swing: timing and the blow (the body's poses are in hunteranim.js)
    if (this.attack) {
      const a = this.attack, d = a.def;
      a.t += dt;
      const p = a.t / d.dur;
      if (!a.hit && p >= d.hitAt) {
        a.hit = true;
        // listeners get a scaled copy, so buffs can tweak it without touching COMBO
        const counter = this.counter > 0;
        const dmg = d.dmg * s.swordMul * (a.combo === 2 ? s.finisherMul : 1) * (counter ? COUNTER_MUL : 1);
        this.onSwing?.(a.combo, { ...d, dmg, range: d.range * s.rangeMul, counter });
      }
      if (p >= 1) {
        if (this.queued && a.combo < 2 && this.stamina > 0) this.startSwing(a.combo + 1, this.pendingAim);
        else this.attack = null;
      }
    }

    // --- Arte: the moment it lands (runes.js does the rest); the spin turns the whole body once
    const art = this.art;
    if (art) {
      art.t += dt;
      if (art.move === 'spin') this.facing = art.f0 + Math.PI * 2 * Math.min(1, Math.max(0, (art.t - 0.06) / 0.44));
      if (!art.fired && art.t >= art.hitAt) {
        art.fired = true;
        this.glow = 1;
        this.onArt?.(art.move);
      }
      if (art.t >= art.dur) this.art = null;
    }

    // --- the body: root placed first so the blade trail reads this frame's hand (hunteranim.js)
    m.root.position.copy(pos);
    m.root.rotation.y = this.facing;
    this.anim.update(dt, time, this);
    m.root.visible = !(this.invuln > 0 && !this.dead && Math.floor(time * 24) % 2 === 0);
    if (this.flash > 0) this.flash -= dt;
    for (const mesh of m.meshes) mesh.material = this.flash > 0 ? FLASH_MAT : mesh.userData.orig;

    const fx = Math.sin(this.facing), fz = Math.cos(this.facing);
    this.light.position.set(pos.x + fx * 0.8, pos.y + 1.9, pos.z + fz * 0.8);
    this.light.intensity = (this.attack ? 3.4 : 2.2) + Math.sin(time * 6) * 0.15 + this.glow * 8;
    this.glow = Math.max(0, this.glow - dt * 2.5);
  }
}
