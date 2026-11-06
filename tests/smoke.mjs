// Smoke test: builds a development snapshot of the game (keeps the window.__hs dev hook), serves it on a free
// port and plays it in headless Chrome (software WebGL). It fails on any page error and on broken core
// mechanics: hunt start, combat (attack turns, telegraphs, perfect dodge, counter), target lock, camera
// collision, creature pathing, the guide to the objective, the valley map and the touch layout.
// Run it with `npm test`; CI runs it before every deploy.
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

// the real production build (service worker, manifest) for the install/offline check
async function buildProd(dir) {
  process.env.NODE_ENV = 'production';
  const { build } = await import('vite');
  await build({ root: ROOT, logLevel: 'error', build: { outDir: dir, emptyOutDir: true, chunkSizeWarningLimit: 4000 } });
}

async function offline(browser, url, dir, errors) {
  const sw = fs.existsSync(path.join(dir, 'sw.js')) ? fs.readFileSync(path.join(dir, 'sw.js'), 'utf8') : '';
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.webmanifest'), 'utf8'));
  const icons = manifest.icons.every((i) => fs.existsSync(path.join(dir, i.src)));
  check('production build: service worker precaches the bundle, manifest icons exist', /assets\/index-[\w-]+\.js/.test(sw) && icons && manifest.icons.length >= 3);
  const page = await browser.newPage();
  page.on('pageerror', (e) => errors.push('offline: ' + e.message));
  await page.goto(url);
  const ready = await page.evaluate(() => Promise.race([
    navigator.serviceWorker.ready.then(() => true),
    new Promise((r) => setTimeout(() => r(false), 30000)),
  ]));
  await page.reload();
  await page.setOfflineMode(true);
  await page.reload();
  const loaded = await page.waitForFunction(() => document.getElementById('play') && document.querySelector('#game canvas'), { timeout: 60000 }).then(() => true, () => false);
  await page.setOfflineMode(false);
  check('production build opens offline (service worker)', ready && loaded, { ready, loaded });
  await page.close();
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

// Headless Chrome still reads the controllers plugged into the machine: a button press (or a drifting stick)
// on a real pad would start the hunt or walk the hunter in the middle of a check. Pages hide them; the
// controller check installs its own fake pad instead.
const noPads = (page) => page.evaluateOnNewDocument(() => {
  Object.defineProperty(navigator, 'getGamepads', { value: () => [], configurable: true });
});

// fresh hunt, unkillable hunter, no roaming spawns (each check places its own creatures)
async function startHunt(page, tap = false) {
  await noPads(page);
  // tests read Portuguese texts; headless Chrome would otherwise pick English from its locale
  await page.evaluateOnNewDocument(() => { try { localStorage.clear(); localStorage.setItem('horror-sword:lang', 'pt'); } catch {} });
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

  // new moves: the witch hexes from range and backs off, the vampire lunges, the bride's scream stuns
  const moves = await page.evaluate(() => new Promise((res) => {
    const { enemies, player } = __hs;
    __hs.setDay(0.8);
    enemies.reset();
    const P = { x: player.pos.x, z: player.pos.z };
    const w = enemies.spawnAt('witch', P.x + 10, P.z);
    w.castCd = 0.2;
    w.cd = 1e9;
    let n = 0, hexed = false, homing = false, stage = 'hex', fleeStart = 0, fled = false, lunged = false, stunned = false, v, b;
    const tick = () => {
      player.pos.x = P.x; player.pos.z = P.z; player.vel.set(0, 0, 0);
      if (stage === 'hex') {
        if (enemies.shots.some((s) => s.homing > 0)) { hexed = true; homing = true; }
        if (hexed || n > 300) {
          stage = 'flee';
          w.pos.set(P.x + 3, w.pos.y, P.z);
          fleeStart = 3;
        }
      } else if (stage === 'flee') {
        const d = Math.hypot(w.pos.x - P.x, w.pos.z - P.z);
        if (d > fleeStart + 1.5) fled = true;
        if (fled || n > 450) {
          stage = 'lunge';
          enemies.reset();
          v = enemies.spawnAt('vampire', P.x + 7, P.z);
          Object.assign(v, { blinkCd: 99, lungeCd: 0, cd: 1e9 });
        }
      } else if (stage === 'lunge') {
        if (v.dash) lunged = true;
        if (lunged || n > 650) {
          stage = 'scream';
          enemies.reset();
          b = enemies.spawnAt('bride', P.x + 3, P.z);
          Object.assign(b, { screamCd: 0, cd: 1e9 });
        }
      } else if (stage === 'scream') {
        if (player.stun > 0) stunned = true;
        if (stunned || n > 900) return res({ hexed, homing, fled, lunged, stunned, frames: n });
      }
      n++;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }));
  check('witch hexes from range with a homing orb', moves.hexed && moves.homing, moves);
  check('witch backs off when the hunter closes in', moves.fled, moves);
  check('vampire lunges from mid range', moves.lunged, moves);
  check("bride's scream stuns a hunter who doesn't dodge", moves.stunned, moves);
  await page.evaluate(() => __hs.enemies.reset());

  // sword runes: finishing chapter I sets the Ember rune in the blade (and in the save), the 2 key picks it,
  // its strikes set creatures on fire, frost freezes on the third hit, and a full Fúria bar unleashes the Arte (V)
  const grant = await page.evaluate(() => {
    const { campaign, blade, enemies } = __hs;
    enemies.reset();
    campaign.save.xp = 0; // the chapter's experience bonus must not open a level-up
    const ch = campaign.save.chapter;
    campaign.complete();
    const ok = blade.id === 'brasa' && campaign.save.runes.owned.includes('brasa') && campaign.save.chapter === ch + 1;
    blade.select('aco');
    return { ok, owned: blade.state.owned, active: blade.id };
  });
  await page.keyboard.press('Digit2');
  await frames(page, 3);
  grant.key = await page.evaluate(() => __hs.blade.id);
  check('runes: chapter I reveals the Ember rune, the 2 key sets it in the blade', grant.ok && grant.key === 'brasa', grant);

  const strike = await page.evaluate(() => new Promise((res) => {
    const { enemies, player, blade } = __hs;
    __hs.setDay(0.8);
    enemies.reset();
    const a = player.facing;
    const g = enemies.spawnAt('ghoul', player.pos.x + Math.sin(a) * 1.8, player.pos.z + Math.cos(a) * 1.8);
    Object.assign(g, { hp: 50, maxHp: 50, cd: 1e9 });
    const prev = player.onSwing;
    player.onSwing = (c, def) => {
      prev(c, def);
      player.onSwing = prev;
      // frost: three hits freeze a creature solid
      blade.grant('geada');
      const f = enemies.spawnAt('ghoul', player.pos.x - Math.sin(a) * 6, player.pos.z - Math.cos(a) * 6);
      Object.assign(f, { hp: 50, maxHp: 50, cd: 1e9 });
      for (let i = 0; i < 3; i++) blade.strike(f, { counter: false });
      res({ burning: g.fire > 0, fury: blade.fury > 0, frozen: f.frozen > 0 });
    };
    // the bride's scream a few checks back may still have the hunter reeling (game time crawls in software rendering)
    Object.assign(player, { stamina: 100, stun: 0, roll: null, attack: null });
    player.tryAttack(a);
    setTimeout(() => res({ timeout: true, busy: player.busy, attack: !!player.attack }), 60000);
  }));
  check('runes: Ember strikes burn, frost freezes on the 3rd hit, hits fill the Fúria bar', strike.burning && strike.frozen && strike.fury, strike);

  await page.evaluate(() => {
    const { blade, player } = __hs;
    blade.select('brasa');
    player.stamina = 100;
    player.attack = null;
  });
  await crowd(page, 'ghoul', 4, 3);
  await page.evaluate(() => {
    for (const e of __hs.enemies.list) Object.assign(e, { hp: 50, maxHp: 50, cd: 1e9 });
    __hs.blade.fill();
  });
  await page.keyboard.press('KeyV');
  const art = await page.waitForFunction(() => {
    const { player, blade, enemies } = __hs;
    if (player.art || blade.fury > 0) return false; // the bar empties as the Arte starts; it lands before it ends
    const L = enemies.list.filter((e) => !e.dying);
    return { fury: blade.fury, hurt: L.filter((e) => e.hp < e.maxHp).length, burning: L.filter((e) => e.fire > 0).length, n: L.length };
  }, { ...WAIT, timeout: 30000 }).then((h) => h.jsonValue(), () => ({ timeout: true }));
  check('runes: V unleashes the Arte with a full bar, hitting every creature around', art.fury === 0 && art.n === 4 && art.hurt === 4 && art.burning === 4, art);
  await page.evaluate(() => __hs.enemies.reset());

  // animation: a swing draws the blade trail; a dead ghoul lies on the ground (its head low), not floating
  // (far enough away that its soul orb doesn't fly to the hunter and open a level-up)
  const anim = await page.evaluate(() => new Promise((res) => {
    const { player, enemies } = __hs;
    Object.assign(player, { stun: 0, attack: null, art: null, roll: null, stamina: 100 });
    const e = enemies.spawnAt('ghoul', player.pos.x + 12, player.pos.z);
    enemies.damage(e, 1e6, 1, 0);
    player.tryAttack(player.facing);
    let trail = false, n = 0;
    const v = e.pos.clone();
    const tick = () => {
      if (player.anim.trail) trail = true;
      if (e.dying > 0.8) { e.m.head.getWorldPosition(v); return res({ trail, head: +(v.y - e.pos.y).toFixed(2) }); }
      if (++n < 600) requestAnimationFrame(tick); else res({ trail, timeout: true });
    };
    requestAnimationFrame(tick);
  }));
  check('animation: blade trail on a swing, dead creatures lie on the ground', anim.trail && anim.head < 0.6, anim);
  await page.evaluate(() => __hs.enemies.reset());

  // shrine: E restores health and saves the hunt there, once per night
  const shrine = await page.evaluate(() => {
    const { player, world } = __hs;
    const s = world.shrines[0];
    player.pos.set(s.x + 1.2, player.pos.y, s.z);
    player.vel.set(0, 0, 0);
    player.maxHp = 100;
    player.hp = 20;
    return { x: s.x, z: s.z };
  });
  await frames(page, 3);
  await page.keyboard.press('KeyE');
  await frames(page, 3);
  const prayed = await page.evaluate((s) => {
    const save = JSON.parse(localStorage.getItem('horror-sword:save') || 'null');
    const healed = __hs.player.hp === __hs.player.maxHp;
    __hs.player.hp = 20;
    return { healed, savedHere: !!save?.pos && Math.hypot(save.pos.x - s.x, save.pos.z - s.z) < 3 };
  }, shrine);
  await page.keyboard.press('KeyE');
  await frames(page, 3);
  prayed.onceOnly = await page.evaluate(() => __hs.player.hp === 20);
  check('shrine: prayer heals and saves the hunt there, once per night', prayed.healed && prayed.savedHere && prayed.onceOnly, prayed);
  await page.evaluate(() => { __hs.player.maxHp = __hs.player.hp = 1e6; });

  // merchant: E opens the shop (game paused), 1 buys a green herb for 8 souls, Esc closes
  await page.evaluate(() => {
    const { player, world, campaign, inv } = __hs;
    const m = world.merchantSpot;
    player.pos.set(m.x + 1.3, player.pos.y, m.z);
    player.vel.set(0, 0, 0);
    campaign.save.purse = 20;
    inv.slots.fill(null);
  });
  await frames(page, 3);
  await page.keyboard.press('KeyE');
  const shopOpen = await page.waitForFunction(() => __hs.state() === 'shop', { ...WAIT, timeout: 20000 }).then(() => true, () => false);
  await page.keyboard.press('Digit1');
  await frames(page, 3);
  const bought = await page.evaluate(() => ({ purse: __hs.campaign.save.purse, herb: __hs.inv.slots.includes('herbG') }));
  await page.keyboard.press('Escape');
  const shopClosed = await page.waitForFunction(() => __hs.state() !== 'shop', { ...WAIT, timeout: 20000 }).then(() => true, () => false);
  check('merchant: shop opens, sells for souls, closes', shopOpen && bought.purse === 12 && bought.herb && shopClosed, { shopOpen, ...bought, shopClosed });

  // the drawn pointer: with the mouse locked (simulated: headless Chrome has no pointer lock) the level-up shows it,
  // mouse deltas move it, the card under it lights up and a left click picks that card
  await page.evaluate(() => { __hs.input.locked = true; __hs.campaign.save.picks = 1; });
  const lvlOpen = await page.waitForFunction(() => __hs.state() === 'levelup', { ...WAIT, timeout: 20000 }).then(() => true, () => false);
  await frames(page, 2);
  const pointer = await page.evaluate(async () => {
    const { ptr, campaign } = __hs;
    const cards = [...document.querySelectorAll('#perks .perk')];
    const want = cards.length - 1, card = cards[want];
    const r = card.getBoundingClientRect();
    const shown = !ptr.el.classList.contains('hidden');
    dispatchEvent(new MouseEvent('mousemove', { movementX: r.left + r.width / 2 - ptr.x, movementY: r.top + r.height / 2 - ptr.y }));
    const hover = card.classList.contains('sel') && card.classList.contains('hot') && ptr.el.classList.contains('lit');
    const key = campaign.offer[want], before = campaign.save.perks[key] || 0;
    await new Promise((res) => setTimeout(res, 700)); // the level-up ignores clicks for its first 0.6 s
    dispatchEvent(new MouseEvent('mousedown', { button: 0 }));
    return { shown, hover, picked: (campaign.save.perks[key] || 0) === before + 1 };
  });
  await frames(page, 2);
  pointer.gone = await page.evaluate(() => __hs.state() === 'play' && __hs.ptr.el.classList.contains('hidden'));
  await page.evaluate(() => { __hs.input.locked = false; });
  check('pointer: drawn on the level-up under pointer lock, hovers and clicks a card', lvlOpen && pointer.shown && pointer.hover && pointer.picked && pointer.gone, { lvlOpen, ...pointer });

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

  // guidance: in the mill chapter the route follows the roads over the bridge, the objective marker shows
  // on screen, M opens the valley map (the hunt waits, the sheet gets painted) and M closes it
  const guide = await page.evaluate(() => new Promise((res) => {
    const { campaign, player, enemies } = __hs;
    enemies.reset();
    campaign.save.chapter = 2;
    campaign.setupChapter();
    player.pos.set(0, player.pos.y, 120);
    let n = 0;
    const tick = () => {
      if (++n < 30) return requestAnimationFrame(tick);
      const path = __hs.hud.path || [], wp = document.getElementById('waypoint');
      res({
        corners: path.length,
        overBridge: path.some((p) => Math.abs(p.x) < 1 && p.z > 20 && p.z < 70),
        endsAtCoffin: !!path.length && path[path.length - 1] === campaign.task.coffin,
        marker: !wp.hidden && /\d+ m/.test(wp.textContent),
      });
    };
    requestAnimationFrame(tick);
  }));
  check('guide: route to the mill follows the roads over the bridge, marker on screen', guide.corners > 4 && guide.overBridge && guide.endsAtCoffin && guide.marker, guide);
  await page.keyboard.press('KeyM');
  const mapOpen = await page.waitForFunction(() => __hs.state() === 'map' && !document.getElementById('worldmap').classList.contains('hidden'), { ...WAIT, timeout: 30000 }).then(() => true, () => false);
  await frames(page, 3);
  const sheet = await page.evaluate(() => {
    const c = document.getElementById('wmCanvas'), g = c.getContext('2d');
    const px = g.getImageData(Math.floor(c.width / 2), Math.floor(c.height / 2), 1, 1).data;
    const t0 = __hs.enemies.clock;
    return { w: c.width, h: c.height, painted: px[3] === 255 && px[0] + px[1] + px[2] > 150, t0, title: document.getElementById('wmTitle').textContent };
  });
  await frames(page, 10);
  sheet.paused = await page.evaluate((t0) => __hs.enemies.clock === t0, sheet.t0);
  await page.keyboard.press('KeyM');
  const mapClosed = await page.waitForFunction(() => __hs.state() === 'play' && document.getElementById('worldmap').classList.contains('hidden'), { ...WAIT, timeout: 30000 }).then(() => true, () => false);
  check('valley map: M opens it (hunt paused, sheet painted) and closes it', mapOpen && sheet.w > 100 && sheet.painted && sheet.paused && /CAP\. III/.test(sheet.title) && mapClosed, { mapOpen, ...sheet, mapClosed });

  // isometric view (Configurações → Perspectiva): it starts on a diagonal at the true isometric angle, and the
  // hunter's silhouette shows through the house standing between him and the camera (and not out in the open)
  if (house) {
    const iso = await page.evaluate(async (h) => {
      const { player, enemies, isoView, settings, retro, scene } = __hs;
      enemies.reset();
      settings.set({ view: 'iso' });
      const q = Math.PI / 2, yaw = __hs.cam();
      const out = { on: isoView.on, diagonal: Math.abs((((yaw % q) + q) % q) - q / 2) < 1e-6 };
      const raf = () => new Promise((r) => requestAnimationFrame(r));
      const r = retro.renderer, gl = r.getContext(), W = gl.drawingBufferWidth, H = gl.drawingBufferHeight, S = 80;
      // pixels the silhouette changes around the middle of the screen, where the hunter stands
      const silhouette = async (x, z, camYaw) => {
        player.pos.set(x, player.pos.y, z);
        player.vel.set(0, 0, 0);
        __hs.setCam(camYaw);
        for (let i = 0; i < 12; i++) await raf();
        const shot = () => {
          r.setRenderTarget(null);
          r.render(scene, isoView.camera);
          const b = new Uint8Array(S * S * 4);
          gl.readPixels((W - S) >> 1, (H - S) >> 1, S, S, gl.RGBA, gl.UNSIGNED_BYTE, b);
          return b;
        };
        const a = shot();
        for (const t of isoView.twins) t.visible = false;
        const b = shot();
        for (const t of isoView.twins) t.visible = true;
        let n = 0;
        for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 24) n++;
        return n;
      };
      const hz = (h[2] + h[3]) / 2;
      // camera to the east (yaw π/2): west of the house the hunter is behind it, east of it he is in the open
      out.behind = await silhouette(h[0] - 1.2, hz, Math.PI / 2);
      const c = isoView.camera.position;
      out.pitch = +Math.atan2(c.y - player.pos.y - 1, Math.hypot(c.x - player.pos.x, c.z - player.pos.z)).toFixed(4);
      out.open = await silhouette(h[1] + 1.5, hz, Math.PI / 2);
      settings.set({ view: 'third' });
      out.off = !isoView.on && isoView.twins.every((t) => !t.visible);
      return out;
    }, house);
    check('isometric view: diagonal, true angle, silhouette only through the house, and back', iso.on && iso.diagonal && Math.abs(iso.pitch - 0.6155) < 0.01 && iso.behind > 40 && iso.open < 5 && iso.off, iso);
  }
  await page.close();
}

// English: the title screen, settings and the chapter banner switch language; the button switches back
async function english(browser, url, errors) {
  const page = await browser.newPage();
  page.on('pageerror', (e) => errors.push('english: ' + e.message));
  await page.setViewport({ width: 640, height: 360 });
  await noPads(page);
  await page.goto(url);
  await page.evaluate(() => { localStorage.clear(); localStorage.setItem('horror-sword:lang', 'en'); });
  await page.reload();
  await page.waitForFunction(() => window.__hs && document.getElementById('play'), WAIT);
  const en = await page.evaluate(() => ({
    lang: document.documentElement.lang,
    play: document.getElementById('play').textContent,
    lore: document.querySelector('.lore').textContent.slice(0, 20),
    sections: [...document.querySelectorAll('#settings h4')].map((h) => h.textContent),
    button: document.getElementById('langBtn')?.textContent,
  }));
  await page.click('#play');
  await page.waitForFunction(() => __hs.state() === 'play', WAIT);
  const banner = await page.waitForFunction(() => document.getElementById('msgTitle').textContent, { ...WAIT, timeout: 30000 }).then((h) => h.jsonValue(), () => '');
  check('English: title, settings and chapter banner', en.lang === 'en' && en.play === 'HUNT' && en.lore.startsWith('When the sun') && en.sections.includes('Controls') && /^CHAPTER/.test(banner), { ...en, banner });
  await page.close();

  // the title-screen button switches back to Portuguese (reload)
  const p2 = await browser.newPage();
  p2.on('pageerror', (e) => errors.push('english: ' + e.message));
  await noPads(p2);
  await p2.goto(url);
  await p2.evaluate(() => { localStorage.clear(); localStorage.setItem('horror-sword:lang', 'en'); });
  await p2.reload();
  await p2.waitForFunction(() => document.getElementById('langBtn'), WAIT);
  await Promise.all([p2.waitForNavigation({ timeout: 60000 }), p2.click('#langBtn')]);
  await p2.waitForFunction(() => document.getElementById('play'), WAIT);
  const back = await p2.evaluate(() => ({ lang: document.documentElement.lang, play: document.getElementById('play').textContent }));
  check('language button switches back to Portuguese', back.lang === 'pt-BR' && back.play === 'CAÇAR', back);
  await p2.close();
}

// a fake standard-mapping controller (navigator.getGamepads is replaced before the game loads)
async function gamepad(browser, url, errors) {
  const page = await browser.newPage();
  page.on('pageerror', (e) => errors.push('gamepad: ' + e.message));
  await page.setViewport({ width: 640, height: 360 });
  await page.evaluateOnNewDocument(() => {
    try { localStorage.clear(); localStorage.setItem('horror-sword:lang', 'pt'); } catch {}
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
  await press(13); // D-pad down
  const padMap = await page.waitForFunction(() => __hs.state() === 'map', { ...WAIT, timeout: 30000 }).then(() => true, () => false);
  await press(1); // B
  const padBack = await page.waitForFunction(() => __hs.state() === 'play', { ...WAIT, timeout: 30000 }).then(() => true, () => false);
  check('controller: D-pad down opens the valley map, B closes it', padMap && padBack, { padMap, padBack });
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
  // a tap on the minimap opens the valley map, a tap on the map goes back to the hunt
  const mini = await (await page.$('#tbMap'))?.boundingBox();
  if (mini) await page.touchscreen.tap(mini.x + mini.width / 2, mini.y + mini.height / 2);
  const tapMap = await page.waitForFunction(() => __hs.state() === 'map' && document.getElementById('touch').classList.contains('hidden'), { ...WAIT, timeout: 30000 }).then(() => true, () => false);
  await page.waitForFunction(() => performance.now() - __hs.worldMap.openAt > 500, WAIT);
  await page.touchscreen.tap(60, 60);
  const tapBack = await page.waitForFunction(() => __hs.state() === 'play' && !document.getElementById('touch').classList.contains('hidden'), { ...WAIT, timeout: 30000 }).then(() => true, () => false);
  check('touch: tapping the minimap opens the valley map, a tap closes it', !!mini && tapMap && tapBack, { tapMap, tapBack });
  await page.close();
}

const deadline = setTimeout(() => { console.error('FAIL  smoke test took longer than 12 minutes'); process.exit(1); }, 12 * 60000);
let server, prodServer, browser;
const errors = [];
const PROD = fs.mkdtempSync(path.join(os.tmpdir(), 'hs-smoke-prod-'));
try {
  const exe = chromePath();
  if (!exe) throw new Error('no Chrome/Chromium found: set CHROME_PATH');
  await buildProd(PROD);
  await buildSnapshot();
  check('development build', fs.existsSync(path.join(OUT, 'index.html')));
  server = await serve(OUT);
  prodServer = await serve(PROD);
  const url = `http://127.0.0.1:${server.address().port}/`;
  browser = await puppeteer.launch({
    executablePath: exe, headless: true, pipe: true,
    // --no-sandbox: CI runners (Ubuntu 24.04) block Chrome's user-namespace sandbox
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio', ...(process.env.CI ? ['--no-sandbox'] : [])],
  });
  await desktop(browser, url, errors);
  await gamepad(browser, url, errors);
  await english(browser, url, errors);
  await touch(browser, url, errors);
  await offline(browser, `http://127.0.0.1:${prodServer.address().port}/`, PROD, errors);
} catch (e) {
  check('smoke test ran to the end', false, e.stack || String(e));
} finally {
  check('no page errors', errors.length === 0, errors.length ? errors.slice(0, 5) : '');
  await browser?.close().catch(() => {});
  server?.close();
  prodServer?.close();
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.rmSync(PROD, { recursive: true, force: true });
  clearTimeout(deadline);
}
console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
