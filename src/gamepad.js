// Game controllers (standard mapping: Xbox / PlayStation / most USB and Bluetooth pads). Polled every frame and
// turned into the same virtual keys the keyboard and the touch buttons use, so the game loop needs no special
// case. What a button does depends on the context main.js reports:
//   play  — left stick move, right stick camera, A jump, B dodge, X/RB sword (hold for the combo), Y crossbow,
//           RT blade Arte, D-pad ◀ ▶ sword runes, LB/R3 lock target, LT/L3 sprint, Back inventory, Start pause,
//           D-pad up pick up
//   ui    — inventory and perk cards: D-pad / left stick move the cursor, A confirm, B back, Back/Start close
//   menu  — title, pause, death and victory screens: A or Start presses the main button, B closes the settings
const DEAD = 0.18; // stick dead zone
const LOOK = 1100; // camera speed at full right-stick tilt, in mouse pixels per second
const REPEAT = 0.1; // a held sword button keeps the combo going
const NAV_FIRST = 0.35, NAV_NEXT = 0.14; // stick-as-arrows auto-repeat in menus

const B = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, BACK: 8, START: 9, L3: 10, R3: 11, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };

const stick = (x, y) => {
  const m = Math.hypot(x, y);
  if (m < DEAD) return [0, 0];
  const k = Math.min(1, (m - DEAD) / (1 - DEAD)) / m;
  return [x * k, y * k];
};

export class Gamepads {
  constructor(input) {
    this.input = input;
    this.prev = [];
    this.held = new Set(); // virtual keys this module is holding down
    this.repeat = 0;
    this.nav = { dir: '', t: 0 };
    this.active = false; // a pad was used last (instead of mouse/keyboard/touch)
    this.movedStick = false;
    this.onConnect = null;
    this.onMenuPress = null; // (button name) => handled in menus: 'A' | 'B' | 'START'
    addEventListener('gamepadconnected', (e) => this.onConnect?.(e.gamepad));
  }

  pad() {
    const list = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of list) if (p && p.connected && p.buttons.length >= 12) return p;
    return null;
  }

  hold(code, down) {
    const inp = this.input;
    if (down && !this.held.has(code)) { this.held.add(code); inp.press(code); }
    else if (!down && this.held.has(code)) { this.held.delete(code); inp.release(code); }
  }

  releaseAll() {
    for (const c of [...this.held]) this.hold(c, false);
    if (this.movedStick) { this.input.stick.x = this.input.stick.y = 0; this.movedStick = false; }
  }

  // Rumble on the pad that is in use (hits, perfect dodges); silently ignored where unsupported.
  rumble(ms, strong = 0.6) {
    const a = this.active && this.pad()?.vibrationActuator;
    a?.playEffect?.('dual-rumble', { duration: ms, strongMagnitude: strong, weakMagnitude: Math.min(1, strong + 0.2) }).catch?.(() => {});
  }

  // ctx: 'play' | 'ui' | 'menu'. The right stick feeds input.dx/dy like a mouse: main.js applies the
  // camera sensitivity and the inverted-Y setting to every source alike.
  update(dt, ctx) {
    const p = this.pad();
    if (!p) {
      if (this.active) { this.releaseAll(); this.active = false; }
      return;
    }
    const btn = (i) => !!p.buttons[i] && (p.buttons[i].pressed || p.buttons[i].value > 0.5);
    const now = p.buttons.map((_, i) => btn(i));
    const down = (i) => now[i];
    const edge = (i) => now[i] && !this.prev[i];
    const [lx, ly] = stick(p.axes[0] || 0, p.axes[1] || 0);
    const [rx, ry] = stick(p.axes[2] || 0, p.axes[3] || 0);
    const used = now.some(Boolean) || lx || ly || rx || ry;
    if (used && !this.active) {
      this.active = true;
      this.input.setTouch(false); // hide the on-screen buttons
    }
    if (!this.active) { this.prev = now; return; }
    const inp = this.input;

    if (ctx !== 'play') {
      // leaving play: let go of everything the pad was holding
      for (const c of [...this.held]) this.hold(c, false);
      if (this.movedStick) { inp.stick.x = inp.stick.y = 0; this.movedStick = false; }
    }

    if (ctx === 'play') {
      if (lx || ly) { inp.stick.x = lx; inp.stick.y = ly; this.movedStick = true; }
      else if (this.movedStick) { inp.stick.x = inp.stick.y = 0; this.movedStick = false; }
      inp.dx += rx * LOOK * dt;
      inp.dy += ry * LOOK * dt;
      this.hold('ShiftLeft', down(B.LT) || down(B.L3));
      const sword = down(B.X) || down(B.RB);
      this.hold('Mouse0', sword);
      if (sword && (this.repeat -= dt) <= 0) { this.repeat = REPEAT; inp.press('Mouse0'); }
      if (!sword) this.repeat = 0;
      const tap = (i, code) => { if (edge(i)) { inp.press(code); inp.release(code); } };
      tap(B.A, 'Space');
      tap(B.B, 'KeyC');
      tap(B.Y, 'KeyQ');
      tap(B.RT, 'KeyV');
      tap(B.LEFT, 'RunePrev');
      tap(B.RIGHT, 'KeyX');
      tap(B.LB, 'KeyR');
      tap(B.R3, 'KeyR');
      tap(B.BACK, 'Tab');
      tap(B.START, 'GamepadPause');
      tap(B.UP, 'KeyE');
    } else if (ctx === 'ui') {
      const tap = (i, code) => { if (edge(i)) { inp.press(code); inp.release(code); } };
      tap(B.A, 'Enter');
      tap(B.B, 'KeyC');
      tap(B.BACK, 'Tab');
      tap(B.START, 'Escape');
      tap(B.UP, 'ArrowUp');
      tap(B.DOWN, 'ArrowDown');
      tap(B.LEFT, 'ArrowLeft');
      tap(B.RIGHT, 'ArrowRight');
      // the left stick works like the D-pad, with auto-repeat
      const dir = Math.abs(lx) > Math.abs(ly) ? (lx > 0.5 ? 'ArrowRight' : lx < -0.5 ? 'ArrowLeft' : '') : ly > 0.5 ? 'ArrowDown' : ly < -0.5 ? 'ArrowUp' : '';
      if (dir !== this.nav.dir) { this.nav = { dir, t: NAV_FIRST }; if (dir) { inp.press(dir); inp.release(dir); } }
      else if (dir && (this.nav.t -= dt) <= 0) { this.nav.t = NAV_NEXT; inp.press(dir); inp.release(dir); }
    } else {
      if (edge(B.A)) this.onMenuPress?.('A');
      if (edge(B.START)) this.onMenuPress?.('START');
      if (edge(B.B)) this.onMenuPress?.('B');
    }
    this.prev = now;
  }
}
