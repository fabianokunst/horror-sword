// PS1-style rendering: low internal resolution with integer pixel scaling, vertex snapping, affine and
// down-sampled textures, palette reduction with ordered dithering, and an optional CRT monitor pass.
// Everything is driven live by RetroRenderer.apply(settings) (see settings.js).
import * as THREE from 'three';

export const RENDER_HEIGHT = 320;

// shared by every ps1() material
const U = {
  uSnap: { value: new THREE.Vector2(160, 120) },
  uAffine: { value: 0.7 },
  uTexDown: { value: 1 },
};

const VS_HEAD = /* glsl */ `
uniform vec2 uSnap;
#ifdef USE_MAP
varying vec3 vHsAffine;
#endif
`;

const FS_HEAD = /* glsl */ `
uniform float uAffine;
uniform float uTexDown;
uniform vec2 uMapSize;
#ifdef USE_MAP
varying vec3 vHsAffine;
#endif
`;

// uv * w and w interpolate perspective-correct, so their ratio is the screen-linear (affine) uv
const MAP_FRAGMENT = /* glsl */ `
#ifdef USE_MAP
  vec2 hsUv = mix(vMapUv, vHsAffine.xy / vHsAffine.z, uAffine);
  if (uTexDown > 1.0) hsUv = (floor(hsUv * uMapSize / uTexDown) * uTexDown + 0.5) / uMapSize;
  diffuseColor *= texture2D(map, hsUv);
#endif
`;

function patchShader(shader, material, selfLit, snapVerts) {
  Object.assign(shader.uniforms, U);
  const img = material.map?.image;
  shader.uniforms.uMapSize = { value: new THREE.Vector2(img?.width || 1, img?.height || 1) };
  shader.vertexShader = VS_HEAD + shader.vertexShader.replace(
    '#include <project_vertex>',
    `#include <project_vertex>
    ${snapVerts ? 'if (uSnap.x > 0.0) gl_Position.xy = floor(gl_Position.xy / gl_Position.w * uSnap + 0.5) / uSnap * gl_Position.w;' : ''}
    #ifdef USE_MAP
      vHsAffine = vec3(vMapUv * gl_Position.w, gl_Position.w);
    #endif`
  );
  shader.fragmentShader = FS_HEAD + shader.fragmentShader.replace('#include <map_fragment>', MAP_FRAGMENT);
  // "baked" self-illumination so characters stay readable and colorful in the dark
  if (selfLit) shader.fragmentShader = shader.fragmentShader.replace(
    '#include <emissivemap_fragment>',
    `#include <emissivemap_fragment>
    totalEmissiveRadiance += diffuseColor.rgb * ${selfLit.toFixed(3)};`
  );
}

export function ps1(material, selfLit = 0, snapVerts = true) {
  material.onBeforeCompile = (shader) => patchShader(shader, material, selfLit, snapVerts);
  material.customProgramCacheKey = () => 'ps1:' + selfLit + ':' + snapVerts;
  return material;
}

export function lambert(color, opts = {}) {
  return ps1(new THREE.MeshLambertMaterial({ color, flatShading: true, ...opts }));
}

// Unlit, "overbright" material for emissive things (lanterns, eyes, runes).
export function basic(color, intensity = 1, opts = {}) {
  return ps1(new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity), ...opts }));
}

export function canvasTexture(size, draw, seed = 1) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  draw(g, size, rnd);
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.generateMipmaps = false;
  return t;
}

export function noiseTexture(size, lo, hi, seed) {
  return canvasTexture(size, (g, s, rnd) => {
    for (let y = 0; y < s; y++)
      for (let x = 0; x < s; x++) {
        const v = Math.floor(lo + rnd() * (hi - lo));
        g.fillStyle = `rgb(${v},${v},${v})`;
        g.fillRect(x, y, 1, 1);
      }
  }, seed);
}

// Gray tile limited to a few tones (tinted by the material color): pick(x, y, rnd) returns an index into tones.
export function toneTexture(size, tones, pick, seed = 1) {
  return canvasTexture(size, (g, s, rnd) => {
    const img = g.createImageData(s, s);
    for (let y = 0; y < s; y++)
      for (let x = 0; x < s; x++) {
        const v = tones[Math.max(0, Math.min(tones.length - 1, pick(x, y, rnd)))];
        const o = (y * s + x) * 4;
        img.data[o] = img.data[o + 1] = img.data[o + 2] = v;
        img.data[o + 3] = 255;
      }
    g.putImageData(img, 0, 0);
  }, seed);
}

let glowTex = null;
export function glowTexture() {
  if (glowTex) return glowTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.25, 'rgba(255,255,255,0.45)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  glowTex = new THREE.CanvasTexture(c);
  return glowTex;
}

const spriteMats = new Map();
export function glowSprite(color, scale = 2, opacity = 0.8) {
  const key = color + ':' + opacity;
  let m = spriteMats.get(key);
  if (!m) {
    m = new THREE.SpriteMaterial({
      map: glowTexture(),
      color,
      transparent: true,
      opacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    spriteMats.set(key, m);
  }
  const s = new THREE.Sprite(m);
  s.scale.setScalar(scale);
  return s;
}

// ------------------------------------------------------------------ palettes
// sRGB values, compared after tone mapping and gamma (the space the player actually sees)
const rgb = (h) => new THREE.Vector3(((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255);
const PALETTES = {
  rgb15: { levels: 32 },
  rgb12: { levels: 16 },
  rgb9: { levels: 8 },
  rgb6: { levels: 4 },
  // night blues, blood reds, lantern golds, moss greens and rune cyan
  gothic: {
    spread: 0.12,
    colors: [
      0x08060c, 0x16121e, 0x1e2038, 0x2c3456, 0x445080, 0x6a7aa4, 0x9dabb9, 0xd4d8e0,
      0xf6eedc, 0x3a1220, 0x6a1426, 0xa81c30, 0xe8364a, 0xff8a70, 0xc88a6a, 0x5a2a5e,
      0x8c4496, 0xe050c0, 0x2a1a12, 0x4e3220, 0x7e5634, 0xb08850, 0xffb040, 0xffe68a,
      0x16281e, 0x2c4a2a, 0x567a34, 0xa0e050, 0x1a4a66, 0x2e8aa0, 0x60e8ff, 0x6a6878,
    ],
  },
  // luminance mapped onto an old photographic print
  sepia: { ramp: [0x0e0806, 0x2a1a10, 0x4a301c, 0x6e4a2c, 0x946a42, 0xb88e60, 0xd8b688, 0xf4e2bc] },
};
const DITHER = { off: 0, bayer2: 1, bayer4: 2, bayer8: 3, noise: 4 };

// ------------------------------------------------------------------ post passes
const POST_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const HASH = /* glsl */ `
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
`;

// Low-res pass: tone map, then reduce to the palette with ordered dithering.
const QUANT_FRAG = /* glsl */ `
uniform sampler2D tDiffuse;
uniform float uExposure;
uniform vec3 uTint;
uniform int uDither;      // 0 off, 1 bayer 2x2, 2 bayer 4x4, 3 bayer 8x8, 4 static noise
uniform float uDitherAmt; // in quantization steps
uniform int uPalMode;     // 0 per-channel levels, 1 nearest palette color, 2 luminance ramp
uniform float uLevels;
uniform float uSpread;
uniform int uPalN;
uniform vec3 uPal[32];
varying vec2 vUv;
${HASH}
float bayer2(vec2 a) { a = floor(a); return fract(a.x * 0.5 + a.y * a.y * 0.75); }
float bayer4(vec2 a) { return bayer2(0.5 * a) * 0.25 + bayer2(a); }
float bayer8(vec2 a) { return bayer4(0.5 * a) * 0.25 + bayer2(a); }
void main() {
  vec3 c = texture2D(tDiffuse, vUv).rgb * uTint;
  c = 1.0 - exp(-c * uExposure);
  c = pow(c, vec3(1.0 / 2.2));
  vec2 px = gl_FragCoord.xy;
  float d = uDither == 1 ? bayer2(px) + 0.125
          : uDither == 2 ? bayer4(px) + 0.03125
          : uDither == 3 ? bayer8(px) + 0.0078125
          : uDither == 4 ? hash12(px) : 0.5;
  d = (d - 0.5) * uDitherAmt;
  if (uPalMode == 0) {
    float L = uLevels - 1.0;
    c = floor(clamp(c + d / L, 0.0, 1.0) * L + 0.5) / L;
  } else if (uPalMode == 2) {
    float L = float(uPalN - 1);
    float y = dot(c, vec3(0.299, 0.587, 0.114));
    c = uPal[int(clamp(floor((y + d / L) * L + 0.5), 0.0, L))];
  } else {
    c += d * uSpread;
    float best = 1e9;
    vec3 pick = c;
    for (int i = 0; i < 32; i++) {
      if (i >= uPalN) break;
      vec3 e = c - uPal[i];
      float dist = dot(e * e, vec3(0.3, 0.59, 0.11));
      if (dist < best) { best = dist; pick = uPal[i]; }
    }
    c = pick;
  }
  gl_FragColor = vec4(c, 1.0);
}
`;

// Screen-res pass: integer upscale, optionally through a CRT (curvature, beam scanlines, RGB mask,
// halation, chromatic aberration, interference), plus vignette.
const DISPLAY_FRAG = /* glsl */ `
uniform sampler2D tLow;
uniform vec2 uLowRes;
uniform vec2 uScreen;
uniform vec2 uOffset;   // the integer-scaled image overhangs the screen by < 1 low-res pixel; keep it centered
uniform float uScale;
uniform float uTime;
uniform float uSharp;   // horizontal beam sharpness: huge = nearest neighbour, ~3 = soft CRT edges
uniform float uCurve;
uniform float uScan;
uniform float uMask;
uniform float uBloom;
uniform float uChroma;
uniform float uNoise;
uniform float uVignette;
${HASH}
vec3 tap(vec2 p) {
  float x = p.x - 0.5, i = floor(x);
  float w = clamp((x - i - 0.5) * uSharp + 0.5, 0.0, 1.0);
  return texture2D(tLow, vec2(i + 0.5 + w, floor(p.y) + 0.5) / uLowRes).rgb;
}
void main() {
  vec2 uv = gl_FragCoord.xy / uScreen;
  vec2 cc = uv * 2.0 - 1.0;
  float inside = 1.0;
  if (uCurve > 0.0) {
    cc *= 1.0 + cc.yx * cc.yx * vec2(0.08, 0.11) * uCurve;
    uv = cc * 0.5 + 0.5;
    float r = uCurve * 0.04 * min(uScreen.x, uScreen.y);
    float dist = length(max(abs(cc) * 0.5 * uScreen - 0.5 * uScreen + r, 0.0)) - r;
    inside = clamp(0.5 - dist, 0.0, 1.0);
  }
  vec2 p = (uv * uScreen + uOffset) / uScale;
  if (uNoise > 0.0) {
    float t = floor(uTime * 20.0);
    float band = step(1.0 - 0.04 * uNoise, hash12(vec2(floor(p.y / 6.0), t)));
    p.x += band * (hash12(vec2(t, 3.7)) - 0.5) * 6.0 * uNoise + sin(p.y * 0.35 + uTime * 3.0) * 0.12 * uNoise;
  }
  vec3 col;
  if (uChroma > 0.0) {
    float o = uChroma * (0.35 + 1.1 * dot(cc, cc));
    col = vec3(tap(p + vec2(o, 0.0)).r, tap(p).g, tap(p - vec2(o, 0.0)).b);
  } else {
    col = tap(p);
  }
  if (uBloom > 0.0) {
    vec3 h = vec3(0.0);
    for (int i = 0; i < 6; i++) {
      float a = float(i) * 1.0472;
      h += texture2D(tLow, (p + vec2(cos(a), sin(a)) * 1.5) / uLowRes).rgb;
      h += texture2D(tLow, (p + vec2(cos(a + 0.5236), sin(a + 0.5236)) * 3.5) / uLowRes).rgb;
    }
    h /= 12.0;
    col += h * h * uBloom * 1.2;
  }
  if (uScan > 0.0) {
    // one screen row falls on the gap between beams; bright pixels get wider beams
    float f = fract(p.y) - 0.5 + 0.5 / uScale;
    float s = mix(0.2, 0.42, clamp(dot(col, vec3(0.299, 0.587, 0.114)), 0.0, 1.0));
    col *= mix(1.0, exp(-f * f / (2.0 * s * s)) * 1.55, uScan);
  }
  if (uMask > 0.0) {
    float m = mod(floor(gl_FragCoord.x), 3.0);
    vec3 tri = m < 0.5 ? vec3(1.0, 0.3, 0.3) : m < 1.5 ? vec3(0.3, 1.0, 0.3) : vec3(0.3, 0.3, 1.0);
    col *= mix(vec3(1.0), tri * 1.65, uMask * 0.85);
  }
  if (uNoise > 0.0) {
    col += (hash12(gl_FragCoord.xy + fract(uTime) * 517.0) - 0.5) * 0.12 * uNoise;
    float roll = fract(uv.y * 0.6 - uTime * 0.07);
    col *= 1.0 + uNoise * (0.07 * smoothstep(0.0, 0.08, roll) * smoothstep(0.2, 0.08, roll)
                         - 0.03 * hash12(vec2(floor(uTime * 30.0), 1.0)));
  }
  vec2 v = uv - 0.5;
  col *= 1.0 - dot(v, v) * uVignette * 1.4;
  gl_FragColor = vec4(col * inside, 1.0);
}
`;

const pass = (fragmentShader, uniforms) =>
  new THREE.ShaderMaterial({ uniforms, vertexShader: POST_VERT, fragmentShader, depthTest: false, depthWrite: false });

export class RetroRenderer {
  constructor(renderer) {
    this.renderer = renderer;
    // some mobile GPUs can't render to half-float targets; fall back to 8-bit (just clips the HDR highlights)
    const hdr = renderer.extensions.has('EXT_color_buffer_half_float') || renderer.extensions.has('EXT_color_buffer_float');
    this.target = new THREE.WebGLRenderTarget(4, 4, {
      type: hdr ? THREE.HalfFloatType : THREE.UnsignedByteType,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
    });
    // palette-reduced image; linear filtering only feeds the CRT's soft beam and halation taps
    this.low = new THREE.WebGLRenderTarget(4, 4, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      generateMipmaps: false,
    });
    this.material = pass(QUANT_FRAG, {
      tDiffuse: { value: this.target.texture },
      uExposure: { value: 1.8 },
      uTint: { value: new THREE.Vector3(1, 1, 1) },
      uDither: { value: 2 },
      uDitherAmt: { value: 1 },
      uPalMode: { value: 0 },
      uLevels: { value: 32 },
      uSpread: { value: 0 },
      uPalN: { value: 0 },
      uPal: { value: Array.from({ length: 32 }, () => new THREE.Vector3()) },
    });
    this.display = pass(DISPLAY_FRAG, {
      tLow: { value: this.low.texture },
      uLowRes: { value: new THREE.Vector2(4, 4) },
      uScreen: { value: new THREE.Vector2(4, 4) },
      uOffset: { value: new THREE.Vector2() },
      uScale: { value: 1 },
      uTime: { value: 0 },
      uSharp: { value: 1e4 },
      uCurve: { value: 0 },
      uScan: { value: 0 },
      uMask: { value: 0 },
      uBloom: { value: 0 },
      uChroma: { value: 0 },
      uNoise: { value: 0 },
      uVignette: { value: 0.5 },
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.scene = new THREE.Scene();
    this.scene.add(this.quad);
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.lines = RENDER_HEIGHT;
    this.wobble = 1;
    this.screen = new THREE.Vector2();
    this.info = '';
  }

  apply(s) {
    const q = this.material.uniforms, d = this.display.uniforms;
    q.uExposure.value = 1.8 * (s.bright / 100);
    q.uDither.value = DITHER[s.dither] ?? 0;
    q.uDitherAmt.value = s.ditherAmt / 100;
    const pal = PALETTES[s.palette] || PALETTES.rgb15;
    const list = pal.colors || pal.ramp || [];
    q.uPalMode.value = pal.levels ? 0 : pal.ramp ? 2 : 1;
    q.uLevels.value = pal.levels || 2;
    q.uSpread.value = pal.spread || 0;
    q.uPalN.value = list.length;
    list.forEach((h, i) => q.uPal.value[i].copy(rgb(h)));

    U.uAffine.value = s.affine / 100;
    U.uTexDown.value = s.texRes;

    const crt = s.crt ? 0.01 : 0;
    d.uSharp.value = s.crt ? 3 : 1e4;
    d.uCurve.value = s.curve * crt;
    d.uScan.value = s.scan * crt;
    d.uMask.value = s.mask * crt;
    d.uBloom.value = s.bloom * crt;
    d.uChroma.value = s.chroma * crt;
    d.uNoise.value = s.noise * crt;
    d.uVignette.value = s.vignette / 100;

    if (s.lines !== this.lines || s.wobble !== this.wobble) {
      this.lines = s.lines;
      this.wobble = s.wobble;
      this.setSize();
    }
  }

  // Sizes follow the renderer's drawing buffer, so call this after renderer.setSize().
  setSize() {
    const { x: W, y: H } = this.renderer.getDrawingBufferSize(this.screen);
    // the short side gets ~`lines` pixels; each one is an exact square of screen pixels
    const scale = Math.max(1, Math.round(Math.min(W, H) / this.lines));
    const rw = Math.ceil(W / scale), rh = Math.ceil(H / scale);
    this.target.setSize(rw, rh);
    this.low.setSize(rw, rh);
    const d = this.display.uniforms;
    d.uLowRes.value.set(rw, rh);
    d.uScreen.value.set(W, H);
    d.uOffset.value.set(Math.floor((rw * scale - W) / 2), Math.floor((rh * scale - H) / 2));
    d.uScale.value = scale;
    // snap grid of `wobble` low-res pixels (in NDC units of 2 / res)
    if (this.wobble) U.uSnap.value.set(rw / (2 * this.wobble), rh / (2 * this.wobble));
    else U.uSnap.value.set(0, 0);
    this.info = `${rw}×${rh} · pixel ${scale}×`;
  }

  render(scene, camera) {
    const r = this.renderer;
    this.display.uniforms.uTime.value = performance.now() / 1000;
    r.setRenderTarget(this.target);
    r.render(scene, camera);
    this.quad.material = this.material;
    r.setRenderTarget(this.low);
    r.render(this.scene, this.camera);
    this.quad.material = this.display;
    r.setRenderTarget(null);
    r.render(this.scene, this.camera);
  }
}
