export class Input {
  constructor(el) {
    this.el = el;
    this.keys = new Set();
    this.pressed = new Set();
    this.dx = 0;
    this.dy = 0;
    this.locked = false;
    this.onLockChange = null;
    // touch mode: fed by TouchControls instead of keyboard / pointer lock
    this.touch = matchMedia('(hover: none) and (pointer: coarse)').matches;
    this.onModeChange = null;
    this.stick = { x: 0, y: 0 };
    this.sprint = false;
    this.looking = false;

    addEventListener('keydown', (e) => {
      this.setTouch(false);
      if (!e.repeat) this.pressed.add(e.code);
      this.keys.add(e.code);
      if (e.code === 'Space') e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
    // whichever pointer was used last decides the control scheme (touch laptops, iPad + trackpad)
    addEventListener('pointerdown', (e) => this.setTouch(e.pointerType !== 'mouse'), true);
    addEventListener('pointermove', (e) => {
      if (e.pointerType === 'mouse' && (e.movementX || e.movementY)) this.setTouch(false);
    }, true);
    // freeLook: pointer lock was refused (embedded browsers, iframes), so plain mouse movement steers the camera
    this.freeLook = false;
    // ui: a choice screen is open (level-up, inventory, merchant). The mouse then drives a pointer
    // (cursor.js, or the system one in freeLook) and its left click lands on what it points at,
    // so neither reaches the game as look movement or as a Mouse0 press.
    this.ui = false;
    addEventListener('mousemove', (e) => {
      if (this.ui || (!this.locked && !this.freeLook)) return;
      this.dx += e.movementX;
      this.dy += e.movementY;
    });
    addEventListener('mousedown', (e) => {
      if (this.ui && e.button === 0) return;
      if (this.locked || this.freeLook) this.pressed.add('Mouse' + e.button);
    });
    // the mouse wheel cycles the sword runes: one step per notch (a trackpad's stream of events is spaced out)
    this.wheelAt = 0;
    addEventListener('wheel', (e) => {
      if (this.ui || (!this.locked && !this.freeLook) || !e.deltaY) return;
      const now = performance.now();
      if (now - this.wheelAt < 160) return;
      this.wheelAt = now;
      this.pressed.add(e.deltaY > 0 ? 'WheelDown' : 'WheelUp');
    }, { passive: true });
    addEventListener('contextmenu', (e) => e.preventDefault());
    // iOS Safari ignores user-scalable=no; block pinch zoom explicitly
    document.addEventListener('gesturestart', (e) => e.preventDefault());
    document.addEventListener('pointerlockerror', () => (this.freeLook = true));
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === el;
      if (this.locked) this.freeLook = false; // a later lock worked: back to normal mouse look
      this.onLockChange?.(this.locked);
    });
  }
  setTouch(v) {
    if (v === this.touch) return;
    this.touch = v;
    this.onModeChange?.(v);
  }
  down(code) { return this.keys.has(code); }
  hit(code) { return this.pressed.has(code); }
  // virtual keys from on-screen buttons
  press(code) { this.keys.add(code); this.pressed.add(code); }
  release(code) { this.keys.delete(code); }
  lock() {
    const fail = () => (this.freeLook = true);
    try {
      if (!this.el.requestPointerLock) return fail();
      this.el.requestPointerLock()?.catch?.(fail);
    } catch { fail(); }
    setTimeout(() => { if (!this.locked) fail(); }, 500);
  }
  endFrame() {
    this.pressed.clear();
    this.dx = this.dy = 0;
  }
}
