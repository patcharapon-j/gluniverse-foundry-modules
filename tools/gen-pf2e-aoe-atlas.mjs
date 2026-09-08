#!/usr/bin/env node
/**
 * PF2e AoE — bake the local channel-packed material atlas.
 *
 *   node tools/gen-pf2e-aoe-atlas.mjs            write assets/pf2e-aoe/material-atlas.png
 *   node tools/gen-pf2e-aoe-atlas.mjs --check    verify the shipped file matches this recipe
 *
 * One 128 × 128 tile per canonical material, laid out 8 wide × 4 deep in
 * `schema.mjs` MATERIALS order (the shader selects a tile from that index; the
 * six spare tiles repeat neutral). Every tile is SEAMLESSLY TILEABLE: all of the
 * noise below is periodic in the tile, so the shader can wrap a tile across an
 * area at any frequency with no visible seam. A non-periodic tile reads as a
 * grid of squares the moment it repeats, which is the one artefact a texture
 * on a rules lattice cannot afford.
 *
 * Channels, all read by `shader.mjs`:
 *   R  broad surface variation — low-frequency fbm, the material's body
 *   G  structure mask — the family's own detail: cracks, dendrites, filaments,
 *      bubbles, waves, fibres, plates, wisps, grain. 1 = on the structure.
 *   B  emissive crests — sparse hot lines/points that sit on the ramp's top
 *   A  particulate / dissolve mask — sparse soft points and a dissolve field
 *
 * Deterministic: the same source always produces the same bytes, which is what
 * lets --check compare the shipped file byte-for-byte.
 */

import { deflateSync } from "node:zlib";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { MATERIALS } from "../scripts/features/pf2e-aoe/schema.mjs";

export const ATLAS = Object.freeze({ width: 1024, height: 512, cols: 8, rows: 4, tile: 128 });

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "assets", "pf2e-aoe", "material-atlas.png");
const check = process.argv.includes("--check");

/* ---- periodic noise ------------------------------------------------------ */

function hash(x, y, seed) {
  let n = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(seed | 0, 1274126177);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}
const wrap = (v, p) => ((v % p) + p) % p;
const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (a, b, t) => a + (b - a) * t;

/** Periodic gradient (Perlin-style) noise, period `p` cells. Range ~[-0.7, 0.7]. */
function gnoise(x, y, p, seed) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const grad = (ix, iy, dx, dy) => {
    const a = hash(wrap(ix, p), wrap(iy, p), seed) * Math.PI * 2;
    return Math.cos(a) * dx + Math.sin(a) * dy;
  };
  const u = fade(xf), v = fade(yf);
  return lerp(
    lerp(grad(xi, yi, xf, yf), grad(xi + 1, yi, xf - 1, yf), u),
    lerp(grad(xi, yi + 1, xf, yf - 1), grad(xi + 1, yi + 1, xf - 1, yf - 1), u), v);
}

/** Periodic fbm in [0,1]. `x`,`y` in tile units [0,1). `p` cells per tile. */
function fbm(x, y, p, seed, oct = 5, gain = 0.5, lac = 2) {
  let s = 0, a = 0.5, f = p, norm = 0;
  for (let i = 0; i < oct; i++) {
    s += a * gnoise(x * f, y * f, f, seed + i * 17);
    norm += a; a *= gain; f *= lac;
  }
  return Math.min(1, Math.max(0, 0.5 + s / norm * 0.9));
}

/** Ridged fbm in [0,1]: 1 on the crests. */
function ridged(x, y, p, seed, oct = 4) {
  let s = 0, a = 0.5, f = p, norm = 0;
  for (let i = 0; i < oct; i++) {
    const n = 1 - Math.abs(gnoise(x * f, y * f, f, seed + i * 29) * 1.4);
    s += a * n * n; norm += a; a *= 0.5; f *= 2;
  }
  return Math.min(1, Math.max(0, s / norm));
}

/** Periodic Voronoi. Returns { f1, f2, id } with distances in cell units. */
function voronoi(x, y, p, seed, jitter = 1) {
  const gx = x * p, gy = y * p;
  const xi = Math.floor(gx), yi = Math.floor(gy);
  let f1 = 9, f2 = 9, id = 0;
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const cx = xi + i, cy = yi + j;
    const ox = hash(wrap(cx, p), wrap(cy, p), seed) * jitter + (1 - jitter) * 0.5;
    const oy = hash(wrap(cx, p), wrap(cy, p), seed + 7) * jitter + (1 - jitter) * 0.5;
    const dx = cx + ox - gx, dy = cy + oy - gy;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d < f1) { f2 = f1; f1 = d; id = hash(wrap(cx, p), wrap(cy, p), seed + 3); }
    else if (d < f2) f2 = d;
  }
  return { f1, f2, id };
}

/** Sparse soft points, periodic. `density` points per cell row. */
function points(x, y, p, seed, keep = 0.35, rMin = 0.08, rMax = 0.22) {
  const gx = x * p, gy = y * p;
  const xi = Math.floor(gx), yi = Math.floor(gy);
  let acc = 0;
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const cx = xi + i, cy = yi + j;
    const h = hash(wrap(cx, p), wrap(cy, p), seed);
    if (h > keep) continue;
    const ox = 0.15 + 0.7 * hash(wrap(cx, p), wrap(cy, p), seed + 11);
    const oy = 0.15 + 0.7 * hash(wrap(cx, p), wrap(cy, p), seed + 13);
    const r = rMin + (rMax - rMin) * hash(wrap(cx, p), wrap(cy, p), seed + 19);
    const dx = cx + ox - gx, dy = cy + oy - gy;
    const d = Math.sqrt(dx * dx + dy * dy) / r;
    acc = Math.max(acc, Math.max(0, 1 - d * d));
  }
  return acc;
}

const sat = (v) => Math.min(1, Math.max(0, v));
const smooth = (a, b, x) => { const t = sat((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const TAU = Math.PI * 2;

/* ---- family recipes ----------------------------------------------------
   Each returns [R, G, B, A] in [0,1] for a tile coordinate (u, v) in [0,1).
   `s` is the material's own seed so no two tiles share a lattice. */

const cracks = (u, v, s, p = 5) => {
  const vo = voronoi(u, v, p, s);
  const edge = 1 - smooth(0.0, 0.09, vo.f2 - vo.f1);
  const broad = fbm(u, v, 3, s + 1, 4);
  const crest = 1 - smooth(0.0, 0.035, vo.f2 - vo.f1);
  const hot = crest * smooth(0.35, 0.75, fbm(u, v, 4, s + 2, 3));
  return [broad, edge, hot, points(u, v, 9, s + 3, 0.30, 0.10, 0.28)];
};

const dendrites = (u, v, s) => {
  const p = 4;
  const gx = u * p, gy = v * p;
  const xi = Math.floor(gx), yi = Math.floor(gy);
  let arms = 0;
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const cx = xi + i, cy = yi + j;
    const ox = hash(wrap(cx, p), wrap(cy, p), s), oy = hash(wrap(cx, p), wrap(cy, p), s + 5);
    const dx = gx - cx - ox, dy = gy - cy - oy;
    const r = Math.sqrt(dx * dx + dy * dy);
    if (r > 1.3) continue;
    const th = Math.atan2(dy, dx) + hash(wrap(cx, p), wrap(cy, p), s + 9) * TAU;
    const sharp = lerp(5, 18, smooth(0.05, 0.5, r));
    const main = Math.pow(Math.abs(Math.cos(th * 3)), sharp);
    const side = Math.pow(Math.abs(Math.cos(th * 3 + Math.sin(r * 9) * 0.9)), sharp * 0.55) * 0.5;
    arms = Math.max(arms, (main + side) * Math.exp(-r * 2.2) * (1 - smooth(0.9, 1.3, r)));
  }
  const fine = ridged(u, v, 12, s + 21, 3);
  const broad = 0.35 + 0.65 * fbm(u, v, 3, s + 1, 4);
  const g = sat(arms * 1.3 + smooth(0.72, 0.92, fine) * 0.35);
  return [broad, g, sat(arms * 1.6 - 0.35) , points(u, v, 10, s + 3, 0.22, 0.06, 0.16)];
};

const filaments = (u, v, s, p = 5) => {
  const r1 = ridged(u, v, p, s, 4);
  const r2 = ridged(u + 0.37, v + 0.61, p * 2, s + 4, 3);
  const g = smooth(0.55, 0.9, r1) * 0.85 + smooth(0.7, 0.95, r2) * 0.5;
  const hot = smooth(0.82, 0.98, r1);
  return [fbm(u, v, 3, s + 1, 4), sat(g), hot, points(u, v, 12, s + 3, 0.20, 0.05, 0.14)];
};

const bubbles = (u, v, s) => {
  const big = points(u, v, 5, s, 0.55, 0.16, 0.42);
  const small = points(u, v, 11, s + 2, 0.40, 0.08, 0.18);
  const rim = smooth(0.0, 0.25, big) * (1 - smooth(0.25, 0.6, big));
  const g = sat(rim * 1.2 + small * 0.6);
  return [fbm(u, v, 3, s + 1, 4), g, sat(rim * 0.9), points(u, v, 9, s + 3, 0.35, 0.08, 0.2)];
};

const waves = (u, v, s) => {
  const warp = fbm(u, v, 2, s + 1, 3) - 0.5;
  const w1 = 0.5 + 0.5 * Math.sin((u + warp * 0.35) * TAU * 6);
  const w2 = 0.5 + 0.5 * Math.sin((v * 0.5 + u + warp * 0.2) * TAU * 4);
  const g = sat(Math.pow(w1, 3) * 0.9 + Math.pow(w2, 4) * 0.4);
  return [fbm(u, v, 3, s + 2, 4), g, smooth(0.8, 1.0, w1) * 0.7, points(u, v, 10, s + 3, 0.25, 0.05, 0.14)];
};

const rays = (u, v, s) => {
  const grain = fbm(u, v, 8, s + 1, 3);
  const glints = points(u, v, 7, s, 0.28, 0.06, 0.20);
  const soft = points(u, v, 3, s + 5, 0.5, 0.25, 0.6);
  return [0.4 + 0.6 * fbm(u, v, 2, s + 2, 4), sat(soft * 0.7 + smooth(0.6, 0.9, grain) * 0.35), glints, points(u, v, 12, s + 3, 0.3, 0.04, 0.12)];
};

const wisps = (u, v, s) => {
  const r = ridged(u, v, 3, s, 4);
  const r2 = ridged(u * 1.0 + 0.5, v + 0.25, 6, s + 4, 3);
  const g = sat(smooth(0.35, 0.8, r) * 0.9 + smooth(0.6, 0.9, r2) * 0.4);
  return [fbm(u, v, 2, s + 1, 5), g, smooth(0.8, 0.98, r) * 0.6, points(u, v, 8, s + 3, 0.3, 0.1, 0.3)];
};

const plates = (u, v, s) => {
  const vo = voronoi(u, v, 4, s, 0.8);
  const seam = 1 - smooth(0.0, 0.07, vo.f2 - vo.f1);
  const grain = fbm(u, v, 10, s + 4, 3);
  const g = sat(seam + (vo.id - 0.5) * 0.3 + grain * 0.25);
  return [0.3 + 0.5 * vo.id + 0.2 * grain, g, seam * smooth(0.5, 0.8, grain) * 0.6, points(u, v, 9, s + 3, 0.25, 0.06, 0.16)];
};

const fibres = (u, v, s, angle = 0.4) => {
  const ca = Math.cos(angle), sa = Math.sin(angle);
  const warp = fbm(u, v, 3, s + 1, 3) - 0.5;
  const along = (u * ca + v * sa) + warp * 0.12;
  const f1 = Math.abs(Math.sin(along * TAU * 9)), f2 = Math.abs(Math.sin((along + warp * 0.3) * TAU * 17));
  const g = sat(Math.pow(f1, 6) * 0.9 + Math.pow(f2, 8) * 0.5);
  return [fbm(u, v, 3, s + 2, 4), g, smooth(0.9, 1.0, f1) * 0.45, points(u, v, 10, s + 3, 0.25, 0.05, 0.14)];
};

const brushed = (u, v, s) => {
  const streak = fbm(u * 0.15, v, 6, s, 4);
  const scratch = ridged(u * 0.2, v, 16, s + 3, 2);
  const g = sat(smooth(0.45, 0.75, streak) * 0.7 + smooth(0.85, 1.0, scratch) * 0.6);
  return [0.35 + 0.65 * streak, g, smooth(0.92, 1.0, scratch), points(u, v, 12, s + 3, 0.18, 0.04, 0.1)];
};

const hexScreen = (u, v, s) => {
  const p = 6;
  const gx = u * p, gy = v * p * 1.1547;
  const a = [wrap(gx, 1) - 0.5, wrap(gy, 1) - 0.5];
  const b = [wrap(gx - 0.5, 1) - 0.5, wrap(gy - 0.5, 1) - 0.5];
  const hr = (q) => { const x = Math.abs(q[0]), y = Math.abs(q[1]); return Math.max(x * 0.5 + y * 0.866, x); };
  const e = 0.5 - Math.min(hr(a), hr(b));
  const g = 1 - smooth(0.02, 0.07, e);
  return [0.5 + 0.2 * (fbm(u, v, 2, s, 3) - 0.5), g * 0.8, 0, points(u, v, 8, s + 3, 0.2, 0.05, 0.12)];
};

const RECIPES = Object.freeze({
  fire: (u, v, s) => cracks(u, v, s, 5),
  cold: dendrites,
  electricity: (u, v, s) => filaments(u, v, s, 5),
  acid: bubbles,
  poison: bubbles,
  sonic: waves,
  force: hexScreen,
  kinetic: (u, v, s) => cracks(u, v, s, 7),
  vitality: rays,
  void: wisps,
  spirit: wisps,
  holy: rays,
  unholy: wisps,
  light: rays,
  shadow: wisps,
  mental: (u, v, s) => filaments(u, v, s, 3),
  illusion: (u, v, s) => waves(u, v, s),
  air: waves,
  earth: plates,
  water: (u, v, s) => { const vo = voronoi(u, v, 5, s); const c = smooth(0.0, 0.18, vo.f2 - vo.f1); const g = 1 - c; return [fbm(u, v, 3, s + 1, 4), g, Math.pow(g, 3) * 0.8, points(u, v, 9, s + 3, 0.25, 0.06, 0.16)]; },
  wood: (u, v, s) => fibres(u, v, s, 0.15),
  metal: brushed,
  plant: (u, v, s) => fibres(u, v, s, 0.9),
  fungal: bubbles,
  arcane: (u, v, s) => filaments(u, v, s, 4),
  neutral: hexScreen,
});

/* ---- bake ---------------------------------------------------------------- */

function bake() {
  const { width, height, cols, tile } = ATLAS;
  const raw = Buffer.alloc(width * height * 4);
  const tiles = [...MATERIALS];
  while (tiles.length < cols * ATLAS.rows) tiles.push("neutral");
  tiles.forEach((material, index) => {
    const recipe = RECIPES[material] ?? RECIPES.neutral;
    const seed = 101 + index * 37;
    const tx = (index % cols) * tile, ty = Math.floor(index / cols) * tile;
    for (let y = 0; y < tile; y++) for (let x = 0; x < tile; x++) {
      const [r, g, b, a] = recipe((x + 0.5) / tile, (y + 0.5) / tile, seed);
      const i = ((ty + y) * width + tx + x) * 4;
      raw[i] = Math.round(sat(r) * 255); raw[i + 1] = Math.round(sat(g) * 255);
      raw[i + 2] = Math.round(sat(b) * 255); raw[i + 3] = Math.round(sat(a) * 255);
    }
  });
  return raw;
}

/* ---- PNG ----------------------------------------------------------------- */

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
function encode(raw) {
  const { width, height } = ATLAS;
  const stride = width * 4 + 1;
  const scan = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    /* Filter type 1 (Sub): noise compresses noticeably better against its
       left neighbour than raw. */
    scan[y * stride] = 1;
    for (let x = 0; x < width * 4; x++) {
      const cur = raw[y * width * 4 + x];
      const left = x >= 4 ? raw[y * width * 4 + x - 4] : 0;
      scan[y * stride + 1 + x] = (cur - left) & 255;
    }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(scan, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

const png = encode(bake());
if (check) {
  let shipped = null;
  try { shipped = readFileSync(out); } catch { /* missing */ }
  if (!shipped || !shipped.equals(png)) {
    console.error(`FAIL ${out} does not match this recipe — re-run without --check`);
    process.exit(1);
  }
  console.log(`atlas OK (${png.length} bytes, ${MATERIALS.length} materials)`);
} else {
  mkdirSync(dirname(out), { recursive: true }); writeFileSync(out, png);
  console.log(`wrote ${out} (${png.length} bytes)`);
}
