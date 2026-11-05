// fonts are bundled with the game (SIL Open Font License) instead of fetched from a third-party CDN
import '@fontsource/pirata-one';
import '@fontsource/vt323';
import * as THREE from 'three';
import { RetroRenderer, lambert, glowSprite, pixelTexture } from './ps1.js';
import { World, heightAt, WATER, findSpawn, CASTLE } from './world.js';
import { Player } from './player.js';
import { Enemies } from './enemies.js';
import { Effects } from './effects.js';
import { Input } from './input.js';
import { UiCursor } from './cursor.js';
import { TouchControls } from './touch.js';
import { Hud } from './hud.js';
import { Inventory } from './inventory.js';
import { Campaign, roman } from './campaign.js';
import { HuntMenu } from './menu.js';
import { initAudio, sfx, updateAmbient, setListener, setPaused, toggleMute, isMuted, setVolumes } from './audio.js';
import { Gamepads } from './gamepad.js';
import { Settings } from './settings.js';
import { LockOn } from './lockon.js';
import { CameraCollider } from './camcollide.js';
import { Interact } from './interact.js';
import { Blade } from './runes.js';
import { WorldMap } from './worldmap.js';
import { L, EN, translatePage, setLang } from './i18n.js';

const CYCLE = 240; // seconds for a full day/night
// perfect dodge: creatures crawl at WITCH_SLOW speed for WITCH real seconds, the blade hits harder a bit longer
const WITCH = 1.1, WITCH_SLOW = 0.25;
const FOV = 62; // vertical, for landscape screens
const MIN_HFOV = 2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(FOV / 2)) * 4 / 3); // what a 4:3 screen sees
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const lerpAngle = (a, b, t) => a + (((b - a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI) * t;

translatePage(); // index.html texts in the chosen language (i18n.js)

// ------------------------------------------------------------------ renderer & scene
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
// the scene is drawn at 240p anyway; a device-res canvas only makes the upscaled pixels evenly sized
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.BasicShadowMap;
document.getElementById('game').appendChild(renderer.domElement);
const retro = new RetroRenderer(renderer);

const scene = new THREE.Scene();
scene.background = new THREE.Color();
scene.fog = new THREE.Fog(0x000000, 10, 80);
const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 1200);

const hemi = new THREE.HemisphereLight(0x405080, 0x201018, 0.5);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffffff, 1);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
Object.assign(sun.shadow.camera, { left: -28, right: 28, top: 28, bottom: -28, near: 1, far: 160 });
sun.shadow.bias = -0.0008;
scene.add(sun, sun.target);

// sky dome objects: stars, moon, sun disc
const stars = (() => {
  const N = 900, arr = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, r = Math.sqrt(1 - u * u);
    arr.set([Math.cos(a) * r * 500, Math.abs(u) * 500, Math.sin(a) * r * 500], i * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
  const p = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 1.5, sizeAttenuation: false, fog: false, transparent: true }));
  p.frustumCulled = false;
  scene.add(p);
  return p;
})();
const moonTex = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d');
  g.fillStyle = '#fff';
  g.beginPath(); g.arc(16, 16, 15, 0, Math.PI * 2); g.fill();
  g.fillStyle = 'rgba(120,120,150,0.5)';
  for (const [x, y, r] of [[11, 12, 4], [20, 19, 3], [18, 9, 2], [10, 21, 2]]) { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); }
  return pixelTexture(new THREE.CanvasTexture(c));
})();
const moon = new THREE.Sprite(new THREE.SpriteMaterial({ map: moonTex, fog: false, color: 0xe8ecff }));
moon.scale.setScalar(38);
const moonGlow = glowSprite(0x8090ff, 140, 0.35);
moonGlow.material = moonGlow.material.clone();
moonGlow.material.fog = false;
const sunDisc = glowSprite(0xffc080, 90, 0.9);
sunDisc.material = sunDisc.material.clone();
sunDisc.material.fog = false;
scene.add(moon, moonGlow, sunDisc);

// water: the waves are computed in the vertex shader (chained after the PS1 patch), so the CPU only
// moves the sheet along with the hunter and advances the clock
const waterTime = { value: 0 };
const waterMat = lambert(0x1a4a66, { transparent: true, opacity: 0.8 });
const ps1Patch = waterMat.onBeforeCompile;
waterMat.onBeforeCompile = (shader, r) => {
  ps1Patch(shader, r);
  shader.uniforms.uWaterTime = waterTime;
  shader.vertexShader = 'uniform float uWaterTime;\n' + shader.vertexShader.replace(
    '#include <begin_vertex>',
    `#include <begin_vertex>
    vec3 hsWave = (modelMatrix * vec4(transformed, 1.0)).xyz;
    transformed.y += sin(hsWave.x * 0.3 + uWaterTime * 1.5) * 0.1 + cos(hsWave.z * 0.25 + uWaterTime * 1.1) * 0.1;`
  );
};
waterMat.customProgramCacheKey = () => 'ps1-water';
const water = new THREE.Mesh(new THREE.PlaneGeometry(260, 260, 52, 52).rotateX(-Math.PI / 2), waterMat);
scene.add(water);

// ------------------------------------------------------------------ game objects
const world = new World(scene);
const fx = new Effects(scene);
const player = new Player(scene);
const enemies = new Enemies(scene, fx);
enemies.world = world;
const input = new Input(renderer.domElement);
const touch = new TouchControls(input);
const pads = new Gamepads(input);
// the mouse pointer drawn on the choice screens, where the real one stays locked (and hidden)
const ptr = new UiCursor();
// (the valley map too: the controller and the mouse leave the camera alone while it is open)
const choosing = () => state === 'inv' || state === 'levelup' || state === 'shop' || state === 'map';
// camera sensitivity, inverted Y and vibration from the settings panel (applied in applyPrefs below)
const prefs = { sens: 1, invertY: false, vibrate: true, waypoint: true };
const LOOK_K = 0.0024; // radians per mouse pixel at 100% sensitivity
const hud = new Hud();
const inv = new Inventory(scene, player, fx, renderer);
const lock = new LockOn(scene);
lock.btn = document.querySelector('#touch [data-key="KeyR"]');
const camCol = new CameraCollider(world);
const worldMap = new WorldMap();

const spawnPt = findSpawn();
player.pos.set(spawnPt.x, heightAt(spawnPt.x, spawnPt.z), spawnPt.z);
player.facing = Math.atan2(CASTLE.x - spawnPt.x, CASTLE.z - spawnPt.z);
world.update(player.pos.x, player.pos.z, 0, true);

let state = 'menu';
let camYaw = player.facing + Math.PI, camPitch = 0.32;
let dayT = 0.44, night = 0, wasNight = false, draculaNight = -1, hitstop = 0, deadTimer = 0, elapsed = 0;
let dayAmt = 1, bloodMoon = false, witch = 0;
let goal = { text: '' }; // this frame's objective (campaign.objective)

// phone vibration / controller rumble, unless switched off in the settings
function buzz(ms, strong) {
  if (!prefs.vibrate) return;
  if (input.touch) navigator.vibrate?.(ms);
  pads.rumble(ms * 2, strong);
}
enemies.onPlayerHit = () => {
  sfx.hurt(); hud.hurt(); fx.shake += 0.5; player.flash = 0.1;
  buzz(60, 0.8);
};
// a roll at the last instant before a blow: slow motion for the creatures and a counter window for the blade
enemies.onPerfectDodge = () => {
  witch = WITCH;
  player.perfectDodge(WITCH + 0.5);
  sfx.perfect();
  fx.burst(player.pos.clone().setY(player.pos.y + 1), player.rank.color, 24, { speed: 6, up: 2, gravity: 0, life: 0.5, size: 0.12 });
  hud.toast(L('✦ Esquiva perfeita — contra-ataque!', '✦ Perfect dodge — counter!'));
  buzz(30, 0.3);
  blade.perfectDodge();
};
// the Count changes phase: title card, organ and thunder, and a shockwave that throws the hunter back
enemies.onBossPhase = (e, stage) => {
  hud.message(stage === 2 ? L('NÉVOA E SANGUE', 'MIST AND BLOOD') : L('A FÚRIA DO CONDE', "THE COUNT'S FURY"),
    stage === 2 ? L('O Conde se desfaz em névoa... cuidado com o sangue que ele lança.', 'The Count dissolves into mist... beware the blood he hurls.')
      : L('Ferido, ele golpeia duas vezes e não dá trégua.', 'Wounded, he strikes twice and gives no quarter.'), 3.5);
  sfx.bossPhase(e.pos);
  fx.shake += 0.8;
  buzz(120, 1);
  const dx = player.pos.x - e.pos.x, dz = player.pos.z - e.pos.z, d = Math.hypot(dx, dz) || 1;
  if (d < 8) { player.vel.x += (dx / d) * 14; player.vel.z += (dz / d) * 14; }
};
enemies.onStagger = () => { hud.toast(L('Atordoado pelo grito! Esquive quando ela inspirar.', 'Stunned by the scream! Dodge when she draws breath.')); fx.shake += 0.4; };
enemies.onKill = (e) => campaign.onKill(e);
const prevKill = enemies.onKill;
enemies.onKill = (e) => { prevKill?.(e); inv.loot(e); blade.onKill(e); };
// sword runes: the blade's element, the Fúria bar and the Artes (runes.js)
const blade = new Blade({ scene, player, enemies, fx, hud, world });
blade.dmgMul = () => inv.damageMul;
blade.keyName = () => (input.touch ? L('ARTE', 'ART') : pads.active ? 'RT' : 'V');
player.onArt = () => blade.fire();
blade.onFire = (hits) => {
  hitstop = hits ? 0.12 : 0.04;
  fx.shake += 0.8;
  buzz(90, 0.9);
};
const _dust = new THREE.Vector3();
player.onSwing = (combo, def) => {
  sfx.swing(combo);
  const heavy = def.vertical || def.counter; // counter hits after a perfect dodge land like the finisher
  fx.slash(player.pos, player.facing, def.vertical, blade.slashColor(combo === 2 || def.counter));
  // the overhead finisher hits the ground in front of the hunter: a spray of earth where the blade lands
  if (def.vertical) fx.burst(_dust.set(player.pos.x + Math.sin(player.facing) * 2, player.pos.y + 0.1, player.pos.z + Math.cos(player.facing) * 2), 0x7a6a50, 14, { speed: 4, up: 2.5, life: 0.5, size: 0.13 });
  const struck = [];
  const hits = enemies.hitArc(player, inv.damageMul > 1 ? { ...def, dmg: def.dmg * inv.damageMul } : def, (e) => {
    struck.push(e);
    blade.strike(e, def);
  });
  blade.afterSwing(struck, def, combo);
  if (hits) player.heal(hits * player.stats.lifesteal); // "Sede de Sangue" perk
  const n = hits + world.hitCoffins(player, def, fx);
  if (n > 0) {
    sfx.hit(heavy);
    hitstop = heavy ? 0.09 : 0.05;
    fx.shake += heavy ? 0.45 : 0.25;
  }
};

// ------------------------------------------------------------------ campaign: chapters (coffins → blood moon → the Count), XP, saves
// The chapter sequence, objective line, coffin events and checkpoints live in campaign.js.
let finalFight = false;
const campaign = new Campaign({ world, enemies, player, hud, fx });
campaign.inv = inv;
campaign.blade = blade;
inv.blade = blade; // the Incenso de Ira fills the Fúria bar
campaign.onVictory = () => setTimeout(showWin, 3500);
// shrines (rest + checkpoint) and Borgo's merchant
const interact = new Interact({ scene, world, player, campaign, inv, hud, fx });
function useOrPickup() {
  const r = interact.use(night);
  if (r === 'shop') { state = 'shop'; touch.show(false); }
  else if (!r) inv.pickup();
}
interact.onTap = () => { if (state === 'play') useOrPickup(); };
world.onPlaceEnter = (p) => hud.message(p.name.toUpperCase(), p.sub, 3);
function startFinalFight() {
  if (finalFight) return;
  finalFight = true;
  dayT = 0.75; // midnight under a blood moon
  bloodMoon = true;
  enemies.spawnAt('dracula', world.arena.x, world.arena.z - 14);
  enemies.spawnAt('bride', world.arena.x - 8, world.arena.z - 8);
  enemies.spawnAt('bride', world.arena.x + 8, world.arena.z - 8);
  hud.message(L('CONDE DRÁCULA', 'COUNT DRACULA'), L('Bem-vindo ao meu castelo, caçador.', 'Welcome to my castle, hunter.'), 5);
  campaign.onFinalFight();
  sfx.boss();
}
const winUi = document.getElementById('win');
const winBtn = document.getElementById('winRetry');
function showWin() {
  state = 'win';
  document.exitPointerLock?.();
  hud.show(false);
  hud.hidePerks(); // a level gained from the victory bonus is offered again once the next cycle starts
  deadUi.classList.add('hidden');
  touch.show(false);
  document.getElementById('winStats').innerHTML = campaign.victoryReport();
  winBtn.textContent = `${L('CICLO', 'CYCLE')} ${roman(campaign.save.cycle + 1)}`;
  winUi.classList.remove('hidden');
}
// new game+: the saved hunt already moved to the next cycle when the Count fell
winBtn.addEventListener('click', () => {
  winUi.classList.add('hidden');
  resume();
  startRun(campaign.save);
});

// ------------------------------------------------------------------ ui flow
const menu = document.getElementById('menu');
const deadUi = document.getElementById('dead');
const playBtn = document.getElementById('play');
document.body.classList.toggle('touch', input.touch);

// phones: hide the browser chrome and prefer landscape (both silently fail where unsupported, e.g. iPhone)
function goFullscreen() {
  const el = document.documentElement;
  if (document.fullscreenElement || !el.requestFullscreen) return;
  el.requestFullscreen({ navigationUI: 'hide' })
    .then(() => screen.orientation?.lock?.('landscape'))
    .catch(() => {});
}

const huntMenu = new HuntMenu(playBtn);

// back into the action from any overlay (title, pause, level-up, death, victory)
function resume() {
  document.getElementById('langBtn')?.remove(); // the language is picked before the first hunt
  initAudio();
  setPaused(false);
  if (input.touch) goFullscreen();
  else input.lock();
  menu.classList.add('hidden');
  hud.show(true);
  touch.show(input.touch);
  state = 'play';
}

// Loads a save (continue, new hunt, checkpoint after a death, next cycle) into the running game.
function startRun(save) {
  huntMenu.close();
  finalFight = false;
  hitstop = deadTimer = witch = 0;
  enemies.timeScale = 1;
  lock.release();
  dayT = campaign.start(save);
  night = save.stats.nights || 0;
  wasNight = Math.sin(dayT * Math.PI * 2) * 0.9 - 0.2 < -0.05; // same test as updateSky, so no false nightfall
  camYaw = player.facing + Math.PI;
}

playBtn.addEventListener('click', () => {
  const fresh = state === 'menu';
  resume();
  if (fresh) {
    startRun(huntMenu.choice());
    sfx.bell();
  }
});
const retryBtn = document.getElementById('retry');
retryBtn.addEventListener('click', () => {
  deadUi.classList.add('hidden');
  resume();
  startRun(campaign.next);
});

// level-up: the game freezes on a choice of three perks (tap, click with the pointer, arrows or 1-2-3)
function openLevelUp() {
  const info = campaign.perkInfo();
  if (!info) return;
  state = 'levelup';
  touch.show(false);
  hud.showPerks(info, choosePerk);
}
function choosePerk(key) {
  if (state !== 'levelup') return;
  campaign.pick(key);
  sfx.select();
  const info = campaign.perkInfo();
  if (info) hud.showPerks(info, choosePerk);
  else {
    hud.hidePerks();
    resume();
  }
}

// the valley map (worldmap.js): M, D-pad down or a tap on the minimap; the hunt waits while it is open
function openMap() {
  state = 'map';
  touch.show(false);
  worldMap.open({
    title: `${campaign.tag} — ${campaign.chapter.title}`,
    goal: goal.text,
    hint: input.touch ? L('Toque para voltar', 'Tap to go back') : pads.active ? L('B ou ↓ para voltar', 'B or ↓ to go back') : L('M ou clique direito para voltar', 'M or right click to go back'),
  });
  sfx.paper();
}

function pause() {
  if (state !== 'play') return;
  state = 'pause';
  setPaused(true);
  playBtn.textContent = L('CONTINUAR', 'CONTINUE');
  menu.classList.remove('hidden');
  touch.show(false);
  if (document.pointerLockElement) document.exitPointerLock();
}
input.onLockChange = (locked) => { if (!locked) pause(); };
touch.onPause = pause;
// switching between touch and mouse/keyboard mid-game: pause so "CONTINUAR" resumes with the right scheme
input.onModeChange = (isTouch) => {
  document.body.classList.toggle('touch', isTouch);
  pause();
};
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });

// sound on/off: menu button (works on touch too) and the N key; remembered between visits
const soundBtn = document.getElementById('soundBtn');
const soundLabel = () => { if (soundBtn) soundBtn.textContent = isMuted() ? L('♪ SOM: DESLIGADO', '♪ SOUND: OFF') : L('♪ SOM: LIGADO', '♪ SOUND: ON'); };
soundBtn?.addEventListener('click', () => { toggleMute(); soundLabel(); });
soundLabel();

// language: only on the title screen (switching reloads the page, which would cut a hunt short)
const langBtn = document.createElement('button');
langBtn.className = 'secondary';
langBtn.id = 'langBtn';
langBtn.textContent = EN ? 'LANGUAGE: ENGLISH' : 'IDIOMA: PORTUGUÊS';
langBtn.title = EN ? 'Mudar para português' : 'Switch to English';
langBtn.addEventListener('click', () => setLang(EN ? 'pt' : 'en'));
soundBtn?.after(langBtn);

// video filters (resolution, palette, dithering, CRT): edited live from the menu, saved in localStorage
const settings = new Settings({
  panel: document.getElementById('settings'), menu, button: document.getElementById('settingsBtn'), describe: () => retro.info,
});
// controls and sound preferences live in the same panel
function applyPrefs(v) {
  prefs.sens = v.sens / 100;
  prefs.invertY = v.invertY;
  prefs.vibrate = v.vibrate;
  prefs.waypoint = v.waypoint;
  hud.mapRotate = v.mapRotate;
  setVolumes({ music: v.vMusic / 100, sfx: v.vSfx / 100, amb: v.vAmb / 100 });
}
settings.onChange = (v) => { retro.apply(v); applyPrefs(v); };
retro.apply(settings.values);
applyPrefs(settings.values);

// controllers: a hint the first time one connects; A/Start press the main button of title, pause, death and victory
pads.onConnect = () => hud.toast(L('Controle conectado · A pula · X espada · B esquiva · Y besta · LB alvo · LT corre', 'Controller connected · A jump · X sword · B dodge · Y crossbow · LB target · LT run'));
pads.onMenuPress = (b) => {
  if (settings.isOpen) { if (b === 'B') settings.close(); return; }
  if (b === 'B') return;
  const btn = [winBtn, retryBtn, playBtn].find((el) => el.offsetParent !== null);
  btn?.click();
};

function resize() {
  const w = innerWidth, h = innerHeight;
  // a page loaded hidden or before layout (background tab, iframe, webview) reports 0×0;
  // keep the last size instead of allocating zero-size render targets, the next resize fixes it
  if (!w || !h) return;
  renderer.setSize(w, h);
  retro.setSize(w, h);
  camera.aspect = w / h;
  // portrait: widen the vertical FOV (capped) so the sides of the fight stay visible
  const fit = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(MIN_HFOV / 2) / camera.aspect));
  camera.fov = Math.min(95, Math.max(FOV, fit));
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
// iOS sometimes reports the old size right after rotating
addEventListener('orientationchange', () => setTimeout(resize, 300));
resize();

// ------------------------------------------------------------------ sky / time of day
const C = {
  night: new THREE.Color(0x0b0d22), blood: new THREE.Color(0x2c0612), day: new THREE.Color(0x8494a6),
  dusk: new THREE.Color(0xc8503a), sunW: new THREE.Color(0xffe0c0), sunO: new THREE.Color(0xff7040),
  moonB: new THREE.Color(0x8090ff), moonR: new THREE.Color(0xff4040),
};
const sky = new THREE.Color(), tmp = new THREE.Color();
const sunDir = new THREE.Vector3(), moonDir = new THREE.Vector3();

function updateSky(dt) {
  const ang = dayT * Math.PI * 2;
  const elev = Math.sin(ang) * 0.9 - 0.2;
  sunDir.set(Math.cos(ang), elev, -0.45).normalize();
  moonDir.set(-Math.cos(ang), Math.max(0.25, -elev), -0.6).normalize();
  dayAmt = smooth(-0.1, 0.3, elev);
  const dusk = Math.max(0, 1 - Math.abs(elev) / 0.3);

  const isNight = elev < -0.05;
  bloodMoon = finalFight || campaign.bloodMoon; // chapters V and VI turn every night red
  if (isNight && !wasNight) {
    night++;
    campaign.onNightfall(night);
    if (bloodMoon) sfx.bloodMoon();
    else sfx.bell(3);
  } else if (!isNight && wasNight) {
    campaign.onDawn();
    sfx.dawn();
  }
  wasNight = isNight;

  sky.copy(bloodMoon ? C.blood : C.night).lerp(C.day, dayAmt).lerp(C.dusk, dusk * 0.6);
  scene.background.copy(sky);
  scene.fog.color.copy(sky);
  world.castle.userData.hazeMat.emissive.copy(sky).multiplyScalar(0.35 + dayAmt * 0.3);
  scene.fog.near = 6 + dayAmt * 20;
  scene.fog.far = 70 + dayAmt * 90;

  const useSun = elev > -0.05;
  const dir = useSun ? sunDir : moonDir;
  sun.position.copy(player.pos).addScaledVector(dir, 70);
  sun.target.position.copy(player.pos);
  if (useSun) {
    sun.color.copy(C.sunW).lerp(C.sunO, dusk);
    sun.intensity = 0.3 + dayAmt * 1.5;
  } else {
    sun.color.copy(bloodMoon ? C.moonR : C.moonB);
    sun.intensity = 0.55;
  }
  hemi.intensity = 0.7 + dayAmt * 0.45;
  hemi.color.copy(bloodMoon ? tmp.set(0x602030) : tmp.set(0x3a4a90)).lerp(C.day, dayAmt);

  stars.position.copy(camera.position);
  stars.material.opacity = 1 - dayAmt;
  moon.position.copy(camera.position).addScaledVector(moonDir, 420);
  moonGlow.position.copy(moon.position);
  moon.material.color.copy(bloodMoon ? C.moonR : tmp.set(0xe8ecff));
  moonGlow.material.color.copy(bloodMoon ? C.moonR : C.moonB);
  moon.material.opacity = moonGlow.material.opacity = 1 - dayAmt * 0.85;
  sunDisc.position.copy(camera.position).addScaledVector(sunDir, 420);
  sunDisc.visible = elev > -0.15;

  retro.material.uniforms.uTint.value.set(1, bloodMoon && isNight ? 0.88 : 1, bloodMoon && isNight ? 0.9 : 1);
  return isNight;
}

function updateWater(time) {
  // snapped to a 5 m grid so the waves (in world space) don't slide with the hunter
  water.position.set(Math.round(player.pos.x / 5) * 5, WATER, Math.round(player.pos.z / 5) * 5);
  waterTime.value = time;
}

// ------------------------------------------------------------------ audio derived from game state
// footsteps, jumps/landings, bolt reloads, nearby creature chatter, and the danger level that drives the score
let stepDist = 0, airT = 0, lastBolts = player.bolts, chatterT = 2;
function audioFrame(dt, time) {
  setListener(player.pos.x, player.pos.z, camYaw);
  const sp = Math.hypot(player.vel.x, player.vel.z);
  if (player.grounded && !player.roll && !player.dead && sp > 1 && (stepDist += sp * dt) > 1.85) {
    stepDist = 0;
    sfx.step(player.swimming, sp > 8);
    // sprinting kicks up dust at every footfall
    if (sp > 8 && !player.swimming) fx.burst(player.pos.clone().setY(player.pos.y + 0.05), 0x7a6a50, 3, { speed: 1.5, up: 1, life: 0.35, size: 0.1 });
  }
  if (!player.grounded) {
    if (airT === 0 && player.vel.y > 4) sfx.jump();
    airT += dt;
  } else {
    if (airT > 0.25 && !player.swimming) {
      sfx.land();
      fx.burst(player.pos.clone().setY(player.pos.y + 0.05), 0x7a6a50, 10, { speed: 3, up: 1, life: 0.45, size: 0.12 });
    }
    airT = 0;
  }
  if (player.bolts > lastBolts) sfx.reload();
  lastBolts = player.bolts;

  let danger = 0;
  const near = [];
  for (const e of enemies.list) {
    if (e.dying) continue;
    const d = Math.hypot(e.pos.x - player.pos.x, e.pos.z - player.pos.z);
    if (d < 30) { near.push(e); danger += 1 - d / 30; }
  }
  if ((chatterT -= dt) <= 0) {
    chatterT = 1.5 + Math.random() * 2.5;
    if (near.length) { const e = near[Math.floor(Math.random() * near.length)]; sfx.idle(e.type, e.pos); }
  }
  updateAmbient(time, 1 - dayAmt, { danger: danger / 2.5, hp: player.hp / player.maxHp, blood: bloodMoon && wasNight, boss: !!enemies.boss });
}

// ------------------------------------------------------------------ main loop
const clock = new THREE.Clock();
const camTarget = new THREE.Vector3();
const camDir = new THREE.Vector3();
const camLook = new THREE.Vector3();
const camBack = new THREE.Vector3();
const witchTint = new THREE.Vector3();
let camDist = 7; // current camera distance, pulled in by walls (see camcollide.js)

function frame() {
  requestAnimationFrame(frame);
  const rawDt = Math.min(clock.getDelta(), 0.05);
  elapsed += rawDt;
  const time = elapsed;
  let dt = rawDt;
  if (hitstop > 0) { hitstop -= rawDt; dt = rawDt * 0.05; }
  // controllers first: their buttons become this frame's virtual keys
  pads.update(rawDt, state === 'play' ? 'play' : choosing() ? 'ui' : 'menu');

  if (state === 'play' || state === 'dead') {
    // slow motion after a perfect dodge, easing back to full speed over its last quarter second
    if (witch > 0) witch = Math.max(0, witch - rawDt);
    enemies.timeScale = witch > 0.25 ? WITCH_SLOW : WITCH_SLOW + (1 - WITCH_SLOW) * (1 - witch / 0.25);
    // target lock: drops dead/far targets; while locked, a sideways flick of the look input switches target
    lock.update(rawDt, { player, enemies, lookDx: state === 'play' ? input.dx : 0, camYaw, color: player.rank.color, time });
    if (state === 'play') {
      // before any input is read: held on-screen buttons re-press their keys this frame
      if (input.touch) touch.update(rawDt, player);
      if (lock.target) {
        // the camera swings to look past the hunter at the target (gently when it is right on top of us)
        const d = Math.hypot(lock.target.pos.x - player.pos.x, lock.target.pos.z - player.pos.z);
        camYaw = lerpAngle(camYaw, lock.yaw(player), 1 - Math.exp(-6 * Math.min(1, d / 3) * rawDt));
      } else camYaw -= input.dx * LOOK_K * prefs.sens;
      camPitch = Math.min(1.2, Math.max(-0.3, camPitch + input.dy * LOOK_K * prefs.sens * (prefs.invertY ? -1 : 1)));
    }
    let f = (input.down('KeyW') ? 1 : 0) - (input.down('KeyS') ? 1 : 0);
    let r = (input.down('KeyD') ? 1 : 0) - (input.down('KeyA') ? 1 : 0);
    if (input.stick.x || input.stick.y) { f = -input.stick.y; r = input.stick.x; }
    // touch: with one thumb on the stick, lazily swing the camera behind the hunter while running forward
    if (state === 'play' && input.touch && !lock.target && !input.looking && f > 0.3 && !player.attack && !player.roll)
      camYaw = lerpAngle(camYaw, player.facing + Math.PI, 1 - Math.exp(-1.2 * dt));
    const mv = {
      x: -Math.sin(camYaw) * f + Math.cos(camYaw) * r,
      z: -Math.cos(camYaw) * f - Math.sin(camYaw) * r,
      sprint: input.down('ShiftLeft') || input.down('ShiftRight') || input.sprint,
      jump: input.hit('Space'),
      // locked on: keep facing the target while walking or standing (player.js lets sprinting break it)
      face: lock.target ? Math.atan2(lock.target.pos.x - player.pos.x, lock.target.pos.z - player.pos.z) : null,
    };
    if (state !== 'play') mv.x = mv.z = 0;
    const camAim = Math.atan2(-Math.sin(camYaw), -Math.cos(camYaw));

    if (state === 'play') {
      // without pointer lock the browser never reports Esc as a lock change, so pause by key here
      if ((!input.locked && (input.hit('Escape') || input.hit('KeyP'))) || input.hit('GamepadPause')) pause();
      if (input.hit('KeyR')) lock.toggle(player, enemies, camAim);
      if (input.hit('Mouse0')) {
        const t = lock.target || enemies.target(player, camAim, 6, 1.3);
        const aim = t ? Math.atan2(t.pos.x - player.pos.x, t.pos.z - player.pos.z)
          : Math.hypot(mv.x, mv.z) > 0 ? Math.atan2(mv.x, mv.z) : camAim;
        player.tryAttack(aim);
      }
      if ((input.hit('Mouse2') || input.hit('ControlLeft') || input.hit('KeyC')) && player.tryRoll(mv.x, mv.z)) {
        sfx.dodge();
        fx.burst(player.pos.clone().setY(player.pos.y + 0.2), 0x7a6a50, 8, { speed: 3, up: 1.5, life: 0.4 });
      }
      if ((input.hit('KeyQ') || input.hit('KeyF') || input.hit('Mouse1')) && player.tryShoot()) {
        const from = player.pos.clone().setY(player.pos.y + 1.5);
        const t = lock.target || enemies.target(player, camAim, 40, input.touch ? 0.6 : 0.35); // thumbs aim worse than mice
        const dir = t
          ? new THREE.Vector3(t.pos.x, t.pos.y + (t.T.center ?? 1.1 * (t.T.scale || 1)), t.pos.z).sub(from)
          : camera.getWorldDirection(camDir).clone();
        player.facing = Math.atan2(dir.x, dir.z);
        enemies.fireBolt(from, dir.normalize(), player.stats.boltDmg, player.stats.pierce);
        sfx.bolt();
      } else if ((input.hit('KeyQ') || input.hit('KeyF') || input.hit('Mouse1')) && !player.bolts) sfx.empty();
      // sword runes: V unleashes the Arte; 1-6 pick a rune, X / the wheel / the D-pad cycle through them
      if (input.hit('KeyV')) blade.unleash();
      if (input.hit('KeyX') || input.hit('WheelDown')) blade.next(1);
      if (input.hit('WheelUp') || input.hit('RunePrev')) blade.next(-1);
      for (let i = 0; i < 6; i++) if (input.hit(`Digit${i + 1}`)) blade.slot(i);
      if (input.hit('KeyN')) { toggleMute(); soundLabel(); }
      if (input.hit('KeyM')) openMap();
      if (input.hit('KeyE')) useOrPickup();
      if (input.hit('Tab') || input.hit('KeyI')) { state = 'inv'; inv.open(); touch.show(false); }
    }

    if (!(finalFight && enemies.boss)) dayT = (dayT + dt / CYCLE) % 1; // the final duel stays at midnight
    const isNight = updateSky(dt);
    if (witch > 0) {
      // slow motion reads as a cold, drained picture
      const k = Math.min(1, witch / 0.25);
      retro.material.uniforms.uTint.value.multiply(witchTint.set(1 - 0.2 * k, 1 - 0.06 * k, 1 + 0.12 * k));
    }
    if (state === 'play') campaign.update(dt, { dayT, isNight });
    if (world.gate.open && !finalFight && !player.dead && world.inArena(player.pos.x, player.pos.z)) startFinalFight();

    player.update(dt, mv, world, time);
    // the swinging blade leaves a trail in the rune's (or the rank's) color
    if (player.anim.trail) fx.blade(player.anim.bladeBase, player.anim.bladeTip, blade.slashColor(player.attack?.combo === 2 || player.counter > 0 || !!player.art));
    enemies.update(dt, { player, dayAmt, time, world, spawn: campaign.spawn });
    blade.update(dt, state === 'play');
    world.update(player.pos.x, player.pos.z, time, dt);

    if (player.dead && state === 'play') {
      state = 'dead';
      deadTimer = 2.2;
      sfx.die();
      touch.show(false);
      campaign.onDeath(); // rewinds the save to the checkpoint (or erases it on Pesadelo)
    }
    if (state === 'dead' && deadTimer > 0 && (deadTimer -= rawDt) <= 0) {
      document.exitPointerLock?.();
      hud.show(false);
      document.getElementById('deadStats').innerHTML = campaign.deathReport();
      retryBtn.textContent = campaign.report.permadeath ? L('NOVA CAÇADA', 'NEW HUNT') : L('TENTAR NOVAMENTE', 'TRY AGAIN');
      deadUi.classList.remove('hidden');
    }
    const label = `${campaign.tag} · ${night === 0 ? L('CREPÚSCULO', 'DUSK') : wasNight ? `${L('NOITE', 'NIGHT')} ${night}` : `${L('DIA', 'DAY')} ${night + 1}`}`;
    goal = campaign.objective();
    const mapKey = input.touch ? L('MAPA', 'MAP') : `<b>${pads.active ? '↓' : 'M'}</b> ${L('MAPA', 'MAP')}`;
    hud.update(rawDt, { player, enemies, world, time: dayT, night, label, camYaw, objective: goal.text, target: goal.target, hunter: campaign.hunter, purse: campaign.save.purse || 0, mapKey });
    if (state === 'play' && campaign.save.picks > 0) openLevelUp();
    audioFrame(dt, time);
  } else {
    if (state === 'levelup') {
      const key = hud.perkInput(input);
      if (key) choosePerk(key);
    }
    if (state === 'shop') {
      // like the inventory: closing (or losing the pointer lock) returns to the hunt / the pause menu
      const lost = !input.touch && !input.locked && !input.freeLook;
      if (lost || !interact.handle(input)) {
        interact.close();
        state = 'play';
        touch.show(input.touch);
        if (lost) pause();
      }
    }
    if (state === 'map') {
      // like the inventory: closing returns to the hunt; losing the pointer lock (Esc) falls into the pause menu
      const lost = !input.touch && !input.locked && !input.freeLook;
      if (lost || !worldMap.handle(input)) {
        worldMap.close();
        sfx.paper(false);
        state = 'play';
        touch.show(input.touch);
        if (lost) pause();
      } else {
        worldMap.draw({ player, target: goal.target, path: hud.path, coffins: world.coffins, shrines: interact.shrines, night, merchant: world.merchantSpot, time: elapsed });
      }
    }
    if (state === 'inv') {
      // Esc (or switching to mouse) drops the pointer lock: close the inventory and fall into the pause menu.
      // In freeLook the lock was refused (re-lock too soon after Esc, iframes), so there is nothing to lose.
      const lost = !input.touch && !input.locked && !input.freeLook;
      if (lost || !inv.handle(input)) {
        inv.close();
        state = 'play';
        touch.show(input.touch);
        if (lost) pause();
      }
    }
    // menu / pause: slow cinematic orbit
    if (state === 'menu') camYaw += rawDt * 0.08;
    updateSky(0);
    player.update(0, { x: 0, z: 0 }, world, time);
    world.update(player.pos.x, player.pos.z, time);
  }

  fx.update(dt, time, player.pos, 1 - dayAmt);
  inv.update(dt, time, state, world);
  interact.update(rawDt, { play: state === 'play', night, touch: input.touch });
  updateWater(time);

  // third-person camera
  camTarget.set(player.pos.x, player.pos.y + 1.7, player.pos.z);
  const want = state === 'menu' ? 7 : 5.4;
  camBack.set(Math.sin(camYaw) * Math.cos(camPitch), Math.sin(camPitch), Math.cos(camYaw) * Math.cos(camPitch));
  // a wall or roof behind the hunter pulls the camera in at once (never show through it); open space lets it ease back
  const room = camCol.clear(camTarget, camBack, want);
  camDist = room < camDist ? room : camDist + (room - camDist) * (1 - Math.exp(-4 * rawDt));
  camera.position.copy(camTarget).addScaledVector(camBack, camDist);
  const floor = Math.max(heightAt(camera.position.x, camera.position.z), WATER) + 0.5;
  if (camera.position.y < floor) camera.position.y = floor;
  // camera right behind the head: hide the hunter instead of filling the screen with the coat
  if (camDist < 1) player.m.root.visible = false;
  if (fx.shake > 0) {
    const s = fx.shake * 0.25;
    camera.position.x += (Math.random() - 0.5) * s;
    camera.position.y += (Math.random() - 0.5) * s;
  }
  // locked on: aim a little toward the target so flying creatures stay in frame
  if (lock.target && state === 'play') camTarget.lerp(lock.center(camLook), 0.2);
  camera.lookAt(camTarget);
  hud.waypoint(camera, goal.target, player, state === 'play' && prefs.waypoint);

  retro.render(scene, camera);
  // after this frame's state changes: until the next one the mouse points at the choice screen or plays
  input.ui = choosing();
  ptr.show(input.ui && state !== 'map' && input.locked && !input.touch);
  input.endFrame();
}
frame();

// offline play and "install app": the service worker is generated by the production build (vite.config.js)
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}

if (import.meta.env.DEV) {
  window.__hs = {
    player, enemies, world, sfx, campaign, lock, camera, camCol, interact, inv, input, ptr, blade, hud, worldMap, setDay: (t) => (dayT = t), setNight: (n) => (night = n),
    state: () => state, witch: () => witch, cam: () => camYaw, camDist: () => camDist,
    setCam: (yaw, pitch) => { camYaw = yaw; if (pitch != null) camPitch = pitch; },
  };
}
