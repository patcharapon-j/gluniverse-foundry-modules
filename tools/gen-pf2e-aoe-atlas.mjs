#!/usr/bin/env node
/** Deterministically bake the local 8×4 RGBA Spellglass material atlas. */

import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SIZE = 256, TILE_W = 32, TILE_H = 64;
const out = join(dirname(fileURLToPath(import.meta.url)), "..", "assets", "pf2e-aoe", "material-atlas.png");
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c | 0;
});
function crc32(buffer) {
  let c = -1; for (const byte of buffer) c = crcTable[(c ^ byte) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}
function hash(x, y, seed) {
  let n = Math.imul(x + seed * 37, 374761393) ^ Math.imul(y + seed * 17, 668265263);
  n = Math.imul(n ^ (n >>> 13), 1274126177); return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}
const raw = Buffer.alloc(SIZE * SIZE * 4);
for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
  const tile = Math.floor(x / TILE_W) + Math.floor(y / TILE_H) * 8;
  const u = x % TILE_W, v = y % TILE_H;
  const broad = hash(Math.floor(u / 4), Math.floor(v / 4), tile);
  const fine = hash(u, v, tile + 31);
  const ridge = Math.abs(Math.sin((u * (tile % 5 + 2) + v * (tile % 7 + 1)) * 0.11));
  const particle = hash(Math.floor(u / 2), Math.floor(v / 2), tile + 73) > 0.86 ? 1 : 0;
  const i = (y * SIZE + x) * 4;
  raw[i] = Math.round(broad * 255); raw[i + 1] = Math.round(fine * 255);
  raw[i + 2] = Math.round(ridge * 255); raw[i + 3] = particle * 255;
}
const scan = Buffer.alloc((SIZE * 4 + 1) * SIZE);
for (let y = 0; y < SIZE; y++) {
  scan[y * (SIZE * 4 + 1)] = 0;
  raw.copy(scan, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, (y + 1) * SIZE * 4);
}
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(SIZE, 0); ihdr.writeUInt32BE(SIZE, 4); ihdr[8] = 8; ihdr[9] = 6;
const png = Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), chunk("IHDR", ihdr),
  chunk("IDAT", deflateSync(scan, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
mkdirSync(dirname(out), { recursive: true }); writeFileSync(out, png);
console.log(`wrote ${out} (${png.length} bytes)`);
