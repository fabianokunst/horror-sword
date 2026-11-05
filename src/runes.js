// Sword runes: elemental infusions earned along the campaign (one per chapter). Each one changes the blade's color,
// adds an effect to every strike and has its own Arte — the special move unleashed when the Fúria bar is full
// (V, RT on a controller, ARTE on touch screens). Kills made with a rune in the blade master it (II, III...);
// every new-game+ cycle lets the runes awaken one level further (up to V).
import * as THREE from 'three';
import './runes.css';
import { groundAt, WATER } from './world.js';
import { centerY } from './enemies.js';
import { sfx } from './audio.js';
import { L } from './i18n.js';

export const FURY = 100;
// kills with the rune in the blade needed for each level (I..V); the cap is III, +1 per new-game+ cycle
export const MASTERY = [0, 25, 70, 140, 240];
const ROMAN = ['I', 'II', 'III', 'IV', 'V'];
// Fúria per creature struck (counted up to 3 a swing), per kill and per perfect dodge
const GAIN = { hit: 7, counter: 11, kill: 6, perfect: 25 };
const BEASTS = new Set(['ghoul', 'wolf', 'bat']); // flesh that burns best
const undead = (e) => !!(e.burns ?? e.T.burns); // what the sun burns, holy light burns too
const hex = (c) => '#' + c.toString(16).padStart(6, '0');

export const RUNES = {
  aco: {
    name: L('Aço', 'Steel'), glyph: '†', color: null, note: 74, move: 'spin',
    desc: L('A lâmina nua, sem infusão.', 'The bare blade, with no infusion.'),
    art: L('Lâmina Giratória', 'Whirling Blade'), artDesc: L('um giro que corta tudo em volta', 'a spin that cuts everything around you'),
  },
  brasa: {
    name: L('Brasa', 'Ember'), glyph: '✹', color: 0xff6a1a, finisher: 0xffd040, note: 69, move: 'slam',
    desc: L('Os golpes incendeiam as criaturas. Feras queimam mais.', 'Strikes set creatures ablaze. Beasts burn hotter.'),
    art: L('Círculo de Brasas', 'Ring of Embers'), artDesc: L('uma onda de fogo em volta do caçador', 'a wave of fire around the hunter'),
    master: L('o fogo pula para as criaturas em volta quando uma cai queimando', 'the fire leaps to nearby creatures when a burning one falls'),
  },
  sangria: {
    name: L('Sangria', 'Bloodletting'), glyph: '❦', color: 0xe01030, finisher: 0xff6080, note: 62, move: 'slam',
    desc: L('Cada golpe bebe sangue e cura o caçador; cada criatura abatida cura mais.', 'Every strike drinks blood and heals the hunter; every kill heals more.'),
    art: L('Lua Crescente', 'Crescent Moon'), artDesc: L('uma lâmina de sangue que atravessa a fila de criaturas', 'a blade of blood that cuts through a line of creatures'),
    master: L('as criaturas abatidas curam o dobro', 'kills heal twice as much'),
  },
  tempestade: {
    name: L('Tempestade', 'Tempest'), glyph: '↯', color: 0xa080ff, finisher: 0xe0d0ff, note: 76, move: 'slam',
    desc: L('O 3º golpe do combo e os contra-ataques soltam raios que pulam entre as criaturas.', 'The 3rd combo hit and counters release lightning that jumps between creatures.'),
    art: L('Juízo dos Céus', 'Judgment from Above'), artDesc: L('raios caem sobre as criaturas em volta', 'lightning strikes the creatures around you'),
    master: L('os raios atordoam quem atingem', 'the lightning stuns whoever it hits'),
  },
  geada: {
    name: L('Geada', 'Frost'), glyph: '❄︎', color: 0x80e0ff, finisher: 0xe8ffff, note: 81, move: 'slam',
    desc: L('Golpes gelam e deixam lentas; no 3º acerto a criatura congela e sofre +50% de dano.', 'Strikes chill and slow; on the 3rd hit the creature freezes and takes +50% damage.'),
    art: L('Inverno Eterno', 'Endless Winter'), artDesc: L('um sopro gelado que congela tudo à frente', 'a freezing gust that freezes everything ahead'),
    master: L('criaturas congeladas estilhaçam ao cair e gelam as vizinhas', 'frozen creatures shatter when they fall and chill their neighbours'),
  },
  aurora: {
    name: L('Aurora', 'Dawn'), glyph: '☼', color: 0xffe080, finisher: 0xffffff, note: 86, move: 'slam',
    desc: L('Golpes marcam um selo de luz: a criatura explode ao cair. Mortos-vivos sofrem mais.', 'Strikes brand a seal of light: the creature bursts when it falls. The undead suffer more.'),
    art: L('Amanhecer', 'Daybreak'), artDesc: L('um clarão de sol que cega tudo e queima os mortos-vivos', 'a flash of sunlight that blinds everything and burns the undead'),
    master: L('as explosões selam quem atingem, em cadeia', 'the bursts seal whoever they hit, setting off chains'),
  },
};
// the order of the 1-6 keys, the HUD row and cycling
export const RUNE_ORDER = ['aco', 'brasa', 'sangria', 'tempestade', 'geada', 'aurora'];

// Lua Crescente: a flat half-ring of blood flying forward at chest height
const WAVE = { speed: 26, range: 22, reach: 2.3 };
const CRESCENT_GEO = new THREE.RingGeometry(1.1, 1.9, 18, 1, Math.PI, Math.PI).rotateX(-Math.PI / 2); // bulges toward +z
const CRESCENT_MAT = new THREE.MeshBasicMaterial({
  color: new THREE.Color(0xff2040).multiplyScalar(1.6), transparent: true, opacity: 0.85,
  side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false,
});

export class Blade {
  constructor({ scene, player, enemies, fx, hud, world }) {
    Object.assign(this, { scene, player, enemies, fx, hud, world });
    this.state = { owned: ['aco'], active: 'aco', kills: {} }; // the save's record, see load()
    this.ng = 0; // new-game+ cycle: raises the mastery cap
    this.fury = 0;
    this.ready = false; // the full-bar chime already played
    this.artId = null; // the rune whose Arte is under way
    this.waves = [];
    this.dmgMul = () => 1; // main.js: the holy water doubles the Artes too
    this.keyName = () => 'V'; // main.js: V, RT or ARTE, whatever the hunter plays with
    this.onFire = null; // main.js: hitstop and shake when an Arte lands (gets the number of creatures hit)
    this.dirty = true;
    this.shownFury = -1;
    this.buildHud();
  }

  get id() { return this.state.active; }
  get rune() { return RUNES[this.id]; }
  get cap() { return 3 + Math.min(2, this.ng); }
  get color() { return this.rune.color ?? this.player.rank.color; }

  // the slash trail: the rune's color, its bright variant on heavy blows (bare steel follows the rank)
  slashColor(heavy) {
    const r = this.rune, k = this.player.rank;
    return r.color == null ? (heavy ? k.finisher : k.color) : heavy ? r.finisher : r.color;
  }

  level(id = this.id) {
    const k = this.state.kills[id] || 0;
    let l = 1;
    while (l < this.cap && k >= MASTERY[l]) l++;
    return l;
  }

  // effect strength: +35% per mastery level, times the Ressonância perk
  pow(id = this.id) { return (1 + 0.35 * (this.level(id) - 1)) * this.player.stats.runePow; }

  // an Arte's damage grows with the blade (levels, Lâmina Rúnica), the rune's mastery, Mestre de Armas and holy water
  artDmg(base, id = this.id) {
    const s = this.player.stats;
    return base * s.swordMul * (1 + 0.25 * (this.level(id) - 1)) * s.artMul * this.dmgMul();
  }

  label(id = this.id) { return `${RUNES[id].name.toUpperCase()} ${ROMAN[this.level(id) - 1]}`; }

  // ---------------------------------------------------------------- save
  // Takes the save's rune record (created for saves from before the runes) plus the runes its finished
  // chapters have earned; the record stays shared with the save, so checkpoints carry it.
  load(save, earned = []) {
    const r = save.runes && typeof save.runes === 'object' ? save.runes : {};
    const owned = new Set(['aco', ...(Array.isArray(r.owned) ? r.owned : []), ...earned]);
    save.runes = this.state = {
      owned: RUNE_ORDER.filter((k) => owned.has(k)),
      active: RUNES[r.active] && owned.has(r.active) ? r.active : 'aco',
      kills: { ...(r.kills && typeof r.kills === 'object' ? r.kills : {}) },
    };
    this.ng = save.cycle || 0;
    this.fury = 0;
    this.ready = false;
    this.artId = null;
    this.clearWaves();
    this.apply();
  }

  // a rune found (chapter reward): it goes straight into the blade
  grant(id) {
    if (!RUNES[id] || this.state.owned.includes(id)) return false;
    const owned = new Set([...this.state.owned, id]);
    this.state.owned = RUNE_ORDER.filter((k) => owned.has(k));
    this.state.active = id;
    this.apply();
    const r = RUNES[id];
    sfx.rune(r.note);
    this.hud.message(`${L('NOVA RUNA', 'NEW RUNE')}: ${r.glyph} ${r.name.toUpperCase()}`, `${r.desc} ${L('Arte', 'Art')}: ${r.art}. ${this.swapHint()}`, 6);
    return true;
  }

  swapHint() {
    if (document.body.classList.contains('touch')) return L('O botão RUNA troca de runa.', 'The RUNE button swaps runes.');
    return L('Troque com 1-6, X ou a roda do mouse (◀ ▶ no controle).', 'Swap with 1-6, X or the mouse wheel (◀ ▶ on a controller).');
  }

  // ---------------------------------------------------------------- choosing
  select(id) {
    if (!this.state.owned.includes(id) || id === this.id || this.player.art) return false;
    this.state.active = id;
    this.apply();
    const r = this.rune, p = this.player;
    sfx.rune(r.note);
    this.hud.toast(`${r.glyph} ${this.label()} · ${L('Arte', 'Art')}: ${r.art}`);
    this.fx.burst(p.pos.clone().setY(p.pos.y + 1.2), this.color, 14, { speed: 2.5, up: 2, gravity: 0, life: 0.45, size: 0.1 });
    return true;
  }

  // the 1-6 keys
  slot(i) {
    const id = RUNE_ORDER[i];
    if (!id) return;
    if (!this.state.owned.includes(id)) {
      sfx.deny();
      this.hud.toast(L('Runa ainda não encontrada', 'Rune not found yet'));
    } else this.select(id);
  }

  // X / mouse wheel / D-pad / the RUNA button
  next(dir = 1) {
    const o = this.state.owned;
    if (o.length < 2) {
      sfx.deny();
      this.hud.toast(L('Nenhuma outra runa ainda: cada capítulo concluído revela uma', 'No other rune yet: each chapter completed reveals one'));
      return;
    }
    this.select(o[(o.indexOf(this.id) + dir + o.length) % o.length]);
  }

  apply() {
    this.player.setRuneColor(this.rune.color);
    this.dirty = true;
  }

  // ---------------------------------------------------------------- Fúria
  get max() { return FURY; }

  // Incenso de Ira: the bar fills at once
  fill() { this.gain(FURY * 10); }

  gain(n) {
    if (this.fury >= FURY || this.player.dead) return;
    this.fury = Math.min(FURY, this.fury + n * this.player.stats.furyGain);
    if (this.fury >= FURY && !this.ready) {
      this.ready = true;
      sfx.furyReady();
      this.hud.toast(`✦ ${this.rune.art} ${L('pronta', 'ready')} — ${this.keyName()}`);
    }
  }

  perfectDodge() { this.gain(GAIN.perfect); }

  // the sword connected with e (Enemies.hitArc calls this for every creature struck)
  strike(e, def) {
    const id = this.id, pow = this.pow(), lvl = this.level(), E = this.enemies;
    if (id === 'brasa') E.ignite(e, 0.9 * pow * (BEASTS.has(e.type) ? 1.5 : 1), 3, lvl >= 3);
    else if (id === 'geada') E.chill(e, def.counter ? 2 : 1, 1.4 * pow, lvl >= 3);
    else if (id === 'aurora') E.seal(e, 6, { dmg: 2.2 * pow, r: 4, chain: lvl >= 3 });
    else if (id === 'sangria' && !this.player.dead) this.player.heal(1.5 * pow);
  }

  // after a swing: Fúria for the creatures struck; the tempest's finisher and counters chain lightning
  afterSwing(struck, def, combo) {
    if (!struck.length) return;
    this.gain(Math.min(3, struck.length) * (def.counter ? GAIN.counter : GAIN.hit));
    if (this.id === 'tempestade' && (combo === 2 || def.counter)) this.chain(struck, def.dmg * 0.7 * this.pow());
  }

  // lightning jumps from the creature struck to the nearest others (2 jumps at level I, one more per level)
  chain(struck, dmg) {
    const E = this.enemies, lvl = this.level(), done = new Set(struck);
    let from = struck[0], n = 0;
    for (let i = 0; i < 1 + lvl; i++) {
      let best = null, bd = 7;
      for (const e of E.list) {
        if (e.dying || done.has(e)) continue;
        const d = Math.hypot(e.pos.x - from.pos.x, e.pos.z - from.pos.z);
        if (d < bd) { bd = d; best = e; }
      }
      if (!best) break;
      const a = from.pos.clone().setY(centerY(from)), b = best.pos.clone().setY(centerY(best));
      this.fx.lightning(a, b, 0xd0c0ff);
      const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz) || 1;
      E.damage(best, dmg, dx / d, dz / d, 3);
      if (lvl >= 3) E.daze(best, 0.6);
      done.add(best);
      from = best;
      n++;
    }
    if (n) sfx.zap(from.pos);
  }

  onKill(e) {
    const s = this.state, id = this.id, before = this.level();
    s.kills[id] = (s.kills[id] || 0) + (e.T.boss || e.name ? 10 : e.elite ? 3 : 1);
    this.gain(GAIN.kill);
    if (id === 'sangria' && !this.player.dead) this.player.heal((this.level() >= 3 ? 6 : 3) * this.pow());
    if (this.level() > before) {
      const r = this.rune;
      sfx.bless();
      this.hud.message(`${r.glyph} ${this.label()}`,
        this.level() === 3 && r.master ? `${L('Maestria', 'Mastery')}: ${r.master}.` : L('A runa arde mais forte na lâmina.', 'The rune burns brighter in the blade.'), 4);
      this.apply();
    }
    this.dirty = true;
  }

  // ---------------------------------------------------------------- Artes
  // V pressed: with a full bar the hunter starts the rune's Arte (player.js plays it and calls fire() as it lands)
  unleash() {
    if (this.player.dead) return false;
    if (this.fury < FURY) {
      sfx.deny();
      return false;
    }
    if (!this.player.startArt(this.rune.move)) return false;
    this.fury = 0;
    this.ready = false;
    this.artId = this.id;
    const p = this.player;
    this.fx.burst(p.pos.clone().setY(p.pos.y + 1.4), this.color, 24, { speed: 3, up: 3, gravity: -1, life: 0.5, size: 0.12 });
    return true;
  }

  fire() {
    const p = this.player, E = this.enemies, fx = this.fx;
    const id = this.artId ?? this.id, lvl = this.level(id), pow = this.pow(id);
    this.artId = null;
    const foot = p.pos.clone(), fxv = Math.sin(p.facing), fzv = Math.cos(p.facing);
    const color = RUNES[id].color ?? p.rank.color;
    let hits = 0;
    // every creature within r (fn returns false to leave one out)
    const around = (r, fn) => {
      for (const e of E.near(p.pos, r)) {
        const dx = e.pos.x - p.pos.x, dz = e.pos.z - p.pos.z, d = Math.hypot(dx, dz) || 0.001;
        if (fn(e, dx / d, dz / d, d) !== false) hits++;
      }
    };
    const spray = (n, place, colors, o) => {
      for (let i = 0; i < n; i++) fx.burst(place(i), colors[i % colors.length], 1, o);
    };
    const at = (a, r, y = 0.3) => new THREE.Vector3(p.pos.x + Math.sin(a) * r, p.pos.y + y, p.pos.z + Math.cos(a) * r);
    sfx.art(id);
    switch (id) {
      case 'aco':
        around(4.8, (e, ux, uz) => E.damage(e, this.artDmg(5, id), ux, uz, 14));
        fx.ring(foot, color, 5.2, 0.35);
        fx.ring(foot, 0xffffff, 3.4, 0.25);
        spray(36, (i) => at((i / 36) * Math.PI * 2, 3.2, 1.1), [color, 0xffffff], { speed: 4, up: 0.5, gravity: 0, life: 0.35, size: 0.12 });
        break;
      case 'brasa':
        around(6.5, (e, ux, uz) => { E.damage(e, this.artDmg(4, id), ux, uz, 12); E.ignite(e, 1.5 * pow, 5, lvl >= 3); });
        fx.ring(foot, 0xff6a1a, 7, 0.55);
        fx.ring(foot, 0xffd040, 4.6, 0.4);
        spray(48, (i) => at((i / 48) * Math.PI * 2, 2 + (i % 3)), [0xff6a1a, 0xffd040, 0xff3010], { speed: 4, up: 6, gravity: 3, life: 0.8, size: 0.2 });
        break;
      case 'sangria':
        this.launchWave(this.artDmg(6, id), 4 * pow);
        fx.ring(foot, 0xe01030, 3, 0.3);
        break;
      case 'tempestade': {
        const dist = (e) => Math.hypot(e.pos.x - p.pos.x, e.pos.z - p.pos.z);
        const targets = E.near(p.pos, 16).sort((a, b) => dist(a) - dist(b)).slice(0, 5 + lvl);
        for (const e of targets) {
          const top = new THREE.Vector3(e.pos.x + (Math.random() - 0.5) * 3, e.pos.y + 16, e.pos.z + (Math.random() - 0.5) * 3);
          fx.lightning(top, e.pos.clone().setY(centerY(e)), 0xe0d8ff, 0.4);
          fx.ring(e.pos, 0xb090ff, 2.4, 0.3);
          E.damage(e, this.artDmg(6, id), 0, 0, 2);
          E.daze(e, 1.2);
          hits++;
        }
        // nothing in reach: the sky still answers
        if (!targets.length) fx.lightning(at(p.facing, 4, 16), at(p.facing, 4, 0), 0xe0d8ff, 0.4);
        fx.ring(foot, 0xb090ff, 4, 0.35);
        break;
      }
      case 'geada':
        // a cone ahead (and anything right next to the hunter)
        around(11, (e, ux, uz, d) => {
          if (d > 3 && ux * fxv + uz * fzv < 0.55) return false;
          E.damage(e, this.artDmg(3.5, id), ux, uz, 6);
          E.freeze(e, 3 * pow, lvl >= 3);
        });
        fx.ring(foot, 0x80e0ff, 3.5, 0.4);
        spray(60, () => at(p.facing + (Math.random() - 0.5) * 1.9, 1 + Math.random() * 10, 0.2 + Math.random() * 1.6),
          [0xc8f4ff, 0x80e0ff, 0xffffff], { speed: 1.5, up: 1, gravity: -0.5, life: 0.9, size: 0.16 });
        break;
      case 'aurora':
        // sealed first, so a creature the flash kills bursts too; blinded after the blow (a blow resets the stun)
        around(14, (e, ux, uz) => {
          E.seal(e, 6, { dmg: 2.2 * pow, r: 4, chain: lvl >= 3 });
          E.damage(e, this.artDmg(4, id) * (undead(e) ? 1.5 : 1), ux, uz, 8);
          E.daze(e, 1.5);
          if (undead(e)) E.ignite(e, 1.2 * pow, 4);
        });
        fx.ring(foot, 0xffe080, 14, 0.7);
        fx.ring(foot, 0xffffff, 8, 0.45);
        spray(40, (i) => at(i * 2.4, Math.random() * 1.2, 0.5 + (i % 10) * 0.4), [0xffe080, 0xffffff], { speed: 1, up: 7, gravity: -2, life: 0.9, size: 0.18 });
        break;
    }
    // a coffin in reach takes the Arte like a heavy blow
    this.world?.hitCoffins?.(p, { range: 5, arc: -1, dmg: this.artDmg(4, id) }, fx);
    this.onFire?.(hits, id);
    return hits;
  }

  // Lua Crescente: the wave flies straight ahead over the ground, cutting each creature in its path once
  launchWave(dmg, heal) {
    const p = this.player, dx = Math.sin(p.facing), dz = Math.cos(p.facing);
    const mesh = new THREE.Mesh(CRESCENT_GEO, CRESCENT_MAT);
    mesh.position.set(p.pos.x + dx * 0.5, p.pos.y + 1.1, p.pos.z + dz * 0.5);
    mesh.rotation.y = p.facing;
    this.scene.add(mesh);
    this.waves.push({ mesh, dx, dz, dist: 0, hit: new Set(), dmg, heal });
  }

  updateWaves(dt) {
    for (let i = this.waves.length - 1; i >= 0; i--) {
      const w = this.waves[i], m = w.mesh.position, step = WAVE.speed * dt;
      m.x += w.dx * step;
      m.z += w.dz * step;
      w.dist += step;
      m.y += (Math.max(groundAt(m.x, m.z), WATER) + 1.1 - m.y) * Math.min(1, dt * 10);
      const grow = 1 + w.dist * 0.035;
      w.mesh.scale.setScalar(grow);
      const fx = m.x + w.dx * 1.5 * grow, fz = m.z + w.dz * 1.5 * grow; // the front of the arc
      for (const e of this.enemies.list) {
        if (e.dying || w.hit.has(e)) continue;
        if (Math.hypot(e.pos.x - fx, e.pos.z - fz) > WAVE.reach * grow + e.T.radius || Math.abs(centerY(e) - m.y) > 2.6) continue;
        w.hit.add(e);
        this.enemies.damage(e, w.dmg, w.dx, w.dz, 10);
        if (!this.player.dead) this.player.heal(w.heal);
      }
      this.fx.burst(new THREE.Vector3(fx, m.y, fz), Math.random() < 0.5 ? 0xff2040 : 0x900818, 2, { speed: 1.5, up: 0.5, gravity: 4, life: 0.4, size: 0.14, spread: 2 * grow });
      if (w.dist > WAVE.range) {
        this.scene.remove(w.mesh);
        this.waves.splice(i, 1);
      }
    }
  }

  clearWaves() {
    for (const w of this.waves) this.scene.remove(w.mesh);
    this.waves.length = 0;
  }

  // ---------------------------------------------------------------- per frame
  update(dt, play) {
    if (play) this.updateWaves(dt);
    this.drawHud();
  }

  // ---------------------------------------------------------------- HUD: rune badge + Fúria bar under the health bars
  buildHud() {
    const box = document.createElement('div');
    box.id = 'rune';
    box.innerHTML = '<div class="rn-top"><span class="rn-g"></span><span class="rn-n"></span><span class="rn-set"></span><span class="rn-k"></span></div>' +
      '<div class="bar fury"><div class="rn-fill"></div></div>';
    const bars = document.getElementById('bars');
    if (bars) bars.after(box);
    else document.getElementById('hud')?.append(box);
    const q = (s) => box.querySelector(s);
    this.el = { box, glyph: q('.rn-g'), name: q('.rn-n'), set: q('.rn-set'), key: q('.rn-k'), fill: q('.rn-fill') };
    // touch buttons (index.html): ARTE glows when the bar is full, RUNA shows the rune in the blade
    this.tbArt = document.querySelector('#touch [data-key="KeyV"]');
    this.tbRune = document.querySelector('#touch [data-key="KeyX"]');
  }

  drawHud() {
    const el = this.el, full = this.fury >= FURY, pct = Math.floor(this.fury);
    if (pct !== this.shownFury) {
      this.shownFury = pct;
      el.fill.style.width = pct + '%';
      el.box.classList.toggle('ready', full);
      this.tbArt?.classList.toggle('ready', full);
      this.tbArt?.classList.toggle('off', !full);
      el.key.textContent = full ? this.keyName() : '';
    }
    if (!this.dirty) return;
    this.dirty = false;
    const r = this.rune, c = hex(this.color);
    el.box.style.setProperty('--rc', c);
    el.glyph.textContent = r.glyph;
    el.name.textContent = this.label();
    el.set.innerHTML = RUNE_ORDER.map((k) => {
      const own = this.state.owned.includes(k);
      return `<span class="${k === this.id ? 'on' : own ? 'own' : ''}">${own ? RUNES[k].glyph : '·'}</span>`;
    }).join('');
    if (this.tbRune) {
      this.tbRune.style.setProperty('--rc', c);
      const g = this.tbRune.querySelector('.rn-tg');
      if (g) g.textContent = r.glyph;
      this.tbRune.classList.toggle('off', this.state.owned.length < 2);
    }
  }
}
