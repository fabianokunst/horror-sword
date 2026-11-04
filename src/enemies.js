// Creatures of the night: spawning, AI, combat, soul orbs and crossbow bolts.
import * as THREE from 'three';
import { makeModel, FLASH_MAT } from './characters.js';
import { heightAt, groundAt, WATER } from './world.js';
import { basic, glowSprite } from './ps1.js';
import { sfx } from './audio.js';
import { NavGrid } from './nav.js';

export const TYPES = {
  ghoul: { model: () => 'ghoul', hp: 3, speed: 3.6, dmg: 10, range: 1.5, windup: 0.4, blood: 0x7cff3a, souls: 1, radius: 0.5 },
  // lunge: a telegraphed dash from mid range
  vampire: { model: () => 'vampire' + Math.floor(Math.random() * 3), hp: 4, speed: 5.4, dmg: 14, range: 1.6, windup: 0.32, blood: 0xd0102a, souls: 2, blink: 7, lunge: true, burns: true, radius: 0.45 },
  bat: { model: () => 'bat', hp: 1, speed: 8.5, dmg: 6, range: 1.3, windup: 0.12, blood: 0xb020d0, souls: 1, fly: 2.4, radius: 0.4, scale: 1.4, center: 0 },
  // scream: stuns a hunter close by who doesn't dodge it
  bride: { model: () => 'bride' + Math.floor(Math.random() * 3), hp: 5, speed: 7.5, dmg: 15, range: 1.8, windup: 0.3, blood: 0xff2a6a, souls: 3, fly: 3.6, scream: true, burns: true, radius: 0.5, center: 1 },
  // ranged: keeps 8-13 m away, hexes with homing green orbs and flees when the hunter closes in
  witch: { model: () => 'witch', hp: 4, speed: 4.6, dmg: 12, range: 1.4, windup: 0.45, blood: 0x60ff90, souls: 2, ranged: true, burns: true, radius: 0.45 },
  wolf: { model: () => 'wolf', hp: 6, speed: 8, dmg: 16, range: 1.9, windup: 0.32, blood: 0xc01818, souls: 3, leap: true, radius: 0.6, scale: 1.2 },
  dracula: { model: () => 'dracula', hp: 45, speed: 5.8, dmg: 24, range: 2.6, windup: 0.42, blood: 0xff1030, souls: 15, blink: 3.5, burns: true, boss: true, radius: 0.8, scale: 1.4, name: 'CONDE DRÁCULA' },
};

const ORB_GEO = new THREE.OctahedronGeometry(0.18, 0);
const ORB_MAT = basic(0x80f0ff, 2.2);
const BOLT_GEO = new THREE.BoxGeometry(0.05, 0.05, 0.7);
const BOLT_MAT = basic(0xc0f8ff, 2.5);

// Telegraphs: when a strike (or a werewolf pounce) starts winding up, the body flashes red for an instant
// and a red glint burns in the eyes until the blow lands, so the dodge can be read, not only heard.
const TELL_MAT = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 0.3, 0.18) });
const TELL_FLASH = 0.09;
const CROUCH = 0.35; // werewolves crouch this long before pouncing
// A roll that starts this close to the moment a blow lands is a perfect dodge (see strike()).
const PERFECT = 0.25;
// mist-blink: angles tried around "right behind the hunter", nearest first
const BLINK_OFFSETS = [0, 0.6, -0.6, 1.2, -1.2, 1.8, -1.8, 2.4, -2.4];

// Count Dracula fights in three phases, entered below these fractions of his health (see bossPhase):
// 2 — mist and blood: fans of blood orbs between his strikes; 3 — fury: faster, double strikes, more blinks.
const BOSS_PHASES = [0.66, 0.33];
const SHIELD = 1.6; // seconds he is untouchable while changing
const CAST = 0.65; // blood-orb windup (the eyes glint as for a strike)
const SHOT_GEO = new THREE.OctahedronGeometry(0.22, 0);
const SHOT_MAT = basic(0xff1a30, 2.2);
const SHOT_SPEED = 13;
const SHOT_DMG = 0.6; // of his strike damage
const HEX_MAT = basic(0x60ff90, 2.2);
const LUNGE = { prep: 0.42, dur: 0.32, speed: 19 }; // vampire dash
const SCREAM = { prep: 0.55, radius: 6.5, stun: 0.7, dmg: 0.4 }; // bride scream

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
    this.onPerfectDodge = null;
    this.onBossPhase = null; // (boss, phase 2 | 3)
    this.shots = []; // the Count's blood orbs
    // set by the campaign: difficulty x chapter scaling, elite odds, XP per soul and how many creatures
    // may attack at once (the rest circle the hunter and wait their turn)
    this.mods = { hp: 1, dmg: 1, elite: 0, xp: 1, attackers: 3 };
    this.attackers = 0;
    // < 1 slows the creatures only (the slow motion after a perfect dodge); bolts and souls keep full speed
    this.timeScale = 1;
    this.clock = 0;
    this.nav = null; // ground navigation around the hunter (nav.js), built on the first update
    this.flowDir = { x: 0, z: 0 };
    this.tmpV = new THREE.Vector3();
    this.onStagger = null;
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

  // a creature leaves the scene: its cloned skeleton owns a bone texture on the GPU, free it
  discard(e) {
    this.scene.remove(e.m.root);
    for (const mesh of e.m.meshes) mesh.skeleton?.dispose();
  }

  reset() {
    for (const e of this.list) this.discard(e);
    for (const o of this.orbs) this.scene.remove(o.mesh);
    for (const b of this.bolts) this.scene.remove(b.mesh);
    for (const s of this.shots) this.scene.remove(s.mesh);
    this.list.length = this.orbs.length = this.bolts.length = this.shots.length = 0;
    this.boss = null;
    this.spawnTimer = 3;
  }

  get alive() { return this.list.filter((e) => !e.dying); } // allocates: avoid in per-frame code

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
      stun: 0, flash: 0, dying: 0, blinkCd: 2 + Math.random() * 4, leapCd: 2, leap: null, crouch: 0,
      burn: 0, speedMul: 0.85 + Math.random() * 0.3, tell: 0, side: Math.random() < 0.5 ? 1 : -1,
      navT: Math.random() * 0.15, hidden: false, pathing: false, // line-of-sight check timer / result
      // special moves: cast (boss orbs, witch hex), prep (vampire lunge / bride scream windup), dash
      cast: 0, castCd: 2 + Math.random() * 2, prep: 0, prepKind: '', dash: null,
      lungeCd: 2 + Math.random() * 3, screamCd: 3 + Math.random() * 3,
    };
    // the eye glint, parented to the head (bats: the body) so it follows the animation
    e.glint = glowSprite(0xff3a1a, 1, 0.95);
    e.glint.visible = false;
    if (m.head) { m.head.add(e.glint); e.glint.position.set(0, 0.11, 0.17); }
    else if (m.body) { m.body.add(e.glint); e.glint.position.set(0, 0.06, 0.36); }
    else { m.root.add(e.glint); e.glint.position.y = T.center ?? 1.6; }
    this.applyMods(e);
    if (T.boss) Object.assign(e, { stage: 1, shield: 0, cast: 0, castCd: 2.5, second: false });
    this.list.push(e);
    if (T.boss) this.boss = e;
    return e;
  }

  // The Count crosses into his next phase: a moment of mist (untouchable), bats, and new tricks.
  // One phase per hit, so a huge blow can't skip the second one.
  bossPhase(e) {
    const f = e.hp / e.maxHp;
    const want = f < BOSS_PHASES[1] ? 3 : f < BOSS_PHASES[0] ? 2 : 1;
    if (want <= e.stage) return;
    e.stage++;
    if (e.stage === 2) e.hp = Math.max(e.hp, e.maxHp * BOSS_PHASES[1] + 0.01);
    else e.hp = Math.max(e.hp, e.maxHp * 0.08); // the fury always gets its moment
    Object.assign(e, { shield: SHIELD, atk: -1, cast: 0, stun: 0, second: false, castCd: 1.2 });
    const p = e.pos.clone().setY(e.pos.y + 1.2);
    this.fx.burst(p, 0x8a2ad0, 50, { speed: 6, up: 4, gravity: 1, life: 1.2, size: 0.3 });
    this.fx.burst(p, 0xff1030, 30, { speed: 8, up: 5, life: 0.9, size: 0.18 });
    for (let i = 0; i < (e.stage === 2 ? 4 : 3); i++) this.spawn('bat', e.pos.x, e.pos.z, 4, 9);
    if (e.stage === 3) {
      e.speedMul *= 1.3;
      e.windup = 0.36;
      e.blinkBase = 2.2;
      const aura = glowSprite(0xff1030, 2.2, 0.5);
      aura.position.y = 1.3;
      e.m.root.add(aura);
      this.spawn('bride', e.pos.x, e.pos.z, 6, 12);
    }
    this.onBossPhase?.(e, e.stage);
  }

  // a fan of blood orbs aimed at the hunter (3 in the second phase, 5 in the third)
  fireFan(e, player) {
    const n = e.stage >= 3 ? 5 : 3, spread = 0.22;
    const from = e.pos.clone().setY(centerY(e) + 0.3);
    const tx = player.pos.x - from.x, tz = player.pos.z - from.z, flat = Math.hypot(tx, tz) || 1;
    const base = Math.atan2(tx, tz), rise = (player.pos.y + 1 - from.y) / flat;
    for (let i = 0; i < n; i++) {
      const a = base + (i - (n - 1) / 2) * spread;
      const mesh = new THREE.Mesh(SHOT_GEO, SHOT_MAT);
      mesh.add(glowSprite(0xff2030, 1.6, 0.7));
      mesh.position.copy(from);
      this.scene.add(mesh);
      this.shots.push({ mesh, vel: new THREE.Vector3(Math.sin(a), rise, Math.cos(a)).normalize().multiplyScalar(SHOT_SPEED), life: 3, owner: e, hit: false, dmgMul: SHOT_DMG, homing: 0, color: 0xff1030 });
    }
    sfx.bloodShot(from);
  }

  // --- combat
  damage(e, dmg, dirX, dirZ, knock = 7) {
    if (e.dying) return;
    if (e.shield > 0) {
      // changing phase: blows glance off the mist
      this.fx.burst(e.pos.clone().setY(centerY(e)), 0xc0a0ff, 6, { speed: 4, up: 2, life: 0.25, size: 0.08 });
      return;
    }
    e.hp -= dmg;
    if (e.T.boss) this.bossPhase(e);
    e.flash = 0.1;
    e.stun = e.T.boss ? 0.08 : 0.28;
    const k = e.T.boss ? knock * 0.25 : knock;
    e.kx = dirX * k;
    e.kz = dirZ * k;
    e.atk = -1;
    e.crouch = 0; // a hit interrupts a werewolf about to pounce...
    if (!e.T.boss) { e.prep = 0; e.cast = 0; e.dash = null; } // ...a lunge, a scream or a hex
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

  // A blow lands. If the hunter rolled in the last instant (and was close enough to have been hit),
  // it is a perfect dodge: no damage, and main.js answers with slow motion and a counter window.
  // returns 'perfect', 'hit' or 'miss'
  strike(e, player, inReach, nearMiss, dmg = e.dmg) {
    const r = player.roll;
    if (r && !r.perfect && r.t < PERFECT && (inReach || nearMiss)) {
      r.perfect = true;
      this.onPerfectDodge?.(e);
      return 'perfect';
    }
    if (inReach && player.hurt(dmg, e.pos.x, e.pos.z)) {
      this.onPlayerHit?.(dmg);
      return 'hit';
    }
    return 'miss';
  }

  // the witch's hex: one green orb that bends toward the hunter
  fireHex(e, player) {
    const from = e.pos.clone().setY(e.pos.y + 2.1 * e.m.root.scale.y); // the lantern on her staff
    const to = new THREE.Vector3(player.pos.x, player.pos.y + 1, player.pos.z);
    const mesh = new THREE.Mesh(SHOT_GEO, HEX_MAT);
    mesh.add(glowSprite(0x60ff90, 1.6, 0.7));
    mesh.position.copy(from);
    this.scene.add(mesh);
    this.shots.push({ mesh, vel: to.sub(from).normalize().multiplyScalar(9), life: 4, owner: e, hit: false, dmgMul: 1, homing: 1.6, color: 0x60ff90 });
    sfx.hexShot(from);
  }

  // the bride's scream: a ring of sound; close by and not dodged, it stuns the hunter for a moment
  scream(e, player) {
    const p = e.pos.clone().setY(centerY(e));
    this.fx.burst(p, 0xff60c0, 44, { speed: 10, up: 0.4, gravity: 0, life: 0.55, size: 0.15 });
    sfx.scream(e.pos);
    const d = Math.hypot(player.pos.x - e.pos.x, player.pos.z - e.pos.z);
    if (this.strike(e, player, d < SCREAM.radius, d < SCREAM.radius + 2, e.dmg * SCREAM.dmg) === 'hit') {
      player.stagger(SCREAM.stun);
      this.onStagger?.();
    }
  }

  // Where a vampire reappears: behind the hunter if that is open ground with nothing in between,
  // otherwise the closest free spot toward the flanks (a wall at the hunter's back sends it to the side).
  blinkSpot(player) {
    const nav = this.nav, p = player.pos;
    const base = player.facing + Math.PI + (Math.random() - 0.5) * 0.6, flip = Math.random() < 0.5 ? 1 : -1;
    for (const o of BLINK_OFFSETS) {
      const a = base + o * flip;
      const x = p.x + Math.sin(a) * 3.2, z = p.z + Math.cos(a) * 3.2;
      if (!nav || (!nav.blockedAt(x, z) && nav.los(x, z, p.x, p.z))) return { x, z };
    }
    return null;
  }

  // --- per frame
  update(dt, ctx) {
    const { player, dayAmt, world, spawn: S = DEFAULT_SPAWN } = ctx;
    this.world = world;
    const nightAmt = 1 - dayAmt;
    const realDt = dt;
    dt *= this.timeScale; // creatures (and their spawning) live in the slowed time
    this.clock += dt;
    const time = this.clock;
    // flow field toward the hunter for the walkers, rebuilt as the hunter moves
    if (world && !this.nav) this.nav = new NavGrid(world);
    this.nav?.update(realDt, player.pos.x, player.pos.z);

    // spawning: the campaign chapter decides who roams, how many and how often
    this.spawnTimer -= dt;
    let alive = 0;
    for (const e of this.list) if (!e.dying) alive++;
    const max = Math.min(26, Math.floor(1 + nightAmt * S.max));
    if (this.spawnTimer <= 0 && !player.dead) {
      this.spawnTimer = nightAmt > 0.5 ? S.interval : 7;
      if (alive < max) {
        const pool = nightAmt > 0.5 ? S.night : S.day;
        const type = pool[Math.floor(Math.random() * pool.length)];
        const n = type === 'bat' ? 3 : 1;
        for (let i = 0; i < n; i++) this.spawn(type, player.pos.x, player.pos.z);
        if (type === 'wolf' && Math.random() < 0.5 && this.list.length) sfx.howl(this.list[this.list.length - 1].pos); // (spawn can fail: no valid spot)
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

    // attack tokens: only a few creatures (bosses aside) wind up a strike or a pounce at the same time
    this.attackers = 0;
    for (const e of L) if (!e.dying && !e.T.boss && (e.atk >= 0 || e.leap || e.crouch > 0 || e.cast > 0 || e.prep > 0 || e.dash)) this.attackers++;

    for (let i = L.length - 1; i >= 0; i--) {
      const e = L[i];
      if (this.updateOne(e, dt, player, dayAmt, time, world)) {
        this.discard(e);
        L.splice(i, 1);
        if (e === this.boss) this.boss = null;
      }
    }
    if (!this.boss) this.boss = L.find((e) => e.name && !e.dying) || null;

    // the Count's blood orbs live in the creatures' (possibly slowed) time; a roll at the last instant is a
    // perfect dodge like any blow, and a dodged orb flies on
    for (let i = this.shots.length - 1; i >= 0; i--) {
      const s = this.shots[i], p = s.mesh.position;
      if (s.homing && !s.hit) {
        // bend toward the hunter's chest, keeping the speed
        const sp = s.vel.length();
        const want = this.tmpV.set(player.pos.x - p.x, player.pos.y + 1 - p.y, player.pos.z - p.z).setLength(sp);
        s.vel.lerp(want, 1 - Math.exp(-s.homing * dt)).setLength(sp);
      }
      p.addScaledVector(s.vel, dt);
      s.mesh.rotation.y += dt * 8;
      s.life -= dt;
      if (Math.random() < 0.5) this.fx.burst(p, s.color, 1, { speed: 0.4, up: 0, gravity: 0, life: 0.3, size: 0.1 });
      let gone = s.life <= 0 || p.y < heightAt(p.x, p.z);
      const d = Math.hypot(player.pos.x - p.x, player.pos.y + 1 - p.y, player.pos.z - p.z);
      if (!gone && !s.hit && d < 0.85 && !player.dead) {
        s.hit = true;
        this.strike(s.owner, player, true, true, s.owner.dmg * s.dmgMul);
        if (!player.roll) gone = true;
      }
      if (gone) {
        this.fx.burst(p, s.color, 8, { speed: 3, up: 2, life: 0.35, size: 0.1 });
        this.scene.remove(s.mesh);
        this.shots.splice(i, 1);
      }
    }

    // soul orbs and bolts belong to the hunter: they ignore the slow motion
    dt = realDt;

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
      e.glint.visible = false;
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
    // stragglers despawn, but the Count and named guardians hunt the player down instead of vanishing
    if (dist > 120 && !T.boss && !e.name) return true;
    const ground = groundAt(pos.x, pos.z);

    // sunlight burns the undead
    if ((e.burns ?? T.burns) && dayAmt > 0.55) {
      e.burn += dt;
      e.hp -= dt * (T.boss ? 1.5 : 2.5);
      if (Math.random() < 0.5) this.fx.burst(pos.clone().setY(pos.y + 1), Math.random() < 0.5 ? 0xff8020 : 0xffe040, 2, { speed: 1, up: 4, gravity: 3, life: 0.6 });
      if (Math.random() < dt * 4) sfx.burn(pos);
      if (e.hp <= 0) { this.kill(e); return false; }
    }

    // a free attack slot (bosses never wait for one)
    const free = T.boss || this.attackers < this.mods.attackers;
    const W = e.windup || T.windup; // the Count's fury shortens his windup
    let speed = 0;
    let mx = 0, mz = 0;
    e.pathing = false; // walking around an obstacle this frame (set in the chase below)
    if (e.shield > 0) {
      // changing phase: a column of mist, untouchable
      e.shield -= dt;
      if (Math.random() < 0.7) this.fx.burst(pos.clone().setY(pos.y + 0.5 + Math.random() * 2), Math.random() < 0.6 ? 0x8a2ad0 : 0xff1030, 3, { speed: 2, up: 3, gravity: 0, life: 0.7, size: 0.22 });
    } else if (e.stun > 0) {
      e.stun -= dt;
    } else if (e.cast > 0) {
      // the Count / the witch raise their hands (eyes glinting), then throw blood orbs / a hex
      if ((e.cast -= dt) <= 0) {
        e.cast = 0;
        if (T.boss) this.fireFan(e, player);
        else this.fireHex(e, player);
      }
    } else if (e.prep > 0) {
      // a vampire coils for its lunge / a bride draws breath to scream
      if ((e.prep -= dt) <= 0) {
        e.prep = 0;
        if (e.prepKind === 'lunge') e.dash = { t: 0, dx: dx / dist, dz: dz / dist, hit: false };
        else this.scream(e, player);
      }
    } else if (e.dash) {
      // the lunge: a straight dash that strikes whatever it passes through
      const d = e.dash;
      d.t += dt;
      pos.x += d.dx * LUNGE.speed * dt;
      pos.z += d.dz * LUNGE.speed * dt;
      if (!d.hit && (dist < 1.5 || (player.roll && dist < 3))) {
        d.hit = true;
        this.strike(e, player, dist < 1.5, true);
      }
      if (d.t >= LUNGE.dur) {
        e.dash = null;
        e.cd = 0.8;
      }
    } else if (e.crouch > 0) {
      // the werewolf gathers itself (eyes glinting), then pounces at where the hunter is now
      if ((e.crouch -= dt) <= 0) {
        e.crouch = 0;
        e.leap = { t: 0, x0: pos.x, z0: pos.z, x1: player.pos.x - (dx / dist) * 1.2, z1: player.pos.z - (dz / dist) * 1.2 };
      }
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
        const d = Math.hypot(player.pos.x - pos.x, player.pos.z - pos.z);
        this.strike(e, player, d < 2.2, d < 4.7);
        this.fx.burst(pos.clone().setY(ground + 0.1), 0x6a5a40, 10, { speed: 4, up: 2 });
        e.cd = 1;
      }
    } else if (e.atk >= 0) {
      e.atk += dt;
      if (e.atk >= W && !e.struck) {
        e.struck = true;
        const reach = T.range + 0.8 * sc;
        const dy = Math.abs(player.pos.y + 1 - centerY(e));
        this.strike(e, player, dist < reach && dy < 2.5, dist < reach + 2.5 && dy < 3);
        if (T.fly) { e.kx = (-dx / dist) * 10; e.kz = (-dz / dist) * 10; }
      }
      if (e.atk >= W + 0.3) {
        if (T.boss && e.stage === 3 && !e.second) {
          // fury: a second blow right after the first (telegraphed again)
          e.second = true;
          e.atk = 0;
          e.struck = false;
          e.tell = TELL_FLASH;
          sfx.attack(e.type, pos);
        } else {
          e.second = false;
          e.atk = -1;
          e.cd = (T.boss ? 0.7 : 0.9) + Math.random() * 0.6;
        }
      }
    } else {
      e.cd -= dt;
      speed = T.speed * e.speedMul;
      mx = dx / dist;
      mz = dz / dist;
      // walkers with a house, a wall or a fence between them and the hunter follow the flow field around it
      if (!T.fly && this.nav) {
        if ((e.navT -= dt) <= 0) {
          e.navT = 0.15;
          e.hidden = !this.nav.los(pos.x, pos.z, player.pos.x, player.pos.z);
        }
        const f = e.hidden && this.nav.flow(pos.x, pos.z, this.flowDir);
        if (f) {
          mx = f.x;
          mz = f.z;
          e.pathing = true;
        }
      }
      // the witch keeps her distance: closes in from afar, backs off (faster when cornered), strafes in between
      if (T.ranged && !player.dead && !(e.pathing && dist > 13)) {
        const radial = dist < 6 ? -1 : dist < 8 ? -0.5 : dist > 13 ? 1 : 0;
        mx = (dx / dist) * radial + (-dz / dist) * e.side * 0.6;
        mz = (dz / dist) * radial + (dx / dist) * e.side * 0.6;
        if (dist < 6) speed *= 1.15;
        if ((e.castCd -= dt) <= 0 && free && !e.hidden && dist > 4 && dist < 18) {
          e.cast = CAST;
          e.castCd = 2.6 + Math.random() * 1.5;
          e.tell = TELL_FLASH;
          this.attackers++;
          sfx.attack(e.type, pos);
        }
      }
      // vampire lunge from mid range, with a clear line
      if (T.lunge && free && !e.hidden && (e.lungeCd -= dt) <= 0 && dist > 4.5 && dist < 9 && !player.dead) {
        e.prep = LUNGE.prep;
        e.prepKind = 'lunge';
        e.lungeCd = 4 + Math.random() * 3;
        e.tell = TELL_FLASH;
        this.attackers++;
        sfx.attack(e.type, pos);
      }
      // bride scream when the hunter is close
      if (T.scream && free && (e.screamCd -= dt) <= 0 && dist < SCREAM.radius - 0.5 && !player.dead) {
        e.prep = SCREAM.prep;
        e.prepKind = 'scream';
        e.screamCd = 6 + Math.random() * 4;
        e.tell = TELL_FLASH;
        this.attackers++;
        sfx.attack(e.type, pos);
      }
      // no free slot and already close: circle the hunter at the edge of the fight and wait for a turn
      const wait = !free && !player.dead && !e.pathing && !T.ranged && dist < T.range + (T.fly ? 6 : 3.4) * sc;
      if (T.fly && dist > 7 && !wait) {
        // circle around the player before swooping in
        const side = Math.sin(time * 0.8 + e.phase) > 0 ? 1 : -1;
        mx += (-dz / dist) * 0.8 * side;
        mz += (dx / dist) * 0.8 * side;
      }
      if (wait) {
        const ring = T.range + (T.fly ? 4.5 : 2.2) * sc;
        const radial = dist < ring ? -1 : 0.15; // back off when inside the ring, drift in when outside
        mx = (-dz / dist) * e.side + (dx / dist) * radial;
        mz = (dx / dist) * e.side + (dz / dist) * radial;
        speed *= 0.4;
      } else if (dist < T.range + 0.3 * sc) {
        speed = 0;
        if (e.cd <= 0 && !player.dead && free && !e.prep && !e.cast) {
          e.atk = 0;
          e.struck = false;
          e.tell = TELL_FLASH;
          if (!T.boss) this.attackers++;
          sfx.attack(e.type, pos);
        }
      }
      // the Count, from his second phase on: blood orbs when the hunter keeps their distance
      if (T.boss && e.stage >= 2 && e.atk < 0 && (e.castCd -= dt) <= 0 && dist > 4.5 && dist < 26 && !player.dead) {
        e.cast = CAST;
        e.castCd = e.stage >= 3 ? 3 : 4.5;
        e.tell = TELL_FLASH;
        sfx.attack(e.type, pos);
      }
      // vampires dissolve into mist and reappear behind the hunter
      if (T.blink && !e.cast && !e.prep && (e.blinkCd -= dt) <= 0 && free && dist > 6 && dist < 35 && !player.dead) {
        const spot = this.blinkSpot(player);
        if (!spot) e.blinkCd = 1; // walls all around the hunter's back: try again in a moment
        else {
          this.fx.burst(pos.clone().setY(pos.y + 1), 0x8a2ad0, 26, { speed: 3, up: 2, gravity: 1, life: 0.8, size: 0.2 });
          pos.x = spot.x;
          pos.z = spot.z;
          this.fx.burst(pos.clone().setY(groundAt(pos.x, pos.z) + 1), 0x8a2ad0, 26, { speed: 3, up: 2, gravity: 1, life: 0.8, size: 0.2 });
          e.blinkCd = (e.blinkBase ?? T.blink) + Math.random() * (e.blinkBase ? 2 : 4);
          e.cd = 0.35;
          e.hidden = false;
          sfx.blink(pos);
          // the count summons bats when he blinks
          if (T.boss) for (let i = 0; i < 3; i++) this.spawn('bat', pos.x, pos.z, 4, 8);
        }
      }
      // a pounce needs a clear line: no jumping through walls
      if (T.leap && (e.leapCd -= dt) <= 0 && free && !e.hidden && dist > 4 && dist < 11 && !player.dead) {
        e.crouch = CROUCH;
        e.tell = TELL_FLASH;
        e.leapCd = 3 + Math.random() * 2;
        this.attackers++;
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
      const swoop = e.atk >= 0 || (dist < 7 && e.cd <= 0.2 && free);
      const ty = swoop ? player.pos.y + 1.1 - (T.center || 0) : Math.max(g, WATER) + T.fly + Math.sin(time * 2 + e.phase) * 0.5;
      pos.y += (ty - pos.y) * Math.min(1, dt * 4);
    } else pos.y = g + (e.leapY || 0);

    // --- animation (walking around an obstacle: face the way it walks, not the hunter through the wall)
    const target = e.pathing ? Math.atan2(mx, mz) : Math.atan2(dx, dz);
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
      const bend = e.atk >= 0 ? (e.atk < W ? -0.9 : -0.1) : e.type === 'bride' ? -0.6 : -0.35;
      m.foreL.rotation.x = m.foreR.rotation.x = bend;
    }
    if (m.armL) {
      let ax;
      if (e.cast > 0) ax = -2.4; // arms raised to throw the blood orbs
      else if (e.atk >= 0) ax = e.atk < W ? -0.5 - (e.atk / W) * 2.2 : -1.1;
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
    else if (e.crouch > 0 || (e.prep > 0 && e.prepKind === 'lunge')) m.spin.rotation.x = 0.4; // coiled
    else if (e.dash) m.spin.rotation.x = 0.55; // low, fast lunge
    else if (e.prep > 0) m.spin.rotation.x = -0.35; // bride throws her head back to scream
    else m.spin.rotation.x = e.type === 'bride' ? 0.35 : 0;

    // telegraph: a red flash as the windup starts, then the eye glint swells until the blow lands
    const winding = (e.atk >= 0 && e.atk < W) || e.crouch > 0 || e.cast > 0 || e.prep > 0;
    e.glint.visible = winding;
    if (winding) {
      const p = e.cast > 0 ? 1 - e.cast / CAST
        : e.prep > 0 ? 1 - e.prep / (e.prepKind === 'lunge' ? LUNGE.prep : SCREAM.prep)
          : e.crouch > 0 ? 1 - e.crouch / CROUCH : e.atk / W;
      e.glint.scale.setScalar((0.2 + 0.5 * Math.min(1, p * 4)) * (1.15 - 0.25 * p));
    }

    m.root.position.copy(pos);
    m.root.rotation.y = e.facing;
    if (e.flash > 0) e.flash -= dt;
    if (e.tell > 0) e.tell -= dt;
    for (const mesh of m.meshes) mesh.material = e.flash > 0 ? FLASH_MAT : e.tell > 0 ? TELL_MAT : mesh.userData.orig;
    return false;
  }
}
