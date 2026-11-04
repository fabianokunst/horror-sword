// Smoke test: builds a development snapshot of the game (keeps the window.__hs dev hook), serves it on a free
// port and plays it in headless Chrome (software WebGL). It fails on any page error and on broken core
// mechanics: hunt start, combat (attack turns, telegraphs, perfect dodge, counter), target lock, camera
// collision, creature pathing and the touch layout. Run it with `npm test`; CI runs it before every deploy.
// CHROME_PATH picks the browser; otherwise the usual Chrome / Chromium / Edge install paths are tried.
// Everything waits on game state, not wall time: software rendering runs at a few frames per second.
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'hs-smoke-'));
const WAIT = { timeout: 120000, polling: 'raf' };
let failed = 0;
const check = (name, ok, info = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${info === '' ? '' : '  ' + (typeof info === 'string' ? info : JSON.stringify(info))}`);
  if (!ok) failed++;
};

function chromePath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const local = process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe');
  const list = {
    win32: ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe', local, 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'],
    darwin: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium'],
    linux: ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'],
  }[process.platform] || [];
  return list.filter(Boolean).find((p) => fs.existsSync(p));
}

async function buildSnapshot() {
  process.env.NODE_ENV = 'development'; // keeps import.meta.env.DEV, so main.js exposes window.__hs
  const { build } = await import('vite');
  await build({ root: ROOT, logLevel: 'error', build: { outDir: OUT, emptyOutDir: true, chunkSizeWarningLimit: 4000 } });
}

function serve(dir) {
  const types = {
    '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.woff': 'font/woff',
    '.txt': 'text/plain', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  };
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent(req.url.split('?')[0]);
    const file = path.join(dir, url === '/' ? 'index.html' : url);
    if (!file.startsWith(dir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404);
      return res.end();
    }
    res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r(server)));
}

const frames = (page, n) => page.evaluate((n) => new Promise((r) => {
  let i = 0;
  const f = () => (++i >= n ? r() : requestAnimationFrame(f));
  requestAnimationFrame(f);
}), n);

// fresh hunt, unkillable hunter, no roaming spawns (each check places its own creatures)
async function startHunt(page, tap = false) {
  await page.evaluateOnNewDocument(() => { try { localStorage.clear(); } catch {} });
  await page.goto(page.__url);
  await page.waitForFunction(() => window.__hs && document.getElementById('play'), WAIT);
  if (tap) await page.tap('#play');
  else await page.click('#play');
  await page.waitForFunction(() => __hs.state() === 'play' && __hs.enemies.nav && __hs.enemies.nav.ready, WAIT);
  await page.evaluate(() => {
    const { enemies, player } = __hs;
    enemies.spawn = () => null;
    enemies.reset();
    player.maxHp = player.hp = 1e6;
  });
}

async function crowd(page, type, n, r) {
  await page.evaluate((type, n, r) => {
    const { player, enemies } = __hs;
    __hs.setDay(0.8);
    enemies.reset();
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      enemies.spawnAt(type, player.pos.x + Math.sin(a) * r, player.pos.z + Math.cos(a) * r);
    }
  }, type, n, r);
}

async function desktop(browser, url, errors) {
  const page = await browser.newPage();
  page.__url = url;
  page.on('pageerror', (e) => errors.push('desktop: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('desktop console: ' + m.text()); });
  await page.setViewport({ width: 640, height: 360 });
  await startHunt(page);
  check('hunt starts from the title menu', await page.evaluate(() => !document.getElementById('hud').classList.contains('hidden')));

  // combat: attack turns and telegraphs over 80 frames of a six-ghoul crowd
  await crowd(page, 'ghoul', 6, 4);
  const turns = await page.evaluate(() => new Promise((res) => {
    const { enemies } = __hs;
    let n = 0, maxBusy = 0, windups = 0, glint = 0;
    const tick = () => {
      let busy = 0;
      for (const e of enemies.list) {
        if (e.dying) continue;
        if (e.atk >= 0 || e.leap || e.crouch > 0) busy++;
        if (e.atk >= 0 && e.atk < e.T.windup) { windups++; if (e.glint.visible) glint++; }
      }
      maxBusy = Math.max(maxBusy, busy);
      if (++n < 80) requestAnimationFrame(tick);
      else res({ maxBusy, limit: enemies.mods.attackers, windups, glint });
    };
    requestAnimationFrame(tick);
  }));
  check('attack turns: never more attackers than allowed', turns.maxBusy >= 1 && turns.maxBusy <= turns.limit, turns);
  check('telegraph: eye glint during every windup', turns.windups > 0 && turns.glint === turns.windups, turns);

  // perfect dodge: roll right before a blow lands -> slow motion and a counter hit
  await crowd(page, 'ghoul', 3, 2.5);
  const perfect = await page.evaluate(() => new Promise((res) => {
    const { enemies, player } = __hs;
    let n = 0;
    const tick = () => {
      player.stamina = 100;
      for (const e of enemies.list) {
        const d = Math.hypot(e.pos.x - player.pos.x, e.pos.z - player.pos.z);
        if (!player.roll && e.atk >= e.T.windup - 0.12 && !e.struck && d < e.T.range + 0.8) { player.tryRoll(0, 0); break; }
      }
      if (__hs.witch() > 0) return res({ ok: true, counter: player.counter });
      if (++n < 500) requestAnimationFrame(tick); else res({ ok: false });
    };
    requestAnimationFrame(tick);
  }));
  check('perfect dodge triggers slow motion', perfect.ok && perfect.counter > 0, perfect);
  if (perfect.ok) {
    const swing = await page.evaluate(() => new Promise((res) => {
      const { player } = __hs;
      const prev = player.onSwing;
      player.onSwing = (c, def) => { prev(c, def); player.onSwing = prev; res({ counter: def.counter }); };
      const go = () => (player.roll ? requestAnimationFrame(go) : player.tryAttack(player.facing));
      go();
      setTimeout(() => res({ timeout: true }), 60000);
    }));
    check('counter window strengthens the next swing', swing.counter === true, swing);
  }

  // Count Dracula: phase 2 (mist, untouchable, blood orbs), a huge hit can't skip it, then phase 3
  const boss = await page.evaluate(() => new Promise((res) => {
    const { enemies, player } = __hs;
    enemies.reset();
    let phases = [];
    enemies.onBossPhase = ((prev) => (e, s) => { phases.push(s); prev?.(e, s); })(enemies.onBossPhase);
    const d = enemies.spawnAt('dracula', player.pos.x, player.pos.z + 9);
    enemies.damage(d, d.maxHp * 0.9, 0, 1); // would skip phase 2 if not clamped
    const afterHit = { stage: d.stage, frac: +(d.hp / d.maxHp).toFixed(2), shield: d.shield > 0 };
    const hpShielded = d.hp;
    enemies.damage(d, 5, 0, 1);
    const shieldHolds = d.hp === hpShielded;
    let n = 0, sawCast = false, sawShot = false;
    const tick = () => {
      player.pos.z = d.pos.z - 9; // keep the distance so he throws orbs instead of striking
      if (d.cast > 0) sawCast = true;
      if (enemies.shots.length) sawShot = true;
      if (sawShot || ++n > 600) {
        d.shield = 0;
        enemies.damage(d, d.maxHp * 0.3, 0, 1);
        return res({ afterHit, shieldHolds, sawCast, sawShot, stage3: d.stage === 3, alive: !d.dying, phases });
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }));
  check('Dracula phase 2: one phase per hit, untouchable while changing', boss.afterHit.stage === 2 && boss.afterHit.frac >= 0.33 && boss.afterHit.shield && boss.shieldHolds, boss);
  check('Dracula phase 2 throws telegraphed blood orbs', boss.sawCast && boss.sawShot, boss);
  check('Dracula phase 3 (fury) still alive to fight', boss.stage3 && boss.alive && boss.phases.join() === '2,3', boss);
  await page.evaluate(() => __hs.enemies.reset());

  // target lock on R, released on R
  await crowd(page, 'ghoul', 3, 6);
  await page.keyboard.press('KeyR');
  const locked = await page.waitForFunction(() => __hs.lock.target, { ...WAIT, timeout: 30000 }).then(() => true, () => false);
  await page.keyboard.press('KeyR');
  const released = await page.waitForFunction(() => !__hs.lock.target, { ...WAIT, timeout: 30000 }).then(() => true, () => false);
  check('target lock: R locks and releases', locked && released);

  // camera and pathing around the biggest village house
  const house = await page.evaluate(() => {
    const village = __hs.world.sites[0];
    let best = null;
    village.root.traverse((o) => {
      if (!o.isMesh || o.material.isMeshBasicMaterial || o.parent === village.g) return;
      o.geometry.computeBoundingBox();
      const b = o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld);
      const sx = b.max.x - b.min.x, sz = b.max.z - b.min.z;
      if (b.max.y - b.min.y > 4 && sx > 3 && sz > 3 && sx < 14 && sz < 14 && (!best || sx * sz > best.a)) best = { a: sx * sz, b: [b.min.x, b.max.x, b.min.z, b.max.z] };
    });
    return best && best.b;
  });
  check('village house found for the camera/pathing checks', !!house);
  if (house) {
    const hz = (house[2] + house[3]) / 2;
    await page.evaluate((x, z) => {
      const { player, enemies } = __hs;
      enemies.reset();
      player.pos.set(x, player.pos.y, z);
      player.vel.set(0, 0, 0);
      __hs.setCam(-Math.PI / 2, 0.25); // camera would sit inside the house
    }, house[1] + 1.2, hz);
    await frames(page, 6);
    const camDist = await page.evaluate(() => __hs.camDist());
    check('camera stops in front of a wall', camDist < 2.5, { camDist: +camDist.toFixed(2) });

    const chase = await page.evaluate((px, pz, gx, gz) => new Promise((res) => {
      const { enemies, player } = __hs;
      enemies.reset();
      enemies.nav.since = Infinity;
      const g = enemies.spawnAt('ghoul', gx, gz);
      g.speedMul = 3;
      g.cd = 1e9;
      const t0 = enemies.clock;
      const tick = () => {
        player.pos.x = px; player.pos.z = pz; player.vel.set(0, 0, 0);
        const d = Math.hypot(g.pos.x - px, g.pos.z - pz);
        if (d < 2.6) return res({ reached: true, seconds: +(enemies.clock - t0).toFixed(1) });
        if (enemies.clock - t0 > 15) return res({ reached: false, distance: +d.toFixed(1) });
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }), house[1] + 2, hz, house[0] - 2, hz);
    check('a ghoul behind a house walks around it', chase.reached, chase);
  }
  await page.close();
}

// a fake standard-mapping controller (navigator.getGamepads is replaced before the game loads)
async function gamepad(browser, url, errors) {
  const page = await browser.newPage();
  page.on('pageerror', (e) => errors.push('gamepad: ' + e.message));
  await page.setViewport({ width: 640, height: 360 });
  await page.evaluateOnNewDocument(() => {
    try { localStorage.clear(); } catch {}
    const pad = { id: 'smoke-test pad', index: 0, connected: true, mapping: 'standard', axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) };
    window.__pad = pad;
    Object.defineProperty(navigator, 'getGamepads', { value: () => [pad], configurable: true });
  });
  await page.goto(url);
  await page.waitForFunction(() => window.__hs && document.getElementById('play'), WAIT);
  const sections = await page.evaluate(() => [...document.querySelectorAll('#settings h4')].map((h) => h.textContent));
  check('settings panel has Controles and Som', sections.includes('Controles') && sections.includes('Som'), sections);
  const press = async (i, n = 3) => {
    await page.evaluate((i) => { __pad.buttons[i].pressed = true; __pad.buttons[i].value = 1; }, i);
    await frames(page, n);
    await page.evaluate((i) => { __pad.buttons[i].pressed = false; __pad.buttons[i].value = 0; }, i);
    await frames(page, 2);
  };
  await press(0); // A on the title screen
  const started = await page.waitForFunction(() => __hs.state() === 'play', { ...WAIT, timeout: 30000 }).then(() => true, () => false);
  check('controller: A starts the hunt', started);
  if (!started) return page.close();
  await page.waitForFunction(() => __hs.enemies.nav && __hs.enemies.nav.ready, WAIT);
  await page.evaluate(() => { __hs.enemies.spawn = () => null; __hs.enemies.reset(); __hs.player.maxHp = __hs.player.hp = 1e6; });
  const yaw0 = await page.evaluate(() => __hs.cam());
  await page.evaluate(() => { __pad.axes[2] = 1; });
  await frames(page, 8);
  await page.evaluate(() => { __pad.axes[2] = 0; });
  const yaw1 = await page.evaluate(() => __hs.cam());
  check('controller: right stick turns the camera', Math.abs(yaw1 - yaw0) > 0.05, { turned: +(yaw1 - yaw0).toFixed(2) });
  await crowd(page, 'ghoul', 3, 6);
  await press(4); // LB
  const locked = await page.waitForFunction(() => __hs.lock.target, { ...WAIT, timeout: 30000 }).then(() => true, () => false);
  check('controller: LB locks a target', locked);
  await press(9); // Start
  const paused = await page.waitForFunction(() => __hs.state() === 'pause', { ...WAIT, timeout: 30000 }).then(() => true, () => false);
  check('controller: Start pauses', paused);
  await page.close();
}

async function touch(browser, url, errors) {
  const page = await browser.newPage();
  page.__url = url;
  page.on('pageerror', (e) => errors.push('touch: ' + e.message));
  await page.emulate({
    viewport: { width: 844, height: 390, deviceScaleFactor: 1, isMobile: true, hasTouch: true, isLandscape: true },
    userAgent: 'Mozilla/5.0 (Linux; Android 14) Mobile',
  });
  await startHunt(page, true);
  const layout = await page.evaluate(() => {
    const touchOn = document.body.classList.contains('touch') && !document.getElementById('touch').classList.contains('hidden');
    const btns = [...document.querySelectorAll('#touch .tb')].map((b) => ({ k: b.dataset.key || b.id, r: b.getBoundingClientRect() }));
    const off = btns.filter((b) => b.r.left < 0 || b.r.top < 0 || b.r.right > innerWidth || b.r.bottom > innerHeight).map((b) => b.k);
    // the buttons are round: compare them as circles, not as their bounding squares
    const hit = (a, b) => Math.hypot(a.r.x + a.r.width / 2 - b.r.x - b.r.width / 2, a.r.y + a.r.height / 2 - b.r.y - b.r.height / 2) < (a.r.width + b.r.width) / 2 - 1;
    const overlaps = [];
    btns.forEach((a, i) => btns.slice(i + 1).forEach((b) => { if (hit(a, b)) overlaps.push(a.k + '/' + b.k); }));
    return { touchOn, buttons: btns.length, off, overlaps };
  });
  check('touch controls shown, on screen and not overlapping', layout.touchOn && !layout.off.length && !layout.overlaps.length, layout);
  await crowd(page, 'ghoul', 3, 6);
  const alvo = await page.$('#touch [data-key="KeyR"]');
  const box = alvo && (await alvo.boundingBox());
  if (box) await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  const locked = await page.waitForFunction(() => __hs.lock.target, { ...WAIT, timeout: 30000 }).then(() => true, () => false);
  check('touch ALVO button locks a target', !!box && locked);
  await page.close();
}

const deadline = setTimeout(() => { console.error('FAIL  smoke test took longer than 12 minutes'); process.exit(1); }, 12 * 60000);
let server, browser;
const errors = [];
try {
  const exe = chromePath();
  if (!exe) throw new Error('no Chrome/Chromium found: set CHROME_PATH');
  await buildSnapshot();
  check('development build', fs.existsSync(path.join(OUT, 'index.html')));
  server = await serve(OUT);
  const url = `http://127.0.0.1:${server.address().port}/`;
  browser = await puppeteer.launch({
    executablePath: exe, headless: true, pipe: true,
    // --no-sandbox: CI runners (Ubuntu 24.04) block Chrome's user-namespace sandbox
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio', ...(process.env.CI ? ['--no-sandbox'] : [])],
  });
  await desktop(browser, url, errors);
  await gamepad(browser, url, errors);
  await touch(browser, url, errors);
} catch (e) {
  check('smoke test ran to the end', false, e.stack || String(e));
} finally {
  check('no page errors', errors.length === 0, errors.length ? errors.slice(0, 5) : '');
  await browser?.close().catch(() => {});
  server?.close();
  fs.rmSync(OUT, { recursive: true, force: true });
  clearTimeout(deadline);
}
console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
