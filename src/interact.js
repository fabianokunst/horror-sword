// Things in the valley the hunter can use with E, a tap on the prompt, or the D-pad up:
// - the wayside shrines: pray to restore health and bolts and save the hunt there (once per night each);
//   falling sends the hunter back to the last shrine prayed at
// - the merchant in Borgo's square: souls (the ✦ count) buy herbs and holy water; the game pauses while browsing
import * as THREE from 'three';
import './interact.css';
import { makeModel } from './characters.js';
import { groundAt } from './world.js';
import { ITEMS } from './items.js';
import { sfx } from './audio.js';
import { L } from './i18n.js';

const RANGE = 2.6;
export const WARES = [
  { id: 'herbG', price: 8 },
  { id: 'herbR', price: 10 },
  { id: 'water', price: 18 },
  { id: 'mixGR', price: 30 },
];

const el = (tag, cls, parent, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  parent?.append(e);
  return e;
};

export class Interact {
  constructor({ scene, world, player, campaign, inv, hud, fx }) {
    Object.assign(this, { world, player, campaign, inv, hud, fx });
    this.shrines = (world.shrines || []).map((s) => ({ ...s, used: -1, power: s.light?.power ?? 0 }));
    const spot = world.merchantSpot;
    this.merchant = null;
    if (spot) {
      const m = makeModel('merchant');
      m.root.position.set(spot.x, groundAt(spot.x, spot.z), spot.z);
      m.root.rotation.y = spot.facing;
      scene.add(m.root);
      world.addObstacle({ x: spot.x, z: spot.z, r: 0.5 });
      this.merchant = { ...spot, m, look: spot.facing };
    }
    this.sel = 0;
    this.acc = 0;
    this.isOpen = false;
    this.html = '';
    this.buildDom();
  }

  buildDom() {
    this.prompt = el('div', 'hidden', document.body);
    this.prompt.id = 'actPrompt';
    this.prompt.addEventListener('click', () => this.onTap?.());
    this.onTap = null; // main.js: same as pressing E

    const shop = (this.shop = el('div', 'overlay hidden', document.body));
    shop.id = 'shop';
    el('h1', null, shop, L('Mercador', 'Merchant'));
    this.purseEl = el('h2', null, shop);
    this.wares = el('div', null, shop);
    this.wares.id = 'wares';
    this.cards = WARES.map((w, i) => {
      const b = el('button', 'ware', this.wares,
        `<span class="pk-n">${i + 1}</span><b>${ITEMS[w.id].name}</b><span class="wr-p">✦ ${w.price}</span><span class="pk-d">${ITEMS[w.id].desc}</span>`);
      b.addEventListener('click', () => { this.select(i); this.buy(i); });
      return b;
    });
    this.say = el('p', 'shop-say', shop, '&nbsp;');
    const close = el('button', 'secondary', shop, L('SAIR', 'LEAVE'));
    close.addEventListener('click', () => this.close());
    el('p', 'lu-keys desk-only', shop, L('1 · 2 · 3 · 4 ou ← → e Enter — Esc para sair', '1 · 2 · 3 · 4 or ← → and Enter — Esc to leave'));
  }

  get purse() { return this.campaign.save.purse || 0; }

  // what the hunter stands next to: { kind: 'shrine', s } | { kind: 'merchant' } | null
  nearest() {
    const p = this.player.pos;
    let best = null, bd = RANGE;
    for (const s of this.shrines) {
      const d = Math.hypot(s.x - p.x, s.z - p.z);
      if (d < bd) { bd = d; best = { kind: 'shrine', s }; }
    }
    const m = this.merchant;
    if (m && Math.hypot(m.x - p.x, m.z - p.z) < bd) best = { kind: 'merchant' };
    return best;
  }

  // E pressed: returns 'shop' when the merchant's window opened, true for a prayer, false for nothing here
  use(night) {
    if (this.player.dead || this.isOpen) return false;
    const n = this.nearest();
    if (!n) return false;
    if (n.kind === 'shrine') { this.pray(n.s, night); return true; }
    this.open();
    return 'shop';
  }

  pray(s, night) {
    if (s.used === night) {
      sfx.deny?.();
      this.hud.toast(L('O santuário já atendeu suas preces nesta noite.', 'This shrine has already answered your prayers tonight.'));
      return;
    }
    s.used = night;
    const p = this.player;
    p.heal(p.maxHp);
    p.bolts = p.stats.maxBolts;
    p.stamina = p.stats.maxSt;
    sfx.bless();
    this.fx?.burst(new THREE.Vector3(s.x, p.pos.y + 1.4, s.z), 0xffd080, 30, { speed: 3, up: 3, gravity: -0.5, life: 1.2, size: 0.12 });
    this.campaign.checkpoint(false);
    this.hud.toast(L('✝ Você reza: vida e virotes restaurados · progresso salvo aqui', '✝ You pray: health and bolts restored · progress saved here'));
  }

  open() {
    this.isOpen = true;
    this.sel = 0;
    this.acc = 0;
    this.shop.classList.remove('hidden');
    this.talk(this.purse ? L('Almas por remédios, caçador. Escolha.', 'Souls for remedies, hunter. Take your pick.') : L('Sem almas, sem negócio. Volte quando tiver caçado.', 'No souls, no deal. Come back after the hunt.'));
    this.refresh();
    sfx.select?.();
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.shop.classList.add('hidden');
    sfx.cancel?.();
  }

  talk(text, bad = false) {
    this.say.textContent = text;
    this.say.classList.toggle('bad', bad);
  }

  refresh() {
    this.purseEl.textContent = `✦ ${this.purse} ${L('almas', 'souls')}`;
    this.cards.forEach((c, i) => {
      c.classList.toggle('sel', i === this.sel);
      c.classList.toggle('off', WARES[i].price > this.purse);
    });
  }

  select(i) {
    this.sel = (i + WARES.length) % WARES.length;
    this.refresh();
  }

  buy(i) {
    const w = WARES[i], s = this.campaign.save;
    if (w.price > this.purse) { sfx.deny?.(); return this.talk(L('Almas insuficientes.', 'Not enough souls.'), true); }
    if (!this.inv.add(w.id)) { sfx.deny?.(); return this.talk(L('Seu inventário está cheio.', 'Your inventory is full.'), true); }
    s.purse -= w.price;
    this.campaign.persistProgress?.();
    sfx.pickup?.();
    this.talk(`${ITEMS[w.id].name} — ${L('negócio fechado.', 'done deal.')}`);
    this.refresh();
  }

  // polled while the window is open; false once it closed
  handle(input) {
    if (!this.isOpen) return false;
    const hit = (...c) => c.some((k) => input.hit(k));
    this.acc += input.dx;
    if (Math.abs(this.acc) > 90) { this.select(this.sel + Math.sign(this.acc)); this.acc = 0; }
    if (hit('ArrowLeft', 'KeyA', 'ArrowUp', 'KeyW')) this.select(this.sel - 1);
    if (hit('ArrowRight', 'KeyD', 'ArrowDown', 'KeyS')) this.select(this.sel + 1);
    for (let i = 0; i < WARES.length; i++) if (hit(`Digit${i + 1}`, `Numpad${i + 1}`)) { this.select(i); this.buy(i); }
    if (hit('Enter', 'Space', 'Mouse0')) this.buy(this.sel);
    if (hit('Escape', 'KeyC', 'Mouse2', 'Tab', 'KeyE')) this.close();
    return this.isOpen;
  }

  update(dt, { play, night, touch }) {
    // shrines already prayed at tonight glow dimmer
    for (const s of this.shrines) if (s.light) s.light.power = s.used === night ? s.power * 0.25 : s.power;
    // the merchant turns to face a hunter who comes close
    const m = this.merchant, p = this.player.pos;
    if (m) {
      const want = Math.hypot(p.x - m.x, p.z - m.z) < 8 ? Math.atan2(p.x - m.x, p.z - m.z) : m.facing;
      let d = want - m.look;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      m.look += d * (1 - Math.exp(-4 * dt));
      m.m.root.rotation.y = m.look;
      if (m.m.spine) m.m.spine.rotation.x = 0.06 + Math.sin(performance.now() / 900) * 0.03;
    }
    const n = play && !this.player.dead ? this.nearest() : null;
    let html = '';
    if (n) {
      const key = touch ? L('TOQUE', 'TAP') : 'E';
      if (n.kind === 'merchant') html = `<b>${key}</b> ${L('Falar com o mercador', 'Talk to the merchant')} · ✦ ${this.purse}`;
      else html = n.s.used === night ? L('✝ Santuário (já usado nesta noite)', '✝ Shrine (already used tonight)') : `<b>${key}</b> ${L('Rezar no santuário', 'Pray at the shrine')}`;
    }
    if (html !== this.html) this.prompt.innerHTML = this.html = html;
    this.prompt.classList.toggle('hidden', !html);
  }
}
