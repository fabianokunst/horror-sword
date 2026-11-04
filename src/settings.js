// Settings panel: video presets and the retro image filters, plus controls (camera sensitivity, inverted Y)
// and sound volumes. Everything is edited live and persisted in localStorage.
const KEY = 'horror-sword:video'; // (name kept so earlier saved video settings still load)

const PRESETS = [
  { id: 'tv', name: 'TV de tubo', lines: 180, palette: 'rgb12', bright: 100, vignette: 50, texRes: 1, affine: 70, wobble: 1,
    dither: 'bayer4', ditherAmt: 100, crt: true, curve: 40, scan: 55, mask: 25, bloom: 35, chroma: 25, noise: 20 },
  { id: 'ps1', name: 'PS1 puro', lines: 240, palette: 'rgb15', bright: 100, vignette: 45, texRes: 1, affine: 100, wobble: 1,
    dither: 'bayer4', ditherAmt: 100, crt: false, curve: 40, scan: 55, mask: 25, bloom: 35, chroma: 25, noise: 20 },
  { id: 'arcade', name: 'Monitor arcade', lines: 240, palette: 'rgb12', bright: 110, vignette: 30, texRes: 1, affine: 60, wobble: 1,
    dither: 'bayer4', ditherAmt: 80, crt: true, curve: 20, scan: 85, mask: 70, bloom: 55, chroma: 10, noise: 5 },
  { id: 'dark', name: 'Pixel sombrio', lines: 120, palette: 'gothic', bright: 105, vignette: 65, texRes: 2, affine: 100, wobble: 2,
    dither: 'bayer8', ditherAmt: 100, crt: false, curve: 40, scan: 55, mask: 25, bloom: 35, chroma: 25, noise: 20 },
  { id: 'daguerre', name: 'Daguerreótipo', lines: 180, palette: 'sepia', bright: 115, vignette: 80, texRes: 2, affine: 70, wobble: 1,
    dither: 'noise', ditherAmt: 100, crt: true, curve: 30, scan: 30, mask: 0, bloom: 45, chroma: 0, noise: 45 },
  { id: 'sharp', name: 'Nítido', lines: 360, palette: 'rgb15', bright: 100, vignette: 30, texRes: 1, affine: 0, wobble: 0,
    dither: 'bayer4', ditherAmt: 50, crt: false, curve: 40, scan: 55, mask: 25, bloom: 35, chroma: 25, noise: 20 },
];

const on = (v) => v && v !== 'off';

// [section title, controls]; a control with `options` is a select, `toggle` a checkbox, otherwise a 0–100% slider.
const SECTIONS = [
  ['Imagem', [
    { key: 'lines', label: 'Resolução', info: true, options: [[360, '360 linhas'], [270, '270 linhas'], [240, '240 linhas (PS1)'], [180, '180 linhas'], [144, '144 linhas'], [120, '120 linhas'], [96, '96 linhas']] },
    { key: 'palette', label: 'Cores', options: [['rgb15', '32 mil (PS1, 15 bits)'], ['rgb12', '4096 (12 bits)'], ['rgb9', '512 (9 bits)'], ['rgb6', '64 (6 bits)'], ['gothic', 'Paleta gótica (32)'], ['sepia', 'Daguerreótipo (8 tons)']] },
    { key: 'bright', label: 'Brilho', min: 50, max: 160 },
    { key: 'vignette', label: 'Vinheta' },
  ]],
  ['Texturas', [
    { key: 'texRes', label: 'Resolução', options: [[1, 'Original'], [2, 'Metade'], [4, 'Um quarto']] },
    { key: 'affine', label: 'Distorção afim' },
    { key: 'wobble', label: 'Tremor de vértices', options: [[0, 'Desligado'], [1, 'PS1 (1 px)'], [2, 'Forte (2 px)'], [3, 'Extremo (3 px)']] },
  ]],
  ['Dithering', [
    { key: 'dither', label: 'Padrão', options: [['off', 'Desligado'], ['bayer2', 'Bayer 2×2'], ['bayer4', 'Bayer 4×4'], ['bayer8', 'Bayer 8×8'], ['noise', 'Ruído']] },
    { key: 'ditherAmt', label: 'Intensidade', max: 200, needs: 'dither' },
  ]],
  ['Monitor CRT', [
    { key: 'crt', label: 'Ativado', toggle: true },
    { key: 'curve', label: 'Curvatura', needs: 'crt' },
    { key: 'scan', label: 'Scanlines', needs: 'crt' },
    { key: 'mask', label: 'Máscara RGB', needs: 'crt' },
    { key: 'bloom', label: 'Brilho difuso', needs: 'crt' },
    { key: 'chroma', label: 'Aberração cromática', needs: 'crt' },
    { key: 'noise', label: 'Interferência', needs: 'crt' },
  ]],
  // not part of the video presets (pref: true)
  ['Controles', [
    { key: 'sens', label: 'Sensibilidade da câmera', min: 25, max: 300, pref: true },
    { key: 'invertY', label: 'Inverter eixo vertical', toggle: true, pref: true },
    { key: 'vibrate', label: 'Vibração (celular)', toggle: true, pref: true },
  ]],
  ['Som', [
    { key: 'vMusic', label: 'Música', pref: true },
    { key: 'vSfx', label: 'Efeitos', pref: true },
    { key: 'vAmb', label: 'Ambiente', pref: true },
  ]],
];
const CONTROLS = SECTIONS.flatMap(([, list]) => list);
const VIDEO = CONTROLS.filter((c) => !c.pref);
const PREFS = { sens: 100, invertY: false, vibrate: true, vMusic: 100, vSfx: 100, vAmb: 100 };

function defaults() {
  const { id, name, ...v } = PRESETS[0];
  return { ...v, ...PREFS };
}

function load() {
  const v = defaults();
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(KEY)) || {}; } catch { /* private mode or corrupt data */ }
  for (const c of CONTROLS) {
    const s = saved[c.key];
    if (typeof s !== typeof v[c.key]) continue;
    if (c.options && !c.options.some(([val]) => val === s)) continue;
    v[c.key] = s;
  }
  return v;
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

export class Settings {
  constructor({ panel, menu, button, describe }) {
    Object.assign(this, { panel, menu, describe });
    this.values = load();
    this.onChange = null;
    this.rows = [];
    this.build();
    button.addEventListener('click', () => this.open());
    addEventListener('keydown', (e) => {
      if (e.code === 'Escape' && this.isOpen) this.close();
    });
  }

  get isOpen() { return !this.panel.classList.contains('hidden'); }

  open() {
    this.menu.classList.add('hidden');
    this.panel.classList.remove('hidden');
    this.sync();
  }

  close() {
    this.panel.classList.add('hidden');
    this.menu.classList.remove('hidden');
  }

  set(patch) {
    Object.assign(this.values, patch);
    try { localStorage.setItem(KEY, JSON.stringify(this.values)); } catch { /* not persisted, still applied */ }
    this.onChange?.(this.values);
    this.sync();
  }

  build() {
    const p = this.panel;
    p.replaceChildren();
    const head = el('div', 'set-head');
    head.append(el('h3', null, 'Configurações'));
    const presetRow = el('label', 'set-row');
    this.preset = el('select');
    for (const pr of PRESETS) this.preset.append(new Option(pr.name, pr.id));
    this.custom = new Option('Personalizado', '');
    this.custom.disabled = true;
    this.preset.append(this.custom);
    this.preset.addEventListener('change', () => {
      const { id, name, ...v } = PRESETS.find((pr) => pr.id === this.preset.value);
      this.set(v);
    });
    presetRow.append(el('span', null, 'Predefinição'), this.preset);
    head.append(presetRow);

    const body = el('div', 'set-body');
    for (const [title, list] of SECTIONS) {
      const sec = el('section');
      sec.append(el('h4', null, title));
      for (const c of list) sec.append(this.control(c));
      body.append(sec);
    }

    const foot = el('div', 'set-foot');
    const reset = el('button', 'small', 'Restaurar');
    reset.addEventListener('click', () => this.set(defaults()));
    const back = el('button', 'small', 'Voltar');
    back.addEventListener('click', () => this.close());
    foot.append(reset, back);
    p.append(head, body, foot);
    this.sync();
  }

  control(c) {
    const row = el('label', 'set-row');
    row.append(el('span', null, c.label));
    let input, out = null;
    if (c.options) {
      input = el('select');
      for (const [val, text] of c.options) input.append(new Option(text, String(val)));
      input.addEventListener('change', () => {
        const opt = c.options.find(([v]) => String(v) === input.value);
        if (opt) this.set({ [c.key]: opt[0] });
      });
    } else if (c.toggle) {
      input = el('input', 'switch');
      input.type = 'checkbox';
      input.addEventListener('change', () => this.set({ [c.key]: input.checked }));
    } else {
      input = el('input');
      input.type = 'range';
      input.min = c.min ?? 0;
      input.max = c.max ?? 100;
      input.step = 5;
      out = el('output');
      input.addEventListener('input', () => this.set({ [c.key]: Number(input.value) }));
    }
    row.append(input);
    if (out) row.append(out);
    const info = c.info ? el('small', 'set-info') : null;
    this.rows.push({ c, row, input, out, info });
    if (!info) return row;
    const wrap = el('div');
    wrap.append(row, info);
    return wrap;
  }

  sync() {
    const v = this.values;
    for (const { c, row, input, out, info } of this.rows) {
      if (c.toggle) input.checked = v[c.key];
      else input.value = String(v[c.key]);
      if (out) out.textContent = v[c.key] + '%';
      const disabled = c.needs && !on(v[c.needs]);
      input.disabled = disabled;
      row.classList.toggle('off', !!disabled);
      if (info) info.textContent = this.describe?.() ?? '';
    }
    const match = PRESETS.find((pr) => VIDEO.every((c) => pr[c.key] === v[c.key]));
    this.custom.hidden = !!match;
    this.preset.value = match ? match.id : '';
  }
}
