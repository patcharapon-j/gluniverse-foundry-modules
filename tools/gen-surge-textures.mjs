#!/usr/bin/env node
/**
 * GLUniverse Suite — bake the Arcane Surge die faces.
 *
 *   node tools/gen-surge-textures.mjs              # write the set
 *   node tools/gen-surge-textures.mjs --check      # verify the set is complete
 *   node tools/gen-surge-textures.mjs --sheet=/tmp/surge.png   # contact sheet
 *
 * Two faces, three maps each, into `assets/pf2e-arcane-surge/dice/`:
 *
 *   blank.png / surge.png            albedo   — multiplied over the colorset
 *                                              background, so it is a near
 *                                              neutral luminance map, not a
 *                                              colour.
 *   *-bump.png                       height   — greyscale, white proud, black
 *                                              sunken. Dice So Nice runs a
 *                                              Sobel pass over this to build a
 *                                              normal map, so contrast here IS
 *                                              relief depth. The groove around
 *                                              every face lives here.
 *   *-emissive.png                   emission — drawn on black and handed to
 *                                              THREE as an emissiveMap. The
 *                                              blank face's is deliberately
 *                                              almost entirely black: a blank
 *                                              face is nothing happening.
 *
 * The die's odds are not baked in: the FACE LAYOUT (how many faces carry the
 * glyph) is derived at runtime from each level's threshold. This tool only
 * produces the two face designs and asserts that every rolling level's demand
 * can be met by them — the cross-check that the layout matches the threshold is
 * `tools/arcane-surge-check.mjs`.
 *
 * There is no image library on the dev box and the repo has no package.json, so
 * this carries its own PNG encoder over `node:zlib`. Output is deterministic —
 * reruns produce byte-identical files.
 */

import { deflateSync } from "node:zlib";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { LEVELS } from "../scripts/features/pf2e-arcane-surge/constants.mjs";
import { glyphFaces, resolveConfig, rollingLevels } from "../scripts/features/pf2e-arcane-surge/levels.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(ROOT, "assets", "pf2e-arcane-surge", "dice");
const SIZE = 256;
const FACES = ["blank", "surge"];
const MAPS = ["", "-bump", "-emissive"];

/* ══════════════════════════════════════════════════════════════════════
   PNG encoder
   ══════════════════════════════════════════════════════════════════════ */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = -1;
  for (let i = 0; i < buffer.length; i++) c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

/** Per-scanline "up" filter — cheap, and these images are vertically smooth. */
function filterScanlines(raw, width, height, channels) {
  const stride = width * channels;
  const out = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    out[y * (stride + 1)] = 2;
    for (let x = 0; x < stride; x++) {
      const here = raw[y * stride + x];
      const above = y === 0 ? 0 : raw[(y - 1) * stride + x];
      out[y * (stride + 1) + 1 + x] = (here - above) & 0xff;
    }
  }
  return out;
}

function encodePNG(raw, width, height, channels) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = channels === 3 ? 2 : 0;
  const idat = deflateSync(filterScanlines(raw, width, height, channels), { level: 9 });
  return Buffer.concat([
    signature,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/* ══════════════════════════════════════════════════════════════════════
   Field helpers
   ══════════════════════════════════════════════════════════════════════ */

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (t) => t * t * (3 - 2 * t);
const smoothstep = (a, b, x) => (a === b ? (x < a ? 0 : 1) : smooth(clamp01((x - a) / (b - a))));
const mix = (a, b, t) => a + (b - a) * t;

/** Wrapped value noise, so a face never shows a tile seam. */
function hash2(ix, iy, seed) {
  let h = ix * 374761393 + iy * 668265263 + seed * 2246822519;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function vnoise(x, y, period, seed) {
  const wrap = (n) => ((n % period) + period) % period;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = smooth(x - x0);
  const fy = smooth(y - y0);
  const a = hash2(wrap(x0), wrap(y0), seed);
  const b = hash2(wrap(x0 + 1), wrap(y0), seed);
  const c = hash2(wrap(x0), wrap(y0 + 1), seed);
  const d = hash2(wrap(x0 + 1), wrap(y0 + 1), seed);
  return mix(mix(a, b, fx), mix(c, d, fx), fy);
}

const fbm = (x, y, period, octaves, seed) => {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  for (let i = 0; i < octaves; i++) {
    sum += amp * vnoise(x * freq, y * freq, period * freq, seed + i);
    freq *= 2;
    amp *= 0.5;
  }
  return sum;
};

/**
 * The groove: a channel cut just inside the face's edge.
 *
 * This is the "groove" the die is asked for, and it is a BUMP feature, not a
 * painted line — carving it into the height map is what makes it catch the
 * light as the die tumbles instead of looking like a sticker.
 */
function groove(x, y) {
  // Distance to the nearest edge of the unit square.
  const edge = Math.min(x, y, 1 - x, 1 - y);
  const channel = smoothstep(0.055, 0.085, edge) * (1 - smoothstep(0.105, 0.135, edge));
  return channel;
}

/**
 * The surge glyph: a six-armed rift, thin and sharp.
 *
 * Deliberately not a rune or a letter — it has to read at the size of a die face
 * tumbling past, which means one silhouette and no interior detail.
 */
function glyph(x, y) {
  const dx = (x - 0.5) * 2;
  const dy = (y - 0.5) * 2;
  const r = Math.hypot(dx, dy);
  const a = Math.atan2(dy, dx);

  // Six arms whose length pulses with angle, tapering to nothing at the tips.
  const arms = Math.abs(Math.cos(a * 3));
  const reach = mix(0.24, 0.62, Math.pow(arms, 2.4));
  const body = 1 - smoothstep(reach * 0.72, reach, r);

  // A hairline crack running through the middle of each arm keeps it reading as
  // a tear rather than as a star.
  const seam = 1 - smoothstep(0.0, 0.045, Math.abs(Math.sin(a * 3)) * r);

  const core = 1 - smoothstep(0.0, 0.14, r);
  return clamp01(Math.max(body * 0.85, core) - seam * 0.35 * smoothstep(0.14, 0.5, r));
}

/* ══════════════════════════════════════════════════════════════════════
   Bake
   ══════════════════════════════════════════════════════════════════════ */

function bakeFace(face) {
  const albedo = Buffer.alloc(SIZE * SIZE * 3);
  const bump = Buffer.alloc(SIZE * SIZE);
  const emissive = Buffer.alloc(SIZE * SIZE * 3);
  const seed = face === "surge" ? 77 : 13;

  for (let py = 0; py < SIZE; py++) {
    const y = (py + 0.5) / SIZE;
    for (let px = 0; px < SIZE; px++) {
      const x = (px + 0.5) / SIZE;
      const i = py * SIZE + px;

      // A quiet mineral grain over the whole face. Stylised, not photoreal:
      // low amplitude, two octaves, no pores or speckle.
      const grain = fbm(x * 6, y * 6, 6, 2, seed);
      const g = groove(x, y);
      const mark = face === "surge" ? glyph(x, y) : 0;

      /* Albedo — multiplied over the colorset, so it stays near-neutral and
         bright. Mean around 0.75 keeps the die from going muddy. */
      let value = 0.78 + (grain - 0.5) * 0.10;
      value -= g * 0.22;             // the groove reads darker
      value -= mark * 0.30;          // the glyph is cut into the face
      const lum = clamp01(value);
      // A faint teal push in the cut areas so the etch is not pure grey.
      albedo[i * 3] = Math.round(clamp01(lum - (g + mark) * 0.05) * 255);
      albedo[i * 3 + 1] = Math.round(lum * 255);
      albedo[i * 3 + 2] = Math.round(clamp01(lum + (g + mark) * 0.04) * 255);

      /* Bump — the relief. White proud, black sunken. Both the groove and the
         glyph are CUT, so both go dark. */
      let height = 0.62 + (grain - 0.5) * 0.16;
      height -= g * 0.42;
      height -= mark * 0.5;
      bump[i] = Math.round(clamp01(height) * 255);

      /* Emission — the glyph only, and only inside the cut, so the surge face
         looks lit from within its own wound. The blank face emits nothing. */
      const glow = face === "surge" ? Math.pow(mark, 1.5) : 0;
      emissive[i * 3] = Math.round(clamp01(glow * 0.36) * 255);
      emissive[i * 3 + 1] = Math.round(clamp01(glow * 0.92) * 255);
      emissive[i * 3 + 2] = Math.round(clamp01(glow * 0.86) * 255);
    }
  }

  return { albedo, bump, emissive };
}

function write(face) {
  const { albedo, bump, emissive } = bakeFace(face);
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(join(OUT_DIR, `${face}.png`), encodePNG(albedo, SIZE, SIZE, 3));
  writeFileSync(join(OUT_DIR, `${face}-bump.png`), encodePNG(bump, SIZE, SIZE, 1));
  writeFileSync(join(OUT_DIR, `${face}-emissive.png`), encodePNG(emissive, SIZE, SIZE, 3));
  return 3;
}

/* ══════════════════════════════════════════════════════════════════════
   Modes
   ══════════════════════════════════════════════════════════════════════ */

function check() {
  const problems = [];
  for (const face of FACES) {
    for (const map of MAPS) {
      const file = join(OUT_DIR, `${face}${map}.png`);
      if (!existsSync(file)) problems.push(`missing ${face}${map}.png`);
    }
  }

  // Every level that rolls needs between 1 and 20 glyph faces, and each of those
  // faces is one of the two designs above. A level demanding more than 20 would
  // silently render a die with fewer glyphs than its odds.
  const config = resolveConfig();
  for (const level of rollingLevels(config)) {
    const needed = glyphFaces(level, config);
    if (needed < 1 || needed > 20) problems.push(`level "${level}" needs ${needed} glyph faces, which a d20 cannot carry`);
  }
  for (const level of LEVELS) {
    if (level === "stable" && glyphFaces(level, config) !== 0) problems.push("Stable must have no glyph faces");
  }

  if (problems.length) {
    console.error(`gen-surge-textures --check: ${problems.length} problem(s)`);
    for (const line of problems) console.error(`  • ${line}`);
    process.exitCode = 1;
  } else {
    const summary = rollingLevels(config).map((l) => `${l}:${glyphFaces(l, config)}`).join(" ");
    console.log(`gen-surge-textures --check: complete (${summary})`);
  }
}

/** Side-by-side of every map, so a recipe change can be reviewed without Foundry. */
function contactSheet(target) {
  const cell = 128;
  const cols = MAPS.length;
  const rows = FACES.length;
  const w = cell * cols;
  const h = cell * rows;
  const out = Buffer.alloc(w * h * 3);

  FACES.forEach((face, row) => {
    const maps = bakeFace(face);
    const sources = [
      { data: maps.albedo, channels: 3 },
      { data: maps.bump, channels: 1 },
      { data: maps.emissive, channels: 3 },
    ];
    sources.forEach((source, col) => {
      for (let py = 0; py < cell; py++) {
        for (let px = 0; px < cell; px++) {
          const sx = Math.floor((px / cell) * SIZE);
          const sy = Math.floor((py / cell) * SIZE);
          const si = (sy * SIZE + sx) * source.channels;
          const di = ((row * cell + py) * w + col * cell + px) * 3;
          if (source.channels === 1) {
            out[di] = out[di + 1] = out[di + 2] = source.data[sy * SIZE + sx];
          } else {
            out[di] = source.data[si];
            out[di + 1] = source.data[si + 1];
            out[di + 2] = source.data[si + 2];
          }
        }
      }
    });
  });

  writeFileSync(target, encodePNG(out, w, h, 3));
  console.log(`gen-surge-textures: wrote contact sheet ${target} (${w}×${h})`);
}

const args = process.argv.slice(2);
const sheet = args.find((a) => a.startsWith("--sheet="));

if (args.includes("--check")) {
  check();
} else if (sheet) {
  contactSheet(sheet.slice("--sheet=".length));
} else {
  let written = 0;
  for (const face of FACES) written += write(face);
  console.log(`gen-surge-textures: wrote ${written} maps for ${FACES.length} faces into assets/pf2e-arcane-surge/dice/`);
}
