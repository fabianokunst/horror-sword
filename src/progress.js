// Hunter progression: difficulty presets, XP/levels, perks ("dons") and the localStorage save.
import { L } from './i18n.js';

const SAVE_KEY = 'horror-sword:save';
const RECORD_KEY = 'horror-sword:records';
const PREFS_KEY = 'horror-sword:prefs';
const VERSION = 1;

// hp/dmg scale every creature, spawn scales how many are alive at once, elite adds to the elite chance,
// attackers is how many creatures may strike at the same time (the others circle and wait).
// keepXp: dying keeps what was earned since the checkpoint; permadeath: dying erases the save.
export const DIFFICULTIES = {
  easy: { name: L('Peregrino', 'Pilgrim'), desc: L('Criaturas frágeis. Ao cair, você mantém a experiência.', 'Frail creatures. When you fall, you keep your experience.'), hp: 0.7, dmg: 0.6, spawn: 0.75, elite: -0.05, xp: 1, attackers: 2, keepXp: true },
  normal: { name: L('Caçador', 'Hunter'), desc: L('A caçada como deve ser. Ao cair, volta ao último ponto salvo.', 'The hunt as it should be. When you fall, you go back to the last save point.'), hp: 1, dmg: 1, spawn: 1, elite: 0, xp: 1, attackers: 3 },
  hard: { name: 'Van Helsing', desc: L('Mais criaturas, mais fortes e mais elites. +25% de experiência.', 'More creatures, stronger, more elites. +25% experience.'), hp: 1.4, dmg: 1.35, spawn: 1.2, elite: 0.05, xp: 1.25, attackers: 3 },
  nightmare: { name: L('Pesadelo', 'Nightmare'), desc: L('Uma vida só. Ao cair, o save é apagado. +50% de experiência.', 'One life. When you fall, the save is erased. +50% experience.'), hp: 1.8, dmg: 1.7, spawn: 1.4, elite: 0.1, xp: 1.5, attackers: 4, permadeath: true },
};

// Titles earned by level; the blade, lantern and slashes take the rank's color.
export const RANKS = [
  { level: 1, name: L('Aprendiz', 'Apprentice'), color: 0x40e8ff, finisher: 0xff70e0 },
  { level: 5, name: L('Juramentado', 'Sworn'), color: 0xffc040, finisher: 0xff8030 },
  { level: 10, name: L('Matador de Vampiros', 'Vampire Slayer'), color: 0xff3050, finisher: 0xffb040 },
  { level: 15, name: L('Inquisidor', 'Inquisitor'), color: 0xb060ff, finisher: 0x60e8ff },
  { level: 22, name: L('Lenda da Noite', 'Legend of the Night'), color: 0xf4f8ff, finisher: 0xffd060 },
];
export const rankOf = (level) => RANKS.reduce((r, k) => (level >= k.level ? k : r), RANKS[0]);

export const PERKS = {
  vigor: { name: 'Vigor', icon: '♥', desc: L('+25 de vida máxima', '+25 max health'), max: 5 },
  couraca: { name: L('Couraça', 'Cuirass'), icon: '⛨', desc: L('-10% de dano recebido', '-10% damage taken'), max: 4 },
  folego: { name: L('Fôlego', 'Second Wind'), icon: '≋', desc: L('+20 de stamina e recuperação 15% mais rápida', '+20 stamina and 15% faster recovery'), max: 4 },
  lamina: { name: L('Lâmina Rúnica', 'Runic Blade'), icon: '†', desc: L('+20% de dano da espada', '+20% sword damage'), max: 5 },
  longa: { name: L('Lâmina Longa', 'Long Blade'), icon: '⟷', desc: L('+12% de alcance dos golpes', '+12% strike reach'), max: 3 },
  golpe: { name: L('Golpe de Misericórdia', 'Coup de Grâce'), icon: '✠', desc: L('O 3º golpe do combo causa +60% de dano', 'The 3rd combo hit deals +60% damage'), max: 3 },
  sangue: { name: L('Sede de Sangue', 'Bloodthirst'), icon: '❦', desc: L('Cada criatura atingida pela espada cura 1 de vida', 'Each creature the sword hits heals 1 health'), max: 3 },
  almas: { name: L('Colheita de Almas', 'Soul Harvest'), icon: '✦', desc: L('Almas curam 50% mais e são atraídas de mais longe', 'Souls heal 50% more and are drawn from farther away'), max: 3 },
  aljava: { name: L('Aljava', 'Quiver'), icon: '➶', desc: L('+2 virotes na besta', '+2 crossbow bolts'), max: 3 },
  prata: { name: L('Prata Benta', 'Blessed Silver'), icon: '✚', desc: L('+50% de dano da besta', '+50% crossbow damage'), max: 4 },
  maos: { name: L('Mãos Ágeis', 'Nimble Hands'), icon: '↻', desc: L('Virotes recarregam 30% mais rápido', 'Bolts reload 30% faster'), max: 3 },
  perfura: { name: L('Virote Perfurante', 'Piercing Bolt'), icon: '⇶', desc: L('Virotes atravessam mais uma criatura', 'Bolts pass through one more creature'), max: 2 },
  fantasma: { name: L('Passo Fantasma', 'Ghost Step'), icon: '◌', desc: L('Esquiva custa 30% menos stamina e vai mais longe', 'Dodging costs 30% less stamina and goes farther'), max: 2 },
  ligeiro: { name: L('Pés Ligeiros', 'Fleet Feet'), icon: '»', desc: L('+8% de velocidade', '+8% speed'), max: 3 },
  // the sword runes and the Fúria bar (runes.js)
  ira: { name: L('Ira Santa', 'Holy Wrath'), icon: '✷', desc: L('A Fúria enche 25% mais rápido', 'Fury fills 25% faster'), max: 3 },
  ressoa: { name: L('Ressonância', 'Resonance'), icon: '◎', desc: L('Efeitos das runas 25% mais fortes (fogo, gelo, raio, sangue, luz)', 'Rune effects 25% stronger (fire, frost, lightning, blood, light)'), max: 3 },
  arte: { name: L('Mestre de Armas', 'Weapon Master'), icon: '✶', desc: L('As Artes da lâmina causam +30% de dano', 'Blade Arts deal +30% damage'), max: 3 },
};

// XP needed to go from `level` to `level + 1`.
export const xpToNext = (level) => Math.floor(6 + 5 * level + level * level * 0.5);

export function computeStats(save) {
  const r = (k) => save.perks[k] || 0, L = save.level;
  return {
    maxHp: 100 + (L - 1) * 4 + r('vigor') * 25,
    armor: 1 - r('couraca') * 0.1,
    maxSt: 100 + r('folego') * 20,
    stRegen: 34 * (1 + r('folego') * 0.15),
    swordMul: (1 + r('lamina') * 0.2) * (1 + (L - 1) * 0.02),
    rangeMul: 1 + r('longa') * 0.12,
    finisherMul: 1 + r('golpe') * 0.6,
    lifesteal: r('sangue'),
    soulHeal: 6 * (1 + r('almas') * 0.5),
    soulPull: 5 + r('almas') * 2.5,
    maxBolts: 6 + r('aljava') * 2,
    boltDmg: 2 * (1 + r('prata') * 0.5),
    boltReload: 1.6 * 0.7 ** r('maos'),
    pierce: r('perfura'),
    rollCost: 18 * (1 - r('fantasma') * 0.3),
    rollSpeed: 14 * (1 + r('fantasma') * 0.15),
    speedMul: 1 + r('ligeiro') * 0.08,
    furyGain: 1 + r('ira') * 0.25,
    runePow: 1 + r('ressoa') * 0.25,
    artMul: 1 + r('arte') * 0.3,
  };
}

// Offers up to n distinct perks that are not maxed yet; perks already taken are slightly favored.
export function rollPerks(save, n = 3) {
  const pool = Object.keys(PERKS).filter((k) => (save.perks[k] || 0) < PERKS[k].max);
  const out = [];
  while (out.length < n && pool.length) {
    const w = pool.map((k) => 1 + (save.perks[k] ? 0.5 : 0));
    let x = Math.random() * w.reduce((a, b) => a + b, 0), i = 0;
    while ((x -= w[i]) > 0) i++;
    out.push(pool.splice(Math.min(i, pool.length - 1), 1)[0]);
  }
  return out;
}

// Adds XP and returns how many levels were gained (each one grants a perk pick).
export function addXp(save, amount) {
  save.xp += amount;
  let gained = 0;
  while (save.xp >= xpToNext(save.level)) {
    save.xp -= xpToNext(save.level);
    save.level++;
    save.picks++;
    gained++;
  }
  return gained;
}

export function newSave(difficulty = 'normal') {
  return {
    v: VERSION, difficulty, chapter: 0, cycle: 0, level: 1, xp: 0, picks: 0, perks: {}, purse: 0, // purse: souls to spend at the merchant
    // sword runes found, the one in the blade and the kills made with each (mastery, see runes.js)
    runes: { owned: ['aco'], active: 'aco', kills: {} },
    stats: { kills: 0, souls: 0, deaths: 0, time: 0 }, pos: null, savedAt: 0,
  };
}

// localStorage can throw (private mode, quota, blocked storage); the game must keep running without it.
function read(key) {
  try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
}
function write(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
}

export function loadSave() {
  const s = read(SAVE_KEY);
  if (!s || s.v !== VERSION || !DIFFICULTIES[s.difficulty]) return null;
  const base = newSave(s.difficulty);
  return { ...base, ...s, perks: { ...s.perks }, stats: { ...base.stats, ...s.stats } };
}
export function writeSave(save) {
  save.savedAt = Date.now();
  return write(SAVE_KEY, save);
}
export function clearSave() {
  try { localStorage.removeItem(SAVE_KEY); } catch { /* storage unavailable */ }
}
export const cloneSave = (s) => JSON.parse(JSON.stringify(s));

// Best results survive permadeath and new games.
export function loadRecords() {
  return { chapter: 0, level: 1, kills: 0, ...read(RECORD_KEY) };
}
export function updateRecords(save, chapterGlobal) {
  const r = loadRecords();
  const next = { chapter: Math.max(r.chapter, chapterGlobal), level: Math.max(r.level, save.level), kills: Math.max(r.kills, save.stats.kills) };
  write(RECORD_KEY, next);
  return next;
}

export const loadPrefs = () => ({ difficulty: 'normal', ...read(PREFS_KEY) });
export const savePrefs = (p) => write(PREFS_KEY, p);
