// Draws the app icons procedurally (a runic sword over a blood moon, 32×32 pixel art scaled up with hard
// pixels) and writes them as PNGs into public/, next to the web app manifest. No image editor, no assets
// to license. Run again after changing the drawing: `npm run icons`.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public');
const N = 32; // logical pixels

const hex = (h) => [(h >> 16) & 255, (h >> 8) & 255, h & 255, 255];
function art() {
  const px = Array.from({ length: N * N }, () => hex(0x0b0610));
  const set = (x, y, c) => { if (x >= 0 && y >= 0 && x < N && y < N) px[y * N + x] = hex(c); };
  // blood moon with a darker rim
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const d = Math.hypot(x + 0.5 - 16, y + 0.5 - 13);
    if (d < 11.5) set(x, y, d > 10 ? 0x4a0612 : 0x7a0c22);
  }
  // blade: cyan, tapering to the tip, with a bright runic core
  for (let y = 2; y <= 21; y++) {
    const half = 0.6 + ((y - 2) / 19) * 1.6;
    for (let x = Math.round(16 - half); x < Math.round(16 + half); x++) set(x, y, 0x40e8ff);
    if (y > 4) set(15, y, 0xd8fcff);
  }
  for (let x = 9; x <= 22; x++) { set(x, 22, 0xf0bc40); set(x, 23, 0xb08020); } // guard
  set(15, 22, 0xff1a40); set(16, 22, 0xff1a40); // the guard's red gem
  for (let y = 24; y <= 28; y++) { set(15, y, 0x7a4422); set(16, y, 0x5a3018); } // grip
  for (let x = 14; x <= 17; x++) set(x, 29, 0xf0bc40); // pommel
  return px;
}

// nearest-neighbour scale of the art into a size×size image; pad = empty margin (fraction) for maskable icons
function render(size, pad = 0) {
  const src = art(), img = Buffer.alloc(size * size * 4);
  const inner = Math.round(size * (1 - pad * 2)), off = Math.round((size - inner) / 2), bg = hex(0x0b0610);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const ix = x - off, iy = y - off;
    const c = ix >= 0 && iy >= 0 && ix < inner && iy < inner ? src[Math.floor((iy / inner) * N) * N + Math.floor((ix / inner) * N)] : bg;
    img.set(c, (y * size + x) * 4);
  }
  return img;
}

// minimal PNG writer: RGBA 8-bit, no filtering, zlib-deflated
const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc32 = (buf) => { let c = -1; for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4), crc = Buffer.alloc(4), td = Buffer.concat([Buffer.from(type), data]);
  len.writeUInt32BE(data.length);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

const files = [
  ['icon-192.png', 192, 0],
  ['icon-512.png', 512, 0],
  ['icon-maskable-512.png', 512, 0.12], // content inside the safe zone of round/squircle masks
  ['apple-touch-icon.png', 180, 0.08],
];
for (const [name, size, pad] of files) {
  fs.writeFileSync(path.join(OUT, name), png(size, render(size, pad)));
  console.log('wrote public/' + name);
}
