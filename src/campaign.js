// Campaign director: chapters and their objectives, enemy scaling, XP/level-ups, checkpoints and NG+ cycles.
import { groundAt } from './world.js';
import { sfx } from './audio.js';
import {
  DIFFICULTIES, PERKS, computeStats, rankOf, addXp, xpToNext, rollPerks,
  newSave, writeSave, clearSave, cloneSave, updateRecords,
} from './progress.js';

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
export const roman = (n) => ROMAN[n - 1] || String(n);

// One chapter per step of the hunt. After the Count falls, the next cycle replays them with stronger
// creatures, more elites and every creature type roaming (see applyScaling / spawnConfig).
export const CHAPTERS = [
  {
    title: 'A Primeira Noite', intro: 'O sol se põe sobre a Transilvânia...',
    goal: { kind: 'survive' },
    density: 6, night: ['ghoul', 'ghoul', 'ghoul', 'bat'], day: ['ghoul'],
  },
  {
    title: 'O Cemitério', intro: 'Algo dorme sob as lápides.',
    goal: { kind: 'coffin', id: 'cemetery', place: 'do Cemitério' },
    guards: [{ type: 'vampire', n: 2 }, { type: 'ghoul', n: 4 }],
    density: 8, night: ['ghoul', 'ghoul', 'vampire', 'vampire', 'bat', 'bat'], day: ['ghoul', 'ghoul'],
  },
  {
    title: 'Uivos no Moinho', intro: 'A matilha protege o seu senhor.',
    goal: { kind: 'coffin', id: 'windmill', place: 'do Moinho' },
    guards: [{ type: 'wolf', n: 1, name: 'LOBO ALFA', hp: 6, scale: 1.5 }, { type: 'wolf', n: 3 }],
    density: 10, night: ['wolf', 'wolf', 'ghoul', 'ghoul', 'vampire', 'bat'], day: ['ghoul', 'wolf'],
  },
  {
    title: 'As Noivas da Abadia', intro: 'Três vozes cantam entre as ruínas.',
    goal: { kind: 'coffin', id: 'abbey', place: 'da Abadia' },
    guards: [{ type: 'bride', n: 3, name: 'NOIVA DO CONDE', hp: 3, scale: 1.15, shade: true }],
    density: 11, night: ['bride', 'vampire', 'vampire', 'bat', 'bat', 'wolf', 'ghoul'], day: ['ghoul', 'wolf'],
  },
  {
    title: 'Lua de Sangue', intro: 'O selo do castelo se alimenta de sangue.',
    goal: { kind: 'kills', n: 30, night: true }, bloodMoon: true, gate: true,
    density: 14, night: ['ghoul', 'vampire', 'vampire', 'bat', 'bat', 'wolf', 'wolf', 'bride'], day: ['ghoul', 'wolf', 'wolf'],
  },
  {
    title: 'O Conde Drácula', intro: 'O portão está aberto. Ele espera por você.',
    goal: { kind: 'boss' }, bloodMoon: true,
    density: 9, night: ['vampire', 'vampire', 'bat', 'bat', 'bride'], day: ['ghoul', 'wolf'],
  },
];

const DUSK = 0.44; // time of day a new hunt starts at, a few seconds before nightfall
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

export class Campaign {
  constructor({ world, enemies, player, hud, fx }) {
    Object.assign(this, { world, enemies, player, hud, fx });
    this.home = { x: player.pos.x, z: player.pos.z, facing: player.facing };
    this.save = newSave();
    this.snapshot = cloneSave(this.save); // state at the last checkpoint, restored on death
    this.diff = DIFFICULTIES.normal;
    this.task = null;
    this.spawn = null;
    this.offer = null;
    this.dayT = DUSK;
    this.isNight = false;
    this.inv = null; // optional inventory with save()/load()
    this.onVictory = null;
    this.setupChapter();
    enemies.onSoul = (xp) => this.gainXp(xp);
    world.onCoffinDestroyed = (c) => this.coffinDestroyed(c);
    world.onCoffinSealed = () => {
      sfx.deny();
      hud.toast('✝ Selado por magia antiga — ainda não é a hora deste caixão');
    };
  }

  get chapter() { return CHAPTERS[this.save.chapter]; }
  get global() { return this.save.cycle * CHAPTERS.length + this.save.chapter; }
  get bloodMoon() { return !!this.chapter.bloodMoon; }
  get tag() {
    const c = this.save.cycle;
    return `${c ? `CICLO ${roman(c + 1)} · ` : ''}CAP. ${roman(this.save.chapter + 1)}`;
  }
  get hunter() {
    const s = this.save;
    return { level: s.level, xp: s.xp, next: xpToNext(s.level), rank: rankOf(s.level) };
  }

  // Puts a save into the world (hunter, position, coffins, gate) and returns the time of day to resume at.
  start(save) {
    this.save = save;
    this.diff = DIFFICULTIES[save.difficulty];
    this.snapshot = cloneSave(save);
    this.offer = null;
    this.dayT = save.dayT ?? DUSK;
    const p = this.player, at = save.pos || this.home;
    p.applyStats(computeStats(save));
    p.reset();
    p.setRank(rankOf(save.level));
    p.pos.set(at.x, groundAt(at.x, at.z), at.z);
    p.facing = at.facing;
    this.enemies.reset();
    this.enemies.kills = save.stats.kills;
    this.enemies.souls = save.stats.souls;
    this.applyScaling();
    this.restoreWorld();
    this.setupChapter();
    // the untouched inventory of the first start is the kit every brand-new hunt begins with
    this.freshInv ??= this.inv?.save?.();
    this.inv?.load?.(save.inventory || this.freshInv);
    if (!save.savedAt) this.checkpoint(false); // a brand-new hunt is saved right away
    if (save.cycle > 0 && save.chapter === 0) this.hud.message(`CICLO ${roman(save.cycle + 1)}`, 'As criaturas retornam mais fortes...', 4);
    this.announce();
    return this.dayT;
  }

  // Creature stats grow with every chapter and cycle; the difficulty multiplies on top.
  applyScaling() {
    const D = this.diff, g = this.global;
    this.enemies.mods = {
      hp: D.hp * (1 + 0.12 * g),
      dmg: D.dmg * (1 + 0.07 * g),
      elite: Math.min(0.4, Math.max(0, 0.02 + 0.025 * g + D.elite)),
      xp: D.xp * (1 + 0.1 * g),
      // each new-game+ cycle lets one more creature strike at once (two more at most)
      attackers: (D.attackers || 3) + Math.min(2, this.save.cycle),
    };
  }

  spawnConfig() {
    const ch = this.chapter, D = this.diff, c = this.save.cycle;
    return {
      night: c > 0 ? [...ch.night, 'vampire', 'wolf', 'bride'] : ch.night,
      day: ch.day,
      max: ch.density * D.spawn * (1 + 0.15 * c),
      interval: Math.max(0.6, (2.6 - 0.25 * this.save.chapter - 0.3 * c) / D.spawn),
    };
  }

  // Coffins of finished chapters stay destroyed and the gate stays open once its chapter is done.
  restoreWorld() {
    const done = CHAPTERS.slice(0, this.save.chapter);
    const coffinHp = Math.round(8 * this.enemies.mods.hp);
    for (const c of this.world.coffins || []) c.maxHp = coffinHp;
    this.world.restore?.({
      destroyed: done.filter((c) => c.goal.kind === 'coffin').map((c) => c.goal.id),
      gateOpen: done.some((c) => c.gate),
    });
    this.sealCoffins();
  }

  // only the current chapter's coffin can be broken
  sealCoffins() {
    const id = this.chapter.goal.kind === 'coffin' ? this.chapter.goal.id : null;
    for (const c of this.world.coffins || []) c.sealed = c.id !== id;
  }

  setupChapter() {
    const g = this.chapter.goal;
    this.applyScaling();
    this.task = { kind: g.kind, n: 0, goal: g.n || 0, coffin: null, guarded: false, fight: false, sawNight: false, done: false };
    if (g.kind === 'coffin') {
      const c = this.world.coffins?.find((c) => c.id === g.id && !c.destroyed);
      // a world without that coffin still gets a playable chapter
      if (c) this.task.coffin = c;
      else Object.assign(this.task, { kind: 'kills', goal: 15 + 5 * this.save.chapter });
    }
    this.sealCoffins();
    this.spawn = this.spawnConfig();
  }

  announce() {
    const ch = this.chapter;
    this.hud.message(`CAPÍTULO ${roman(this.save.chapter + 1)}`, `${ch.title} — ${ch.intro}`, 5);
  }

  objective() {
    const t = this.task, p = this.player.pos;
    const m = (o) => `${Math.round(dist(o, p))}m`;
    switch (t.kind) {
      case 'survive':
        return { text: this.isNight ? '☾ Sobreviva até o amanhecer' : '☾ Sobreviva à noite que se aproxima' };
      case 'coffin':
        return { text: `✝ Destrua o caixão ${this.chapter.goal.place} · ${m(t.coffin)}`, target: t.coffin };
      case 'kills': {
        const night = this.chapter.goal.night, wait = night && !this.isNight ? ' (à noite)' : '';
        return { text: `☠ Abata criaturas${night ? ' sob a lua de sangue' : ''} · ${t.n}/${t.goal}${wait}` };
      }
      case 'boss':
        return t.fight || !this.world.arena
          ? { text: '☠ Derrote o Conde Drácula' }
          : { text: `♜ Invada o pátio do Castelo Drácula · ${m(this.world.arena)}`, target: this.world.arena };
    }
    return { text: '' };
  }

  update(dt, { dayT, isNight }) {
    const t = this.task;
    this.dayT = dayT;
    this.isNight = isNight;
    this.save.stats.time += dt;
    if (isNight) t.sawNight = true;
    if (t.coffin && !t.guarded && dist(t.coffin, this.player.pos) < 42) {
      t.guarded = true;
      this.spawnGuards(t.coffin);
    }
  }

  spawnGuards(c) {
    for (const g of this.chapter.guards || [])
      for (let i = 0; i < g.n; i++) {
        const e = this.enemies.spawn(g.type, c.x, c.z, 3, 9);
        if (e && g.name) this.enemies.empower(e, g);
      }
    this.hud.message('GUARDIÕES', 'Algo desperta para proteger o caixão.', 3);
    if (this.chapter.guards?.some((g) => g.type === 'wolf')) sfx.howl();
  }

  // --- events from the game
  onNightfall(night) {
    this.save.stats.nights = night;
    if (this.bloodMoon) this.hud.message('LUA DE SANGUE', 'O céu sangra sobre o vale.');
    else this.hud.message(`NOITE ${night}`, this.task.kind === 'survive' ? 'Sobreviva até o amanhecer.' : 'As criaturas despertam.');
  }

  onDawn() {
    if (this.task.kind === 'survive' && this.task.sawNight && !this.task.done) this.complete('O SOL NASCE', 'Você sobreviveu à noite.');
    else this.hud.message('AMANHECER', 'Os vampiros queimam sob o sol.');
  }

  onKill(e) {
    const t = this.task;
    if (t.done) return;
    if (t.kind === 'kills' && (!this.chapter.goal.night || this.isNight) && ++t.n >= t.goal) this.complete();
    if (t.kind === 'boss' && e.T.boss) {
      this.player.heal(50);
      this.complete();
    }
  }

  onFinalFight() { this.task.fight = true; }

  coffinDestroyed(c) {
    sfx.smash();
    this.fx.shake += 0.6;
    if (c === this.task.coffin && !this.task.done) this.complete('CAIXÃO DESTRUÍDO', `${this.chapter.title} — capítulo concluído.`);
  }

  // --- progression
  complete(title = 'CAPÍTULO CONCLUÍDO', sub = `${this.chapter.title} · bônus de experiência`) {
    const s = this.save, ch = this.chapter;
    if (this.player.dead) return; // e.g. dawn breaking over the body: the death already rewound the save
    this.task.done = true;
    this.gainXp(xpToNext(s.level) * 0.5 * this.diff.xp); // about half a level per chapter
    if (s.chapter === CHAPTERS.length - 1) return this.victory();
    this.hud.message(title, sub, 4);
    sfx.bell(2);
    if (ch.gate) {
      this.world.openGate?.();
      this.hud.message('OS PORTÕES SE ABREM', 'O Castelo Drácula aguarda...', 5);
    }
    s.chapter++;
    this.setupChapter();
    this.checkpoint();
    this.announce();
  }

  victory() {
    const s = this.save;
    this.hud.message('VITÓRIA', 'O Conde Drácula retorna ao pó... por enquanto.', 5);
    sfx.bell(3);
    s.stats.kills = this.enemies.kills;
    s.stats.souls = this.enemies.souls;
    this.report = { cycle: s.cycle + 1, level: s.level, rank: rankOf(s.level).name, ...s.stats };
    updateRecords(s, this.global + 1);
    // the next cycle starts back in the village at dusk
    s.cycle++;
    s.chapter = 0;
    s.pos = { ...this.home };
    s.dayT = DUSK;
    if (this.inv?.save) s.inventory = this.inv.save();
    writeSave(s);
    this.snapshot = cloneSave(s);
    this.onVictory?.();
  }

  checkpoint(toast = true) {
    const s = this.save, p = this.player;
    s.pos = { x: p.pos.x, z: p.pos.z, facing: p.facing };
    s.dayT = this.dayT;
    s.stats.kills = this.enemies.kills;
    s.stats.souls = this.enemies.souls;
    if (this.inv?.save) s.inventory = this.inv.save();
    this.snapshot = cloneSave(s);
    const ok = writeSave(s);
    updateRecords(s, this.global);
    if (toast) this.hud.toast(ok ? '✦ Progresso salvo' : 'Este navegador não permite salvar o progresso');
  }

  gainXp(xp) {
    const s = this.save, before = rankOf(s.level);
    if (!addXp(s, xp)) return;
    this.player.applyStats(computeStats(s));
    sfx.bless();
    const rank = rankOf(s.level);
    if (rank !== before) {
      this.player.setRank(rank);
      this.hud.message('NOVO TÍTULO', `${rank.name} — sua lâmina brilha com uma nova cor.`, 4);
    }
    this.persistProgress();
  }

  // the perk choice shown when a level is gained; null once every perk is maxed
  perkInfo() {
    const s = this.save;
    if (s.picks <= 0) return null;
    if (!this.offer) this.offer = rollPerks(s);
    if (!this.offer.length) { s.picks = 0; return null; }
    return {
      level: s.level, rank: rankOf(s.level), picks: s.picks,
      choices: this.offer.map((key) => ({ key, ...PERKS[key], have: s.perks[key] || 0 })),
    };
  }

  pick(key) {
    const s = this.save;
    s.perks[key] = (s.perks[key] || 0) + 1;
    s.picks = Math.max(0, s.picks - 1);
    this.offer = null;
    this.player.applyStats(computeStats(s));
    this.persistProgress();
  }

  // Easy keeps every level and perk even after falling, so they are written immediately.
  persistProgress() {
    if (!this.diff.keepXp) return;
    const s = this.save;
    Object.assign(this.snapshot, { level: s.level, xp: s.xp, picks: s.picks, perks: { ...s.perks } });
    writeSave(this.snapshot);
  }

  // --- death
  onDeath() {
    const s = this.save, D = this.diff;
    s.stats.deaths++;
    s.stats.kills = this.enemies.kills;
    s.stats.souls = this.enemies.souls;
    const records = updateRecords(s, this.global);
    this.report = {
      chapter: `${this.tag} — ${this.chapter.title}`, level: s.level, rank: rankOf(s.level).name, ...s.stats, records,
      permadeath: !!D.permadeath,
    };
    if (D.permadeath) {
      clearSave();
      this.next = newSave(s.difficulty);
      return;
    }
    // back to the last checkpoint, keeping lifetime stats (and, on easy, the hunter's growth)
    const next = cloneSave(this.snapshot);
    next.stats = { ...s.stats };
    if (D.keepXp) Object.assign(next, { level: s.level, xp: s.xp, picks: s.picks, perks: { ...s.perks } });
    writeSave(next);
    this.next = next;
  }

  deathReport() {
    const r = this.report, D = this.diff;
    const penalty = r.permadeath
      ? `<em>Pesadelo: a caçada termina aqui e o save foi apagado.</em><br>Recorde: capítulo ${r.records.chapter + 1} · nível ${r.records.level}`
      : D.keepXp
        ? '<em>Você volta ao início do capítulo, com toda a experiência.</em>'
        : `<em>Você volta ao início do capítulo, no nível ${this.next.level}.</em>`;
    return `${r.chapter}<br>Nível <b>${r.level}</b> · ${r.rank}<br>` +
      `Criaturas abatidas: <b>${r.kills}</b> · Almas: <b>${r.souls}</b><br>${penalty}`;
  }

  victoryReport() {
    const r = this.report, t = Math.floor(r.time);
    return `Ciclo ${roman(r.cycle)} concluído · Nível <b>${r.level}</b> · ${r.rank}<br>` +
      `Tempo: <b>${Math.floor(t / 60)}m ${String(t % 60).padStart(2, '0')}s</b> · Quedas: <b>${r.deaths}</b><br>` +
      `Criaturas abatidas: <b>${r.kills}</b> · Almas: <b>${r.souls}</b><br>` +
      `<em>O Ciclo ${roman(r.cycle + 1)} traz criaturas mais fortes e mais elites.</em>`;
  }
}
