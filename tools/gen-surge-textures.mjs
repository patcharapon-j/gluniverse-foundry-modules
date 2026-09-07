#!/usr/bin/env node
/**
 * GLUniverse Suite — bake the Arcane Surge dice surfaces.
 *
 *   node tools/gen-surge-textures.mjs              # write the set
 *   node tools/gen-surge-textures.mjs --check      # verify the set is complete
 *   node tools/gen-surge-textures.mjs --sheet=/tmp/surge.png   # contact sheet
 *
 * THERE IS NO PAINTED COLOUR ON THESE DICE. Every face carries relief and light
 * and nothing else, so what you see is Dice So Nice's own frosted-glass material
 * being cut and lit rather than a picture of glass laid over it. That is a
 * deliberate constraint, and it shapes everything below.
 *
 *   <id>-bump.png      height   — greyscale, white proud, black sunken. DSN runs
 *                                 a Sobel pass over this to build its normal map,
 *                                 so contrast here IS relief depth. With the
 *                                 albedo gone this map carries the entire form:
 *                                 the frost grain, the rings, the whirlpool.
 *   <id>-emissive.png  emission — drawn on black, handed to THREE as an
 *                                 emissiveMap. Only the surge glyph emits; a
 *                                 blank face is nothing happening. This is what
 *                                 makes a surge face readable across a table
 *                                 now that no ink distinguishes it.
 *
 * Two files exist purely as CARRIERS, and both are load-bearing in ways that
 * look like mistakes:
 *
 *   clear.png    A fully transparent RGBA image, used as the `labels` entry for
 *                all twenty faces of the surge d20. Dice So Nice draws a face's
 *                `bumpMaps` and `emissiveMaps` ONLY inside the branch it takes
 *                when the label is an image — a text label (including "") goes
 *                down a different path that writes glyphs into all three canvases
 *                and never touches those maps at all. So an image label is the
 *                price of having per-face relief, and a transparent one is how
 *                you pay it without painting anything.
 *
 *   surface.png  Pure white, used as the colorset `texture`'s albedo with
 *                `composite: "multiply"` — which makes it the identity, leaving
 *                the material's own colour untouched. DSN only draws a texture's
 *                `bump` inside the same block that draws its source, so a
 *                bump-only texture has to be a white texture.
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
import { glyphFloats } from "../scripts/features/pf2e-arcane-surge/palette.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(ROOT, "assets", "pf2e-arcane-surge", "dice");
const SIZE = 256;

/* The surge glyph's hue, from the suite palette by way of DIE_KEYS — never
   written out here. See the emission block in bakeFace() for why that matters. */
const GLYPH_RGB = glyphFloats();

/**
 * Exactly what ships, in the order the contact sheet prints it.
 *
 * A flat list rather than a faces × maps grid, because the set is no longer a
 * grid: the face art has no albedo, the tiling surface has no emission, and one
 * file belongs to neither. A cross product would have written three files that
 * nothing loads and asserted the presence of three more.
 */
const SURFACES = Object.freeze([
  { file: "clear", kind: "clear" },
  { file: "blank-bump", kind: "bump", face: "blank" },
  { file: "blank-emissive", kind: "emissive", face: "blank" },
  { file: "surge-bump", kind: "bump", face: "surge" },
  { file: "surge-emissive", kind: "emissive", face: "surge" },
  { file: "surface", kind: "albedo", face: "surface" },
  { file: "surface-bump", kind: "bump", face: "surface" },
]);

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
  // 0 grey, 2 truecolour, 6 truecolour + alpha. The last one exists for the
  // transparent label carrier and nothing else.
  ihdr[9] = channels === 4 ? 6 : channels === 3 ? 2 : 0;
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

/* ══════════════════════════════════════════════════════════════════════
   Where the face actually is inside this square
   ══════════════════════════════════════════════════════════════════════ */

/**
 * A D20 FACE IS NOT CENTRED IN ITS TEXTURE TILE, and every field below is drawn
 * around where it really is.
 *
 * Dice So Nice lays its faces out as 256px tiles in one atlas and draws a label
 * image across a whole tile, 1:1 — so this square IS a tile. But the geometry
 * sampling it is a triangle, and the triangle is not concentric with the square.
 * Read off the `uv` attribute of DSN's own d20 model (`DICE_MODELS.d20` in
 * `engine/DiceModels.js`), all twenty faces land in their tile identically:
 *
 *     apex     (0.5006, 0.0010)           apex UP — the label texture is bound
 *     base     y = 0.8635, x 0.003→0.999  with `flipY = false`, so v runs DOWN
 *     centroid (0.5006, 0.5760)           the canvas the same way y does
 *
 * Two numbers fall out of that, and the first pass here had both wrong:
 *
 *   THE CENTRE OF THE FACE IS AT y = 0.576, NOT 0.5. A triangle's centroid sits
 *   a third of its height up from the base, so art centred on the SQUARE is
 *   struck an eighth of a tile toward the apex — off-centre on a die that turns,
 *   and lopsidedly clipped besides.
 *
 *   THE LARGEST CIRCLE THAT FITS IS THE INCIRCLE, r = 0.2875 of the tile, which
 *   is 0.575 in the ±1 coordinates below. Anything wider runs off two of the
 *   three edges — and the rings were struck at 0.62 about the SQUARE's centre,
 *   so every one of them did, on every face of the die.
 *
 * None of this shows in the contact sheet, which prints squares. It is measured
 * in `--check` instead.
 */
const FACE_CX = 0.5;
const FACE_CY = 0.576;
/** The face's three corners, in tile coordinates. */
const FACE_TRIANGLE = Object.freeze([[0.0026, 0.8635], [0.9985, 0.8635], [0.5006, 0.0010]]);
/** Radius of the inscribed circle, in face units (1.0 = half a tile). */
const FACE_INRADIUS = 0.575;

/** Face-centred coordinates: ±1 across a tile, origin on the triangle's centre. */
function facePoint(x, y) {
  return [(x - FACE_CX) * 2, (y - FACE_CY) * 2];
}

/** Signed distance from (x, y) to the line pq, positive on `opposite`'s side. */
function edgeDistance(x, y, p, q, opposite) {
  const nx = q[1] - p[1];
  const ny = p[0] - q[0];
  const len = Math.hypot(nx, ny) || 1;
  const here = ((x - p[0]) * nx + (y - p[1]) * ny) / len;
  const there = ((opposite[0] - p[0]) * nx + (opposite[1] - p[1]) * ny) / len;
  return there >= 0 ? here : -here;
}

/** Whether a tile coordinate is on the die at all, with `inset` to spare. */
function insideFace(x, y, inset = 0) {
  const [a, b, c] = FACE_TRIANGLE;
  return edgeDistance(x, y, a, b, c) >= inset
    && edgeDistance(x, y, b, c, a) >= inset
    && edgeDistance(x, y, c, a, b) >= inset;
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
 * Everything therefore stays inside GLYPH_SAFE, which sits below the face's
 * INCIRCLE — the largest circle the triangle admits — with the outer ring's own
 * half-width to spare. See FACE_INRADIUS above; the previous value was outside
 * it, about the wrong centre, and every ring on the die was clipped by two of
 * its own edges.
 *
 * Cut deliberately deep and narrow: on a tumbling die a shallow wide channel
 * reads as a smudge, and it is the hard shoulder either side of a narrow one
 * that actually catches a highlight.
 */
const GLYPH_SAFE = 0.5;

function groove(x, y) {
  const [dx, dy] = facePoint(x, y);
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
  const [dx, dy] = facePoint(x, y);
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
   The transmission band
   ══════════════════════════════════════════════════════════════════════ */

/**
 * THE BUMP MAP IS ALSO THE TRANSMISSION MASK, and that governs every level
 * chosen below.
 *
 * For `glass` — and for `frosted` and `resin`, the other two transmissive
 * materials — Dice So Nice binds the very same bump canvas a second time as the
 * material's `transmissionMap` (`usesTransmissionMask` in `DiceFactory`), then
 * reads it through one line of its own patched shader chunk:
 *
 *     material.transmission *= smoothstep(0.6, 0.9, texture(transmissionMap).r)
 *
 * So this map does not only say how deep the surface is. It says what is glass
 * and what is solid, on a hard curve with nothing in the middle:
 *
 *     ≥ 0.9 (230)  fully transmissive — the body of the die
 *     ≤ 0.6 (153)  fully opaque — the figure you are meant to read
 *
 * DSN's own numerals are drawn at `#555555` on a `#FFFFFF` field, which is that
 * contract stated in the module's source. Ours has to agree with it.
 *
 * THESE DICE ONCE SHIPPED WITH A FIELD AT 141. That is a legible height map and
 * a perfectly ordinary-looking contact sheet, and it put 94% of every face
 * below the bottom of the curve — so `transmission` was zero everywhere, the
 * glass was not glass, and what the table got was an opaque near-black solid
 * with no albedo on it. Nothing errored. Only the two numbers below stand
 * between that and a die, so `--check` measures them rather than trusting them.
 */
const GLASS_TOP = 0.9;
const SOLID_FLOOR = 0.6;

/** Where the frost field sits: inside the glass band, with room to grain. */
const FIELD = 0.975;

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

      /* Albedo — PURE WHITE, and only for the tiling surface. It is composited
         with `multiply`, so white is the identity: the die keeps the colorset's
         own glass rather than wearing a picture of glass. It exists at all
         because DSN draws a texture's bump only inside the block that draws its
         source, so a bump with no source is a bump that never arrives. */
      albedo[i * 3] = 255;
      albedo[i * 3 + 1] = 255;
      albedo[i * 3 + 2] = 255;

      /* Bump — the whole form, AND the transmission mask. See the band above.
         The field rides high so the body of the die is glass; the frost grains
         it without ever leaving the band. The cuts go the whole way through the
         curve in one step, because a groove that stops halfway is not a
         shallower groove — it is a smear of partial transmission, which is the
         one thing this material renders badly.

         The glyph is cut deeper than the rings that frame it, so on a face that
         has both, the whirlpool is the figure and the rings are the setting. */
      let height = FIELD + (ice - 0.425) * 0.14;
      height -= g * 0.50;
      height -= mark * 0.72;
      bump[i] = Math.round(clamp01(height) * 255);

      /* Emission — the glyph only, and hottest at its core, so the surge face
         looks lit from inside its own wound. This is the ONLY thing that
         separates a surge face from a blank one at a glance, which is why it
         reaches full brightness rather than sitting at the tint it did when the
         albedo was also darkening the mark.

         THE HUE IS NOT WRITTEN HERE. It comes from DIE_KEYS.glyph, the same
         statement that gives the colorset in `dsn.mjs` the body this burns
         inside. Written out separately, the two drifted onto the same colour
         immediately — the die was the suite's teal and so was the whirlpool,
         and each half looked perfectly correct in its own file while the die
         answered nothing. The check tool measures the angle between them.

         Toward the eye it blows to white, so the mark has a value range of its
         own rather than being one flat wash: across a table the centre is what
         you catch first and the arms are what tell you what it was. */
      const rc = Math.hypot(...facePoint(x, y));
      const heat = 1 - smoothstep(0.05, 0.32, rc);
      const glow = face === "surge" ? Math.pow(mark, 1.15) : 0;
      for (let c = 0; c < 3; c++) {
        emissive[i * 3 + c] = Math.round(clamp01(mix(GLYPH_RGB[c], 1, heat * 0.8) * glow) * 255);
      }
    }
  }

  return { albedo, bump, emissive };
}

/** The transparent label carrier. See the header: it buys the per-face maps. */
function bakeClear() {
  return Buffer.alloc(SIZE * SIZE * 4);
}

/** One shipped file's pixels, and how many channels they carry. */
function bakeSurface(surface) {
  if (surface.kind === "clear") return { data: bakeClear(), channels: 4 };
  const maps = bakeFace(surface.face);
  if (surface.kind === "bump") return { data: maps.bump, channels: 1 };
  if (surface.kind === "emissive") return { data: maps.emissive, channels: 3 };
  return { data: maps.albedo, channels: 3 };
}

function write() {
  mkdirSync(OUT_DIR, { recursive: true });
  for (const surface of SURFACES) {
    const { data, channels } = bakeSurface(surface);
    writeFileSync(join(OUT_DIR, `${surface.file}.png`), encodePNG(data, SIZE, SIZE, channels));
  }
  return SURFACES.length;
}

/* ══════════════════════════════════════════════════════════════════════
   Modes
   ══════════════════════════════════════════════════════════════════════ */

function check() {
  const problems = [];
  for (const surface of SURFACES) {
    if (!existsSync(join(OUT_DIR, `${surface.file}.png`))) problems.push(`missing ${surface.file}.png`);
  }

  /* The two carriers are the parts of this set most likely to be "fixed" into
     uselessness by somebody who reads them as placeholders, so they are
     measured rather than trusted: an opaque clear.png would paint a grey square
     over every face, and a non-white surface.png would tint the glass it exists
     to leave alone. Both failures render perfectly. */
  const clear = bakeClear();
  if (clear.some((byte) => byte !== 0)) problems.push("clear.png is not fully transparent — it would paint over every die face");

  const white = bakeSurface({ kind: "albedo", face: "surface" }).data;
  if (white.some((byte) => byte !== 255)) {
    problems.push("surface.png is not pure white — under multiply it would tint the glass instead of leaving it alone");
  }

  /* The glyph now lives entirely in relief and light. If either map stopped
     distinguishing a surge face from a blank one, the die would roll correct
     odds and show the player nothing. */
  const blank = bakeFace("blank");
  const surge = bakeFace("surge");
  if (Buffer.compare(blank.bump, surge.bump) === 0) problems.push("the surge and blank bump maps are identical — the glyph has no relief");
  if (!surge.emissive.some((byte) => byte > 0)) problems.push("the surge emissive map is black — nothing marks a surge face");
  if (blank.emissive.some((byte) => byte > 0)) problems.push("the blank emissive map glows — every face would read as a surge");

  /* And the band. Every bump here is also a transmission mask, so these are the
     numbers that decide whether the die is made of glass — see the block above
     `bakeFace`. They are measured because the failure is silent and total: the
     set once shipped with its field at 141/255 and the dice came out opaque.
     `--sheet` would not have shown it and neither would a diff. */
  const glass = Math.round(GLASS_TOP * 255);
  const solid = Math.round(SOLID_FLOOR * 255);
  const surface = bakeFace("surface");

  for (const [name, maps] of [["blank", blank], ["surge", surge], ["surface", surface]]) {
    const sorted = Uint8Array.from(maps.bump).sort();
    const median = sorted[sorted.length >> 1];
    if (median < glass) {
      problems.push(
        `${name}-bump.png sits at ${median}/255 across most of the face; below ${glass} Dice So Nice ` +
        `reads it as a transmission mask of zero and the die stops being glass`
      );
    }
  }

  /* The tiling surface is different in kind: it is drawn under EVERY face of
     every die that wears the colorset, including the severity d10s, and DSN
     then draws its own numerals into the same canvas at #555. So the numerals
     are the only thing on it allowed to be solid. A single dark pixel in this
     field is a permanent opaque smear repeated across every face on the table. */
  const surfaceFloor = surface.bump.reduce((lowest, byte) => Math.min(lowest, byte), 255);
  if (surfaceFloor < glass) {
    problems.push(
      `surface-bump.png reaches ${surfaceFloor}/255; it tiles under every face and must stay ` +
      `wholly above ${glass}, leaving the numerals DSN draws at 85 as the only solid marks`
    );
  }

  // And the marks have to clear the bottom of the curve, or they are neither
  // glass nor solid but a band of partial transmission, which reads as fog.
  for (const [name, maps] of [["blank", blank], ["surge", surge]]) {
    const floor = maps.bump.reduce((lowest, byte) => Math.min(lowest, byte), 255);
    if (floor > solid) problems.push(`${name}-bump.png only cuts to ${floor}/255; a mark must reach ${solid} to read as solid`);
  }
  const surgeFloor = surge.bump.reduce((lowest, byte) => Math.min(lowest, byte), 255);
  const blankFloor = blank.bump.reduce((lowest, byte) => Math.min(lowest, byte), 255);
  if (surgeFloor >= blankFloor) problems.push("the glyph is not cut deeper than the rings that frame it");

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

  /* AND EVERY MARK HAS TO BE ON THE DIE. The square this bakes is a texture
     TILE; what samples it is a triangle, and not a concentric one — see
     FACE_TRIANGLE. So art can be perfectly composed here and still be cut by
     the die's own edges, and the contact sheet cannot show you that, because it
     prints squares. It shipped that way: the rings were struck at 0.62 about
     the SQUARE's centre, which is both outside the incircle and 0.076 off the
     face's own centre, so each ring ran off two of its three edges on all
     twenty faces.

     Scanned rather than inferred from the radii, so a mark that is not radially
     symmetric is held to the same rule. */
  const MARK_FLOOR = 0.02;
  for (const face of ["blank", "surge"]) {
    let worst = 0;
    for (let py = 0; py < SIZE; py++) {
      const y = (py + 0.5) / SIZE;
      for (let px = 0; px < SIZE; px++) {
        const x = (px + 0.5) / SIZE;
        const mark = groove(x, y) + (face === "surge" ? glyph(x, y) : 0);
        if (mark <= MARK_FLOOR || insideFace(x, y)) continue;
        worst = Math.max(worst, Math.hypot(...facePoint(x, y)));
      }
    }
    if (worst > 0) {
      problems.push(
        `${face}-bump.png draws out to ${worst.toFixed(3)} of the face, past the triangle ` +
        `the die samples (its incircle is ${FACE_INRADIUS}); that art is clipped by the die's own edges`
      );
    }
  }

  // The glyph has to be centred, or it wobbles as the die turns — and centred on
  // the FACE, which is not the centre of this square. Measured, not asserted:
  // the centre of mass of the drawn mark must sit on the triangle's centroid.
  const centre = glyphCentroid();
  if (centre.mass <= 0) problems.push("the surge glyph is empty");
  else {
    const off = Math.hypot(centre.x - FACE_CX, centre.y - FACE_CY);
    if (off > 0.01) problems.push(`the surge glyph is off-centre by ${(off * 100).toFixed(1)}% of the face`);
  }

  if (problems.length) {
    console.error(`gen-surge-textures --check: ${problems.length} problem(s)`);
    for (const line of problems) console.error(`  • ${line}`);
    process.exitCode = 1;
  } else {
    const summary = rollingLevels(config).map((l) => `${l}:${glyphFaces(l, config)}`).join(" ");
    console.log(`gen-surge-textures --check: complete (${summary}, glyph centred to ${(Math.hypot(centre.x - FACE_CX, centre.y - FACE_CY) * 1000).toFixed(2)}‰)`);
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
  return mass > 0 ? { x: sx / mass, y: sy / mass, mass } : { x: FACE_CX, y: FACE_CY, mass: 0 };
}

/**
 * Every SHIPPED file side by side, so a recipe change can be reviewed without
 * Foundry. It prints the set that actually loads rather than a faces × maps
 * grid, so a file nobody uses cannot look reviewed.
 *
 * Transparency and pure white are both invisible on a white page, so the two
 * carriers are drawn over a checkerboard — which is also the only way to see at
 * a glance that they are what they claim to be.
 */
function contactSheet(target) {
  const cell = 160;
  const cols = 4;
  const rows = Math.ceil(SURFACES.length / cols);
  const w = cell * cols;
  const h = cell * rows;
  const out = Buffer.alloc(w * h * 3);
  const checker = (px, py) => ((px >> 4) + (py >> 4)) % 2 ? 96 : 64;
  // Checker everywhere first, so a cell with no map in it is visibly EMPTY
  // rather than a black square that reads as an eighth, all-black texture.
  for (let py = 0; py < h; py++) for (let px = 0; px < w; px++) {
    const di = (py * w + px) * 3;
    out[di] = out[di + 1] = out[di + 2] = checker(px, py);
  }

  SURFACES.forEach((surface, index) => {
    const { data, channels } = bakeSurface(surface);
    const col = index % cols;
    const row = Math.floor(index / cols);
    for (let py = 0; py < cell; py++) {
      for (let px = 0; px < cell; px++) {
        const sx = Math.floor((px / cell) * SIZE);
        const sy = Math.floor((py / cell) * SIZE);
        const si = (sy * SIZE + sx) * channels;
        const di = ((row * cell + py) * w + col * cell + px) * 3;
        const under = checker(px, py);
        if (channels === 1) {
          out[di] = out[di + 1] = out[di + 2] = data[sy * SIZE + sx];
        } else if (channels === 4) {
          const a = data[si + 3] / 255;
          for (let c = 0; c < 3; c++) out[di + c] = Math.round(mix(under, data[si + c], a));
        } else {
          // Opaque: pure white has to LOOK pure white, or the one file whose
          // whole job is being the multiply identity reads as a grey mistake.
          for (let c = 0; c < 3; c++) out[di + c] = data[si + c];
        }
      }
    }
  });

  writeFileSync(target, encodePNG(out, w, h, 3));
  console.log(`gen-surge-textures: wrote contact sheet ${target} (${w}×${h}, ${SURFACES.length} shipped maps)`);
}

const args = process.argv.slice(2);
const sheet = args.find((a) => a.startsWith("--sheet="));

if (args.includes("--check")) {
  check();
} else if (sheet) {
  contactSheet(sheet.slice("--sheet=".length));
} else {
  const written = write();
  console.log(`gen-surge-textures: wrote ${written} maps into assets/pf2e-arcane-surge/dice/`);
}
