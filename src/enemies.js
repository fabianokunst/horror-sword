// Creatures of the night: spawning, AI, combat, soul orbs and crossbow bolts.
import * as THREE from 'three';
import { makeModel, FLASH_MAT } from './characters.js';
import { heightAt, groundAt, WATER } from './world.js';
import { basic, glowSprite } from './ps1.js';
import { sfx } from './audio.js';

export const TYPES = {
  ghoul: { model: () => 'ghoul', hp: 3, speed: 3.6, dmg: 10, range: 1.5, windup: 0.4, blood: 0x7cff3a, souls: 1, radius: 0.5 },
  vampire: { model: () => 'vampire' + Math.floor(Math.random() * 3), hp: 4, speed: 5.4, dmg: 14, range: 1.6, windup: 0.32, blood: 0xd0102a, souls: 2, blink: 7, burns: true, radius: 0.45 },
  bat: { model: () => 'bat', hp: 1, speed: 8.5, dmg: 6, range: 1.3, windup: 0.12, blood: 0xb020d0, souls: 1, fly: 2.4, radius: 0.4, scale: 1.4, center: 0 },
  bride: { model: () => 'bride' + Math.floor(Math.random() * 3), hp: 5, speed: 7.5, dmg: 15, range: 1.8, windup: 0.3, blood: 0xff2a6a, souls: 3, fly: 3.6, burns: true, radius: 0.5, center: 1 },
  wolf: { model: () => 'wolf', hp: 6, speed: 8, dmg: 16, range: 1.9, windup: 0.32, blood: 0xc01818, souls: 3, leap: true, radius: 0.6, scale: 1.2 },
  dracula: { model: () => 'dracula', hp: 45, speed: 5.8, dmg: 24, range: 2.6, windup: 0.42, blood: 0xff1030, souls: 15, blink: 3.5, burns: true, boss: true, radius: 0.8, scale: 1.4, name: 'CONDE DRÁCULA' },
};

const ORB_GEO = new THREE.OctahedronGeometry(0.18, 0);
const ORB_MAT = basic(0x80f0ff, 2.2);
const BOLT_GEO = new THREE.BoxGeometry(0.05, 0.05, 0.7);
const BOLT_MAT = basic(0xc0f8ff, 2.5);

// roaming creatures when no campaign chapter is driving the spawns
const DEFAULT_SPAWN = { max: 8, interval: 2.6, night: ['ghoul', 'ghoul', 'vampire', 'vampire', 'bat', 'bat'], day: ['ghoul', 'ghoul', 'wolf'] };

const centerY = (e) => e.pos.y + (e.T.center ?? 1.1 * (e.T.scale || 1));

const lerpAngle = (a, b, t) => {
  let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
};

export class Enemies {
  constructor(scene, fx) {
    this.scene = scene;
    this.fx = fx;
    this.list = [];
    this.orbs = [];
    this.bolts = [];
    this.kills = 0;
    this.souls = 0;
    this.spawnTimer = 3;
    this.boss = null;
    this.onKill = null;
    this.onSoul = null;
    // set by the campaign: difficulty x chapter scaling, elite odds and XP per soul
    this.mods = { hp: 1, dmg: 1, elite: 0, xp: 1 };
  }

  // Scales a fresh creature to the current chapter; some come back as glowing elites.
  applyMods(e) {
    const M = this.mods;
    e.maxHp = e.hp = e.T.hp * M.hp;
    e.dmg = e.T.dmg * M.dmg;
    e.souls = e.T.souls;
    if (!e.T.boss && Math.random() < M.elite) {
      e.elite = true;
      e.maxHp = e.hp *= 2.5;
      e.dmg *= 1.3;
      e.souls *= 3;
      e.speedMul *= 1.1;
      e.m.root.scale.multiplyScalar(1.25);
      const glow = glowSprite(0xff2040, 2.6, 0.5);
      glow.position.y = (e.T.center ?? 1.1 * (e.T.scale || 1)) / e.m.root.scale.y;
      e.m.root.add(glow);
    }
  }

  // Named creatures (guardians, bosses) get their own health bar and can be told to ignore the sun.
  empower(e, { name, hp = 1, scale = 1, shade = false } = {}) {
    e.name = name;
    e.maxHp = e.hp *= hp;
    e.m.root.scale.multiplyScalar(scale);
    if (shade) e.burns = false;
    return e;
  }

  reset() {
    for (const e of this.list) this.scene.remove(e.m.root);
    for (const o of this.orbs) this.scene.remove(o.mesh);
    for (const b of this.bolts) this.scene.remove(b.mesh);
    this.list.length = this.orbs.length = this.bolts.length = 0;
    this.boss = null;
    this.spawnTimer = 3;
  }

  get alive() { return this.list.filter((e) => !e.dying); }

  // random valid spot around (px, pz) inside the valley; null when nothing fits
  spawn(type, px, pz, minD = 38, maxD = 55) {
    const p = this.world?.spawnPoint(px, pz, minD, maxD);
    return p ? this.spawnAt(type, p.x, p.z) : null;
  }

  spawnAt(type, x, z) {
    const T = TYPES[type];
    const m = makeModel(T.model());
    m.root.scale.setScalar(T.scale || 1);
    this.scene.add(m.root);
    const e = {
      type, T, m, hp: T.hp,
      pos: new THREE.Vector3(x, groundAt(x, z) + (T.fly || 0), z),
      kx: 0, kz: 0, facing: 0, phase: Math.random() * 10, cd: 1, atk: -1, struck: false,
      stun: 0, flash: 0, dying: 0, blinkCd: 2 + Math.random() * 4, leapCd: 2, leap: null,
      burn: 0, speedMul: 0.85 + Math.random() * 0.3,
    };
    this.applyMods(e);
    this.list.push(e);
    if (T.boss) this.boss = e;
    return e;
  }

  // --- combat
  damage(e, dmg, dirX, dirZ, knock = 7) {
    if (e.dying) return;
    e.hp -= dmg;
    e.flash = 0.1;
    e.stun = e.T.boss ? 0.08 : 0.28;
    const k = e.T.boss ? knock * 0.25 : knock;
    e.kx = dirX * k;
    e.kz = dirZ * k;
    e.atk = -1;
    const p = e.pos.clone().setY(centerY(e));
    this.fx.burst(p, e.T.blood, 14, { speed: 5, up: 4 });
    this.fx.burst(p, 0xffffff, 3, { speed: 7, up: 2, life: 0.2, size: 0.08 });
    if (e.hp <= 0) this.kill(e);
  }

  kill(e) {
    e.dying = 0.001;
    this.kills++;
    sfx.kill(e.type, e.pos);
    const p = e.pos.clone();
    p.y += 1;
    this.fx.burst(p, e.T.blood, 30, { speed: 6, up: 6, life: 0.9 });
    this.fx.burst(p, 0x200818, 16, { speed: 3, up: 2, gravity: 2, life: 1.2, size: 0.25 });
    for (let i = 0; i < e.souls; i++) this.dropOrb(e.pos.x + (Math.random() - 0.5) * 2, e.pos.z + (Math.random() - 0.5) * 2);
    if (e === this.boss) this.boss = null;
    this.onKill?.(e);
  }

  // Sword arc test from the player's position and facing.
  hitArc(player, def) {
    const fx = Math.sin(player.facing), fz = Math.cos(player.facing);
    let n = 0;
    for (const e of this.list) {
      if (e.dying) continue;
      const dx = e.pos.x - player.pos.x, dz = e.pos.z - player.pos.z, d = Math.hypot(dx, dz) || 0.001;
      if (d > def.range + e.T.radius) continue;
      if (d > 1.2 && (dx * fx + dz * fz) / d < def.arc) continue;
      if (Math.abs(centerY(e) - player.pos.y - 1) > 2.6) continue;
      this.damage(e, def.dmg, dx / d, dz / d, def.vertical ? 10 : 7);
      n++;
    }
    return n;
  }

  fireBolt(from, dir, dmg = 2, pierce = 0) {
    const mesh = new THREE.Mesh(BOLT_GEO, BOLT_MAT);
    mesh.position.copy(from);
    mesh.lookAt(from.clone().add(dir));
    this.scene.add(mesh);
    this.bolts.push({ mesh, dir: dir.clone().normalize(), life: 1.2, dmg, pierce, struck: new Set() });
  }

  dropOrb(x, z) {
    const mesh = new THREE.Mesh(ORB_GEO, ORB_MAT);
    const glow = glowSprite(0x60e0ff, 1.4, 0.6);
    mesh.add(glow);
    const y = Math.max(groundAt(x, z), WATER) + 0.8;
    mesh.position.set(x, y, z);
    this.scene.add(mesh);
    this.orbs.push({ mesh, y, t: Math.random() * 6, life: 30 });
  }

  // Picks the best target for the sword's soft-lock / crossbow auto-aim.
  target(player, aimAngle, maxD, maxAngle) {
    let best = null, bestScore = Infinity;
    for (const e of this.list) {
      if (e.dying) continue;
      const dx = e.pos.x - player.pos.x, dz = e.pos.z - player.pos.z, d = Math.hypot(dx, dz);
      if (d > maxD) continue;
      let da = Math.abs(((Math.atan2(dx, dz) - aimAngle + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
      if (da > maxAngle) continue;
      const score = d + da * 6;
      if (score < bestScore) { bestScore = score; best = e; }
    }
    return best;
  }

  // --- per frame
  update(dt, ctx) {
    const { player, dayAmt, time, world, spawn: S = DEFAULT_SPAWN } = ctx;
    this.world = world;
    const nightAmt = 1 - dayAmt;

    // spawning: the campaign chapter decides who roams, how many and how often
    this.spawnTimer -= dt;
    const alive = this.list.filter((e) => !e.dying).length;
    const max = Math.min(26, Math.floor(1 + nightAmt * S.max));
    if (this.spawnTimer <= 0 && !player.dead) {
      this.spawnTimer = nightAmt > 0.5 ? S.interval : 7;
      if (alive < max) {
        const pool = nightAmt > 0.5 ? S.night : S.day;
        const type = pool[Math.floor(Math.random() * pool.length)];
        const n = type === 'bat' ? 3 : 1;
        for (let i = 0; i < n; i++) this.spawn(type, player.pos.x, player.pos.z);
        if (type === 'wolf' && Math.random() < 0.5) sfx.howl(this.list[this.list.length - 1].pos);
      }
    }

    // separation between creatures
    const L = this.list;
    for (let i = 0; i < L.length; i++)
      for (let j = i + 1; j < L.length; j++) {
        const a = L[i], b = L[j];
        if (a.dying || b.dying) continue;
        const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z, d = Math.hypot(dx, dz), r = a.T.radius + b.T.radius;
        if (d < r && d > 0.001) {
          const p = (r - d) / 2 / d;
          a.pos.x -= dx * p; a.pos.z -= dz * p;
          b.pos.x += dx * p; b.pos.z += dz * p;
        }
      }

    for (let i = L.length - 1; i >= 0; i--) {
      const e = L[i];
      if (this.updateOne(e, dt, player, dayAmt, time, world)) {
        this.scene.remove(e.m.root);
        L.splice(i, 1);
        if (e === this.boss) this.boss = null;
      }
    }
    if (!this.boss) this.boss = L.find((e) => e.name && !e.dying) || null;

    // soul orbs
    for (let i = this.orbs.length - 1; i >= 0; i--) {
      const o = this.orbs[i], p = o.mesh.position;
      o.t += dt;
      o.life -= dt;
      const dx = player.pos.x - p.x, dz = player.pos.z - p.z, dy = player.pos.y + 1 - p.y, d = Math.hypot(dx, dy, dz);
      if (d < player.stats.soulPull && !player.dead) {
        const s = (12 * dt) / Math.max(d, 0.3);
        p.x += dx * s; p.y += dy * s; p.z += dz * s;
      } else p.y = o.y + Math.sin(o.t * 3) * 0.2;
      o.mesh.rotation.y += dt * 3;
      if (d < 0.9 && !player.dead) {
        player.heal(player.stats.soulHeal);
        this.souls++;
        this.onSoul?.(this.mods.xp);
        sfx.pickup();
        this.fx.burst(p, 0x80f0ff, 10, { speed: 3, up: 3, gravity: 0, life: 0.4 });
      }
      if (d < 0.9 || o.life <= 0) {
        this.scene.remove(o.mesh);
        this.orbs.splice(i, 1);
      }
    }

    // crossbow bolts
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const b = this.bolts[i], p = b.mesh.position;
      b.life -= dt;
      const step = 45 * dt;
      let hit = b.life <= 0;
      for (let s = 0; s < 3 && !hit; s++) {
        p.addScaledVector(b.dir, step / 3);
        if (p.y < heightAt(p.x, p.z)) { hit = true; sfx.thunk(p, false); }
        for (const e of L) {
          if (e.dying || b.struck.has(e)) continue;
          if (Math.hypot(e.pos.x - p.x, centerY(e) - p.y, e.pos.z - p.z) < e.T.radius + 0.5) {
            this.damage(e, b.dmg, b.dir.x, b.dir.z, 5);
            b.struck.add(e);
            sfx.thunk(p, true);
            // piercing bolts keep flying through `pierce` more creatures
            if (b.struck.size > b.pierce) { hit = true; break; }
          }
        }
      }
      if (Math.random() < 0.6) this.fx.burst(p, 0x80e8ff, 1, { speed: 0.3, up: 0, gravity: 0, life: 0.25, size: 0.08 });
      if (hit) {
        this.fx.burst(p, 0xc0f8ff, 6, { speed: 3, up: 2, life: 0.3, size: 0.08 });
        this.scene.remove(b.mesh);
        this.bolts.splice(i, 1);
      }
    }
  }

  // returns true when the creature should be removed
  updateOne(e, dt, player, dayAmt, time, world) {
    const T = e.T, m = e.m, pos = e.pos;
    const sc = T.scale || 1;
    if (e.dying) {
      e.dying += dt;
      const k = Math.min(1, e.dying * 3);
      if (T.fly) { pos.y = Math.max(groundAt(pos.x, pos.z), pos.y - dt * 8); m.spin.rotation.z += dt * 10; }
      else m.spin.rotation.x = -k * Math.PI / 2;
      if (e.dying > 0.6) pos.y -= dt * 1.5;
      m.root.position.copy(pos);
      for (const mesh of m.meshes) mesh.material = e.dying < 0.12 ? FLASH_MAT : mesh.userData.orig;
      return e.dying > 1.4;
    }

    const dx = player.pos.x - pos.x, dz = player.pos.z - pos.z, dist = Math.hypot(dx, dz) || 0.001;
    if (dist > 120) return true;
    const ground = groundAt(pos.x, pos.z);

    // sunlight burns the undead
    if ((e.burns ?? T.burns) && dayAmt > 0.55) {
      e.burn += dt;
      e.hp -= dt * (T.boss ? 1.5 : 2.5);
      if (Math.random() < 0.5) this.fx.burst(pos.clone().setY(pos.y + 1), Math.random() < 0.5 ? 0xff8020 : 0xffe040, 2, { speed: 1, up: 4, gravity: 3, life: 0.6 });
      if (Math.random() < dt * 4) sfx.burn(pos);
      if (e.hp <= 0) { this.kill(e); return false; }
    }

    let speed = 0;
    let mx = 0, mz = 0;
    if (e.stun > 0) {
      e.stun -= dt;
    } else if (e.leap) {
      const l = e.leap;
      l.t += dt;
      const p = Math.min(1, l.t / 0.5);
      pos.x = l.x0 + (l.x1 - l.x0) * p;
      pos.z = l.z0 + (l.z1 - l.z0) * p;
      e.leapY = Math.sin(p * Math.PI) * 2.2;
      if (p >= 1) {
        e.leap = null;
        e.leapY = 0;
        if (Math.hypot(player.pos.x - pos.x, player.pos.z - pos.z) < 2.2 && player.hurt(e.dmg, pos.x, pos.z)) this.onPlayerHit?.(e.dmg);
        this.fx.burst(pos.clone().setY(ground + 0.1), 0x6a5a40, 10, { speed: 4, up: 2 });
        e.cd = 1;
      }
    } else if (e.atk >= 0) {
      e.atk += dt;
      if (e.atk >= T.windup && !e.struck) {
        e.struck = true;
        const reach = T.range + 0.8 * sc;
        const dy = Math.abs(player.pos.y + 1 - centerY(e));
        if (dist < reach && dy < 2.5 && player.hurt(e.dmg, pos.x, pos.z)) this.onPlayerHit?.(e.dmg);
        if (T.fly) { e.kx = (-dx / dist) * 10; e.kz = (-dz / dist) * 10; }
      }
      if (e.atk >= T.windup + 0.3) {
        e.atk = -1;
        e.cd = (T.boss ? 0.7 : 0.9) + Math.random() * 0.6;
      }
    } else {
      e.cd -= dt;
      speed = T.speed * e.speedMul;
      mx = dx / dist;
      mz = dz / dist;
      if (T.fly && dist > 7) {
        // circle around the player before swooping in
        const side = Math.sin(time * 0.8 + e.phase) > 0 ? 1 : -1;
        mx += (-dz / dist) * 0.8 * side;
        mz += (dx / dist) * 0.8 * side;
      }
      if (dist < T.range + 0.3 * sc) {
        speed = 0;
        if (e.cd <= 0 && !player.dead) { e.atk = 0; e.struck = false; sfx.attack(e.type, pos); }
      }
      // vampires dissolve into mist and reappear behind the hunter
      if (T.blink && (e.blinkCd -= dt) <= 0 && dist > 6 && dist < 35 && !player.dead) {
        this.fx.burst(pos.clone().setY(pos.y + 1), 0x8a2ad0, 26, { speed: 3, up: 2, gravity: 1, life: 0.8, size: 0.2 });
        const a = player.facing + Math.PI + (Math.random() - 0.5) * 1.4;
        pos.x = player.pos.x + Math.sin(a) * 3.2;
        pos.z = player.pos.z + Math.cos(a) * 3.2;
        this.fx.burst(pos.clone().setY(groundAt(pos.x, pos.z) + 1), 0x8a2ad0, 26, { speed: 3, up: 2, gravity: 1, life: 0.8, size: 0.2 });
        e.blinkCd = T.blink + Math.random() * 4;
        e.cd = 0.35;
        sfx.blink(pos);
        // the count summons bats when he blinks
        if (T.boss) for (let i = 0; i < 3; i++) this.spawn('bat', pos.x, pos.z, 4, 8);
      }
      if (T.leap && (e.leapCd -= dt) <= 0 && dist > 4 && dist < 11) {
        e.leap = { t: 0, x0: pos.x, z0: pos.z, x1: player.pos.x - (dx / dist) * 1.2, z1: player.pos.z - (dz / dist) * 1.2 };
        e.leapCd = 3 + Math.random() * 2;
        sfx.leap(pos);
      }
    }

    const ml = Math.hypot(mx, mz) || 1;
    pos.x += ((mx / ml) * speed + e.kx) * dt;
    pos.z += ((mz / ml) * speed + e.kz) * dt;
    const kd = Math.exp(-8 * dt);
    e.kx *= kd;
    e.kz *= kd;
    if (!T.fly) world.collide(pos, T.radius * 0.8);

    const g = groundAt(pos.x, pos.z);
    if (T.fly) {
      const swoop = e.atk >= 0 || (dist < 7 && e.cd <= 0.2);
      const ty = swoop ? player.pos.y + 1.1 - (T.center || 0) : Math.max(g, WATER) + T.fly + Math.sin(time * 2 + e.phase) * 0.5;
      pos.y += (ty - pos.y) * Math.min(1, dt * 4);
    } else pos.y = g + (e.leapY || 0);

    // --- animation
    const target = Math.atan2(dx, dz);
    e.facing = lerpAngle(e.facing, target, 1 - Math.exp(-10 * dt));
    e.phase += (speed + 1) * dt * 1.6;
    const sw = Math.sin(e.phase) * Math.min(1, speed / 4);
    const amt = Math.min(1, speed / 4);
    if (m.legL) {
      m.legL.rotation.x = sw * 0.8;
      m.legR.rotation.x = -sw * 0.8;
      m.shinL.rotation.x = 0.08 + Math.max(0, Math.sin(e.phase - 1.2)) * amt;
      m.shinR.rotation.x = 0.08 + Math.max(0, Math.sin(e.phase - 1.2 + Math.PI)) * amt;
    }
    // hunched predators, upright aristocrats
    if (m.spine) m.spine.rotation.x = e.type === 'ghoul' ? 0.5 : e.type === 'wolf' ? 0.35 + amt * 0.15 : 0.05;
    if (m.neck) m.neck.rotation.x = e.type === 'ghoul' || e.type === 'wolf' ? -0.35 : 0;
    if (m.foreL) {
      const bend = e.atk >= 0 ? (e.atk < T.windup ? -0.9 : -0.1) : e.type === 'bride' ? -0.6 : -0.35;
      m.foreL.rotation.x = m.foreR.rotation.x = bend;
    }
    if (m.armL) {
      let ax;
      if (e.atk >= 0) ax = e.atk < T.windup ? -0.5 - (e.atk / T.windup) * 2.2 : -1.1;
      else if (e.type === 'ghoul' || e.type === 'wolf') ax = -1.1 + sw * 0.3;
      else if (e.type === 'bride') ax = -0.4 + Math.sin(time * 3 + e.phase) * 0.2;
      else ax = sw * 0.5;
      m.armL.rotation.x = ax + (e.type === 'ghoul' ? sw * 0.2 : 0);
      m.armR.rotation.x = ax - (e.type === 'ghoul' ? sw * 0.2 : 0);
    }
    if (m.wingL) {
      const rate = e.type === 'bat' ? 22 : 9;
      const f = Math.sin(time * rate + e.phase) * (e.type === 'bat' ? 0.9 : 0.5);
      m.wingL.rotation.z = f + (e.type === 'bride' ? 0.2 : 0);
      m.wingR.rotation.z = -f - (e.type === 'bride' ? 0.2 : 0);
    }
    if (m.cape) m.cape.rotation.x = 0.15 + speed * 0.06 + Math.sin(time * 6 + e.phase) * 0.05;
    if (m.cape2) m.cape2.rotation.x = 0.1 + speed * 0.05 + Math.sin(time * 5 + e.phase + 1) * 0.08;
    if (m.wingL2) {
      const f2 = Math.sin(time * (e.type === 'bat' ? 22 : 9) + e.phase - 0.6) * 0.5;
      m.wingL2.rotation.z = f2;
      m.wingR2.rotation.z = -f2;
    }
    if (m.tail) m.tail.rotation.y = Math.sin(time * 8 + e.phase) * 0.4;
    if (m.tail2) m.tail2.rotation.y = Math.sin(time * 8 + e.phase - 0.8) * 0.5;
    if (e.leap) m.spin.rotation.x = -0.6;
    else m.spin.rotation.x = e.type === 'bride' ? 0.35 : 0;

    m.root.position.copy(pos);
    m.root.rotation.y = e.facing;
    if (e.flash > 0) e.flash -= dt;
    for (const mesh of m.meshes) mesh.material = e.flash > 0 ? FLASH_MAT : mesh.userData.orig;
    return false;
  }
}
