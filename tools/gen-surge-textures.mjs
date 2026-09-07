#!/usr/bin/env node
/**
 * GLUniverse Suite — bake the Arcane Surge dice surfaces.
 *
 *   node tools/gen-surge-textures.mjs              # write the set
 *   node tools/gen-surge-textures.mjs --check      # verify the set is complete
 *   node tools/gen-surge-textures.mjs --sheet=/tmp/surge.png   # contact sheet
 *
 * Two different kinds of die need two different kinds of art, and conflating
 * them is why the first pass looked wrong on the severity roll:
 *
 *   FACE ART — `blank` and `surge`. Whole-face images handed to Dice So Nice as
 *   `labels`, one per face of the surge d20. The die is read by its GLYPH, not
 *   by a number, so the face IS the art.
 *
 *   SURFACE ART — `surface`. A tiling material handed to DSN as a `texture`,
 *   under numerals it draws itself. The severity d100 (and the d10s DSN builds
 *   it from) are ordinary numbered shapes; they need a frosted surface to sit
 *   under the numbers, not twenty pictures.
 *
 * Three maps each:
 *
 *   <id>.png           albedo   — multiplied over the colorset background, so it
 *                                 is authored as a near-neutral luminance map.
 *                                 Frosted glass is BRIGHT and low-contrast; the
 *                                 depth comes from the bump, not from painting
 *                                 shadows into the colour.
 *   <id>-bump.png      height   — greyscale, white proud, black sunken. DSN runs
 *                                 a Sobel pass over this to build its normal map,
 *                                 so contrast here IS relief depth. Every groove
 *                                 in this die lives in this map and nowhere else.
 *   <id>-emissive.png  emission — drawn on black, handed to THREE as an
 *                                 emissiveMap. Only the surge glyph emits; a
 *                                 blank face is nothing happening.
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
const FACES = ["blank", "surge", "surface"];
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

/** Wrapped value noise, so a tiling surface never shows a seam. */
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
 * Frosted glass, as a height field.
 *
 * Two scales on purpose: a fine grain that catches the light as the die tumbles,
 * and a much broader swell that reads as the thickness of the glass rather than
 * as dirt on it. Frost is a SURFACE property — it belongs almost entirely in the
 * bump map, which is why the albedo stays bright and nearly flat.
 */
function frost(x, y, seed) {
  const fine = fbm(x * 26, y * 26, 26, 2, seed);
  const swell = fbm(x * 5, y * 5, 5, 2, seed + 11);
  return clamp01(0.55 + (fine - 0.5) * 0.55 + (swell - 0.5) * 0.45);
}

/**
 * The bevelled grooves around the glyph — CONCENTRIC RINGS, not a border.
 *
 * A d20's faces are triangles. Dice So Nice maps this square image onto a
 * triangular face, so anything drawn near the square's edge is clipped, and the
 * corners are never seen at all: a rectangular border groove would come out as
 * four disconnected stubs. Rings are the shape that survives being mapped onto
 * any face polygon, and they suit a whirlpool besides — the glyph looks like it
 * is turning inside them.
 *
 * Everything therefore stays inside GLYPH_SAFE, comfortably within the triangle
 * inscribed in this square.
 *
 * Cut deliberately deep and narrow: on a tumbling die a shallow wide channel
 * reads as a smudge, and it is the hard shoulder either side of a narrow one
 * that actually catches a highlight.
 */
const GLYPH_SAFE = 0.62;

function groove(x, y) {
  const dx = (x - 0.5) * 2;
  const dy = (y - 0.5) * 2;
  const r = Math.hypot(dx, dy);
  const ring = (at, halfWidth) =>
    (1 - smoothstep(halfWidth * 0.55, halfWidth, Math.abs(r - at)));
  // A firm outer ring that frames the glyph, and a finer inner one just off it.
  return clamp01(ring(GLYPH_SAFE, 0.030) + ring(GLYPH_SAFE - 0.075, 0.014) * 0.55);
}

/**
 * The surge glyph: a whirlpool.
 *
 * Built in polar space so it is centred by construction — the previous version
 * offset its arms by an angle that pushed the visual mass off-centre, which is
 * exactly the kind of thing that only shows up on a die that rotates.
 *
 * Four logarithmic-spiral arms drawn as a signed distance to the spiral curve,
 * so the edges are sharp at any resolution rather than being a soft blob with a
 * threshold. The arms taper into a clean eye at the middle and fade before they
 * reach the groove.
 */
function glyph(x, y) {
  const dx = (x - 0.5) * 2;
  const dy = (y - 0.5) * 2;
  /* Scaled into the safe radius, INSIDE the inner groove. A d20 face is a
     triangle; art drawn out toward the square's edge is simply not on the die. */
  const scale = 1 / (GLYPH_SAFE - 0.11);
  const r = Math.hypot(dx, dy) * scale;
  if (r > 0.86) return 0;

  const a = Math.atan2(dy, dx);
  const ARMS = 4;
  const TIGHTNESS = 2.35;

  /* Distance to the nearest arm of a log spiral: the phase of a spiral through
     this point is (angle - tightness*log(r)); its fractional distance to the
     nearest arm is the glyph's body. */
  const phase = (a - Math.log(Math.max(r, 0.02)) * TIGHTNESS) * (ARMS / (Math.PI * 2));
  let d = Math.abs(phase - Math.round(phase)) / (ARMS / (Math.PI * 2));
  // Convert the angular distance into a roughly uniform width in real space, so
  // the arms do not fatten toward the rim.
  d *= Math.max(r, 0.08);

  /* Arms taper: widest in the middle band, closing to nothing at both ends.
     The width is set for the size this is actually SEEN at — one face of a
     tumbling d20, a couple of hundred pixels at most. A hairline that looks
     elegant in the contact sheet disappears entirely there. */
  const taper = smoothstep(0.05, 0.26, r) * (1 - smoothstep(0.58, 0.84, r));
  const width = 0.082 * taper;
  const arm = width <= 0 ? 0 : 1 - smoothstep(width * 0.55, width, d);

  // The eye: a solid centre the arms spin out of, with a small void inside it so
  // it reads as a vortex rather than a dot.
  const eye = (1 - smoothstep(0.055, 0.105, r)) * smoothstep(0.012, 0.042, r);

  return clamp01(Math.max(arm * taper, eye));
}

/* ══════════════════════════════════════════════════════════════════════
   Bake
   ══════════════════════════════════════════════════════════════════════ */

function bakeFace(face) {
  const albedo = Buffer.alloc(SIZE * SIZE * 3);
  const bump = Buffer.alloc(SIZE * SIZE);
  const emissive = Buffer.alloc(SIZE * SIZE * 3);
  const seed = face === "surge" ? 77 : face === "surface" ? 41 : 13;
  const isSurface = face === "surface";

  for (let py = 0; py < SIZE; py++) {
    const y = (py + 0.5) / SIZE;
    for (let px = 0; px < SIZE; px++) {
      const x = (px + 0.5) / SIZE;
      const i = py * SIZE + px;

      const ice = frost(x, y, seed);
      // The surface material tiles under numerals, so it carries no groove and
      // no glyph — an edge channel would repeat across every face of a d10.
      const g = isSurface ? 0 : groove(x, y);
      const mark = face === "surge" ? glyph(x, y) : 0;

      /* Albedo — frosted glass is bright and nearly flat. Multiplied over the
         colorset background, so mean luminance stays high or the die goes
         muddy; all the character is in the bump. */
      let value = 0.86 + (ice - 0.55) * 0.14;
      value -= g * 0.10;
      value -= mark * 0.16;
      const lum = clamp01(value);
      // A whisper of teal in the cuts so the etch is not flat grey.
      albedo[i * 3] = Math.round(clamp01(lum - (g + mark) * 0.045) * 255);
      albedo[i * 3 + 1] = Math.round(lum * 255);
      albedo[i * 3 + 2] = Math.round(clamp01(lum + (g + mark) * 0.035) * 255);

      /* Bump — everything that should catch light. Frost grain, the groove, and
         the glyph, all cut INTO the face. */
      let height = 0.60 + (ice - 0.55) * 0.34;
      height -= g * 0.52;
      height -= mark * 0.62;
      bump[i] = Math.round(clamp01(height) * 255);

      /* Emission — the glyph only, and hottest at its core, so the surge face
         looks lit from inside its own wound. */
      const glow = face === "surge" ? Math.pow(mark, 1.35) : 0;
      emissive[i * 3] = Math.round(clamp01(glow * 0.34) * 255);
      emissive[i * 3 + 1] = Math.round(clamp01(glow * 0.94) * 255);
      emissive[i * 3 + 2] = Math.round(clamp01(glow * 0.88) * 255);
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
  // faces is one of the two face designs above. A level demanding more than 20
  // would silently render a die with fewer glyphs than its own odds.
  const config = resolveConfig();
  for (const level of rollingLevels(config)) {
    const needed = glyphFaces(level, config);
    if (needed < 1 || needed > 20) problems.push(`level "${level}" needs ${needed} glyph faces, which a d20 cannot carry`);
  }
  for (const level of LEVELS) {
    if (level === "stable" && glyphFaces(level, config) !== 0) problems.push("Stable must have no glyph faces");
  }

  // The glyph has to be centred, or it wobbles as the die turns. Measured, not
  // asserted: the centre of mass of the drawn mark must sit on the face centre.
  const centre = glyphCentroid();
  if (centre.mass <= 0) problems.push("the surge glyph is empty");
  else {
    const off = Math.hypot(centre.x - 0.5, centre.y - 0.5);
    if (off > 0.01) problems.push(`the surge glyph is off-centre by ${(off * 100).toFixed(1)}% of the face`);
  }

  if (problems.length) {
    console.error(`gen-surge-textures --check: ${problems.length} problem(s)`);
    for (const line of problems) console.error(`  • ${line}`);
    process.exitCode = 1;
  } else {
    const summary = rollingLevels(config).map((l) => `${l}:${glyphFaces(l, config)}`).join(" ");
    console.log(`gen-surge-textures --check: complete (${summary}, glyph centred to ${(Math.hypot(centre.x - 0.5, centre.y - 0.5) * 1000).toFixed(2)}‰)`);
  }
}

/** Centre of mass of the glyph, in face coordinates. */
function glyphCentroid() {
  let mass = 0;
  let sx = 0;
  let sy = 0;
  for (let py = 0; py < SIZE; py++) {
    const y = (py + 0.5) / SIZE;
    for (let px = 0; px < SIZE; px++) {
      const x = (px + 0.5) / SIZE;
      const v = glyph(x, y);
      mass += v;
      sx += v * x;
      sy += v * y;
    }
  }
  return mass > 0 ? { x: sx / mass, y: sy / mass, mass } : { x: 0.5, y: 0.5, mass: 0 };
}

/** Side-by-side of every map, so a recipe change can be reviewed without Foundry. */
function contactSheet(target) {
  const cell = 160;
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
  console.log(`gen-surge-textures: wrote ${written} maps for ${FACES.length} surfaces into assets/pf2e-arcane-surge/dice/`);
}
