// On-screen controls for phones/tablets: floating stick (left side), camera drag (right side), action buttons.
// Everything is fed into Input, so the game loop treats it like keyboard + mouse.
const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

const STICK_ZONE = 0.45; // touches starting in this fraction of the width (from the left) grab the stick
const DEAD = 0.18;
const LOOK = 1100; // dragging across the screen's short side turns the camera ~150°
const REPEAT = 0.1; // holding the sword keeps the combo going

export class TouchControls {
  constructor(input) {
    this.input = input;
    this.el = $('touch');
    this.base = $('stick');
    this.knob = $('knob');
    this.sprintBtn = $('tbSprint');
    this.boltBtn = this.el.querySelector('[data-key="KeyQ"]');
    this.ammo = $('ammo');
    this.onPause = null;
    this.stickId = null;
    this.lookId = null;
    this.held = new Map(); // pointerId -> button
    this.repeat = 0;
    this.lastBolts = -1;

    this.el.addEventListener('pointerdown', (e) => this.down(e));
    this.el.addEventListener('pointermove', (e) => this.move(e));
    this.el.addEventListener('pointerup', (e) => this.up(e));
    this.el.addEventListener('pointercancel', (e) => this.up(e));
  }

  show(v) {
    this.el.classList.toggle('hidden', !v);
    if (!v) this.reset();
  }

  reset() {
    for (const id of [...this.held.keys()]) this.releaseButton(id);
    this.endStick();
    this.lookId = null;
    this.input.looking = false;
  }

  down(e) {
    e.preventDefault();
    const btn = e.target.closest('.tb');
    if (btn) {
      if (btn.id === 'tbPause') return this.onPause?.();
      if (btn === this.sprintBtn) return this.setSprint(!this.input.sprint);
      this.held.set(e.pointerId, btn);
      btn.classList.add('down');
      this.input.press(btn.dataset.key);
      this.repeat = REPEAT;
      return;
    }
    this.el.setPointerCapture(e.pointerId);
    if (this.stickId === null && e.clientX < innerWidth * STICK_ZONE) {
      this.stickId = e.pointerId;
      this.r = this.base.offsetWidth / 2;
      this.placeBase(clamp(e.clientX, this.r, innerWidth - this.r), clamp(e.clientY, this.r, innerHeight - this.r));
      this.base.classList.add('active');
      this.moveStick(e.clientX, e.clientY);
    } else if (this.lookId === null) {
      this.lookId = e.pointerId;
      this.lx = e.clientX;
      this.ly = e.clientY;
      this.input.looking = true;
    }
  }

  move(e) {
    if (e.pointerId === this.stickId) this.moveStick(e.clientX, e.clientY);
    else if (e.pointerId === this.lookId) {
      const k = LOOK / Math.min(innerWidth, innerHeight);
      this.input.dx += (e.clientX - this.lx) * k;
      this.input.dy += (e.clientY - this.ly) * k;
      this.lx = e.clientX;
      this.ly = e.clientY;
    }
  }

  up(e) {
    if (this.held.has(e.pointerId)) this.releaseButton(e.pointerId);
    else if (e.pointerId === this.stickId) this.endStick();
    else if (e.pointerId === this.lookId) {
      this.lookId = null;
      this.input.looking = false;
    }
  }

  placeBase(x, y) {
    this.cx = x;
    this.cy = y;
    Object.assign(this.base.style, { left: x - this.r + 'px', top: y - this.r + 'px', bottom: 'auto' });
  }

  moveStick(x, y) {
    let dx = x - this.cx, dy = y - this.cy;
    const d = Math.hypot(dx, dy), r = this.r;
    if (d > r) {
      // drag the base along so the stick never runs out of travel
      this.placeBase(this.cx + dx * (1 - r / d), this.cy + dy * (1 - r / d));
      dx *= r / d;
      dy *= r / d;
    }
    this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
    const len = Math.hypot(dx, dy) / r;
    const amt = len < DEAD ? 0 : (len - DEAD) / (1 - DEAD) / len;
    this.input.stick.x = (dx / r) * amt;
    this.input.stick.y = (dy / r) * amt;
  }

  endStick() {
    this.stickId = null;
    this.input.stick.x = this.input.stick.y = 0;
    this.base.classList.remove('active');
    Object.assign(this.base.style, { left: '', top: '', bottom: '' });
    this.knob.style.transform = '';
    this.setSprint(false);
  }

  releaseButton(id) {
    const b = this.held.get(id);
    this.held.delete(id);
    b.classList.remove('down');
    this.input.release(b.dataset.key);
  }

  setSprint(v) {
    this.input.sprint = v;
    this.sprintBtn.classList.toggle('on', v);
  }

  update(dt, player) {
    if ((this.repeat -= dt) <= 0) {
      this.repeat = REPEAT;
      for (const b of this.held.values()) if ('repeat' in b.dataset) this.input.press(b.dataset.key);
    }
    if (player.bolts !== this.lastBolts) {
      this.lastBolts = player.bolts;
      this.ammo.textContent = player.bolts;
      this.boltBtn.classList.toggle('off', player.bolts === 0);
    }
  }
}
