// The game's mouse pointer: a small silver blade, tip up-left, that turns gold over anything clickable.
// - With the mouse free (title, pause, death, victory, settings) it replaces the system arrow through CSS
//   (--cur / --cur-on, see cursor.css), so it moves with no lag.
// - The level-up cards, the inventory and the merchant keep the pointer locked (closing them drops straight
//   back into the hunt), and a locked pointer is invisible. There a copy of the blade is drawn in the page,
//   moved by the mouse deltas: it highlights what it points at (the same pointerenter a free mouse sends)
//   and a left click clicks it. Right click still means "back".
import './cursor.css';

const HOT = 'button, a, .inv-slot, .inv-opt, #inv.examining .inv-view';
const SIZE = 32;

// tip at (2, 2), the sword drawn upright and turned 45° so it points up-left
// (ids differ per variant: both copies live in the same page inside #ptr)
function blade(on) {
  const id = on ? 'ptrOn' : 'ptrOff';
  const steel = on ? ['#fff4c8', '#f0bc40', '#a06a10'] : ['#ffffff', '#c8e8f4', '#6a8a9c'];
  const glow = on ? `<path d="M0 0 L3.2 6 L2.7 21 H-2.7 L-3.2 6 Z" fill="#ff4020" stroke="#ff4020" stroke-width="3" filter="url(#${id}b)"/>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
<defs><linearGradient id="${id}" x1="0" x2="1"><stop offset="0" stop-color="${steel[0]}"/><stop offset=".55" stop-color="${steel[1]}"/><stop offset="1" stop-color="${steel[2]}"/></linearGradient>
<filter id="${id}b" x="-1" y="-1" width="3" height="3"><feGaussianBlur stdDeviation="1.4"/></filter></defs>
<g transform="translate(2.4 2.4) rotate(-45)" stroke="#0a0408" stroke-width="1.6" stroke-linejoin="round">
${glow}
<path d="M0 0 L3.2 6 L2.7 21 H-2.7 L-3.2 6 Z" fill="url(#${id})"/>
<path d="M0 5 V19.5" stroke="${on ? '#a06a10' : '#5a7a8c'}" stroke-width="1"/>
<rect x="-7" y="21" width="14" height="3.2" rx="1" fill="${on ? '#ffe080' : '#e8b53a'}"/>
<rect x="-1.7" y="24.2" width="3.4" height="6.4" fill="#5a2c14"/>
<circle cx="0" cy="32.4" r="2.3" fill="${on ? '#ffe080' : '#e8b53a'}"/>
</g></svg>`;
}
const url = (svg) => `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;

const root = document.documentElement.style;
root.setProperty('--cur', `${url(blade(false))} 2 2, auto`);
root.setProperty('--cur-on', `${url(blade(true))} 2 2, pointer`);

export class UiCursor {
  constructor() {
    const el = (this.el = document.createElement('div'));
    el.id = 'ptr';
    el.className = 'hidden';
    el.innerHTML = `<div class="off">${blade(false)}</div><div class="on">${blade(true)}</div>`;
    document.body.append(el);
    this.active = false;
    this.moved = false;
    this.x = innerWidth / 2;
    this.y = innerHeight / 2;
    this.hot = null;

    addEventListener('mousemove', (e) => {
      if (!this.active) return;
      this.x = Math.min(innerWidth - 1, Math.max(0, this.x + e.movementX));
      this.y = Math.min(innerHeight - 1, Math.max(0, this.y + e.movementY));
      this.moved = true;
      this.place();
      this.hover();
    });
    addEventListener('mousedown', (e) => {
      if (!this.active || e.button !== 0) return;
      const t = this.target();
      if (!t) return;
      el.classList.add('down');
      // bubbles, so handlers on a parent (the examine view) see it too; works on SVG parts as well
      t.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: this.x, clientY: this.y }));
    });
    addEventListener('mouseup', () => el.classList.remove('down'));
    addEventListener('resize', () => {
      this.x = Math.min(this.x, innerWidth - 1);
      this.y = Math.min(this.y, innerHeight - 1);
      this.place();
    });
  }

  // main.js, every frame: on while a choice screen is open under pointer lock
  show(on) {
    if (on !== this.active) {
      this.active = on;
      // it stays where it was last time, but highlights nothing until the mouse moves:
      // a keyboard or controller player keeps the selection they had
      this.moved = false;
      this.el.classList.toggle('hidden', !on);
      if (on) this.place();
      else this.setHot(null);
    } else if (on && this.moved) this.hover(); // the screen changed under a still pointer (menu opened, new cards)
  }

  place() { this.el.style.transform = `translate(${this.x - 2}px, ${this.y - 2}px)`; }

  target() {
    const t = document.elementFromPoint(this.x, this.y);
    return t && t !== document.documentElement && t !== document.body ? t : null;
  }

  hover() {
    const hot = this.target()?.closest(HOT) || null;
    if (hot === this.hot) return;
    this.setHot(hot);
    hot?.dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'mouse' }));
  }

  setHot(hot) {
    this.hot?.classList.remove('hot');
    this.hot = hot;
    hot?.classList.add('hot');
    this.el.classList.toggle('lit', !!hot);
  }
}
