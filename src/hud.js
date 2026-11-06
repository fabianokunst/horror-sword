import { Vector3 } from 'three';
import { PLACES, groundAt } from './world.js';
import { paintSheet, SHEET } from './worldmap.js';
import { route } from './route.js';
import './campaign.css';
import { L } from './i18n.js';

const $ = (id) => document.getElementById(id);
const hex = (c) => '#' + c.toString(16).padStart(6, '0');
const el = (tag, props = {}, parent) => {
  const n = Object.assign(document.createElement(tag), props);
  parent?.append(n);
  return n;
};
const RANGE = 80; // metres from the minimap centre to its rim
const SHEET_PPM = 2.5; // pixels per metre of the parchment behind the minimap
// short landmark names for the minimap
const SHORT = {
  village: 'Borgo', cemetery: L('Cemitério', 'Cemetery'), bridge: L('Ponte', 'Bridge'), windmill: L('Moinho', 'Mill'),
  gallows: L('Forca', 'Gallows'), abbey: L('Abadia', 'Abbey'), castle: L('Castelo', 'Castle'),
};
const paintMini = () => paintSheet(Math.round((SHEET.x1 - SHEET.x0) * SHEET_PPM), false);

export class Hud {
  constructor() {
    this.el = {
      hud: $('hud'), hp: $('hpFill'), st: $('stFill'), night: $('nightLbl'), clock: $('clock'),
      kills: $('kills'), souls: $('souls'), boss: $('boss'), bossName: $('bossName'), bossFill: $('bossFill'),
      msg: $('msg'), msgTitle: $('msgTitle'), msgSub: $('msgSub'), vignette: $('vignette'),
    };
    this.map = $('minimap');
    this.ctx = this.map.getContext('2d');
    this.mapPx = 0; // backing size of the minimap canvas, redone when its CSS size changes
    new ResizeObserver(() => (this.mapPx = 0)).observe(this.map);
    this.mapRotate = true; // settings: the minimap turns with the camera
    this.sheet = null; // its parchment, painted while the game is idle (or on the first frame that needs it)
    (window.requestIdleCallback || setTimeout)(() => (this.sheet ??= paintMini()), { timeout: 3000 });
    this.path = null; // road to the objective (route.js)
    this.pathT = 0;
    this.pathFor = null;
    // under the minimap: how to open the valley map, and the landmark the hunter is in
    this.el.mapKey = el('div', { id: 'mapKey' }, this.el.hud);
    this.el.place = el('div', { id: 'mapPlace' }, this.el.hud);
    this.keyHint = this.placeId = null;
    // the objective marker in the 3D view
    this.el.wp = el('div', { id: 'waypoint', hidden: true }, this.el.hud);
    this.el.wp.innerHTML = '<b class="wp-arrow">▲</b><i>◆</i><span></span>';
    this.el.wpArrow = this.el.wp.querySelector('.wp-arrow');
    this.el.wpDist = this.el.wp.querySelector('span');
    this.wpText = '';
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
      <p class="lu-keys desk-only">${L('1 · 2 · 3 — ou mova o mouse e clique', '1 · 2 · 3 — or move the mouse and click')}</p>`;
    this.perkSel = 0;
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

  // --- level-up: three perk cards, chosen by tap/click (cursor.js draws the pointer under pointer lock), 1-2-3 or arrows
  showPerks(info, onPick) {
    this.onPick = onPick;
    this.perkKeys = info.choices.map((c) => c.key);
    this.perkSel = Math.min(this.perkSel, this.perkKeys.length - 1);
    $('luTitle').textContent = `${L('Nível', 'Level')} ${info.level}`;
    $('luRank').textContent = info.rank.name;
    $('luRank').style.color = hex(info.rank.color);
    $('luHint').textContent = info.picks > 1 ? L(`Escolha um dom (${info.picks} pendentes)`, `Choose a gift (${info.picks} pending)`) : L('Escolha um dom', 'Choose a gift');
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
  // (The mouse picks through the pointer: hovering a card selects it, a click on it chooses it.)
  perkInput(input) {
    if (!this.perkReady()) return null;
    if (input.hit('ArrowLeft') || input.hit('KeyA')) this.selectPerk(this.perkSel - 1);
    if (input.hit('ArrowRight') || input.hit('KeyD')) this.selectPerk(this.perkSel + 1);
    for (let i = 0; i < this.perkKeys.length; i++) if (input.hit(`Digit${i + 1}`) || input.hit(`Numpad${i + 1}`)) return this.perkKeys[i];
    if (input.hit('Enter')) return this.perkKeys[this.perkSel];
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
    this.el.souls.textContent = s.purse ?? enemies.souls; // souls to spend (lifetime total in the reports)
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
    this.guide(dt, player, s.target);
    this.drawMap(player, enemies, world, s.camYaw, s.target, s.shrines, night);
    if (s.mapKey !== this.keyHint) this.el.mapKey.innerHTML = this.keyHint = s.mapKey;
    // the landmark around the hunter, named under the minimap
    const here = PLACES.find((p) => Math.hypot(player.pos.x - p.x, player.pos.z - p.z) < p.r + 10);
    if ((here?.id ?? null) !== this.placeId) {
      this.placeId = here?.id ?? null;
      this.el.place.textContent = here?.name ?? '';
    }
  }

  // The road to the objective (route.js), refreshed a few times a second; the map screens draw it too.
  guide(dt, player, target) {
    if (!target) { this.path = this.pathFor = null; return; }
    if ((this.pathT -= dt) > 0 && this.pathFor === target) return;
    this.pathT = 0.4;
    this.pathFor = target;
    this.path = route({ x: player.pos.x, z: player.pos.z }, target);
  }

  // A window into the valley sheet (worldmap.js, painted without its names), so the minimap reads like the map
  // screen: parchment, roads, forests and the landmark pictures. It turns with the camera (straight ahead is up,
  // the N chip on the rim points north) unless the settings pin north up. Names stay upright, creatures are red
  // dots, and the objective is a red ◆ on the map, or an arrow on the rim with its distance.
  drawMap(player, enemies, world, camYaw, target, shrines, night) {
    const cv = this.map, c = this.ctx;
    if (!this.mapPx) {
      this.mapCss = cv.clientWidth || 140;
      this.mapPx = Math.max(100, Math.round(this.mapCss * Math.min(devicePixelRatio || 1, 2)));
      cv.width = cv.height = this.mapPx;
      this.rimShade = null;
    }
    this.sheet ??= paintMini();
    const S = this.mapPx, R = S / 2, k = R / RANGE;
    // u: one "design pixel" of a 180 px minimap, never so small that the names stop being readable
    const u = (S / this.mapCss) * Math.max(0.8, this.mapCss / 180);
    const px = player.pos.x, pz = player.pos.z, now = performance.now(), pulse = 0.5 + 0.5 * Math.sin(now / 170);
    const rot = this.mapRotate ? camYaw : 0, cr = Math.cos(rot), sr = Math.sin(rot);
    const to = (x, z) => { const dx = (x - px) * k, dz = (z - pz) * k; return [R + dx * cr - dz * sr, R + dx * sr + dz * cr]; };
    const inside = (sx, sy, pad) => Math.hypot(sx - R, sy - R) < R - pad * u;
    const text = (str, sx, sy, color, size, font = 'VT323, monospace', halo = 'rgba(240, 226, 190, 0.92)') => {
      c.font = `${Math.round(size * u)}px ${font}`;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.lineWidth = 3.5 * u;
      c.lineJoin = 'round';
      c.strokeStyle = halo;
      c.strokeText(str, sx, sy);
      c.fillStyle = color;
      c.fillText(str, sx, sy);
    };
    c.save();
    c.clearRect(0, 0, S, S);
    c.beginPath();
    c.arc(R, R, R, 0, Math.PI * 2);
    c.clip();
    c.fillStyle = '#a88a64'; // past the edge of the sheet: more mountains
    c.fillRect(0, 0, S, S);
    c.save();
    c.translate(R, R);
    c.rotate(rot);
    c.imageSmoothingEnabled = true;
    c.drawImage(this.sheet, (SHEET.x0 - px) * k, (SHEET.z0 - pz) * k, (SHEET.x1 - SHEET.x0) * k, (SHEET.z1 - SHEET.z0) * k);
    c.restore();
    // the paper shaded toward the rim
    if (!this.rimShade) {
      this.rimShade = c.createRadialGradient(R, R, R * 0.7, R, R, R);
      this.rimShade.addColorStop(0, 'rgba(40, 20, 5, 0.08)');
      this.rimShade.addColorStop(1, 'rgba(40, 20, 5, 0.5)');
    }
    c.fillStyle = this.rimShade;
    c.fillRect(0, 0, S, S);
    // where the camera looks
    c.save();
    c.translate(R, R);
    c.rotate(rot - camYaw);
    const view = c.createRadialGradient(0, 0, 0, 0, 0, R * 0.75);
    view.addColorStop(0, 'rgba(20, 80, 140, 0.28)');
    view.addColorStop(1, 'rgba(20, 80, 140, 0)');
    c.fillStyle = view;
    c.beginPath(); c.moveTo(0, 0); c.arc(0, 0, R * 0.75, -Math.PI / 2 - 0.55, -Math.PI / 2 + 0.55); c.closePath(); c.fill();
    c.restore();
    // landmark names, upright, under their pictures (never over the hunter or the N chip)
    const nx = R + sr * (R - 11 * u), ny = R - cr * (R - 11 * u);
    for (const p of PLACES) {
      const [sx, sy] = to(p.x, p.z), y = sy + (p.id === 'village' ? 20 : p.id === 'castle' ? 16 : 11) * k + 7 * u;
      if (inside(sx, y, 16) && Math.hypot(sx - R, y - R) > 18 * u && Math.hypot(sx - nx, y - ny) > 24 * u) text(SHORT[p.id] || p.name, sx, y, '#2a1a0e', 15, "'Pirata One', serif");
    }
    // the way to the objective, in red ink like on the map screen
    if (this.path) {
      c.save();
      c.strokeStyle = 'rgba(176, 16, 26, 0.9)';
      c.lineWidth = 3 * u;
      c.lineCap = 'round';
      c.setLineDash([4 * u, 4.5 * u]);
      c.lineDashOffset = -now / 50;
      c.beginPath();
      this.path.forEach((p, i) => { const [x, y] = i ? to(p.x, p.z) : [R, R]; i ? c.lineTo(x, y) : c.moveTo(x, y); });
      c.stroke();
      c.restore();
    }
    // shrines (faded once used tonight), the merchant, the coffins still standing
    for (const sh of shrines || world.shrines || []) {
      const [sx, sy] = to(sh.x, sh.z);
      if (inside(sx, sy, 8)) text('†', sx, sy, sh.used === night ? 'rgba(120, 100, 70, 0.6)' : '#9a6400', 20);
    }
    if (world.merchantSpot) {
      const [sx, sy] = to(world.merchantSpot.x, world.merchantSpot.z + 6);
      if (inside(sx, sy, 8)) text('¤', sx, sy, '#0e6a72', 20);
    }
    for (const cf of world.coffins) {
      if (cf.destroyed || cf === target) continue;
      const [sx, sy] = to(cf.x, cf.z);
      if (inside(sx, sy, 8)) text('✝', sx, sy, '#5a2020', 17);
    }
    // creatures: red dots (bigger for elites, bigger still for a boss)
    for (const e of enemies.list) {
      if (e.dying) continue;
      const [sx, sy] = to(e.pos.x, e.pos.z);
      if (!inside(sx, sy, 3)) continue;
      const r = (e.T.boss ? 6 + pulse : e.elite ? 4.5 : 3.5) * u;
      c.fillStyle = e.T.boss ? '#ff1020' : '#d01828';
      c.strokeStyle = '#1a0606';
      c.lineWidth = 1.4 * u;
      c.beginPath(); c.arc(sx, sy, r, 0, Math.PI * 2); c.fill(); c.stroke();
    }
    // the objective: a pulsing red diamond on the map, or an arrow on the rim with the distance
    if (target) {
      const [tx, ty] = to(target.x, target.z);
      if (inside(tx, ty, 12)) {
        c.strokeStyle = `rgba(176, 16, 26, ${0.5 + 0.45 * pulse})`;
        c.lineWidth = 2.4 * u;
        c.beginPath(); c.arc(tx, ty, (10 + 3 * pulse) * u, 0, Math.PI * 2); c.stroke();
        text('◆', tx, ty, '#c0101c', 22);
      } else {
        const ang = Math.atan2(ty - R, tx - R), rim = R - 2 * u;
        c.save();
        c.translate(R + Math.cos(ang) * rim, R + Math.sin(ang) * rim);
        c.rotate(ang);
        c.fillStyle = '#c0101c';
        c.strokeStyle = '#f4ead0';
        c.lineWidth = 2 * u;
        c.beginPath(); c.moveTo(0, 0); c.lineTo(-14 * u, -9 * u); c.lineTo(-10 * u, 0); c.lineTo(-14 * u, 9 * u); c.closePath();
        c.stroke(); c.fill();
        c.restore();
        const dist = `${Math.round(Math.hypot(target.x - px, target.z - pz))} m`, lr = R - 30 * u;
        text(dist, R + Math.cos(ang) * lr, R + Math.sin(ang) * lr, '#8a0c14', 17);
      }
    }
    // north: a dark chip on the rim (it travels around when the map turns)
    c.fillStyle = 'rgba(30, 16, 8, 0.85)';
    c.beginPath(); c.arc(nx, ny, 8.5 * u, 0, Math.PI * 2); c.fill();
    text('N', nx, ny + 0.5 * u, '#f0d080', 15, "'Pirata One', serif", 'rgba(0, 0, 0, 0)');
    // the hunter, as on the map screen
    c.save();
    c.translate(R, R);
    c.fillStyle = `rgba(30, 140, 200, ${0.2 + 0.12 * pulse})`;
    c.beginPath(); c.arc(0, 0, 13 * u, 0, Math.PI * 2); c.fill();
    c.rotate(rot - player.facing + Math.PI);
    c.fillStyle = '#0c4a78';
    c.strokeStyle = '#f4ead0';
    c.lineWidth = 2 * u;
    c.beginPath(); c.moveTo(0, -10 * u); c.lineTo(7 * u, 8 * u); c.lineTo(0, 4 * u); c.lineTo(-7 * u, 8 * u); c.closePath();
    c.stroke(); c.fill();
    c.restore();
    c.restore();
  }

  // The objective in the 3D view: a diamond over it with the distance, held at the screen edge (with an
  // arrow toward it) when it is off to the side or behind the camera. Called after the camera has moved.
  waypoint(camera, target, player, show) {
    const w = this.el.wp, d = target && Math.hypot(target.x - player.pos.x, target.z - player.pos.z);
    if (!show || !target || d < 7) { if (!w.hidden) w.hidden = true; return; }
    w.hidden = false;
    camera.updateMatrixWorld();
    const v = _wp.set(target.x, groundAt(target.x, target.z) + 2.5, target.z).applyMatrix4(camera.matrixWorldInverse);
    const W = innerWidth, H = innerHeight, m = Math.max(36, Math.min(W, H) * 0.08), top = Math.max(m, Math.min(W, H) * 0.16);
    let sx = 0, sy = 0, edge = v.z > -0.5;
    if (!edge) {
      _ndc.copy(v).applyMatrix4(camera.projectionMatrix);
      sx = ((_ndc.x + 1) / 2) * W;
      sy = ((1 - _ndc.y) / 2) * H;
      edge = sx < m || sx > W - m || sy < top || sy > H - m;
    }
    let ang = 0;
    if (edge) {
      // behind the camera: down at the bottom, on the side it lies
      const dx = v.z > -0.5 ? v.x : sx - W / 2, dy = v.z > -0.5 ? Math.max(0, -v.y) + v.z + 1 : sy - H / 2;
      const t = Math.min((W / 2 - m) / (Math.abs(dx) || 1e-6), (dy < 0 ? H / 2 - top : H / 2 - m) / (Math.abs(dy) || 1e-6));
      sx = W / 2 + dx * t;
      sy = H / 2 + dy * t;
      ang = Math.atan2(dx, -dy);
    }
    w.style.transform = `translate(${sx.toFixed(1)}px, ${sy.toFixed(1)}px)`;
    w.classList.toggle('edge', edge);
    w.classList.toggle('flip', edge && Math.cos(ang) < 0); // arrow below: distance above
    this.el.wpArrow.style.transform = `rotate(${ang.toFixed(3)}rad) translateY(-1.15em)`;
    const txt = `${Math.round(d)} m`;
    if (txt !== this.wpText) this.el.wpDist.textContent = this.wpText = txt;
  }
}
const _wp = new Vector3(), _ndc = new Vector3();
