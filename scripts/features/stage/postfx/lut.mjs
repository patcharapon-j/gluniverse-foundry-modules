/**
 * Stage character grade — looks, as 3D colour lookup tables.
 *
 * Pure: no `game`, no DOM, no fetch. Everything a look is goes through one
 * representation — a 3D LUT on encoded (display) colour — whether it started
 * as a recipe shipped with the suite or a `.cube` file a GM made in Resolve,
 * Photoshop or Lightroom. The shader therefore has one kind of look to apply.
 *
 * On the GPU a LUT is a 2D "strip": N tiles of N×N side by side, tile b holding
 * blue slice b with red across and green down. WebGL1 has no 3D textures; the
 * strip is sampled bilinearly inside two neighbouring tiles and the two are
 * mixed, which is trilinear interpolation. `sampleStrip` below does exactly
 * that on the same 8-bit data the GPU holds, so the check tool and the browser
 * harness can compare the two.
 */

import {
  toLinear,
  toSRGB,
  basicParams,
  toneCurve,
  linearToOklab,
  oklabToLinear,
  LUMA,
} from "./grade-model.mjs";

/** Grid size recipes are baked at, and `.cube` files are resampled to when
 *  larger. 33 is the size nearly every grading tool exports by default; the
 *  strip it needs is 1089 texels wide, inside every WebGL1 texture limit. */
export const LUT_SIZE = 33;

/** Largest grid a `.cube` may declare before we refuse it outright. */
export const CUBE_MAX_SIZE = 256;

// ─── .cube ───

/**
 * Parse an Adobe/Resolve `.cube` file.
 *
 * Supports `LUT_3D_SIZE` (red varies fastest), `LUT_1D_SIZE` (applied per
 * channel, converted to 3D), `DOMAIN_MIN` / `DOMAIN_MAX`, `TITLE` and comments.
 * Throws with a message a GM can act on when the file is not a usable LUT.
 *
 * @returns {{ title: string, size: number, data: Float32Array }} a 3D LUT on
 *          the 0..1 domain, rgb triplets, red fastest.
 */
export function parseCube(text) {
  let title = "";
  let size3 = 0;
  let size1 = 0;
  let min = [0, 0, 0];
  let max = [1, 1, 1];
  const values = [];
  const lines = String(text ?? "").split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.replace(/#.*/, "").trim();
    if (!line) continue;
    const [key, ...rest] = line.split(/\s+/);
    const upper = key.toUpperCase();
    if (upper === "TITLE") {
      title = line.slice(5).trim().replace(/^"|"$/g, "");
    } else if (upper === "LUT_3D_SIZE") {
      size3 = Number(rest[0]);
    } else if (upper === "LUT_1D_SIZE") {
      size1 = Number(rest[0]);
    } else if (upper === "DOMAIN_MIN") {
      min = rest.slice(0, 3).map(Number);
    } else if (upper === "DOMAIN_MAX") {
      max = rest.slice(0, 3).map(Number);
    } else if (upper === "LUT_3D_INPUT_RANGE" || upper === "LUT_1D_INPUT_RANGE") {
      const [lo, hi] = rest.map(Number);
      min = [lo, lo, lo];
      max = [hi, hi, hi];
    } else if (/^[-+.\d]/.test(key)) {
      const nums = [key, ...rest].slice(0, 3).map(Number);
      if (nums.length !== 3 || nums.some((n) => !Number.isFinite(n))) throw new Error(`bad data line: ${raw.trim()}`);
      values.push(nums);
    }
    // Unknown keywords are ignored, as the format allows.
  }

  if (![...min, ...max].every(Number.isFinite) || min.some((m, i) => m >= max[i])) {
    throw new Error("DOMAIN_MIN must be below DOMAIN_MAX");
  }

  if (size3) {
    if (!Number.isInteger(size3) || size3 < 2 || size3 > CUBE_MAX_SIZE) throw new Error(`LUT_3D_SIZE ${size3} is out of range`);
    if (values.length !== size3 ** 3) throw new Error(`expected ${size3 ** 3} entries for LUT_3D_SIZE ${size3}, found ${values.length}`);
    const data = new Float32Array(values.length * 3);
    values.forEach((v, i) => data.set(v, i * 3));
    return { title, size: size3, data: remapDomain(data, size3, min, max) };
  }
  if (size1) {
    if (!Number.isInteger(size1) || size1 < 2 || size1 > 65536) throw new Error(`LUT_1D_SIZE ${size1} is out of range`);
    if (values.length !== size1) throw new Error(`expected ${size1} entries for LUT_1D_SIZE ${size1}, found ${values.length}`);
    const curve = (ch, x) => {
      const t = Math.min(Math.max((x - min[ch]) / (max[ch] - min[ch]), 0), 1) * (size1 - 1);
      const i = Math.min(Math.floor(t), size1 - 2);
      const f = t - i;
      return values[i][ch] + (values[i + 1][ch] - values[i][ch]) * f;
    };
    return { title, ...bakeFunction((c) => c.map((x, ch) => curve(ch, x)), LUT_SIZE) };
  }
  throw new Error("no LUT_3D_SIZE or LUT_1D_SIZE line — this is not a .cube LUT");
}

/**
 * A LUT whose input domain is not 0..1 is resampled onto 0..1: every grid
 * point of the result asks the source what it does to that colour, with inputs
 * outside the declared domain clamped to its edge.
 */
function remapDomain(data, size, min, max) {
  if (min.every((m) => m === 0) && max.every((m) => m === 1)) return data;
  const src = { size, data };
  const out = new Float32Array(size ** 3 * 3);
  for (let b = 0; b < size; b++) {
    for (let g = 0; g < size; g++) {
      for (let r = 0; r < size; r++) {
        const c = [r, g, b].map((v, ch) => (v / (size - 1) - min[ch]) / (max[ch] - min[ch]));
        out.set(sampleLut(src, c), ((b * size + g) * size + r) * 3);
      }
    }
  }
  return out;
}

/** Trilinear sample of a float LUT at an encoded colour, clamped to 0..1. */
export function sampleLut(lut, c) {
  const N = lut.size;
  const p = c.map((x) => Math.min(Math.max(x, 0), 1) * (N - 1));
  const i0 = p.map((x) => Math.min(Math.floor(x), N - 2));
  const f = p.map((x, k) => x - i0[k]);
  const at = (r, g, b) => (b * N + g) * N + r;
  const out = [0, 0, 0];
  for (let dz = 0; dz <= 1; dz++) {
    for (let dy = 0; dy <= 1; dy++) {
      for (let dx = 0; dx <= 1; dx++) {
        const w = (dx ? f[0] : 1 - f[0]) * (dy ? f[1] : 1 - f[1]) * (dz ? f[2] : 1 - f[2]);
        const idx = at(i0[0] + dx, i0[1] + dy, i0[2] + dz) * 3;
        for (let k = 0; k < 3; k++) out[k] += lut.data[idx + k] * w;
      }
    }
  }
  return out;
}

/** Resample a LUT onto a coarser grid. Larger `.cube` files are brought down
 *  to LUT_SIZE so the strip fits every GPU's texture limit. */
export function resampleLut(lut, size = LUT_SIZE) {
  if (lut.size <= size) return lut;
  return bakeFunction((c) => sampleLut(lut, c), size);
}

/** Sample any colour function onto a grid. */
export function bakeFunction(fn, size = LUT_SIZE) {
  const data = new Float32Array(size ** 3 * 3);
  for (let b = 0; b < size; b++) {
    for (let g = 0; g < size; g++) {
      for (let r = 0; r < size; r++) {
        const out = fn([r / (size - 1), g / (size - 1), b / (size - 1)]);
        data.set(out.map((x) => Math.min(Math.max(x, 0), 1)), ((b * size + g) * size + r) * 3);
      }
    }
  }
  return { size, data };
}

// ─── The GPU layout ───

/**
 * Pack a LUT into the strip the shader samples: RGBA8, `size²` wide and `size`
 * tall. Row y is green slice y; tile b (x from b·size) is blue slice b.
 */
export function lutToStrip(lut) {
  const N = lut.size;
  const W = N * N;
  const bytes = new Uint8Array(W * N * 4);
  for (let b = 0; b < N; b++) {
    for (let g = 0; g < N; g++) {
      for (let r = 0; r < N; r++) {
        const src = ((b * N + g) * N + r) * 3;
        const dst = (g * W + b * N + r) * 4;
        for (let k = 0; k < 3; k++) bytes[dst + k] = Math.round(Math.min(Math.max(lut.data[src + k], 0), 1) * 255);
        bytes[dst + 3] = 255;
      }
    }
  }
  return { size: N, width: W, height: N, bytes };
}

/**
 * Sample a strip exactly as the shader does: clamp, bilinear within blue tiles
 * b and b+1 at texel centres, then mix the two. Encoded in, encoded out.
 */
export function sampleStrip(strip, c) {
  const N = strip.size;
  const W = strip.width;
  const p = c.map((x) => Math.min(Math.max(x, 0), 1) * (N - 1));
  const b0 = Math.floor(p[2]);
  const fb = p[2] - b0;
  const b1 = Math.min(b0 + 1, N - 1);
  const texel = (x, y) => {
    const i = (y * W + x) * 4;
    return [strip.bytes[i] / 255, strip.bytes[i + 1] / 255, strip.bytes[i + 2] / 255];
  };
  const bilinear = (tile) => {
    const x = tile * N + p[0];
    const y = p[1];
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const x1 = Math.min(x0 + 1, tile * N + N - 1);
    const y1 = Math.min(y0 + 1, N - 1);
    const fx = x - x0;
    const fy = y - y0;
    const a = texel(x0, y0);
    const bb = texel(x1, y0);
    const cc = texel(x0, y1);
    const d = texel(x1, y1);
    return a.map((_, k) => (a[k] * (1 - fx) + bb[k] * fx) * (1 - fy) + (cc[k] * (1 - fx) + d[k] * fx) * fy);
  };
  const s0 = bilinear(b0);
  const s1 = bilinear(b1);
  return s0.map((x, k) => x + (s1[k] - x) * fb);
}

// ─── Recipes ───
//
// A recipe is a small, readable description of a look, baked into a LUT when
// it is loaded. Every field is optional and neutral when absent:
//
//   exposure     stops, as basic correction's
//   contrast     -100..100, as basic correction's
//   saturation   -100..100, as basic correction's (OKLab chroma)
//   hue          degrees, as basic correction's (OKLab hue)
//   temperature  -100..100, cool to warm, at constant luminance
//   tint         -100..100, green to magenta, at constant luminance
//   shadows      { hue, amount }  split-tone colour pushed into the darks
//   highlights   { hue, amount }  split-tone colour pushed into the lights
//   fade         0..100, how far black is lifted toward grey
//
// Hues are OKLab hue angles in degrees: roughly red 30, orange 60, yellow 105,
// green 140, cyan 195, blue 260, purple 300, magenta 330.

/** Chroma a split-tone of amount 100 adds, in OKLab units. */
const SPLIT_CHROMA = 0.09;

/** Luma-neutral white-balance gains for a temperature and tint. */
function balance(temperature = 0, tint = 0) {
  const t = temperature / 100;
  const m = tint / 100;
  const gains = [1 + 0.18 * t + 0.06 * m, 1 - 0.1 * m, 1 - 0.18 * t + 0.06 * m];
  const y = gains[0] * LUMA[0] + gains[1] * LUMA[1] + gains[2] * LUMA[2];
  return gains.map((g) => g / y);
}

const inGamut = (c) => c.every((x) => x >= 0 && x <= 1);

/** Where chroma compression starts, as a fraction of the most that fits. */
const FIT_KNEE = 0.75;

/**
 * Bring an OKLab colour into gamut smoothly: lightness clamped, then chroma
 * compressed at constant lightness and hue with a soft knee — the same shape
 * the shader's saturation dial uses. Returns linear.
 *
 * Recipes are baked into a grid and read back by interpolation, so they must
 * not have a crease sharper than the grid: pulling an out-of-range colour
 * toward grey at constant luminance does, near white, where a bright yellow's
 * blue channel goes from nothing to half-scale across 2% of the input.
 */
export function fitOklab(lab) {
  const L = Math.min(Math.max(lab[0], 0), 1);
  const a = lab[1];
  const b = lab[2];
  // The most of this chroma that fits, found by bisection, looking up to twice
  // as far as asked so a colour inside the gamut can still sit in the knee.
  let lo = 0;
  let hi = 2;
  if (inGamut(oklabToLinear([L, a * hi, b * hi]))) lo = hi;
  else {
    for (let i = 0; i < 16; i++) {
      const mid = (lo + hi) / 2;
      if (inGamut(oklabToLinear([L, a * mid, b * mid]))) lo = mid;
      else hi = mid;
    }
  }
  const knee = FIT_KNEE * lo;
  let k = 1;
  if (k > knee) {
    const width = lo - knee;
    const excess = k - knee;
    k = width > 0 ? knee + excess / (1 + excess / width) : lo;
  }
  return oklabToLinear([L, a * k, b * k]).map((x) => Math.min(Math.max(x, 0), 1));
}

/**
 * Evaluate a recipe on one encoded colour.
 *
 * The level-and-balance steps run in linear light and are allowed to leave the
 * displayable range; the colour steps then run in OKLab; and only at the end is
 * the result brought back into gamut, once and smoothly (`fitOklab`). Fitting
 * after every step would put a crease in the LUT at every step.
 */
export function applyRecipe(recipe, srgb) {
  const r = recipe ?? {};
  const p = basicParams({
    exposure: r.exposure ?? 0,
    contrast: r.contrast ?? 0,
    saturation: r.saturation ?? 0,
    hue: r.hue ?? 0,
  });

  // Exposure and white balance: gains in linear light.
  const wb = balance(r.temperature, r.tint);
  let lin = srgb.map((x, i) => toLinear(x) * p.gain * wb[i]);

  // Contrast: the tone curve on luminance, as a ratio.
  if (p.contrast !== 1) {
    const y = lin[0] * LUMA[0] + lin[1] * LUMA[1] + lin[2] * LUMA[2];
    if (y > 1e-9) {
      const ye = Math.min(toSRGB(y), 1);
      const ratio = toLinear(toneCurve(ye, p)) / toLinear(ye);
      lin = lin.map((x) => x * ratio);
    }
  }

  // Saturation, hue and the split tones, on the OKLab chroma vector.
  const lab = linearToOklab(lin.map((x) => Math.max(x, 0)));
  const hueRad = ((r.hue ?? 0) * Math.PI) / 180;
  const a0 = lab[1];
  const b0 = lab[2];
  lab[1] = (a0 * Math.cos(hueRad) - b0 * Math.sin(hueRad)) * p.sat;
  lab[2] = (a0 * Math.sin(hueRad) + b0 * Math.cos(hueRad)) * p.sat;
  const L = Math.min(Math.max(lab[0], 0), 1);
  const push = (tone, weight) => {
    if (!tone?.amount) return;
    const h = ((tone.hue ?? 0) * Math.PI) / 180;
    const k = (tone.amount / 100) * SPLIT_CHROMA * weight;
    lab[1] += Math.cos(h) * k;
    lab[2] += Math.sin(h) * k;
  };
  push(r.shadows, (1 - L) * (1 - L));
  push(r.highlights, L * L);

  let out = fitOklab(lab).map(toSRGB);
  if (r.fade) {
    const f = (r.fade / 100) * 0.25;
    out = out.map((x) => f + x * (1 - f));
  }
  return out.map((x) => Math.min(Math.max(x, 0), 1));
}

/** Bake a recipe into a LUT. */
export function bakeRecipe(recipe, size = LUT_SIZE) {
  return bakeFunction((c) => applyRecipe(recipe, c), size);
}

/**
 * The looks the suite ships, named after AutoCompositing's colour presets.
 * Ids are stable data — a scene stores them — so a look may be retuned but
 * never renamed.
 */
export const BUILTIN_LOOKS = Object.freeze({
  "builtin:cherry-blossoms": Object.freeze({
    name: "Cherry Blossoms",
    recipe: { temperature: 8, saturation: 8, shadows: { hue: 330, amount: 18 }, highlights: { hue: 5, amount: 40 }, fade: 12, exposure: 0.05 },
  }),
  "builtin:neon": Object.freeze({
    name: "Neon",
    recipe: { saturation: 35, contrast: 25, shadows: { hue: 300, amount: 45 }, highlights: { hue: 195, amount: 40 } },
  }),
  "builtin:night-city": Object.freeze({
    name: "Night City",
    recipe: { temperature: -30, contrast: 20, exposure: -0.3, saturation: 10, shadows: { hue: 255, amount: 40 }, highlights: { hue: 65, amount: 28 } },
  }),
  "builtin:rainy-forest": Object.freeze({
    name: "Rainy Forest",
    recipe: { temperature: -10, tint: -20, saturation: -20, contrast: -10, fade: 10, shadows: { hue: 170, amount: 22 }, highlights: { hue: 115, amount: 12 } },
  }),
  "builtin:under-water": Object.freeze({
    name: "Under Water",
    recipe: { temperature: -50, tint: -15, saturation: -10, contrast: -15, fade: 10, shadows: { hue: 225, amount: 40 }, highlights: { hue: 190, amount: 28 } },
  }),
  "builtin:winter": Object.freeze({
    name: "Winter",
    recipe: { temperature: -35, saturation: -30, exposure: 0.15, fade: 15, highlights: { hue: 240, amount: 15 } },
  }),
  "builtin:flame": Object.freeze({
    name: "Flame",
    recipe: { temperature: 45, contrast: 20, saturation: 15, shadows: { hue: 30, amount: 30 }, highlights: { hue: 70, amount: 35 } },
  }),
  "builtin:gray": Object.freeze({
    name: "Gray",
    recipe: { saturation: -100, contrast: 10 },
  }),
  "builtin:lipstick": Object.freeze({
    name: "Lipstick",
    recipe: { saturation: 20, contrast: 10, shadows: { hue: 330, amount: 22 }, highlights: { hue: 355, amount: 28 } },
  }),
  "builtin:pastel": Object.freeze({
    name: "Pastel",
    recipe: { saturation: -25, contrast: -25, exposure: 0.2, fade: 30, shadows: { hue: 250, amount: 15 }, highlights: { hue: 340, amount: 15 } },
  }),
  "builtin:vintage": Object.freeze({
    name: "Vintage",
    recipe: { temperature: 20, saturation: -20, contrast: -10, fade: 25, shadows: { hue: 200, amount: 15 }, highlights: { hue: 75, amount: 25 } },
  }),
  "builtin:silence": Object.freeze({
    name: "Silence",
    recipe: { temperature: -15, saturation: -60, contrast: -15, fade: 20 },
  }),
  "builtin:orange-film": Object.freeze({
    name: "OrangeFilm",
    recipe: { contrast: 15, saturation: 10, shadows: { hue: 205, amount: 35 }, highlights: { hue: 60, amount: 38 } },
  }),
});

export const BUILTIN_LOOK_IDS = Object.freeze(Object.keys(BUILTIN_LOOKS));
