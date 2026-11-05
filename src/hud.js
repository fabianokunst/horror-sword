import { Vector3 } from 'three';
import { CASTLE, ROADS, PLACES, groundAt } from './world.js';
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
const DOT = { ghoul: '#9cff40', vampire: '#ff3050', bat: '#c040ff', bride: '#ff60c0', wolf: '#ffa030', dracula: '#ff0000', witch: '#60ff90' };
const RANGE = 80; // metres from the minimap centre to its rim

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
    this.drawMap(player, enemies, world, s.camYaw, s.target);
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

  // Window into the pre-painted valley map. It turns with the camera (straight ahead is up, N marks north)
  // unless the settings pin north up. Objectives out of range sit on the rim with an arrow and their distance.
  drawMap(player, enemies, world, camYaw, target) {
    const cv = this.map, c = this.ctx;
    if (!this.mapPx) {
      this.mapPx = Math.max(140, Math.round(cv.clientWidth * Math.min(devicePixelRatio || 1, 2)));
      cv.width = cv.height = this.mapPx;
    }
    const S = this.mapPx, R = S / 2, u = S / 140, k = R / RANGE, M = world.map, mpp = M.size / (M.canvas.width - 1);
    const px = player.pos.x, pz = player.pos.z, now = performance.now();
    const rot = this.mapRotate ? camYaw : 0, cr = Math.cos(rot), sr = Math.sin(rot);
    const to = (x, z) => { const dx = (x - px) * k, dz = (z - pz) * k; return [R + dx * cr - dz * sr, R + dx * sr + dz * cr]; };
    c.save();
    c.clearRect(0, 0, S, S);
    c.beginPath();
    c.arc(R, R, R, 0, Math.PI * 2);
    c.clip();
    c.fillStyle = '#1a1622';
    c.fillRect(0, 0, S, S);
    // terrain and roads, in the turned frame
    c.save();
    c.translate(R, R);
    c.rotate(rot);
    c.imageSmoothingEnabled = true;
    c.drawImage(M.canvas, (M.x0 - px - mpp / 2) * k, (M.z0 - pz - mpp / 2) * k, M.canvas.width * mpp * k, M.canvas.height * mpp * k);
    c.fillStyle = 'rgba(0,0,0,0.25)';
    c.fillRect(-S, -S, S * 2, S * 2);
    c.lineCap = c.lineJoin = 'round';
    c.strokeStyle = 'rgba(232, 200, 140, 0.8)';
    c.lineWidth = Math.max(2 * u, 5 * k);
    for (const rd of ROADS) {
      c.beginPath();
      rd.forEach(([x, z], i) => (i ? c.lineTo : c.moveTo).call(c, (x - px) * k, (z - pz) * k));
      c.stroke();
    }
    c.restore();
    // the way to the objective: gold dots marching along the roads
    if (this.path) {
      c.save();
      c.strokeStyle = '#ffd860';
      c.lineWidth = 2.4 * u;
      c.setLineDash([2.5 * u, 4 * u]);
      c.lineDashOffset = -now / 60;
      c.beginPath();
      this.path.forEach((p, i) => { const [x, y] = i ? to(p.x, p.z) : [R, R]; i ? c.lineTo(x, y) : c.moveTo(x, y); });
      c.stroke();
      c.restore();
    }
    const dot = (x, z, color, r) => { const [sx, sy] = to(x, z); c.fillStyle = color; c.fillRect(sx - r * u, sy - r * u, r * 2 * u, r * 2 * u); };
    const text = (ch, sx, sy, color, size) => {
      c.font = `${Math.round(size * u)}px VT323, monospace`;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.lineWidth = 3 * u;
      c.strokeStyle = 'rgba(0, 0, 0, 0.85)';
      c.strokeText(ch, sx, sy);
      c.fillStyle = color;
      c.fillText(ch, sx, sy);
    };
    const inside = (sx, sy, pad = 8) => Math.hypot(sx - R, sy - R) < R - pad * u;
    // on the map only (shrines, merchant) or pinned to the rim when out of range (coffins, castle)
    const icon = (x, z, ch, color, size = 14, pin = true) => {
      let [sx, sy] = to(x, z);
      const d = Math.hypot(sx - R, sy - R) || 1, rim = R - 9 * u;
      if (d > rim) { if (!pin) return; sx = R + ((sx - R) / d) * rim; sy = R + ((sy - R) / d) * rim; }
      text(ch, sx, sy, color, size);
    };
    for (const { l } of world.visibleLights) dot(l.x, l.z, '#ffd070', 1.5);
    for (const o of enemies.orbs) dot(o.mesh.position.x, o.mesh.position.z, '#80f0ff', 1.5);
    for (const e of enemies.list) if (!e.dying) dot(e.pos.x, e.pos.z, DOT[e.type], e.T.boss ? 4 : 2.5);
    for (const s of world.shrines || []) icon(s.x, s.z, '†', '#ffd080', 15, false);
    if (world.merchantSpot) icon(world.merchantSpot.x, world.merchantSpot.z, '¤', '#90f0ff', 15, false);
    for (const cf of world.coffins) if (!cf.destroyed && cf !== target) icon(cf.x, cf.z, '✝', '#a03040', 13);
    icon(CASTLE.x, CASTLE.z, '♜', world.gate.open ? '#ffd040' : '#c02040', 15);
    // the objective: a pulsing diamond on the map, or an arrow on the rim with the distance
    if (target) {
      const pulse = 0.6 + 0.4 * Math.sin(now / 180), [tx, ty] = to(target.x, target.z);
      if (inside(tx, ty, 10)) text('◆', tx, ty, `rgba(255, 220, 90, ${pulse})`, 20);
      else {
        const a = Math.atan2(ty - R, tx - R), rim = R - 3 * u;
        c.save();
        c.translate(R + Math.cos(a) * rim, R + Math.sin(a) * rim);
        c.rotate(a);
        c.fillStyle = `rgba(255, 216, 96, ${0.75 + 0.25 * pulse})`;
        c.strokeStyle = '#000';
        c.lineWidth = 1.5 * u;
        c.beginPath(); c.moveTo(1 * u, 0); c.lineTo(-11 * u, -8 * u); c.lineTo(-11 * u, 8 * u); c.closePath();
        c.stroke(); c.fill();
        c.restore();
        const dist = Math.hypot(target.x - px, target.z - pz), lr = R - 24 * u;
        text(`${Math.round(dist)}m`, R + Math.cos(a) * lr, R + Math.sin(a) * lr, '#ffe8a0', 15);
      }
    }
    // north on the rim (it moves when the map turns)
    if (this.mapRotate) text('N', R + sr * (R - 9 * u), R - cr * (R - 9 * u), '#ff8070', 15);
    // what the camera sees, then the hunter
    c.save();
    c.translate(R, R);
    c.rotate(rot - camYaw);
    const view = c.createRadialGradient(0, 0, 0, 0, 0, R * 0.7);
    view.addColorStop(0, 'rgba(255,255,255,0.18)');
    view.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = view;
    c.beginPath(); c.moveTo(0, 0); c.arc(0, 0, R * 0.7, -Math.PI / 2 - 0.55, -Math.PI / 2 + 0.55); c.closePath(); c.fill();
    c.restore();
    c.save();
    c.translate(R, R);
    c.rotate(rot - player.facing + Math.PI);
    c.fillStyle = '#60e8ff';
    c.strokeStyle = '#000';
    c.lineWidth = 1.5 * u;
    c.beginPath(); c.moveTo(0, -7 * u); c.lineTo(5 * u, 6 * u); c.lineTo(0, 3 * u); c.lineTo(-5 * u, 6 * u); c.closePath();
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
