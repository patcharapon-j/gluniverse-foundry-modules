/**
 * The fate die's face maps, baked from the glyph geometry.
 *
 * Pure: returns RGBA byte arrays. `dsn.mjs` puts them on a canvas in the
 * browser; the check tool and the preview read the same bytes, so what they
 * measure is what Dice So Nice is handed.
 *
 * The die is BLACK GLASS, and three Dice So Nice behaviours govern every value
 * here (read off its shipped sourcemap, and the same three Arcane Surge's dice
 * are built on; see docs/ARCANE_SURGE.md):
 *
 *   THE BUMP MAP IS ALSO THE TRANSMISSION MASK. On a transmissive material
 *   (`glass`) DSN binds the finished bump canvas a second time as
 *   `transmissionMap` and reads it through `smoothstep(0.6, 0.9, r)`. So height
 *   decides what is glass and what is solid: the field sits at or above
 *   GLASS_TOP, the glyph is cut below SOLID_FLOOR, and nothing lingers between
 *   them, because a half-transmissive smear is the one thing glass renders badly.
 *
 *   BUMP AND EMISSIVE ARE READ ONLY FOR AN IMAGE LABEL. Every face is labelled
 *   with an image (the painted glyph, or the transparent one for a blank face).
 *
 *   EMISSION IS NOT A LOCAL COST. Any non-black emissive in the dice scene puts
 *   the whole canvas on DSN's bloom path for the throw. So the glyph is also
 *   PAINTED into the label in its tone: with the glow switched off (intensity 0)
 *   the die sends no emissive at all and still reads, and with DSN's realistic
 *   lighting off (no bump, no emissive) the painted glyph is still on the face.
 *
 * A d6 face is its whole texture tile and the cube is concentric with it, so
 * unlike the d20 (centroid at y = 0.576) the glyph is centred on the tile.
 */

import { frameCoverage, glyphCoverage, glyphShapes } from "./glyphs.mjs";

export const SIZE = 256;
export const GLASS_TOP = 0.9;
export const SOLID_FLOOR = 0.6;
/* The frost field: high in the glass band, with room for grain. */
export const FIELD = 0.965;
export const GRAIN = 0.03;

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (t) => t * t * (3 - 2 * t);
const mix = (a, b, t) => a + (b - a) * t;

/* Wrapped value noise, so the frost tiles without a seam. */
function hash2(ix, iy, seed) {
  let h = Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed, 2246822519 | 0);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
function vnoise(x, y, period, seed) {
  const wrap = (n) => ((n % period) + period) % period;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = smooth(x - x0);
  const fy = smooth(y - y0);
  return mix(
    mix(hash2(wrap(x0), wrap(y0), seed), hash2(wrap(x0 + 1), wrap(y0), seed), fx),
    mix(hash2(wrap(x0), wrap(y0 + 1), seed), hash2(wrap(x0 + 1), wrap(y0 + 1), seed), fx),
    fy,
  );
}
function frost(u, v, seed) {
  const fine = vnoise(u * 24, v * 24, 24, seed) * 0.6 + vnoise(u * 48, v * 48, 48, seed + 1) * 0.4;
  const swell = vnoise(u * 4, v * 4, 4, seed + 7);
  return clamp01(0.5 + (fine - 0.5) * 0.7 + (swell - 0.5) * 0.5);
}

/** "#rrggbb" → [r, g, b] 0..255. */
export function rgbOf(hex) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(hex ?? ""));
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [255, 255, 255];
}

/**
 * Bake one face.
 *
 * @param {object} spec      faces.mjs `glyphSpec`
 * @param {object} opts
 * @param {string} opts.tone  "#rrggbb" — the glyph's hue (painted and emitted)
 * @param {boolean} [opts.custom]  a GM's own label image sits on this face: the
 *        field goes SOLID so their art reads as a painted face, not a smear in glass
 * @returns {{ label: Uint8ClampedArray, bump: Uint8ClampedArray, emissive: Uint8ClampedArray, size: number }}
 */
export function bakeFace(spec, { tone = "#ffffff", custom = false, size = SIZE } = {}) {
  const shapes = glyphShapes(spec);
  const [tr, tg, tb] = rgbOf(tone);
  const label = new Uint8ClampedArray(size * size * 4);
  const bump = new Uint8ClampedArray(size * size * 4);
  const emissive = new Uint8ClampedArray(size * size * 4);
  const aa = 2.4 / size;
  const seed = 31;

  for (let py = 0; py < size; py++) {
    const v = (py + 0.5) / size;
    const y = v * 2 - 1;
    for (let px = 0; px < size; px++) {
      const u = (px + 0.5) / size;
      const x = u * 2 - 1;
      const i = (py * size + px) * 4;

      const mark = custom ? 0 : glyphCoverage(shapes, x, y, aa);
      const frame = frameCoverage(x, y, aa);

      /* Height: the frost field in the glass band, the frame and the glyph cut
         clean through the curve in one step. */
      let h = custom ? 0.3 : FIELD + (frost(u, v, seed) - 0.5) * GRAIN * 2;
      if (!custom) h = mix(h, 0.42, frame);
      h = mix(h, 0.22, mark);
      const hb = Math.round(clamp01(h) * 255);
      bump[i] = hb; bump[i + 1] = hb; bump[i + 2] = hb; bump[i + 3] = 255;

      /* Label: the glyph painted in its tone, transparent elsewhere. */
      label[i] = tr; label[i + 1] = tg; label[i + 2] = tb;
      label[i + 3] = Math.round(mark * 255);

      /* Emission: the glyph only, hottest along the spine of each stroke. */
      const e = mark * mark;
      emissive[i] = Math.round(tr * e);
      emissive[i + 1] = Math.round(tg * e);
      emissive[i + 2] = Math.round(tb * e);
      emissive[i + 3] = 255;
    }
  }
  return { label, bump, emissive, size };
}

/** Fully transparent: the label of a face that carries no glyph. */
export function bakeClear(size = SIZE) {
  return new Uint8ClampedArray(size * size * 4);
}

/* ── Measurement (the check tool reads these) ─────────────────────────── */

/** Fraction of a bump map in [lo, hi) of 0..1. */
export function bandShare(bump, lo, hi) {
  let n = 0;
  const total = bump.length / 4;
  for (let i = 0; i < bump.length; i += 4) {
    const h = bump[i] / 255;
    if (h >= lo && h < hi) n++;
  }
  return n / total;
}

/** Furthest painted pixel from the centre, in face units (Chebyshev). */
export function markExtent(label, size = SIZE) {
  let extent = 0;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      if (label[(py * size + px) * 4 + 3] < 8) continue;
      const x = Math.abs(((px + 0.5) / size) * 2 - 1);
      const y = Math.abs(((py + 0.5) / size) * 2 - 1);
      extent = Math.max(extent, x, y);
    }
  }
  return extent;
}
