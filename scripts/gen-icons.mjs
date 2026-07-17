// Generates the extension icons as PNGs with zero dependencies.
// A dark rounded square with a 2x2 grid of tab-group-colored tiles.
// Run: node scripts/gen-icons.mjs

import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";

const SIZES = [16, 32, 48, 128];

const BG = [10, 15, 28];
const BARS = [
  [96, 165, 250], // blue
  [74, 222, 128], // green
  [250, 250, 250], // white-ish
];

function sdRoundRect(px, py, cx, cy, hw, hh, r) {
  const qx = Math.abs(px - cx) - hw + r;
  const qy = Math.abs(py - cy) - hh + r;
  return Math.min(Math.max(qx, qy), 0) + Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) - r;
}

function render(size) {
  const px = new Uint8Array(size * size * 4);
  const c = size / 2;
  const bgHalf = size / 2 - size * 0.02;
  const bgR = size * 0.29;

  // A descending, right-aligned stack: tabs snapping into a tidy order.
  const barHeight = size * 0.145;
  const gap = size * 0.08;
  const barR = barHeight * 0.36;
  const right = c + size * 0.29;
  const widths = [size * 0.6, size * 0.49, size * 0.38];
  const bars = widths.map((width, row) => ({
    cx: right - width / 2,
    cy: c + (row - 1) * (barHeight + gap),
    width,
  }));

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const dBg = sdRoundRect(x + 0.5, y + 0.5, c, c, bgHalf, bgHalf, bgR);
      const aa = (d) => Math.min(1, Math.max(0, 0.5 - d)); // 1px antialias
      const bgA = aa(dBg);
      if (bgA <= 0) continue;

      let [r, g, b] = BG;
      for (let row = 0; row < bars.length; row++) {
        const bar = bars[row];
        const dBar = sdRoundRect(
          x + 0.5,
          y + 0.5,
          bar.cx,
          bar.cy,
          bar.width / 2,
          barHeight / 2,
          barR,
        );
        const barA = aa(dBar);
        if (barA > 0) {
          r = r + (BARS[row][0] - r) * barA;
          g = g + (BARS[row][1] - g) * barA;
          b = b + (BARS[row][2] - b) * barA;
        }
      }
      px[i] = Math.round(r);
      px[i + 1] = Math.round(g);
      px[i + 2] = Math.round(b);
      px[i + 3] = Math.round(bgA * 255);
    }
  }
  return px;
}

// --- minimal PNG encoder ---
const CRC_TABLE = new Int32Array(256).map((_, n) => {
  let cValue = n;
  for (let k = 0; k < 8; k++) cValue = cValue & 1 ? 0xedb88320 ^ (cValue >>> 1) : cValue >>> 1;
  return cValue;
});

function crc32(buf) {
  let crc = -1;
  for (const byte of buf) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(size, pixels) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // no filter
    Buffer.from(pixels.buffer, y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

mkdirSync(new URL("../public/icons/", import.meta.url), { recursive: true });
for (const size of SIZES) {
  const out = new URL(`../public/icons/icon${size}.png`, import.meta.url);
  writeFileSync(out, png(size, render(size)));
  console.log(`icon${size}.png`);
}
