import { CASTLE } from './world.js';
import './campaign.css';

const $ = (id) => document.getElementById(id);
const hex = (c) => '#' + c.toString(16).padStart(6, '0');
const el = (tag, props = {}, parent) => {
  const n = Object.assign(document.createElement(tag), props);
  parent?.append(n);
  return n;
};
const DOT = { ghoul: '#9cff40', vampire: '#ff3050', bat: '#c040ff', bride: '#ff60c0', wolf: '#ffa030', dracula: '#ff0000' };
const RANGE = 70;

export class Hud {
  constructor() {
    this.el = {
      hud: $('hud'), hp: $('hpFill'), st: $('stFill'), night: $('nightLbl'), clock: $('clock'),
      kills: $('kills'), souls: $('souls'), boss: $('boss'), bossName: $('bossName'), bossFill: $('bossFill'),
      msg: $('msg'), msgTitle: $('msgTitle'), msgSub: $('msgSub'), vignette: $('vignette'),
    };
    this.map = $('minimap');
    this.ctx = this.map.getContext('2d');
    this.msgTimer = 0;
    this.msgQueue = [];
    this.hurtTimer = 0;
    this.toastTimer = 0;
    this.objText = null;

    // campaign HUD: XP bar under stamina, level + title line, save toast
    const xp = el('div', { className: 'bar xp' }, $('bars'));
    this.el.xp = el('div', { id: 'xpFill' }, xp);
    this.el.lvl = el('div', { id: 'lvl' });
    $('stats').prepend(this.el.lvl);
    this.el.objective = $('objective') || el('div', { id: 'objective' }, this.el.hud);
    this.el.toast = el('div', { id: 'toast' }, this.el.hud);

    // level-up perk choice (built here so index.html stays untouched)
    this.lu = el('div', { id: 'levelup', className: 'overlay hidden' }, document.body);
    this.lu.innerHTML = `<h1 id="luTitle"></h1><h2 id="luRank"></h2><p id="luHint"></p><div id="perks"></div>
      <p class="lu-keys desk-only">1 · 2 · 3 — ou mova o mouse e clique</p>`;
    this.perkSel = 0;
    this.perkAcc = 0;
    this.perkKeys = [];
    this.perkOpenAt = 0;
    this.onPick = null;
  }

  show(v) { this.el.hud.classList.toggle('hidden', !v); }

  // Messages queue up; a newer one cuts the current one short instead of replacing it.
  message(title, sub = '', dur = 3.5) {
    if (this.msgTimer > 0) {
      this.msgQueue.push([title, sub, dur]);
      if (this.msgQueue.length > 4) this.msgQueue.shift();
      this.msgTimer = Math.min(this.msgTimer, 1.5);
      return;
    }
    this.el.msgTitle.textContent = title;
    this.el.msgSub.textContent = sub;
    this.el.msg.classList.add('show');
    this.msgTimer = dur;
  }

  toast(text) {
    this.el.toast.textContent = text;
    this.el.toast.classList.add('show');
    this.toastTimer = 2.5;
  }

  // --- level-up: three perk cards, chosen by tap/click, 1-2-3, arrows or mouse sweep under pointer lock
  showPerks(info, onPick) {
    this.onPick = onPick;
    this.perkKeys = info.choices.map((c) => c.key);
    this.perkSel = Math.min(this.perkSel, this.perkKeys.length - 1);
    this.perkAcc = 0;
    $('luTitle').textContent = `Nível ${info.level}`;
    $('luRank').textContent = info.rank.name;
    $('luRank').style.color = hex(info.rank.color);
    $('luHint').textContent = info.picks > 1 ? `Escolha um dom (${info.picks} pendentes)` : 'Escolha um dom';
    const box = $('perks');
    box.replaceChildren();
    info.choices.forEach((c, i) => {
      const b = el('button', { className: 'perk', type: 'button' }, box);
      const pips = '◆'.repeat(c.have + 1) + '◇'.repeat(c.max - c.have - 1);
      b.innerHTML = `<span class="pk-n">${i + 1}</span><span class="pk-i">${c.icon}</span>` +
        `<b>${c.name}</b><span class="pk-r">${pips}</span><span class="pk-d">${c.desc}</span>`;
      b.addEventListener('click', () => { if (this.perkReady()) this.onPick?.(c.key); });
      b.addEventListener('pointerenter', () => this.selectPerk(i));
    });
    this.selectPerk(this.perkSel);
    if (this.lu.classList.contains('hidden')) this.perkOpenAt = performance.now();
    this.lu.classList.remove('hidden');
  }

  // a short grace period so a combo click still in flight does not pick a card blindly
  perkReady() { return performance.now() - this.perkOpenAt > 600; }

  hidePerks() { this.lu.classList.add('hidden'); }

  selectPerk(i) {
    const n = this.perkKeys.length;
    this.perkSel = (i + n) % n;
    [...$('perks').children].forEach((b, j) => b.classList.toggle('sel', j === this.perkSel));
  }

  // Polled every frame while choosing; returns the chosen perk key or null.
  perkInput(input) {
    if (!this.perkReady()) return null;
    this.perkAcc += input.dx;
    if (Math.abs(this.perkAcc) > 90) {
      this.selectPerk(this.perkSel + Math.sign(this.perkAcc));
      this.perkAcc = 0;
    }
    if (input.hit('ArrowLeft') || input.hit('KeyA')) this.selectPerk(this.perkSel - 1);
    if (input.hit('ArrowRight') || input.hit('KeyD')) this.selectPerk(this.perkSel + 1);
    for (let i = 0; i < this.perkKeys.length; i++) if (input.hit(`Digit${i + 1}`) || input.hit(`Numpad${i + 1}`)) return this.perkKeys[i];
    if (input.hit('Enter') || input.hit('Mouse0')) return this.perkKeys[this.perkSel];
    return null;
  }

  hurt() { this.hurtTimer = 0.35; }

  update(dt, s) {
    const { player, enemies, world, time, night, label } = s;
    this.el.hp.style.width = (player.hp / player.maxHp) * 100 + '%';
    this.el.st.style.width = Math.max(0, player.stamina / player.stats.maxSt) * 100 + '%';
    if (s.hunter) {
      const h = s.hunter;
      this.el.xp.style.width = Math.min(1, h.xp / h.next) * 100 + '%';
      this.el.lvl.textContent = `NV ${h.level} · ${h.rank.name}`;
      this.el.lvl.style.color = hex(h.rank.color);
    }
    if (s.objective !== undefined && s.objective !== this.objText) this.el.objective.textContent = this.objText = s.objective;
    if (this.toastTimer > 0 && (this.toastTimer -= dt) <= 0) this.el.toast.classList.remove('show');
    this.el.night.textContent = label;
    const hrs = (time * 24 + 6) % 24;
    this.el.clock.textContent = `${String(Math.floor(hrs)).padStart(2, '0')}:${String(Math.floor((hrs % 1) * 60)).padStart(2, '0')}  ➶${player.bolts}`;
    this.el.kills.textContent = enemies.kills;
    this.el.souls.textContent = enemies.souls;
    const boss = enemies.boss;
    this.el.boss.classList.toggle('hidden', !boss);
    // the Count's bar shows where his phases begin (enemies.js BOSS_PHASES)
    this.el.boss.classList.toggle('phased', !!boss?.T.boss);
    if (boss) {
      this.el.bossName.textContent = boss.name ?? boss.T.name;
      this.el.bossFill.style.width = Math.max(0, boss.hp / (boss.maxHp ?? boss.T.hp)) * 100 + '%';
    }
    if (this.msgTimer > 0 && (this.msgTimer -= dt) <= 0) {
      this.el.msg.classList.remove('show');
      const next = this.msgQueue.shift();
      if (next) this.message(...next);
    }
    this.hurtTimer = Math.max(0, this.hurtTimer - dt);
    const low = player.hp < 30 ? 0.35 + Math.sin(performance.now() / 200) * 0.15 : 0;
    this.el.vignette.style.opacity = Math.max(low, this.hurtTimer * 2.5);
    this.drawMap(dt, player, enemies, world, s.camYaw, s.target);
  }

  // Window into the pre-painted valley map, with markers clamped to the rim when out of range.
  drawMap(dt, player, enemies, world, camYaw, target) {
    const px = player.pos.x, pz = player.pos.z, M = world.map;
    const c = this.ctx, S = 140, k = S / (RANGE * 2), mpp = M.size / (M.canvas.width - 1);
    c.save();
    c.clearRect(0, 0, S, S);
    c.beginPath();
    c.arc(S / 2, S / 2, S / 2, 0, Math.PI * 2);
    c.clip();
    c.fillStyle = '#1a1622';
    c.fillRect(0, 0, S, S);
    c.imageSmoothingEnabled = false;
    const src = (RANGE * 2) / mpp;
    c.drawImage(M.canvas, (px - RANGE - M.x0) / mpp, (pz - RANGE - M.z0) / mpp, src, src, 0, 0, S, S);
    c.fillStyle = 'rgba(0,0,0,0.2)';
    c.fillRect(0, 0, S, S);
    const plot = (x, z, color, r) => {
      c.fillStyle = color;
      c.fillRect(S / 2 + (x - px) * k - r, S / 2 + (z - pz) * k - r, r * 2, r * 2);
    };
    const icon = (x, z, ch, color, size = 14) => {
      const dx = x - px, dz = z - pz, d = Math.hypot(dx, dz) || 1, r = Math.min(d * k, S / 2 - 8);
      c.fillStyle = color;
      c.font = `${size}px VT323`;
      c.textAlign = 'center';
      c.fillText(ch, S / 2 + (dx / d) * r, S / 2 + (dz / d) * r + size * 0.35);
    };
    for (const { l } of world.visibleLights) plot(l.x, l.z, '#ffd070', 1.5);
    for (const o of enemies.orbs) plot(o.mesh.position.x, o.mesh.position.z, '#80f0ff', 1.5);
    for (const e of enemies.list) if (!e.dying) plot(e.pos.x, e.pos.z, DOT[e.type], e.T.boss ? 4 : 2.5);
    for (const cf of world.coffins) if (!cf.destroyed) icon(cf.x, cf.z, '✝', '#ff3050');
    icon(CASTLE.x, CASTLE.z, '♜', world.gate.open ? '#ffd040' : '#ff2040');
    if (target) {
      const pulse = 0.6 + 0.4 * Math.sin(performance.now() / 180);
      icon(target.x, target.z, '◆', `rgba(255, 230, 120, ${pulse})`, 16);
    }
    // player arrow
    c.translate(S / 2, S / 2);
    c.rotate(-player.facing + Math.PI);
    c.fillStyle = '#60e8ff';
    c.beginPath();
    c.moveTo(0, -6);
    c.lineTo(4, 5);
    c.lineTo(-4, 5);
    c.fill();
    c.restore();
    // camera direction tick
    c.strokeStyle = 'rgba(255,255,255,0.35)';
    c.beginPath();
    c.moveTo(S / 2, S / 2);
    c.lineTo(S / 2 - Math.sin(camYaw) * 16, S / 2 - Math.cos(camYaw) * 16);
    c.stroke();
  }
}
