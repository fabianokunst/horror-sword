// The valley map (M, D-pad ↓, or a tap on the minimap): the whole valley inked on parchment, with relief,
// forests, roads and every landmark named, plus the shrines, the merchant, the Count's coffins, the hunter
// and, in red ink, the objective and the road to it (route.js). The hunt pauses while it is open.
import { heightAt, mapE, riverZ, WATER, PLACES, ROADS, FORESTS, LAKE, CASTLE } from './world.js';
import { mulberry32 } from './rng.js';
import { L } from './i18n.js';
import './worldmap.css';

const V = { x0: -232, x1: 232, z0: -270, z1: 208 }; // world rectangle on the sheet (mountain ring included)
const VW = V.x1 - V.x0, VH = V.z1 - V.z0;
const STEP = 2; // metres per sample of the painted relief
const GRACE = 350; // ms: the tap that opened the map must not close it

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const mix = (c, d, t) => { c[0] += (d[0] - c[0]) * t; c[1] += (d[1] - c[1]) * t; c[2] += (d[2] - c[2]) * t; };
const INK = '#2a1a0e', PAPER = [228, 212, 174];

const forestAt = (x, z) => {
  for (const f of FORESTS) if (Math.hypot(x - f.x, z - f.z) < f.r * 0.9) return f;
  return null;
};
const roadNear = (x, z, r) => ROADS.some((rd) => rd.some(([ax, az], i) => {
  if (!i) return false;
  const [bx, bz] = rd[i - 1], dx = bx - ax, dz = bz - az, t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(x - ax - dx * t, z - az - dz * t) < r;
}));

// Relief washes on paper, sampled every STEP metres (painted once, then scaled up smoothly)
function paintRelief() {
  const w = VW / STEP + 1, h = VH / STEP + 1, hs = new Float32Array(w * h);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) hs[j * w + i] = heightAt(V.x0 + i * STEP, V.z0 + j * STEP);
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const g = cv.getContext('2d'), img = g.createImageData(w, h), c = [0, 0, 0];
  const H = (i, j) => hs[Math.min(h - 1, Math.max(0, j)) * w + Math.min(w - 1, Math.max(0, i))];
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const x = V.x0 + i * STEP, z = V.z0 + j * STEP, y = H(i, j);
    c[0] = PAPER[0]; c[1] = PAPER[1]; c[2] = PAPER[2];
    const f = forestAt(x, z);
    if (f) mix(c, f.dead ? [176, 160, 160] : [168, 178, 128], 0.55);
    mix(c, [190, 182, 172], 0.4 * smooth(150, 70, Math.hypot(x - CASTLE.x, z - CASTLE.z))); // the castle's ashen crag
    mix(c, [168, 140, 108], 0.75 * smooth(0.86, 1.02, mapE(x, z))); // the mountain ring
    if (y < WATER) mix(c, [122, 150, 160], 0.85);
    // hillshade, light from the north-west
    const k = Math.min(1.22, Math.max(0.62, 1 + ((H(i + 1, j) - H(i - 1, j)) + (H(i, j + 1) - H(i, j - 1))) * 0.11));
    c[0] *= k; c[1] *= k; c[2] *= k;
    // contour lines every 5 m and the shore line
    const band = (v) => Math.floor(v / 5), wet = (v) => v < WATER;
    if (wet(y) !== wet(H(i + 1, j)) || wet(y) !== wet(H(i, j + 1))) mix(c, [50, 70, 86], 0.8);
    else if (y > WATER && (band(y) !== band(H(i + 1, j)) || band(y) !== band(H(i, j + 1)))) mix(c, [120, 90, 60], 0.35);
    img.data.set([c[0], c[1], c[2], 255], (j * w + i) * 4);
  }
  g.putImageData(img, 0, 0);
  return cv;
}

// little ink pictures for each landmark (s = pixels per metre)
const PICS = {
  village(g, x, y, s) {
    const house = (hx, hy, w) => {
      g.fillRect(hx - w / 2, hy - w * 0.4, w, w * 0.8);
      g.beginPath(); g.moveTo(hx - w * 0.65, hy - w * 0.35); g.lineTo(hx, hy - w); g.lineTo(hx + w * 0.65, hy - w * 0.35); g.fill();
    };
    for (const [dx, dz] of [[-12, -8], [11, -10], [-14, 9], [13, 8], [-3, 15], [5, -16]]) house(x + dx * s, y + dz * s, 6 * s);
    // the church in the square
    g.fillRect(x - 2.5 * s, y - 5 * s, 5 * s, 9 * s);
    g.fillRect(x - 0.6 * s, y - 10 * s, 1.2 * s, 5 * s);
    g.fillRect(x - 2 * s, y - 8.6 * s, 4 * s, 1.1 * s);
  },
  cemetery(g, x, y, s) {
    g.lineWidth = Math.max(1, 0.9 * s);
    for (let i = -2; i <= 2; i++) for (let j = -1; j <= 1; j++) {
      const cx = x + i * 6 * s + (j % 2) * 3 * s, cy = y + j * 7 * s;
      g.beginPath(); g.moveTo(cx, cy - 3 * s); g.lineTo(cx, cy + 2.5 * s); g.moveTo(cx - 1.6 * s, cy - 1.3 * s); g.lineTo(cx + 1.6 * s, cy - 1.3 * s); g.stroke();
    }
  },
  windmill(g, x, y, s) {
    g.fillRect(x - 3 * s, y - 2 * s, 6 * s, 8 * s);
    g.lineWidth = Math.max(1.2, 1.2 * s);
    g.beginPath(); g.moveTo(x - 8 * s, y - 10 * s); g.lineTo(x + 8 * s, y + 6 * s); g.moveTo(x + 8 * s, y - 10 * s); g.lineTo(x - 8 * s, y + 6 * s); g.stroke();
  },
  gallows(g, x, y, s) {
    g.lineWidth = Math.max(1.2, 1.3 * s);
    g.beginPath(); g.moveTo(x - 3 * s, y + 5 * s); g.lineTo(x - 3 * s, y - 6 * s); g.lineTo(x + 4 * s, y - 6 * s); g.lineTo(x + 4 * s, y - 3 * s); g.stroke();
  },
  abbey(g, x, y, s) {
    g.fillRect(x - 9 * s, y - 4 * s, 18 * s, 9 * s);
    g.beginPath(); g.moveTo(x - 10 * s, y - 4 * s); g.lineTo(x, y - 10 * s); g.lineTo(x + 10 * s, y - 4 * s); g.fill();
    g.fillRect(x - 0.7 * s, y - 16 * s, 1.4 * s, 6 * s);
    g.fillRect(x - 2.4 * s, y - 14.4 * s, 4.8 * s, 1.2 * s);
  },
  castle(g, x, y, s) {
    const tower = (tx, w, hgt) => {
      g.fillRect(tx - w / 2, y - hgt * s, w, hgt * s + 8 * s);
      for (let k = -1; k <= 1; k += 2) g.fillRect(tx + k * w * 0.32 - w * 0.14, y - hgt * s - 2.4 * s, w * 0.28, 2.4 * s);
    };
    g.fillRect(x - 20 * s, y - 6 * s, 40 * s, 14 * s);
    for (let i = -20; i <= 18; i += 5) g.fillRect(x + i * s, y - 8.5 * s, 2.4 * s, 2.5 * s);
    tower(x - 20 * s, 9 * s, 18);
    tower(x + 20 * s, 9 * s, 18);
    tower(x, 11 * s, 28);
  },
};
// where each name goes, relative to the landmark (metres)
const LABEL = { village: [0, 34], cemetery: [0, -24], bridge: [46, 3], windmill: [0, 22], gallows: [-4, -15], abbey: [0, 22], castle: [0, -44] };

export class WorldMap {
  constructor() {
    const el = (this.el = document.createElement('div'));
    el.id = 'worldmap';
    el.className = 'overlay hidden';
    el.innerHTML = `<canvas id="wmCanvas"></canvas>
      <div class="wm-side"><h2 id="wmTitle"></h2><p id="wmGoal"></p>
        <ul class="wm-legend">
          <li><i class="wm-you">▲</i>${L('Você', 'You')}</li>
          <li><i class="wm-goal">◯</i>${L('Objetivo', 'Objective')}</li>
          <li><i class="wm-route">┅</i>${L('Caminho pelas estradas', 'Way along the roads')}</li>
          <li><i class="wm-shrine">†</i>${L('Santuário: descanso e checkpoint', 'Shrine: rest and checkpoint')}</li>
          <li><i class="wm-merchant">¤</i>${L('Mercador', 'Merchant')}</li>
          <li><i class="wm-coffin">✝</i>${L('Caixão do Conde', "The Count's coffin")}</li>
        </ul>
        <p class="wm-hint" id="wmHint"></p></div>`;
    document.body.append(el);
    this.canvas = el.querySelector('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.relief = null;
    this.base = null; // relief + ink at the current size
    this.size = 0;
    this.openAt = 0;
    this.tapped = false;
    el.addEventListener('click', () => { if (performance.now() - this.openAt > GRACE) this.tapped = true; });
    addEventListener('resize', () => (this.size = 0));
    // paint the relief while the game is idle, so the first open does not stall
    (window.requestIdleCallback || setTimeout)(() => this.relief ??= paintRelief(), { timeout: 4000 });
  }

  get isOpen() { return !this.el.classList.contains('hidden'); }

  // { title, goal, hint }
  open(text) {
    document.getElementById('wmTitle').textContent = text.title;
    document.getElementById('wmGoal').textContent = text.goal || '';
    document.getElementById('wmHint').textContent = text.hint;
    this.el.classList.remove('hidden');
    this.openAt = performance.now();
    this.tapped = false;
    this.size = 0;
  }

  close() { this.el.classList.add('hidden'); }

  // false once the player closes it (M, Esc, Tab, a tap, right click; on a controller B, A, Back, Start or ↓)
  handle(input) {
    if (this.tapped) return false;
    return !['KeyM', 'Escape', 'Tab', 'KeyI', 'KeyC', 'Enter', 'Space', 'ArrowDown', 'Mouse2'].some((k) => input.hit(k));
  }

  // pixels per metre and the world → sheet transform
  get k() { return this.canvas.width / VW; }
  at(x, z) { const k = this.k; return [(x - V.x0) * k, (z - V.z0) * k]; }

  build() {
    const r = this.canvas.getBoundingClientRect();
    const w = Math.max(64, Math.round(r.width * Math.min(devicePixelRatio || 1, 2)));
    this.canvas.width = w;
    this.canvas.height = Math.round((w * VH) / VW);
    this.size = r.width;
    this.relief ??= paintRelief();
    const b = (this.base = document.createElement('canvas'));
    b.width = this.canvas.width;
    b.height = this.canvas.height;
    const g = b.getContext('2d'), k = this.k, u = w / 700; // u: line/text scale against a 700 px sheet
    g.imageSmoothingEnabled = true;
    g.drawImage(this.relief, -k * STEP / 2, -k * STEP / 2, (VW + STEP) * k, (VH + STEP) * k);
    const rnd = mulberry32(99);
    // paper: specks and stains, darker toward the edges
    for (let i = 0; i < 260; i++) {
      g.fillStyle = `rgba(90, 60, 30, ${0.04 + rnd() * 0.08})`;
      g.beginPath(); g.arc(rnd() * b.width, rnd() * b.height, (0.5 + rnd() * 2.5) * u, 0, Math.PI * 2); g.fill();
    }
    const edge = g.createRadialGradient(b.width / 2, b.height / 2, b.width * 0.3, b.width / 2, b.height / 2, b.width * 0.75);
    edge.addColorStop(0, 'rgba(60, 30, 10, 0)');
    edge.addColorStop(1, 'rgba(60, 30, 10, 0.45)');
    g.fillStyle = edge;
    g.fillRect(0, 0, b.width, b.height);

    // mountains along the ring
    g.strokeStyle = 'rgba(70, 45, 25, 0.75)';
    g.fillStyle = 'rgba(70, 45, 25, 0.22)';
    g.lineWidth = Math.max(1, 1.1 * u);
    for (let z = V.z0; z < V.z1; z += 13) for (let x = V.x0; x < V.x1; x += 15) {
      const px = x + (rnd() - 0.5) * 10, pz = z + (rnd() - 0.5) * 9, e = mapE(px, pz);
      if (e < 0.97 || e > 1.18) continue;
      const [sx, sy] = this.at(px, pz), hw = (4 + rnd() * 3) * k, hh = hw * (1.1 + rnd() * 0.5);
      g.beginPath(); g.moveTo(sx - hw, sy); g.lineTo(sx, sy - hh); g.lineTo(sx + hw, sy); g.stroke();
      g.beginPath(); g.moveTo(sx, sy - hh); g.lineTo(sx + hw, sy); g.lineTo(sx + hw * 0.2, sy); g.fill();
    }
    // forests: little trees (bare ones in the dead woods by the castle)
    for (let z = V.z0; z < V.z1; z += 7) for (let x = V.x0; x < V.x1; x += 7) {
      const px = x + (rnd() - 0.5) * 5, pz = z + (rnd() - 0.5) * 5, f = forestAt(px, pz);
      if (!f || heightAt(px, pz) < 1 || roadNear(px, pz, 5)) continue;
      const [sx, sy] = this.at(px, pz), r = (1.6 + rnd() * 0.8) * k;
      if (f.dead && rnd() < f.dead) {
        g.strokeStyle = 'rgba(60, 40, 40, 0.7)';
        g.lineWidth = Math.max(0.8, 0.8 * u);
        g.beginPath(); g.moveTo(sx, sy + r); g.lineTo(sx, sy - r); g.moveTo(sx, sy - r * 0.2); g.lineTo(sx - r * 0.8, sy - r); g.moveTo(sx, sy); g.lineTo(sx + r * 0.8, sy - r * 0.8); g.stroke();
      } else {
        g.fillStyle = 'rgba(52, 72, 40, 0.75)';
        g.beginPath(); g.arc(sx, sy - r * 0.3, r, 0, Math.PI * 2); g.fill();
        g.fillStyle = 'rgba(40, 25, 15, 0.8)';
        g.fillRect(sx - 0.4 * u, sy + r * 0.5, 0.8 * u + 0.4, r * 0.6);
      }
    }
    // roads: ink edges with a pale track
    g.lineCap = g.lineJoin = 'round';
    for (const [style, width] of [['#6a4a2a', 4.2], ['#eadab0', 2]]) {
      g.strokeStyle = style;
      g.lineWidth = Math.max(width * 0.6, width * u);
      for (const rd of ROADS) {
        g.beginPath();
        rd.forEach(([x, z], i) => { const [sx, sy] = this.at(x, z); i ? g.lineTo(sx, sy) : g.moveTo(sx, sy); });
        g.stroke();
      }
    }
    // landmarks and their names
    g.fillStyle = g.strokeStyle = INK;
    for (const p of PLACES) {
      const [sx, sy] = this.at(p.x, p.z);
      PICS[p.id]?.(g, sx, sy, Math.max(k * 0.9, 1.15 * u));
    }
    const label = (text, x, z, size, color = INK, italic = false) => {
      const [sx, sy] = this.at(x, z);
      g.font = `${italic ? 'italic ' : ''}${Math.round(size * u)}px 'Pirata One', serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.lineWidth = 4 * u;
      g.strokeStyle = 'rgba(232, 216, 178, 0.85)';
      g.strokeText(text, sx, sy);
      g.fillStyle = color;
      g.fillText(text, sx, sy);
    };
    for (const p of PLACES) {
      const [dx, dz] = LABEL[p.id] || [0, 20];
      label(p.name, p.x + dx, p.z + dz, p.id === 'castle' || p.id === 'village' ? 26 : 21);
    }
    label(L('Rio Argeș', 'Argeș River'), -150, riverZ(-150) - 11, 19, '#2a4a62', true);
    label(L('Lago Escuro', 'Dark Lake'), LAKE.x, LAKE.z, 17, '#2a4a62', true);
    label(L('Montes Cárpatos', 'Carpathian Mountains'), -150, -236, 20, '#5a3a20', true);
    // compass
    const [cx, cy] = [b.width - 46 * u, b.height - 56 * u], R = 22 * u;
    g.fillStyle = INK;
    g.beginPath(); g.moveTo(cx, cy - R); g.lineTo(cx + R * 0.28, cy); g.lineTo(cx, cy + R * 0.6); g.lineTo(cx - R * 0.28, cy); g.fill();
    g.strokeStyle = INK;
    g.lineWidth = 1.2 * u;
    g.beginPath(); g.arc(cx, cy, R * 0.75, 0, Math.PI * 2); g.stroke();
    g.font = `${Math.round(18 * u)}px 'Pirata One', serif`;
    g.textAlign = 'center';
    g.fillText('N', cx, cy - R - 10 * u);
    // double frame
    g.strokeStyle = INK;
    g.lineWidth = 2 * u;
    g.strokeRect(6 * u, 6 * u, b.width - 12 * u, b.height - 12 * u);
    g.lineWidth = 1 * u;
    g.strokeRect(11 * u, 11 * u, b.width - 22 * u, b.height - 22 * u);
  }

  // s: { player, target, path, coffins, shrines, night, merchant, time }
  draw(s) {
    if (!this.isOpen) return;
    if (Math.abs(this.canvas.getBoundingClientRect().width - this.size) > 0.5 || !this.base) this.build();
    const g = this.ctx, u = this.canvas.width / 700, t = s.time;
    g.drawImage(this.base, 0, 0);
    const glyph = (ch, x, z, color, size, halo = 'rgba(240, 226, 190, 0.9)') => {
      const [sx, sy] = this.at(x, z);
      g.font = `${Math.round(size * u)}px VT323, monospace`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.lineWidth = 3.5 * u;
      g.strokeStyle = halo;
      g.strokeText(ch, sx, sy);
      g.fillStyle = color;
      g.fillText(ch, sx, sy);
      return [sx, sy];
    };
    for (const sh of s.shrines) glyph('†', sh.x, sh.z, sh.used === s.night ? 'rgba(120, 100, 70, 0.6)' : '#9a6400', 24);
    if (s.merchant) glyph('¤', s.merchant.x, s.merchant.z + 6, '#0e6a72', 24);
    for (const c of s.coffins) {
      const [sx, sy] = glyph('✝', c.x, c.z, c.destroyed ? 'rgba(90, 80, 70, 0.6)' : c === s.target ? '#b0101a' : '#4a2a2a', 22);
      if (c.destroyed) {
        g.strokeStyle = 'rgba(120, 20, 20, 0.8)';
        g.lineWidth = 2 * u;
        const r = 7 * u;
        g.beginPath(); g.moveTo(sx - r, sy - r); g.lineTo(sx + r, sy + r); g.moveTo(sx + r, sy - r); g.lineTo(sx - r, sy + r); g.stroke();
      }
    }
    // the way there, in red ink, marching toward the objective
    if (s.path && s.path.length > 1) {
      g.save();
      g.strokeStyle = 'rgba(176, 16, 26, 0.85)';
      g.lineWidth = 2.6 * u;
      g.setLineDash([7 * u, 6 * u]);
      g.lineDashOffset = -t * 18 * u;
      g.beginPath();
      s.path.forEach((p, i) => {
        const [sx, sy] = i ? this.at(p.x, p.z) : this.at(s.player.pos.x, s.player.pos.z);
        i ? g.lineTo(sx, sy) : g.moveTo(sx, sy);
      });
      g.stroke();
      g.restore();
    }
    if (s.target) {
      const [sx, sy] = this.at(s.target.x, s.target.z), pulse = 0.5 + 0.5 * Math.sin(t * 4);
      g.strokeStyle = `rgba(176, 16, 26, ${0.55 + 0.4 * pulse})`;
      g.lineWidth = 2.4 * u;
      g.beginPath(); g.arc(sx, sy, (13 + pulse * 4) * u, 0, Math.PI * 2); g.stroke();
      g.beginPath(); g.arc(sx, sy, (18 + pulse * 4) * u, -0.4, 1.2); g.stroke();
      if (!s.coffins.includes(s.target)) glyph('◆', s.target.x, s.target.z, '#b0101a', 22);
    }
    // the hunter: an arrow in the direction he faces
    const [px, py] = this.at(s.player.pos.x, s.player.pos.z), f = s.player.facing;
    g.save();
    g.translate(px, py);
    g.fillStyle = `rgba(30, 140, 200, ${0.18 + 0.12 * Math.sin(t * 5)})`;
    g.beginPath(); g.arc(0, 0, 15 * u, 0, Math.PI * 2); g.fill();
    g.rotate(Math.PI - f);
    g.fillStyle = '#0c4a78';
    g.strokeStyle = '#f4ead0';
    g.lineWidth = 2 * u;
    g.beginPath(); g.moveTo(0, -10 * u); g.lineTo(7 * u, 8 * u); g.lineTo(0, 4 * u); g.lineTo(-7 * u, 8 * u); g.closePath();
    g.stroke();
    g.fill();
    g.restore();
  }
}
