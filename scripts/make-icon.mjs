// Writes src-tauri/icons/app-icon.png (1024x1024): three candles on a dark
// rounded square. `npm run icon` then derives every bundle size from it.
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";

const S = 1024;
const R = 224;
const BG = [28, 28, 30];
const UP = [52, 199, 89];
const DOWN = [255, 69, 58];

// In 32-unit design space, matching the tray fallback glyph.
const candles = [
  [9, 12, 15, 22, 25, DOWN],
  [16, 7, 10, 18, 21, UP],
  [23, 5, 7, 14, 17, UP],
];

function roundedSq(x, y) {
  const q = (v) => Math.abs(v - S / 2) - (S / 2 - R);
  const qx = q(x), qy = q(y);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - R;
}

function glyph(x, y) {
  const u = (x / S) * 32, v = (y / S) * 32;
  for (const [cx, wt, bt, bb, wb, col] of candles) {
    if ((Math.abs(u - cx) <= 2.5 && v >= bt && v <= bb) || (Math.abs(u - cx) <= 0.6 && v >= wt && v <= wb)) return col;
  }
  return null;
}

const raw = Buffer.alloc(S * (S * 4 + 1));
for (let y = 0; y < S; y++) {
  raw[y * (S * 4 + 1)] = 0;
  for (let x = 0; x < S; x++) {
    let a = 0, rgb = [0, 0, 0];
    for (let sy = 0; sy < 2; sy++)
      for (let sx = 0; sx < 2; sx++) {
        const px = x + (sx + 0.5) / 2, py = y + (sy + 0.5) / 2;
        if (roundedSq(px, py) <= 0) {
          const c = glyph(px, py) ?? BG;
          rgb = rgb.map((v, i) => v + c[i]);
          a++;
        }
      }
    const o = y * (S * 4 + 1) + 1 + x * 4;
    if (a) for (let i = 0; i < 3; i++) raw[o + i] = Math.round(rgb[i] / a);
    raw[o + 3] = Math.round((a / 4) * 255);
  }
}

const crcTable = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
const crc = (buf) => {
  let c = -1;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const c = Buffer.alloc(4);
  c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(S, 0);
ihdr.writeUInt32BE(S, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // RGBA
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", deflateSync(raw)),
  chunk("IEND", Buffer.alloc(0)),
]);
mkdirSync("src-tauri/icons", { recursive: true });
writeFileSync("src-tauri/icons/app-icon.png", png);
console.log("wrote src-tauri/icons/app-icon.png");
