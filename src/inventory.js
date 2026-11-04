// Survival-horror inventory in the old Capcom style: 8 slots, use / combine / examine / discard,
// a condition ECG, the equipped weapons and a slowly turning 3D view of the selected item.
import * as THREE from 'three';
import './inventory.css';
import { ITEMS, EQUIP, combine, itemModel, Pickups } from './items.js';
import { sfx } from './audio.js';

const SLOTS = 8, COLS = 4, ROWS = SLOTS / COLS;
const START = ['herbG', 'water'];
const ACTIONS = [['use', 'USAR'], ['startCombine', 'COMBINAR'], ['examine', 'EXAMINAR'], ['drop', 'DESCARTAR']];
const LOOT = { ghoul: 0.12, vampire: 0.18, bat: 0.05, bride: 0.35, wolf: 0.22, witch: 0.3 };
const BLESS_MAX = 90;
const PV = 96; // preview render size, upscaled with chunky pixels
const ICON_POSE = { sword: [0, 0.3, -0.8], crossbow: [0.5, 0.9, 0] };
// hp fraction above which each condition applies: label, color, heart rate
const COND = [[0.66, 'BEM', '#3cff6a', 1.1], [0.4, 'CUIDADO', '#ffd23c', 1.45], [0.2, 'CUIDADO', '#ff8a2a', 1.8], [-1, 'PERIGO', '#ff2a3a', 2.3]];
const HELP = {
  grid: 'WASD mover · E selecionar · TAB fechar',
  menu: 'W/S escolher · E confirmar · Q voltar',
  combine: 'Escolha o item para combinar · Q cancelar',
  examine: 'WASD girar · Q voltar',
};
const TOUCH_HELP = { grid: 'Toque em um item', menu: 'Toque em uma ação', combine: 'Toque no item para combinar', examine: 'Toque para voltar' };
const BAG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M3 8h18v12H3zM9 8V5h6v3M3 13h18" /></svg>';

const el = (tag, cls, parent, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  parent?.appendChild(e);
  return e;
};

// one heartbeat (P, QRS, T waves), p in [0, 1)
const bump = (p, c, w) => Math.exp(-(((p - c) / w) ** 2));
const beat = (p) => 0.12 * bump(p, 0.18, 0.035) - 0.15 * bump(p, 0.3, 0.015) + bump(p, 0.33, 0.02) - 0.3 * bump(p, 0.37, 0.018) + 0.22 * bump(p, 0.56, 0.05);

export class Inventory {
  constructor(scene, player, fx, renderer) {
    this.player = player;
    this.fx = fx;
    this.pickups = new Pickups(scene);
    this.slots = Array.from({ length: SLOTS }, (_, i) => START[i] ?? null);
    this.blessed = 0;
    this.isOpen = false;
    this.mode = 'grid';
    this.cursor = 0;
    this.menuIdx = 0;
    this.from = -1;
    this.text = '';
    this.shown = 0;
    this.flashT = 0;
    this.sparkT = 0;
    this.mx = this.my = 0;
    this.ecg = { ys: new Float32Array(160), head: 0, acc: 0, phase: 0, amp: 1 };
    this.lamp = null; // the lantern color saved while the blade is blessed
    this.promptHtml = '';
    this.buildPreview(renderer);
    this.buildDom();
    if (import.meta.env.DEV) window.__inv = this;
  }

  // ---------------------------------------------------------------- setup
  // The preview borrows the game's renderer (a second WebGL context can fail on phones): it draws into a small
  // render target whose pixels are copied to a 2D canvas.
  buildPreview(renderer) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = PV;
    canvas.className = 'inv-pv';
    const ctx = canvas.getContext('2d');
    // linear render target -> screen, with the same exposure curve as the game's post pass
    const lut = new Uint8Array(256);
    for (let i = 0; i < 256; i++) lut[i] = Math.round(255 * (1 - Math.exp(-(i / 255) * 1.8)) ** (1 / 2.2));
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xd0dcff, 0x302018, 1.6));
    const sun = new THREE.DirectionalLight(0xfff0e0, 2.4);
    sun.position.set(1.5, 2, 2.5);
    scene.add(sun);
    const cam = new THREE.PerspectiveCamera(30, 1, 0.1, 20);
    cam.position.set(0, 0.35, 3.2);
    cam.lookAt(0, 0, 0);
    const spin = new THREE.Group();
    scene.add(spin);
    this.pv = {
      r: renderer, rt: new THREE.WebGLRenderTarget(PV, PV), buf: new Uint8Array(PV * PV * 4), clear: new THREE.Color(),
      canvas, ctx, img: ctx.createImageData(PV, PV), lut, scene, cam, spin, id: null, tilt: 0.35,
    };
    // slot icons come from the same rig, rendered once
    this.icons = {};
    for (const id of [...Object.keys(ITEMS), ...Object.keys(EQUIP)]) {
      this.show3d(id, ICON_POSE[id]);
      this.renderPreview();
      this.icons[id] = canvas.toDataURL();
    }
    this.show3d(null);
  }

  renderPreview() {
    const { r, rt, buf, img, lut, clear } = this.pv, d = img.data;
    const target = r.getRenderTarget(), alpha = r.getClearAlpha();
    r.getClearColor(clear);
    r.setRenderTarget(rt);
    r.setClearColor(0x000000, 0);
    r.render(this.pv.scene, this.pv.cam);
    r.readRenderTargetPixels(rt, 0, 0, PV, PV, buf);
    r.setRenderTarget(target);
    r.setClearColor(clear, alpha);
    // GL rows are bottom-up
    for (let y = 0; y < PV; y++)
      for (let x = 0, s = (PV - 1 - y) * PV * 4, o = y * PV * 4; x < PV * 4; x += 4) {
        d[o + x] = lut[buf[s + x]];
        d[o + x + 1] = lut[buf[s + x + 1]];
        d[o + x + 2] = lut[buf[s + x + 2]];
        d[o + x + 3] = buf[s + x + 3];
      }
    this.pv.ctx.putImageData(img, 0, 0);
  }

  show3d(id, pose = [0.35, 0.6, 0]) {
    const pv = this.pv;
    pv.spin.clear();
    pv.id = id;
    pv.tilt = pose[0];
    pv.spin.rotation.set(...pose);
    if (!id) return;
    const m = itemModel(id);
    const box = new THREE.Box3().setFromObject(m);
    const size = box.getSize(new THREE.Vector3());
    m.position.sub(box.getCenter(new THREE.Vector3()));
    const holder = new THREE.Group();
    holder.add(m);
    holder.scale.setScalar(1.5 / Math.max(size.x, size.y, size.z));
    pv.spin.add(holder);
  }

  buildDom() {
    const root = el('div', 'hidden', document.body);
    root.id = 'inv';
    const win = el('div', 'inv-win', root);
    const head = el('div', 'inv-head', win, '<span>INVENTÁRIO</span>');
    const x = el('button', 'inv-x', head, '✕');
    x.addEventListener('click', () => this.close());

    const body = el('div', 'inv-body', win);
    const left = el('div', 'inv-col', body);
    const cond = el('div', 'inv-box inv-cond', left, '<div class="inv-lbl">CONDIÇÃO</div>');
    const ecg = el('canvas', 'inv-ecg', cond);
    ecg.width = this.ecg.ys.length;
    ecg.height = 48;
    const state = el('div', 'inv-state', cond);
    const equip = el('div', 'inv-box inv-equip', left, '<div class="inv-lbl">EQUIPADO</div>');
    const eq = (id, extra) => {
      const row = el('div', 'inv-eq', equip, `<img src="${this.icons[id]}" alt="">`);
      el('span', null, row, EQUIP[id].name.toUpperCase());
      return el('em', extra, row);
    };
    const blessLbl = eq('sword', 'inv-bless');
    const ammo = eq('crossbow');

    const grid = el('div', 'inv-box inv-grid', body);
    const slots = this.slots.map((_, i) => {
      const s = el('div', 'inv-slot', grid, '<img alt="">');
      s.addEventListener('click', () => this.tapSlot(i));
      return s;
    });
    const menu = el('div', 'inv-menu hidden', grid);
    const opts = ACTIONS.map(([, label], j) => {
      const o = el('div', 'inv-opt', menu, label);
      o.addEventListener('click', (e) => { e.stopPropagation(); this.menuIdx = j; this.ok(); });
      return o;
    });

    const view = el('div', 'inv-box inv-view', body);
    view.appendChild(this.pv.canvas);
    const name = el('div', 'inv-name', view);
    view.addEventListener('click', () => { if (this.mode === 'examine') this.back(); });

    const text = el('div', 'inv-box inv-text', win);
    const help = el('div', 'inv-help', win);

    // in-game: pickup prompt (tappable on phones) and the blessed-blade timer
    const prompt = el('div', 'hidden', document.body);
    prompt.id = 'invPrompt';
    prompt.addEventListener('click', () => this.pickup());
    const blessHud = el('div', 'hidden', document.body);
    blessHud.id = 'invBless';
    // on-screen button for touch mode; touch.js turns it into a virtual Tab press
    const touchEl = document.getElementById('touch');
    if (touchEl) {
      const b = el('div', 'tb', touchEl, BAG + '<small>ITENS</small>');
      b.id = 'tbInv';
      b.dataset.key = 'Tab';
    }

    addEventListener('keydown', (e) => { if (e.code === 'Tab') e.preventDefault(); });
    this.dom = { root, win, ecg, ctx: ecg.getContext('2d'), state, blessLbl, ammo, grid, slots, menu, opts, view, name, text, help, prompt, blessHud };
  }

  // ---------------------------------------------------------------- inventory ops
  add(id) {
    const i = this.slots.indexOf(null);
    if (i >= 0) this.slots[i] = id;
    return i >= 0;
  }

  pickup() {
    if (this.player.dead || this.isOpen) return;
    const p = this.pickups.nearest(this.player.pos);
    if (!p) return;
    if (!this.add(p.id)) {
      this.flash('Não há espaço para carregar mais itens.');
      sfx.deny?.();
      return;
    }
    this.pickups.remove(p, true);
    this.flash(`Você pegou: ${ITEMS[p.id].name}.`);
    sfx.pickup();
  }

  loot(e) {
    const drop = (id, dx = 0, life = 90) => this.pickups.spawn(id, e.pos.x + dx, e.pos.z, { life, pop: true });
    if (e.T?.boss) { drop('water', -0.7, Infinity); drop('mixGR', 0.7, Infinity); return; }
    if (Math.random() > (LOOT[e.type] ?? 0.1)) return;
    const r = Math.random();
    drop(r < 0.6 ? 'herbG' : r < 0.85 ? 'herbR' : 'water');
  }

  get damageMul() { return this.blessed > 0 ? 2 : 1; }

  save() { return { slots: [...this.slots], bless: Math.round(this.blessed) }; }

  load(s) {
    if (!s) return;
    this.slots = Array.from({ length: SLOTS }, (_, i) => (ITEMS[s.slots?.[i]] ? s.slots[i] : null));
    this.blessed = Math.min(BLESS_MAX, Math.max(0, +s.bless || 0));
  }

  // ---------------------------------------------------------------- menu flow
  open() {
    this.isOpen = true;
    this.mode = 'grid';
    this.mx = this.my = 0;
    this.dom.root.classList.remove('hidden');
    this.dom.prompt.classList.add('hidden');
    this.dom.blessHud.classList.add('hidden');
    this.describe();
    sfx.select?.();
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.mode = 'grid';
    this.dom.root.classList.add('hidden');
    this.dom.root.classList.remove('examining');
    sfx.cancel?.();
  }

  // returns false once the inventory is closed
  handle(input) {
    if (!this.isOpen) return false;
    const hit = (...codes) => codes.some((c) => input.hit(c));
    let dx = hit('KeyD', 'ArrowRight') - hit('KeyA', 'ArrowLeft');
    let dy = hit('KeyS', 'ArrowDown') - hit('KeyW', 'ArrowUp');
    // with the pointer locked, the mouse nudges the cursor too
    this.mx += input.dx;
    this.my += input.dy;
    if (Math.abs(this.mx) > 90) { dx += Math.sign(this.mx); this.mx = 0; }
    if (Math.abs(this.my) > 90) { dy += Math.sign(this.my); this.my = 0; }
    if (hit('Tab', 'KeyI', 'Escape')) this.close();
    else if (hit('KeyE', 'Enter', 'Space', 'Mouse0')) this.ok();
    else if (hit('KeyQ', 'Backspace', 'KeyC', 'Mouse2')) this.back();
    else if (dx || dy) this.move(dx, dy);
    return this.isOpen;
  }

  move(dx, dy) {
    if (this.mode === 'menu') {
      if (!dy) return;
      this.menuIdx = (this.menuIdx + dy + ACTIONS.length) % ACTIONS.length;
    } else if (this.mode === 'examine') {
      this.pv.spin.rotation.y += dx * 0.6;
      this.pv.tilt = Math.min(1.4, Math.max(-1.4, this.pv.tilt + dy * 0.35));
      return;
    } else {
      const c = (this.cursor % COLS + dx + COLS) % COLS, r = (Math.floor(this.cursor / COLS) + dy + ROWS) % ROWS;
      this.cursor = r * COLS + c;
      if (this.mode === 'grid') this.describe();
    }
    sfx.cursor?.();
  }

  ok() {
    if (this.mode === 'grid') {
      if (!this.slots[this.cursor]) return sfx.deny?.();
      this.mode = 'menu';
      this.menuIdx = 0;
      sfx.select?.();
    } else if (this.mode === 'menu') {
      this[ACTIONS[this.menuIdx][0]]();
    } else if (this.mode === 'combine') {
      this.finishCombine();
    } else this.back();
  }

  back() {
    if (this.mode === 'grid') return this.close();
    if (this.mode === 'combine') this.cursor = this.from;
    this.mode = 'grid';
    this.dom.root.classList.remove('examining');
    this.describe();
    sfx.cancel?.();
  }

  tapSlot(i) {
    if (this.mode === 'combine') { this.cursor = i; return this.finishCombine(); }
    this.mode = 'grid';
    this.dom.root.classList.remove('examining');
    this.cursor = i;
    this.describe();
    this.ok();
  }

  // ---------------------------------------------------------------- actions
  use() {
    const id = this.slots[this.cursor], it = ITEMS[id], p = this.player;
    this.mode = 'grid';
    if (it.heal) {
      if (p.hp >= p.maxHp) return this.say('Você não está ferido.', true);
      p.heal(it.heal);
      this.slots[this.cursor] = null;
      this.say(`Você usou: ${it.name}.`);
      sfx.heal?.();
      this.fx?.burst(p.pos.clone().setY(p.pos.y + 1), 0x60ff80, 16, { speed: 2, up: 3, gravity: -2, life: 0.8 });
    } else if (it.bless) {
      this.blessed = Math.min(BLESS_MAX, this.blessed + it.bless);
      this.slots[this.cursor] = null;
      this.say('A lâmina brilha com luz sagrada. Dano em dobro!');
      sfx.bless?.();
    } else this.say('Não é possível usar isso sozinho.', true);
  }

  startCombine() {
    this.mode = 'combine';
    this.from = this.cursor;
    this.say(`Combinar ${ITEMS[this.slots[this.from]].name} com...`);
    sfx.select?.();
  }

  finishCombine() {
    const a = this.slots[this.from], b = this.slots[this.cursor];
    if (this.cursor === this.from || !b) return this.say('Escolha outro item.', true);
    const r = combine(a, b);
    this.mode = 'grid';
    if (!r) { this.cursor = this.from; return this.say('Não é possível combinar.', true); }
    this.slots[this.from] = r;
    this.slots[this.cursor] = null;
    this.cursor = this.from;
    this.say(`Você misturou as ervas: ${ITEMS[r].name}.`);
    sfx.heal?.();
  }

  examine() {
    this.mode = 'examine';
    this.dom.root.classList.add('examining');
    this.say(ITEMS[this.slots[this.cursor]].desc);
    sfx.select?.();
  }

  drop() {
    const id = this.slots[this.cursor], p = this.player;
    this.slots[this.cursor] = null;
    this.mode = 'grid';
    this.pickups.spawn(id, p.pos.x + Math.sin(p.facing) * 1.2, p.pos.z + Math.cos(p.facing) * 1.2);
    this.say(`Você descartou: ${ITEMS[id].name}.`);
    sfx.cancel?.();
  }

  // ---------------------------------------------------------------- text
  say(msg, bad = false) {
    this.text = msg;
    this.shown = 0;
    this.dom.text.classList.toggle('bad', bad);
    if (bad) sfx.deny?.();
  }

  describe() {
    const id = this.slots[this.cursor];
    this.say(id ? ITEMS[id].desc : '');
  }

  flash(msg) {
    this.dom.prompt.textContent = msg;
    this.flashT = 2.2;
  }

  // ---------------------------------------------------------------- per frame
  update(dt, time, state, world) {
    const play = state === 'play', p = this.player;
    this.pickups.update(play ? dt : 0, p, world, play);

    if (play && this.blessed > 0) {
      this.blessed = Math.max(0, this.blessed - dt);
      if ((this.sparkT -= dt) <= 0 && this.fx) {
        this.sparkT = 0.08;
        const a = p.facing + 0.6;
        this.fx.burst(new THREE.Vector3(p.pos.x + Math.sin(a) * 0.5, p.pos.y + 1.2, p.pos.z + Math.cos(a) * 0.5), 0xffd060, 1, { speed: 0.6, up: 1.2, gravity: 0, life: 0.5, size: 0.08 });
      }
      if (this.blessed === 0) this.flash('A bênção da lâmina se esvaiu.');
    }
    // the hunter's lantern turns golden while the blade is blessed
    const blessed = this.blessed > 0;
    if (p.light && blessed !== (this.lamp !== null)) {
      if (blessed) { this.lamp = p.light.color.getHex(); p.light.color.setHex(0xffc040); }
      else { p.light.color.setHex(this.lamp); this.lamp = null; }
    }

    // in-game prompt / feedback
    const near = play && !p.dead ? this.pickups.nearest(p.pos) : null;
    if (this.flashT > 0) { this.flashT -= dt; this.promptHtml = ''; }
    else if (near) {
      const html = `<b>${document.body.classList.contains('touch') ? 'TOQUE' : 'E'}</b> ${ITEMS[near.id].name}`;
      if (html !== this.promptHtml) this.dom.prompt.innerHTML = this.promptHtml = html;
    }
    this.dom.prompt.classList.toggle('hidden', !play || (this.flashT <= 0 && !near));
    this.dom.blessHud.classList.toggle('hidden', !play || !blessed);
    if (blessed) this.dom.blessHud.textContent = `✝ LÂMINA ABENÇOADA ${Math.ceil(this.blessed)}s`;

    if (this.isOpen) this.draw(dt);
  }

  draw(dt) {
    const d = this.dom, p = this.player;
    // slots, combine source, action menu
    this.slots.forEach((id, i) => {
      const s = d.slots[i], img = s.firstChild;
      if (img.dataset.id !== (id || '')) {
        img.dataset.id = id || '';
        if (id) img.src = this.icons[id];
        else img.removeAttribute('src');
      }
      s.classList.toggle('sel', i === this.cursor);
      s.classList.toggle('from', this.mode === 'combine' && i === this.from);
    });
    const menuOn = this.mode === 'menu';
    d.menu.classList.toggle('hidden', !menuOn);
    if (menuOn) {
      const s = d.slots[this.cursor], right = this.cursor % COLS < COLS / 2;
      d.menu.style.top = s.offsetTop + 'px';
      d.menu.style.left = right ? s.offsetLeft + s.offsetWidth - 4 + 'px' : '';
      d.menu.style.right = right ? '' : d.grid.clientWidth - s.offsetLeft - 4 + 'px';
      d.opts.forEach((o, j) => o.classList.toggle('on', j === this.menuIdx));
    }
    const touch = document.body.classList.contains('touch');
    d.help.textContent = (touch ? TOUCH_HELP : HELP)[this.mode];

    // typewriter description
    const n = Math.min(this.text.length, (this.shown += dt * 90) | 0);
    if (d.text.textContent.length !== n || !this.text.startsWith(d.text.textContent)) d.text.textContent = this.text.slice(0, n);

    // condition
    const k = p.hp / p.maxHp, [, label, color, rate] = COND.find(([t]) => k > t);
    d.state.textContent = label;
    d.state.style.color = color;
    this.drawEcg(dt, color, rate, label === 'PERIGO');
    d.blessLbl.textContent = this.blessed > 0 ? `✝ ${Math.ceil(this.blessed)}s` : '';
    d.ammo.textContent = p.bolts != null ? `➶ ${p.bolts}` : '';

    // rotating preview of the selected item
    const id = this.slots[this.cursor];
    if (id !== this.pv.id) this.show3d(id);
    d.name.textContent = id ? ITEMS[id].name : '— vazio —';
    const pv = this.pv;
    if (this.mode !== 'examine') pv.spin.rotation.y += dt * 0.9;
    pv.spin.rotation.x = pv.tilt;
    this.renderPreview();
  }

  drawEcg(dt, color, rate, weak) {
    const e = this.ecg, c = this.dom.ctx, W = e.ys.length, H = this.dom.ecg.height, GAP = 10;
    for (e.acc += dt * 60; e.acc >= 1; e.acc--) {
      e.head = (e.head + 1) % W;
      e.phase += rate / 60;
      // a weak pulse beats unevenly
      if (e.phase >= 1) { e.phase -= 1; e.amp = weak ? 0.45 + Math.random() * 0.4 : 1; }
      e.ys[e.head] = beat(e.phase) * e.amp;
    }
    c.clearRect(0, 0, W, H);
    c.strokeStyle = 'rgba(80, 120, 140, 0.18)';
    c.lineWidth = 1;
    c.beginPath();
    for (let x = 8; x < W; x += 16) { c.moveTo(x + 0.5, 0); c.lineTo(x + 0.5, H); }
    for (let y = 8; y < H; y += 16) { c.moveTo(0, y + 0.5); c.lineTo(W, y + 0.5); }
    c.stroke();
    c.strokeStyle = color;
    c.lineWidth = 2;
    const y = (v) => H * 0.64 - v * H * 0.5;
    for (let a = W - GAP; a > 0; a--) {
      const x1 = (e.head - a + 1 + W) % W, x0 = (x1 - 1 + W) % W;
      if (x1 === 0) continue;
      c.globalAlpha = 1 - a / W;
      c.beginPath();
      c.moveTo(x0, y(e.ys[x0]));
      c.lineTo(x1, y(e.ys[x1]));
      c.stroke();
    }
    c.globalAlpha = 1;
  }
}
