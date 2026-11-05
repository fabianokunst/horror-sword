// Language: Portuguese (the original) or English. Picked with the button on the title screen and remembered;
// a first visit follows the browser's language. Texts are written where they are used as L('português', 'English'),
// so both versions sit side by side; switching reloads the page (every table is built in the chosen language).
const KEY = 'horror-sword:lang';
let saved = null;
try { saved = localStorage.getItem(KEY); } catch { /* storage blocked: follow the browser */ }
export const LANG = saved === 'en' || saved === 'pt' ? saved : (navigator.language || 'pt').toLowerCase().startsWith('pt') ? 'pt' : 'en';
export const EN = LANG === 'en';
export const L = (pt, en) => (EN && en != null ? en : pt);

export function setLang(lang) {
  try { localStorage.setItem(KEY, lang); } catch { /* not remembered, still switches for this load */ }
  location.reload();
}

// the static texts of index.html
export function translatePage() {
  document.documentElement.lang = EN ? 'en' : 'pt-BR';
  if (!EN) return;
  const set = (sel, html) => { const e = document.querySelector(sel); if (e) e.innerHTML = html; };
  const label = (sel, text) => { const e = document.querySelector(sel); if (e) e.setAttribute('aria-label', text); };
  set('#menu h2', 'The Night Hunter');
  set('.lore', 'When the sun goes down, the dead rise. Vampires, ghouls and bats take the forest.<br />With your runic blade, survive the nights and reap the souls of the creatures.');
  set('.controls.desk-only',
    '<span>WASD</span> move &nbsp; <span>Mouse</span> camera &nbsp; <span>Shift</span> run &nbsp; <span>Space</span> jump<br />' +
    '<span>Left click</span> sword (3-hit combo) &nbsp; <span>Right click / Ctrl</span> dodge &nbsp; <span>Q / F</span> silver crossbow &nbsp; <span>R</span> lock target<br />' +
    '<span>V</span> blade Art (full Fury) &nbsp; <span>1-6 / X / wheel</span> swap rune<br />' +
    'Vampires burn at dawn · Red eyes: dodge at the last instant to counter &nbsp; <span>Esc</span> pause &nbsp; <span>M</span> map &nbsp; <span>N</span> sound');
  set('.controls.touch-only',
    '<span>Left side</span> move &nbsp; <span>Right side</span> drag the camera<br />' +
    '<span>Sword</span> hold for the combo &nbsp; <span>Dodge</span> <span>Bow</span> <span>Jump</span> <span>Run</span> <span>Target</span><br />' +
    '<span>Art</span> with full Fury &nbsp; <span>Rune</span> swaps the blade\'s power &nbsp; <span>Minimap</span> tap for the valley map<br />' +
    'Vampires burn at dawn · Red eyes: dodge at the last instant to counter');
  set('.rotate-hint', '↻ Turn the device sideways to play better');
  set('#play', 'HUNT');
  set('#settingsBtn', 'SETTINGS');
  set('.credits', 'Free software · <a href="THIRD-PARTY-NOTICES.txt" target="_blank" rel="noopener">Licenses and credits</a>');
  set('#dead h1', 'You Fell');
  set('#retry', 'TRY AGAIN');
  set('#win h1', 'Victory');
  set('#win h2', 'Count Dracula has been destroyed');
  set('#winRetry', 'HUNT AGAIN');
  set('#nightLbl', 'DUSK');
  for (const [key, text] of [['KeyC', 'DODGE'], ['KeyQ', 'BOW'], ['Space', 'JUMP'], ['KeyR', 'TARGET'], ['KeyV', 'ART'], ['KeyX', 'RUNE']])
    set(`#touch [data-key="${key}"] small`, text);
  set('#tbSprint small', 'RUN');
  label('#tbPause', 'Pause');
  label('#touch [data-key="Mouse0"]', 'Sword');
  label('#touch [data-key="KeyR"]', 'Lock target');
  label('#tbArt', 'Blade Art');
  label('#tbRune', 'Swap rune');
  label('#tbMap', 'Map');
}
