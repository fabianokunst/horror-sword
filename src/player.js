import * as THREE from 'three';
import { makeModel, FLASH_MAT } from './characters.js';
import { groundAt, WATER } from './world.js';
import { computeStats, newSave, RANKS } from './progress.js';

// Three-hit combo: rig pose (yaw/pitch of the arm+blade) is interpolated by eased swing progress.
export const COMBO = [
  { dur: 0.3, hitAt: 0.42, dmg: 1, range: 3.2, arc: 0.15, pose: (e) => [0.12, -1.8 + 3.3 * e], twist: (e) => -0.5 + e, vertical: false },
  { dur: 0.3, hitAt: 0.42, dmg: 1, range: 3.2, arc: 0.15, pose: (e) => [0.3, 1.5 - 3.3 * e], twist: (e) => 0.5 - e, vertical: false },
  { dur: 0.46, hitAt: 0.5, dmg: 2.5, range: 3.8, arc: 0.4, pose: (e) => [-1.8 + 3.0 * e, 0.15], twist: () => 0, vertical: true },
];

const lerpAngle = (a, b, t) => {
  let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
};
const easeSwing = (p) => {
  const t = Math.min(1, Math.max(0, (p - 0.12) / 0.5));
  return 1 - (1 - t) ** 3;
};

export class Player {
  constructor(scene) {
    this.m = makeModel('hunter');
    this.m.armR.rotation.order = 'YXZ'; // yaw after pitch: the sword arm sweeps around the body
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
    this.phase = 0;
    this.flash = 0;
    this.onSwing = null;
    this.light = new THREE.PointLight(0x70d8ff, 2.2, 12, 1);
    scene.add(this.light);
  }

  get busy() { return this.dead || !!this.roll; }

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
    this.m.bladeMat?.color.set(rank.color);
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
    if (this.m.spin) this.m.spin.rotation.set(0, 0, 0);
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
    return true;
  }

  hurt(dmg, fx, fz) {
    if (this.dead || this.roll || this.invuln > 0) return false;
    this.hp -= dmg * this.stats.armor;
    this.invuln = 0.6;
    this.flash = 0.12;
    const dx = this.pos.x - fx, dz = this.pos.z - fz, d = Math.hypot(dx, dz) || 1;
    this.vel.x += (dx / d) * 9;
    this.vel.z += (dz / d) * 9;
    if (this.hp <= 0) { this.hp = 0; this.dead = true; this.attack = null; }
    return true;
  }

  heal(n) { this.hp = Math.min(this.maxHp, this.hp + n); }

  update(dt, mv, world, time) {
    const m = this.m, pos = this.pos, vel = this.vel, s = this.stats;
    this.invuln = Math.max(0, this.invuln - dt);
    this.shootCd = Math.max(0, this.shootCd - dt);
    if (this.bolts < s.maxBolts && (this.boltTimer += dt) > s.boltReload) { this.bolts++; this.boltTimer = 0; }

    let tx = 0, tz = 0;
    const moveLen = Math.hypot(mv.x, mv.z);
    if (this.dead) {
      this.deadT += dt;
      m.spin.rotation.x = -Math.min(1, this.deadT * 2.5) * Math.PI / 2;
    } else if (this.roll) {
      const r = this.roll;
      r.t += dt;
      const p = Math.min(1, r.t / r.dur), sp = s.rollSpeed * (1 - p * 0.6);
      tx = r.dx * sp;
      tz = r.dz * sp;
      this.facing = Math.atan2(r.dx, r.dz);
      m.spin.rotation.x = p * Math.PI * 2;
      if (p >= 1) { this.roll = null; m.spin.rotation.x = 0; }
    } else {
      const sprint = mv.sprint && moveLen > 0 && this.stamina > 1 && !this.swimming && !this.attack;
      let speed = (this.swimming ? 3 : sprint ? 10.5 : 6.5) * s.speedMul;
      if (this.attack) speed = 1.5;
      if (moveLen > 0) {
        tx = (mv.x / moveLen) * speed;
        tz = (mv.z / moveLen) * speed;
        if (!this.attack) this.facing = lerpAngle(this.facing, Math.atan2(mv.x, mv.z), 1 - Math.exp(-14 * dt));
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
        pos.y = g;
        vel.y = 0;
        this.grounded = true;
      } else this.grounded = false;
    }

    // --- sword swing: the right arm + blade form one line aimed by the combo pose
    const spine = m.spine, armR = m.armR;
    if (this.attack) {
      const a = this.attack, d = a.def;
      a.t += dt;
      const p = a.t / d.dur, e = easeSwing(p);
      const [rx, ry] = d.pose(e);
      armR.rotation.set(-Math.PI / 2 + rx, ry, 0);
      m.foreR.rotation.x = 0;
      m.handR.rotation.x = 0;
      spine.rotation.y = d.twist(e) * 0.6;
      if (!a.hit && p >= d.hitAt) {
        a.hit = true;
        // listeners get a scaled copy, so buffs can tweak it without touching COMBO
        const dmg = d.dmg * s.swordMul * (a.combo === 2 ? s.finisherMul : 1);
        this.onSwing?.(a.combo, { ...d, dmg, range: d.range * s.rangeMul });
      }
      if (p >= 1) {
        if (this.queued && a.combo < 2 && this.stamina > 0) this.startSwing(a.combo + 1, this.pendingAim);
        else this.attack = null;
      }
    }

    // --- procedural skeletal animation
    const hs = Math.hypot(vel.x, vel.z);
    this.phase += hs * dt * 1.7;
    const amt = Math.min(1, hs / 6);
    const sw = Math.sin(this.phase) * amt * 0.85;
    const knee = (ph) => 0.05 + Math.max(0, Math.sin(ph - 1.2)) * 1.1 * amt;
    m.legL.rotation.x = sw;
    m.legR.rotation.x = -sw;
    m.shinL.rotation.x = knee(this.phase);
    m.shinR.rotation.x = knee(this.phase + Math.PI);
    m.footL.rotation.x = -sw * 0.3;
    m.footR.rotation.x = sw * 0.3;
    m.armL.rotation.set(-sw * 0.8, 0, 0.08);
    m.foreL.rotation.x = -0.25 - amt * 0.35;
    if (!this.grounded && !this.swimming) {
      m.legL.rotation.x = -0.8; m.shinL.rotation.x = 1.0;
      m.legR.rotation.x = 0.3; m.shinR.rotation.x = 0.5;
    }
    if (this.roll) {
      m.legL.rotation.x = m.legR.rotation.x = -1.3;
      m.shinL.rotation.x = m.shinR.rotation.x = 1.9;
      m.armL.rotation.x = -1;
    }
    m.hips.position.y = 0.98 + Math.abs(Math.sin(this.phase)) * 0.05 * amt;
    if (!this.attack) {
      // guard stance: elbow bent, blade pointing forward at hip height
      armR.rotation.set(-0.35 + sw * 0.1, 0, -0.12);
      m.foreR.rotation.x = -0.7;
      m.handR.rotation.x = -0.35;
      spine.rotation.y *= 0.8;
    }
    spine.rotation.x = amt * 0.12;
    m.head.rotation.y = -spine.rotation.y * 0.6;
    m.scarf.rotation.x = 0.25 + hs * 0.09 + Math.sin(time * 9) * 0.08 * (0.3 + amt);

    m.root.position.copy(pos);
    m.root.rotation.y = this.facing;
    m.root.visible = !(this.invuln > 0 && !this.dead && Math.floor(time * 24) % 2 === 0);
    if (this.flash > 0) this.flash -= dt;
    for (const mesh of m.meshes) mesh.material = this.flash > 0 ? FLASH_MAT : mesh.userData.orig;

    const fx = Math.sin(this.facing), fz = Math.cos(this.facing);
    this.light.position.set(pos.x + fx * 0.8, pos.y + 1.9, pos.z + fz * 0.8);
    this.light.intensity = (this.attack ? 3.4 : 2.2) + Math.sin(time * 6) * 0.15;
  }
}
