#!/usr/bin/env node
/**
 * GLUniverse Suite — bake the PF2e Damage Dice texture set.
 *
 *   node tools/gen-damage-textures.mjs            # write every map
 *   node tools/gen-damage-textures.mjs fire cold   # just these types
 *   node tools/gen-damage-textures.mjs --check     # verify the set is complete
 *
 * Writes three 256×256 PNGs per damage type into
 * `assets/pf2e-damage-dice/textures/`:
 *
 *   <id>.png           albedo  — multiplied over the colorset background, so it
 *                               is authored as a near-neutral luminance map with
 *                               only a light hue push. Mean ≈ 0.75 keeps dice
 *                               from going muddy.
 *   <id>-bump.png      height  — greyscale, white = proud, black = sunken. Dice
 *                               So Nice runs a Sobel pass over it to build the
 *                               normal map, so contrast here is relief depth.
 *   <id>-emissive.png  emission — drawn onto a black canvas and handed to
 *                               THREE as `emissiveMap`. Black = inert.
 *
 * Everything is seamless: all noise runs on a wrapped lattice, and every
 * frequency is an integer, so a die face never shows a tile edge.
 *
 * There is no image library on the dev box (and the repo has no package.json),
 * so this file carries its own PNG encoder over `node:zlib`. Output is
 * deterministic — reruns produce byte-identical files.
 */

import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync, existsSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { DAMAGE_TYPES, DAMAGE_TYPE_IDS } from "../scripts/features/pf2e-damage-dice/damage-types.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(ROOT, "assets", "pf2e-damage-dice", "textures");
const SIZE = 256;

/* ══════════════════════════════════════════════════════════════════════
   PNG encoder
   ══════════════════════════════════════════════════════════════════════ */

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/**
 * Per-scanline adaptive filtering, the heuristic from the PNG spec: try each
 * filter, keep the one with the smallest sum of absolute differences. On noisy
 * procedural maps this is worth roughly 40% off the file size versus filter 0.
 */
function filterScanlines(raw, width, height, channels) {
  const stride = width * channels;
  const out = Buffer.alloc((stride + 1) * height);
  const cand = Buffer.alloc(stride);
  const best = Buffer.alloc(stride);
  let prev = Buffer.alloc(stride);

  for (let y = 0; y < height; y++) {
    const line = raw.subarray(y * stride, (y + 1) * stride);
    let bestType = 0;
    let bestScore = Infinity;

    for (let type = 0; type <= 4; type++) {
      let score = 0;
      for (let i = 0; i < stride; i++) {
        const a = i >= channels ? line[i - channels] : 0;
        const b = prev[i];
        const c = i >= channels ? prev[i - channels] : 0;
        let v;
        switch (type) {
          case 0: v = line[i]; break;
          case 1: v = line[i] - a; break;
          case 2: v = line[i] - b; break;
          case 3: v = line[i] - ((a + b) >> 1); break;
          default: {
            const p = a + b - c;
            const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
            v = line[i] - (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
          }
        }
        cand[i] = v & 0xff;
        score += cand[i] < 128 ? cand[i] : 256 - cand[i];
      }
      if (score < bestScore) {
        bestScore = score;
        bestType = type;
        cand.copy(best);
      }
    }

    out[y * (stride + 1)] = bestType;
    best.copy(out, y * (stride + 1) + 1);
    prev = line;
  }
  return out;
}

/** `channels` is 1 (greyscale) or 3 (truecolour). */
function encodePNG(raw, width, height, channels) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;                          // bit depth
  ihdr[9] = channels === 1 ? 0 : 2;     // colour type: greyscale | truecolour
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(filterScanlines(raw, width, height, channels), { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/* ══════════════════════════════════════════════════════════════════════
   Tileable procedural toolkit

   Every generator here takes coordinates in [0,1) and a *period* in whole
   cells. Wrapping the lattice indices by that period is what makes the result
   seamless; keeping every period an integer is what keeps it seamless after
   octave stacking.
   ══════════════════════════════════════════════════════════════════════ */

const TAU = Math.PI * 2;
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => t * t * (3 - 2 * t);
const smoothstep = (e0, e1, x) => (e1 === e0 ? (x < e0 ? 0 : 1) : smooth(clamp01((x - e0) / (e1 - e0))));
const mod = (a, n) => ((a % n) + n) % n;

/** Deterministic 2D hash → [0,1). */
function hash2(ix, iy, seed) {
  let h = (ix * 374761393 + iy * 668265263 + seed * 2246822519) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  h = h ^ (h >>> 16);
  return (h >>> 0) / 4294967296;
}

/**
 * Value noise on a `px × py` wrapped lattice.
 *
 * Independent periods per axis are what stretch a pattern without breaking the
 * tile. Scaling a coordinate instead — `noise(x, y * 0.3)` — looks like the
 * same thing and is not: y=1 no longer lands back on y=0, so the top and bottom
 * edges stop matching and every die face shows the seam.
 */
function vnoise2(x, y, px, py, seed) {
  const gx = x * px, gy = y * py;
  const x0 = Math.floor(gx), y0 = Math.floor(gy);
  const fx = smooth(gx - x0), fy = smooth(gy - y0);
  const i0 = mod(x0, px), i1 = mod(x0 + 1, px);
  const j0 = mod(y0, py), j1 = mod(y0 + 1, py);
  const n00 = hash2(i0, j0, seed), n10 = hash2(i1, j0, seed);
  const n01 = hash2(i0, j1, seed), n11 = hash2(i1, j1, seed);
  return lerp(lerp(n00, n10, fx), lerp(n01, n11, fx), fy);
}

const vnoise = (x, y, period, seed) => vnoise2(x, y, period, period, seed);

/** Fractal sum. Periods double per octave, so the whole stack stays tileable. */
function fbm2(x, y, px, py, octaves, seed, gain = 0.5) {
  let sum = 0, amp = 1, norm = 0, a = px, b = py;
  for (let o = 0; o < octaves; o++) {
    sum += amp * vnoise2(x, y, a, b, seed + o * 101);
    norm += amp;
    amp *= gain;
    a *= 2;
    b *= 2;
  }
  return sum / norm;
}

const fbm = (x, y, period, octaves, seed, gain = 0.5) =>
  fbm2(x, y, period, period, octaves, seed, gain);

/** Push coordinates around by a tileable noise field. Stays wrapped. */
function warp(x, y, amount, period, seed) {
  const dx = fbm(x, y, period, 3, seed) - 0.5;
  const dy = fbm(x, y, period, 3, seed + 977) - 0.5;
  return [mod(x + amount * dx, 1), mod(y + amount * dy, 1)];
}

/** Billowy ridges — the classic `1 - |2n-1|` fold, stacked. */
function ridged(x, y, period, octaves, seed) {
  let sum = 0, amp = 1, norm = 0, p = period;
  for (let o = 0; o < octaves; o++) {
    sum += amp * (1 - Math.abs(2 * vnoise(x, y, p, seed + o * 313) - 1));
    norm += amp;
    amp *= 0.55;
    p *= 2;
  }
  return sum / norm;
}

/**
 * Wrapped cellular noise. Returns the two nearest feature-point distances,
 * normalised so `f1` is roughly 0..1 across a cell. `jitter` 0 gives a perfect
 * lattice (used for the force honeycomb); `stagger` offsets odd rows by half a
 * cell, which turns the square lattice into a hexagonal one.
 */
function worley(x, y, cells, seed, { jitter = 1, stagger = false } = {}) {
  const gx = x * cells, gy = y * cells;
  const cx = Math.floor(gx), cy = Math.floor(gy);
  let f1 = Infinity, f2 = Infinity, id = 0;

  for (let oy = -1; oy <= 1; oy++) {
    for (let ox = -1; ox <= 1; ox++) {
      const ix = cx + ox, iy = cy + oy;
      const wx = mod(ix, cells), wy = mod(iy, cells);
      const rowShift = stagger && mod(iy, 2) === 1 ? 0.5 : 0;
      const px = ix + rowShift + 0.5 + (hash2(wx, wy, seed) - 0.5) * jitter;
      const py = iy + 0.5 + (hash2(wx, wy, seed + 7919) - 0.5) * jitter;
      const d = Math.hypot(px - gx, py - gy);
      if (d < f1) { f2 = f1; f1 = d; id = hash2(wx, wy, seed + 104729); }
      else if (d < f2) { f2 = d; }
    }
  }
  return { f1, f2, id };
}

/* ══════════════════════════════════════════════════════════════════════
   Recipes — one per damage type

   Each returns { a: [r,g,b], h, e: [r,g,b] }, all channels in 0..1.
   `a` is multiplied over the die's base colour, so ~0.75 is "unchanged".
   ══════════════════════════════════════════════════════════════════════ */

const grey = (v) => [v, v, v];
const tint = (v, r, g, b) => [clamp01(v * r), clamp01(v * g), clamp01(v * b)];
const glow = (v, r, g, b) => [clamp01(v * r), clamp01(v * g), clamp01(v * b)];
const DARK = [0, 0, 0];

/**
 * A blob field with per-cell radius variation. Plain `smoothstep` over a Worley
 * distance gives every cell the same radius, which reads as polka dots however
 * much you jitter the centres; keying the radius off the cell's own hash — and
 * warping the domain first — is what turns dots back into damage.
 */
function blobs(x, y, cells, seed, { rMin = 0.2, rMax = 0.5, jitter = 1, warpAmount = 0, warpPeriod = 4, falloff = 0.15 } = {}) {
  const [wx, wy] = warpAmount ? warp(x, y, warpAmount, warpPeriod, seed + 555) : [x, y];
  const w = worley(wx, wy, cells, seed, { jitter });
  const r = rMin + (rMax - rMin) * w.id;
  return { cover: smoothstep(r, r * falloff, w.f1), r, ...w };
}

/** One sharpened wave across an arbitrary lattice direction; `freq`/`a`/`b` integer. */
const streak = (x, y, a, b, freq, phase, wobble, power) =>
  Math.pow(0.5 + 0.5 * Math.sin(TAU * (freq * (a * x + b * y) + phase + wobble)), power);

const RECIPES = {
  /* Stone beaten hollow: dished craters with a raised lip, chipped at the edges. */
  bludgeoning(x, y, s) {
    const b = blobs(x, y, 5, s, { rMin: 0.34, rMax: 0.68, warpAmount: 0.12, warpPeriod: 5, falloff: 0.1 });
    const lip = smoothstep(0.16, 0.0, Math.abs(b.f1 - b.r));
    const grain = fbm(x, y, 10, 4, s + 1);
    const chips = Math.pow(smoothstep(0.32, 0.0, worley(x, y, 17, s + 5).f1), 1.5);
    const v = 0.7 - 0.2 * b.cover + 0.1 * lip + 0.09 * grain - 0.2 * chips;
    return {
      a: grey(clamp01(v)),
      h: clamp01(0.62 - 0.34 * b.cover + 0.16 * lip + 0.1 * grain - 0.26 * chips),
      e: DARK,
    };
  },

  /* Drawn steel: hairline striations, scratched, punched through with a burr. */
  piercing(x, y, s) {
    const wob = 1.4 * (fbm2(x, y, 4, 12, 3, s) - 0.5);
    const stria = 0.5 + 0.5 * Math.sin(TAU * (46 * x + wob));
    const scratch = streak(x, y, 1, 0, 11, 0.2, 2.2 * (fbm2(x, y, 3, 9, 3, s + 3) - 0.5), 5);
    const b = blobs(x, y, 6, s + 7, { rMin: 0.16, rMax: 0.38, warpAmount: 0.1, falloff: 0.2 });
    const burr = smoothstep(b.r * 2.0, b.r, b.f1) * (1 - b.cover);
    const v = 0.74 + 0.05 * stria + 0.05 * scratch - 0.42 * b.cover + 0.1 * burr;
    return {
      a: tint(clamp01(v), 0.97, 1.0, 1.05),
      h: clamp01(0.68 + 0.08 * stria + 0.1 * scratch - 0.62 * b.cover + 0.2 * burr),
      e: DARK,
    };
  },

  /* A handful of real cuts at three angles, over a honed surface. */
  slashing(x, y, s) {
    const wob = 0.5 * (fbm(x, y, 4, 3, s) - 0.5);
    const cut = Math.max(
      streak(x, y, 1, 1, 2, 0.0, wob, 14),
      streak(x, y, 1, 2, 3, 0.37, wob, 16),
      streak(x, y, 2, 1, 2, 0.71, wob, 12)
    );
    const hone = 0.5 + 0.5 * Math.sin(TAU * (34 * (x + y) + 1.6 * wob));
    const v = 0.78 + 0.04 * hone - 0.46 * cut;
    return {
      a: tint(clamp01(v), 0.98, 1.01, 1.06),
      h: clamp01(0.8 + 0.05 * hone - 0.72 * cut),
      e: DARK,
    };
  },

  /* Blood soaking outward, then running. The run is stretched by lattice period,
     not by scaling y — scaling y would put a seam across every face. */
  bleed(x, y, s) {
    const run = fbm2(x, y, 6, 2, 5, s);
    const blot = fbm(mod(x + 0.12 * (run - 0.5), 1), y, 4, 5, s + 11);
    const pool = smoothstep(0.4, 0.76, blot * 0.68 + run * 0.32);
    const v = 0.88 - 0.5 * pool;
    return {
      a: [clamp01(v * 1.05), clamp01(v * 0.7), clamp01(v * 0.72)],
      h: clamp01(0.62 - 0.3 * pool + 0.1 * blot),
      e: glow(Math.pow(pool, 2.2), 0.9, 0.1, 0.14),
    };
  },

  /* Eaten hollow at two scales, with channels where it ran before it dried. */
  acid(x, y, s) {
    const [wx, wy] = warp(x, y, 0.2, 4, s);
    const coarse = blobs(x, y, 7, s, { rMin: 0.2, rMax: 0.6, warpAmount: 0.2, falloff: 0.1 });
    const fine = blobs(x, y, 14, s + 31, { rMin: 0.16, rMax: 0.46, warpAmount: 0.2, falloff: 0.15 });
    const channel = smoothstep(0.74, 0.96, ridged(wx, wy, 6, 4, s + 3));
    const eaten = clamp01(coarse.cover * 0.85 + fine.cover * 0.5 + channel * 0.55);
    const scum = fbm(x, y, 9, 4, s + 4);
    const v = 0.88 - 0.44 * eaten - 0.08 * scum;
    return {
      a: [clamp01(v * 0.9), clamp01(v * 1.06), clamp01(v * 0.7)],
      h: clamp01(0.82 - 0.66 * eaten + 0.08 * scum),
      e: glow(smoothstep(0.72, 1.0, eaten) * 0.8, 0.42, 1.0, 0.1),
    };
  },

  /* Frost: crystal boundaries first, then the needles growing along them. */
  cold(x, y, s) {
    const w = worley(x, y, 6, s, { jitter: 0.9 });
    const facet = smoothstep(0.0, 0.16, w.f2 - w.f1);
    const needles = ridged(x, y, 8, 4, s + 2);
    const rime = smoothstep(0.62, 0.95, needles);
    const v = 0.62 + 0.24 * (1 - facet) + 0.16 * rime;
    return {
      a: [clamp01(v * 0.94), clamp01(v * 1.0), clamp01(v * 1.06)],
      h: clamp01(0.44 + 0.4 * (1 - facet) + 0.26 * rime),
      e: glow(Math.pow(1 - facet, 3) * 0.55 + rime * 0.25, 0.5, 0.85, 1.0),
    };
  },

  /* Arc filaments, branching hard and glowing hot along their length. */
  electricity(x, y, s) {
    const r = ridged(x, y, 5, 5, s);
    const arc = smoothstep(0.84, 0.99, r);
    const halo = smoothstep(0.66, 0.94, r);
    const v = 0.5 + 0.46 * arc + 0.12 * halo;
    return {
      a: [clamp01(v * 0.82), clamp01(v * 0.94), clamp01(v * 1.12)],
      h: clamp01(0.42 + 0.5 * arc + 0.12 * halo),
      e: glow(arc * 0.95 + halo * 0.2, 0.62, 0.84, 1.0),
    };
  },

  /* Turbulence pulled through itself, cooling to charcoal, sparking embers. */
  fire(x, y, s) {
    const wx = fbm(x, y, 4, 4, s) - 0.5;
    const wy = fbm(x, y, 4, 4, s + 51) - 0.5;
    const f = fbm(mod(x + 0.35 * wx, 1), mod(y + 0.35 * wy, 1), 5, 5, s + 7);
    const heat = smoothstep(0.36, 0.86, f);
    const char = smoothstep(0.44, 0.12, f);
    const ember = Math.pow(smoothstep(0.22, 0.0, worley(x, y, 22, s + 9).f1), 2);
    const v = 0.44 + 0.5 * heat - 0.24 * char + 0.3 * ember;
    return {
      a: [clamp01(v * 1.12), clamp01(v * 0.82), clamp01(v * 0.6)],
      h: clamp01(0.4 + 0.34 * f - 0.18 * char),
      e: glow(Math.pow(heat, 1.5) * 0.9 + ember, 1.0, 0.44, 0.1),
    };
  },

  /* Pressure waves spreading from a handful of sources and dying out. */
  sonic(x, y, s) {
    const [wx, wy] = warp(x, y, 0.1, 4, s + 61);
    const w = worley(wx, wy, 3, s, { jitter: 0.85 });
    const rings = 0.5 + 0.5 * Math.sin(TAU * 5 * w.f1);
    const decay = smoothstep(1.15, 0.05, w.f1);
    const crest = Math.pow(rings, 9) * decay;
    const v = 0.74 + 0.18 * rings * decay;
    return {
      a: [clamp01(v * 1.03), clamp01(v * 0.86), clamp01(v * 1.08)],
      h: clamp01(0.58 + 0.3 * rings * decay),
      e: glow(crest * 0.95, 0.86, 0.32, 1.0),
    };
  },

  /* Raw magic held in a lattice — a honeycomb with a node at every centre. */
  force(x, y, s) {
    const w = worley(x, y, 6, s, { jitter: 0, stagger: true });
    const wall = smoothstep(0.075, 0.0, w.f2 - w.f1);
    const node = smoothstep(0.16, 0.0, w.f1);
    const haze = fbm(x, y, 6, 3, s + 13);
    const v = 0.56 + 0.34 * wall + 0.3 * node + 0.08 * haze;
    return {
      a: [clamp01(v * 0.94), clamp01(v * 0.92), clamp01(v * 1.14)],
      h: clamp01(0.44 + 0.36 * wall + 0.3 * node),
      e: glow(wall * 0.7 + node * 0.95, 0.66, 0.6, 1.0),
    };
  },

  /* Thought turned in on itself: two rounds of domain warping. */
  mental(x, y, s) {
    const q = fbm(x, y, 3, 4, s) - 0.5;
    const r = fbm(mod(x + 0.4 * q, 1), mod(y + 0.4 * q, 1), 4, 4, s + 23) - 0.5;
    const v0 = fbm(mod(x + 0.55 * r, 1), mod(y - 0.55 * r, 1), 5, 5, s + 41);
    const band = smoothstep(0.42, 0.72, v0);
    const v = 0.6 + 0.3 * band + 0.1 * v0;
    return {
      a: [clamp01(v * 1.1), clamp01(v * 0.8), clamp01(v * 1.06)],
      h: clamp01(0.5 + 0.3 * v0),
      e: glow(Math.pow(band, 2) * 0.75, 0.88, 0.3, 0.82),
    };
  },

  /* Sludge running slow, with the gas still coming out of it. */
  poison(x, y, s) {
    const sludge = fbm2(x, y, 3, 9, 5, s);
    const b = blobs(x, y, 7, s + 6, { rMin: 0.22, rMax: 0.64, warpAmount: 0.14, warpPeriod: 5, falloff: 0.55 });
    const rim = smoothstep(b.r * 0.24, 0.0, Math.abs(b.f1 - b.r * 0.8));
    const v = 0.76 - 0.22 * sludge + 0.16 * rim - 0.12 * b.cover;
    return {
      a: [clamp01(v * 0.78), clamp01(v * 1.08), clamp01(v * 0.74)],
      h: clamp01(0.56 + 0.26 * b.cover + 0.22 * rim - 0.2 * sludge),
      e: glow(clamp01(rim * 0.65 + Math.pow(b.cover, 4) * 0.3), 0.4, 1.0, 0.3),
    };
  },

  /* Ectoplasm drifting — stretched by lattice period so the tile still closes. */
  spirit(x, y, s) {
    const stretched = fbm2(x, y, 7, 2, 5, s);
    const wisp = smoothstep(0.46, 0.84, stretched);
    const veil = fbm(x, y, 7, 3, s + 17);
    const v = 0.66 + 0.3 * wisp + 0.08 * veil;
    return {
      a: [clamp01(v * 1.06), clamp01(v * 1.02), clamp01(v * 0.88)],
      h: clamp01(0.54 + 0.22 * wisp),
      e: glow(Math.pow(wisp, 1.7) * 0.85, 1.0, 0.9, 0.62),
    };
  },

  /* Life blooming outward — overlapping, uneven — with motes coming off it. */
  vitality(x, y, s) {
    const b = blobs(x, y, 4, s, { rMin: 0.7, rMax: 1.2, jitter: 0.95, warpAmount: 0.16, warpPeriod: 3, falloff: 0.0 });
    const bloom = Math.pow(b.cover, 1.8);
    const mote = Math.pow(smoothstep(0.24, 0.0, worley(x, y, 18, s + 8).f1), 2.5);
    const veil = fbm(x, y, 6, 4, s + 13);
    const v = 0.62 + 0.28 * bloom + 0.1 * veil + 0.26 * mote;
    return {
      a: [clamp01(v * 1.12), clamp01(v * 1.02), clamp01(v * 0.74)],
      h: clamp01(0.5 + 0.3 * bloom + 0.12 * veil),
      e: glow(Math.pow(bloom, 3.4) * 0.7 + mote, 1.0, 0.86, 0.42),
    };
  },

  /* An absence with structure: dark bands, and the few stars not yet eaten. */
  void(x, y, s) {
    const q = fbm(x, y, 3, 5, s) - 0.5;
    const swirl = fbm(mod(x + 0.6 * q, 1), mod(y + 0.6 * q, 1), 4, 5, s + 29);
    const horizon = smoothstep(0.3, 0.7, swirl);
    const star = Math.pow(smoothstep(0.14, 0.0, worley(x, y, 26, s + 12).f1), 3);
    const v = 0.44 + 0.26 * horizon + 0.34 * star;
    return {
      a: [clamp01(v * 0.96), clamp01(v * 0.86), clamp01(v * 1.14)],
      h: clamp01(0.48 + 0.22 * horizon),
      e: glow(star * 1.0 + Math.pow(horizon, 3) * 0.28, 0.78, 0.6, 1.0),
    };
  },

  /* No damage type of its own — so it wears the suite's own etched glass:
     a fine brushed grain under a hairline rule. Deliberately the quietest
     texture in the set, because it is the one that fires on every stray
     untyped die and must never look like it means something. */
  untyped(x, y, s) {
    const brush = 0.5 + 0.5 * Math.sin(TAU * (38 * y + 1.2 * (fbm2(x, y, 2, 10, 3, s) - 0.5)));
    const line = (u) => {
      const t = mod(u * 3, 1);
      return smoothstep(0.018, 0.0, Math.min(t, 1 - t));
    };
    const rule = Math.max(line(x), line(y));
    const grain = fbm(x, y, 16, 3, s + 3);
    const v = 0.9 + 0.012 * brush + 0.025 * grain - 0.1 * rule;
    return { a: grey(clamp01(v)), h: clamp01(0.82 + 0.02 * brush + 0.03 * grain - 0.3 * rule), e: DARK };
  },
};

/* ══════════════════════════════════════════════════════════════════════
   Bake
   ══════════════════════════════════════════════════════════════════════ */

/** Stable per-type seed, so adding a type never reshuffles the others. */
function seedFor(id) {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % 100000;
}

function bake(id) {
  const recipe = RECIPES[id];
  if (!recipe) throw new Error(`No texture recipe for damage type "${id}"`);
  const seed = seedFor(id);

  const albedo = Buffer.alloc(SIZE * SIZE * 3);
  const bump = Buffer.alloc(SIZE * SIZE);
  const emissive = Buffer.alloc(SIZE * SIZE * 3);
  let emissiveEnergy = 0;

  for (let py = 0; py < SIZE; py++) {
    const y = (py + 0.5) / SIZE;
    for (let px = 0; px < SIZE; px++) {
      const x = (px + 0.5) / SIZE;
      const { a, h, e } = recipe(x, y, seed);
      const i = py * SIZE + px;

      albedo[i * 3] = Math.round(clamp01(a[0]) * 255);
      albedo[i * 3 + 1] = Math.round(clamp01(a[1]) * 255);
      albedo[i * 3 + 2] = Math.round(clamp01(a[2]) * 255);
      bump[i] = Math.round(clamp01(h) * 255);
      emissive[i * 3] = Math.round(clamp01(e[0]) * 255);
      emissive[i * 3 + 1] = Math.round(clamp01(e[1]) * 255);
      emissive[i * 3 + 2] = Math.round(clamp01(e[2]) * 255);
      emissiveEnergy += clamp01(e[0]) + clamp01(e[1]) + clamp01(e[2]);
    }
  }

  return {
    albedo: encodePNG(albedo, SIZE, SIZE, 3),
    bump: encodePNG(bump, SIZE, SIZE, 1),
    emissive: encodePNG(emissive, SIZE, SIZE, 3),
    emissiveMean: emissiveEnergy / (SIZE * SIZE * 3),
  };
}

const hexToRgb = (hex) => {
  const n = parseInt(String(hex).replace(/^#/, ""), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

/**
 * Contact sheet: every type as a column, four rows deep —
 *
 *   face      albedo composited `multiply` over the type's own die colour, i.e.
 *             roughly what the player will see. This is the row to judge; the
 *             raw albedo below it is authored near-neutral and always looks
 *             washed out on its own.
 *   albedo    the map as written to disk
 *   bump      height, white proud
 *   emission  the glow, over black
 *
 * The only practical way to review a recipe change without launching Foundry:
 * a tiling seam or a blown-out glow is obvious here and invisible in a diff.
 */
function contactSheet(ids, cell = 128) {
  const w = ids.length * cell;
  const h = 4 * cell;
  const buf = Buffer.alloc(w * h * 3);
  ids.forEach((id, col) => {
    const recipe = RECIPES[id];
    const seed = seedFor(id);
    const backgrounds = DAMAGE_TYPES[id].background.map(hexToRgb);
    for (let py = 0; py < cell; py++) {
      for (let px = 0; px < cell; px++) {
        const { a, h: height, e } = recipe((px + 0.5) / cell, (py + 0.5) / cell, seed);
        // Quarter the tile between the type's background variants, the way
        // Dice So Nice spreads them across the dice of one roll.
        const bg = backgrounds[(px < cell / 2 ? 0 : 1) + (py < cell / 2 ? 0 : 2)] ?? backgrounds[0];
        const face = a.map((v, c) => v * bg[c]);
        const rows = [face, a, [height, height, height], e];
        rows.forEach((rgb, row) => {
          const i = ((row * cell + py) * w + col * cell + px) * 3;
          buf[i] = Math.round(clamp01(rgb[0]) * 255);
          buf[i + 1] = Math.round(clamp01(rgb[1]) * 255);
          buf[i + 2] = Math.round(clamp01(rgb[2]) * 255);
        });
      }
    }
  });
  return encodePNG(buf, w, h, 3);
}

/* ── CLI ──────────────────────────────────────────────────────────────── */

const args = process.argv.slice(2);
const checkOnly = args.includes("--check");
const sheetArg = args.find((a) => a.startsWith("--sheet="));
const wanted = args.filter((a) => !a.startsWith("--"));
const ids = wanted.length ? wanted : DAMAGE_TYPE_IDS;

const missingRecipes = DAMAGE_TYPE_IDS.filter((id) => !RECIPES[id]);
const strayRecipes = Object.keys(RECIPES).filter((id) => !DAMAGE_TYPE_IDS.includes(id));
if (missingRecipes.length) {
  console.error(`No recipe for: ${missingRecipes.join(", ")}`);
  process.exit(1);
}
if (strayRecipes.length) {
  console.error(`Recipe for unknown damage type: ${strayRecipes.join(", ")}`);
  process.exit(1);
}

if (sheetArg) {
  const path = sheetArg.slice("--sheet=".length);
  writeFileSync(path, contactSheet(ids));
  console.log(`contact sheet (${ids.length} types × face/albedo/bump/emission) → ${path}`);
  process.exit(0);
}

if (checkOnly) {
  let missing = 0;
  for (const id of DAMAGE_TYPE_IDS) {
    for (const suffix of ["", "-bump", "-emissive"]) {
      const p = join(OUT_DIR, `${id}${suffix}.png`);
      if (!existsSync(p) || statSync(p).size === 0) {
        console.error(`MISSING ${p}`);
        missing++;
      }
    }
  }
  console.log(missing ? `${missing} texture(s) missing` : `all ${DAMAGE_TYPE_IDS.length * 3} textures present`);
  process.exit(missing ? 1 : 0);
}

mkdirSync(OUT_DIR, { recursive: true });

let total = 0;
let mismatches = 0;
for (const id of ids) {
  const { albedo, bump, emissive, emissiveMean } = bake(id);
  writeFileSync(join(OUT_DIR, `${id}.png`), albedo);
  writeFileSync(join(OUT_DIR, `${id}-bump.png`), bump);
  writeFileSync(join(OUT_DIR, `${id}-emissive.png`), emissive);
  // The table and the maps have to agree: a type that declares a glow but
  // bakes a black emission map registers a whole dice system to render nothing,
  // and a type that bakes light it never declares simply never shows it.
  const declared = DAMAGE_TYPES[id].emissive > 0;
  const baked = emissiveMean > 0.001;
  if (declared !== baked) {
    console.error(
      `  ! ${id}: damage-types.mjs declares emissive=${DAMAGE_TYPES[id].emissive}, ` +
      `but the baked map is ${baked ? "lit" : "black"} — fix one of the two`
    );
    mismatches++;
  }
  const kb = (albedo.length + bump.length + emissive.length) / 1024;
  total += kb;
  console.log(
    `${id.padEnd(12)} ${kb.toFixed(0).padStart(4)} KB` +
    `  (albedo ${(albedo.length / 1024).toFixed(0)}, bump ${(bump.length / 1024).toFixed(0)}, ` +
    `emissive ${(emissive.length / 1024).toFixed(0)}, glow ${(emissiveMean * 100).toFixed(1)}%)`
  );
}
console.log(`\n${ids.length} damage type(s), ${(total / 1024).toFixed(2)} MB → ${OUT_DIR}`);
if (mismatches) process.exit(1);
