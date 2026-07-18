// Generates the extension icons as PNGs with zero dependencies.
// A dark rounded square with the Regroup monoline R mark.
// Run: node scripts/gen-icons.mjs

import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";

const SIZES = [16, 32, 48, 128];

const BG = [9, 9, 11];
const MARK = [250, 250, 250];
const ACCENT = [129, 140, 248];

function sdRoundRect(px, py, cx, cy, hw, hh, r) {
  const qx = Math.abs(px - cx) - hw + r;
  const qy = Math.abs(py - cy) - hh + r;
  return Math.min(Math.max(qx, qy), 0) + Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) - r;
}

function segmentDistance(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared ? Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / lengthSquared)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function render(size) {
  const px = new Uint8Array(size * size * 4);
  const c = size / 2;
  const bgHalf = size / 2 - size * 0.02;
  const bgR = size * 0.24;
  const stroke = size * 0.068;
  const point = ([x, y]) => [x * size, y * size];
  const markSegments = [
    [[0.3, 0.75], [0.3, 0.31]],
    [[0.3, 0.31], [0.51, 0.31]],
    [[0.51, 0.31], [0.62, 0.38]],
    [[0.62, 0.38], [0.62, 0.48]],
    [[0.62, 0.48], [0.51, 0.55]],
    [[0.51, 0.55], [0.3, 0.55]],
    [[0.49, 0.55], [0.71, 0.76]],
  ].map(([a, b]) => [point(a), point(b)]);
  const accentSegment = [point([0.3, 0.2]), point([0.51, 0.2])];

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const dBg = sdRoundRect(x + 0.5, y + 0.5, c, c, bgHalf, bgHalf, bgR);
      const aa = (d) => Math.min(1, Math.max(0, 0.5 - d)); // 1px antialias
      const bgA = aa(dBg);
      if (bgA <= 0) continue;

      let [r, g, b] = BG;
      const markDistance = Math.min(...markSegments.map(([[ax, ay], [bx, by]]) =>
        segmentDistance(x + 0.5, y + 0.5, ax, ay, bx, by)
      ));
      const markA = aa(markDistance - stroke / 2);
      r += (MARK[0] - r) * markA;
      g += (MARK[1] - g) * markA;
      b += (MARK[2] - b) * markA;

      const [[accentAx, accentAy], [accentBx, accentBy]] = accentSegment;
      const accentA = aa(segmentDistance(x + 0.5, y + 0.5, accentAx, accentAy, accentBx, accentBy) - stroke / 2) * 0.9;
      r += (ACCENT[0] - r) * accentA;
      g += (ACCENT[1] - g) * accentA;
      b += (ACCENT[2] - b) * accentA;
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
