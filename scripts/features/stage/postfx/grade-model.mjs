/**
 * Stage character grade — the data model.
 *
 * Pure: no `game`, no `canvas`, no DOM. The check tool imports this under plain
 * Node, and the shader in gl.mjs is a transcription of `gradePixel` below, so
 * the two can be compared number for number.
 *
 * The grade is a stack of layers, each of which the GM controls directly. The
 * automatic analysis of the background only ever proposes starting values; it
 * never moves a value on its own. Two rules hold for every dial in every layer:
 *
 *   1. At its neutral value a dial is an exact no-op. Every dial neutral gives
 *      back the original art bit for bit.
 *   2. A dial changes one property of the picture. Two dials that both move the
 *      same thing are two ways of asking one question, and a GM who dislikes the
 *      result can no longer find which part they dislike.
 *
 * Where each value lives:
 *   scene flag  `stage.grade`          the full stack for that room
 *   world       `stage.gradeDefaults`  the stack a scene starts from
 *   actor       `ppTrim` (library)     a small per-art correction
 */

import { clamp } from "../../../core/util.mjs";

/** Schema version of a stored grade. */
export const GRADE_VERSION = 1;

/** Scene flag key; read and written through the suite id. */
export const GRADE_FLAG = "stage.grade";

// ─── Basic correction ───
//
// Six dials, and each one owns one property of the tone or colour:
//
//   exposure    gain in linear light — moves white, black stays put
//   brightness  lift — moves black, white stays put
//   gamma       midtones — black and white both stay put
//   contrast    slope about mid-grey — black, white and mid-grey all stay put
//   saturation  chroma — lightness and hue stay put
//   hue         hue angle — lightness and chroma stay put
//
// The four tone dials act on luminance only and rescale the pixel as a ratio,
// so none of them can shift its chromaticity. The two colour dials act on the
// OKLab chroma vector, so neither can shift lightness. That is what makes the
// list above true rather than approximately true.

/**
 * @typedef {object} DialSpec
 * @property {number} min
 * @property {number} max
 * @property {number} neutral  The value at which the dial is an exact no-op.
 * @property {number} step
 */

/** @type {Readonly<Record<string, DialSpec>>} */
export const BASIC_DIALS = Object.freeze({
  exposure: Object.freeze({ min: -3, max: 3, neutral: 0, step: 0.05 }),
  brightness: Object.freeze({ min: -100, max: 100, neutral: 0, step: 1 }),
  gamma: Object.freeze({ min: 0.25, max: 4, neutral: 1, step: 0.01 }),
  contrast: Object.freeze({ min: -100, max: 100, neutral: 0, step: 1 }),
  saturation: Object.freeze({ min: -100, max: 100, neutral: 0, step: 1 }),
  hue: Object.freeze({ min: -180, max: 180, neutral: 0, step: 1 }),
});

export const BASIC_KEYS = Object.freeze(Object.keys(BASIC_DIALS));

/**
 * The per-actor correction. A subset of basic correction, for art that is
 * always off in the same way whatever room it stands in. It composes with the
 * scene's own basic correction rather than replacing it.
 */
export const TRIM_KEYS = Object.freeze(["exposure", "gamma", "saturation", "hue"]);

/** How far one unit of `brightness` lifts black, in encoded light. */
const LIFT_PER_UNIT = 0.25 / 100;

/** `contrast` of ±100 halves or doubles the curve's slope at mid-grey. */
const CONTRAST_OCTAVES_PER_UNIT = 1 / 100;

function neutralBasic() {
  const out = {};
  for (const key of BASIC_KEYS) out[key] = BASIC_DIALS[key].neutral;
  return out;
}

/** The grade a scene with no stored grade and no world default gets. */
export const DEFAULT_GRADE = Object.freeze({
  v: GRADE_VERSION,
  basic: Object.freeze(neutralBasic()),
});

/** The trim an actor with nothing stored gets. */
export const DEFAULT_TRIM = Object.freeze(
  Object.fromEntries(TRIM_KEYS.map((key) => [key, BASIC_DIALS[key].neutral]))
);

function readDial(spec, raw) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return spec.neutral;
  return clamp(n, spec.min, spec.max);
}

/**
 * Coerce anything stored into a complete, in-range grade.
 *
 * Missing sections and dials take their neutral value, never a guess, so a
 * grade written by an older build reads back as exactly what it said plus
 * no-ops for everything it did not know about.
 */
export function normalizeGrade(raw, fallback = DEFAULT_GRADE) {
  const src = raw && typeof raw === "object" ? raw : {};
  const base = fallback && typeof fallback === "object" ? fallback : DEFAULT_GRADE;
  const basicSrc = src.basic && typeof src.basic === "object" ? src.basic : {};
  const basicBase = base.basic ?? DEFAULT_GRADE.basic;
  const basic = {};
  for (const key of BASIC_KEYS) {
    basic[key] = readDial(BASIC_DIALS[key], key in basicSrc ? basicSrc[key] : basicBase[key]);
  }
  return { v: GRADE_VERSION, basic };
}

/** Coerce a stored per-actor trim. */
export function normalizeTrim(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  const out = {};
  for (const key of TRIM_KEYS) out[key] = readDial(BASIC_DIALS[key], src[key]);
  return out;
}

/** True when a trim changes nothing. Such a trim is not worth storing. */
export function isNeutralTrim(trim) {
  const t = normalizeTrim(trim);
  return TRIM_KEYS.every((key) => t[key] === BASIC_DIALS[key].neutral);
}

// ─── Resolution to shader parameters ───

/**
 * Everything the basic-correction block of the shader takes, resolved from the
 * scene's dials and the actor's trim.
 *
 * Composition: exposure and hue add, gamma and saturation multiply. Each rule is
 * the one that keeps the neutral value neutral — an actor trim of 0 stops, ×1
 * gamma or 0% saturation leaves the scene's value exactly as it was.
 *
 * @returns {{gain:number, lift:number, gamma:number, contrast:number,
 *            sat:number, hueCos:number, hueSin:number}}
 */
export function basicParams(basic, trim = DEFAULT_TRIM) {
  const b = normalizeGrade({ basic }).basic;
  const t = normalizeTrim(trim);

  const stops = b.exposure + t.exposure;
  const gamma = b.gamma * t.gamma;
  const sat = (1 + b.saturation / 100) * (1 + t.saturation / 100);
  const hueRad = ((b.hue + t.hue) * Math.PI) / 180;

  return {
    gain: 2 ** stops,
    lift: b.brightness * LIFT_PER_UNIT,
    gamma,
    contrast: 2 ** (b.contrast * CONTRAST_OCTAVES_PER_UNIT),
    sat,
    // Exactly (1, 0) at zero, so the rotation's delta is exactly zero there.
    hueCos: hueRad === 0 ? 1 : Math.cos(hueRad),
    hueSin: hueRad === 0 ? 0 : Math.sin(hueRad),
  };
}

/** The identity parameters. */
export const NEUTRAL_PARAMS = Object.freeze(basicParams(DEFAULT_GRADE.basic));

/** Interpolate two parameter sets, for the scene-change tween. */
export function lerpParams(a, b, t) {
  const out = {};
  for (const key of Object.keys(b)) {
    const from = Number.isFinite(a?.[key]) ? a[key] : b[key];
    out[key] = from + (b[key] - from) * t;
  }
  return out;
}

// ─── The reference implementation ───
//
// `gradePixel` is the shader's grade, written out in JavaScript. gl.mjs
// transcribes it into GLSL line for line; the check tool asserts the rules above
// against this, and the browser harness asserts that the GLSL agrees with it.
// Change one and you must change the other.

export const LUMA = Object.freeze([0.2126, 0.7152, 0.0722]);

export function toLinear(c) {
  return Math.pow(Math.max(c, 0), 2.2);
}

export function toSRGB(c) {
  return Math.pow(Math.max(c, 0), 1 / 2.2);
}

function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

// ── OKLab ──
// Saturation and hue work in OKLab (Björn Ottosson, 2020), a perceptual space:
// L is lightness, (a, b) is a chroma vector whose length is chroma and whose
// angle is hue, and the three are close to independent to the eye. Scaling or
// rotating (a, b) therefore leaves lightness where it was and moves exactly one
// of chroma or hue.
//
// Linear light would be the obvious space and is the wrong one: a channel near
// black is a tiny number there, so a chroma push drives it below zero almost
// immediately, and in encoded values that is a dark channel collapsing to 0 over
// a sliver of the input — a visible seam across any smooth gradient.

/**
 * The four OKLab matrices, row-major. Exported so gl.mjs can write them into
 * the shader from this one statement rather than from a copy of it.
 */
export const OKLAB = Object.freeze({
  /** linear sRGB → LMS */
  toLms: Object.freeze([
    [0.4122214708, 0.5363325363, 0.0514459929],
    [0.2119034982, 0.6806995451, 0.1073969566],
    [0.0883024619, 0.2817188376, 0.6299787005],
  ]),
  /** cube-rooted LMS → Lab */
  toLab: Object.freeze([
    [0.2104542553, 0.793617785, -0.0040720468],
    [1.9779984951, -2.428592205, 0.4505937099],
    [0.0259040371, 0.7827717662, -0.808675766],
  ]),
  /** Lab → cube-rooted LMS */
  fromLab: Object.freeze([
    [1, 0.3963377774, 0.2158037573],
    [1, -0.1055613458, -0.0638541728],
    [1, -0.0894841775, -1.291485548],
  ]),
  /** LMS → linear sRGB */
  fromLms: Object.freeze([
    [4.0767416621, -3.3077115913, 0.2309699292],
    [-1.2684380046, 2.6097574011, -0.3413193965],
    [-0.0041960863, -0.7034186147, 1.707614701],
  ]),
});

const mul = (m, v) => m.map((row) => row[0] * v[0] + row[1] * v[1] + row[2] * v[2]);

export function linearToOklab(c) {
  return mul(OKLAB.toLab, mul(OKLAB.toLms, c).map(Math.cbrt));
}

export function oklabToLinear(o) {
  return mul(OKLAB.fromLms, mul(OKLAB.fromLab, o).map((x) => x * x * x));
}

/** Bisection steps when measuring how much chroma fits: 2⁻¹¹ of the search
 *  range, well under one 8-bit step. */
export const GAMUT_STEPS = 11;

/** How far past the requested chroma the gamut search looks. A colour that
 *  still fits at twice what was asked for is nowhere near the edge. */
export const GAMUT_REACH = 2;

/** Where chroma compression starts, as a fraction of the most that fits. */
export const GAMUT_KNEE = 0.8;

const inGamut = (c) => c[0] >= 0 && c[1] >= 0 && c[2] >= 0 && c[0] <= 1 && c[1] <= 1 && c[2] <= 1;

/**
 * Saturation and hue, in OKLab, with the result kept displayable.
 *
 * Chroma is shortened at constant lightness and hue — never by clipping
 * channels, which would move both. And it is shortened *softly*: the most chroma
 * that fits along this hue is measured, and a request approaching it is
 * compressed over the last fifth of the range rather than stopped dead at the
 * wall. A hard stop is continuous but has a corner, and on a smooth gradient
 * that corner is a visible seam wherever the push first reaches the edge.
 */
export function chromaAdjust(c, p) {
  const [L, a, b] = linearToOklab(c);
  const na = (a * p.hueCos - b * p.hueSin) * p.sat;
  const nb = (a * p.hueSin + b * p.hueCos) * p.sat;
  if (Math.hypot(na, nb) < 1e-7) return oklabToLinear([L, 0, 0]).map((x) => Math.min(Math.max(x, 0), 1));

  // The largest multiple of the requested chroma that is still displayable.
  let lo = 0;
  let hi = GAMUT_REACH;
  if (inGamut(oklabToLinear([L, na * hi, nb * hi]))) lo = hi;
  else {
    for (let i = 0; i < GAMUT_STEPS; i++) {
      const mid = (lo + hi) / 2;
      if (inGamut(oklabToLinear([L, na * mid, nb * mid]))) lo = mid;
      else hi = mid;
    }
  }

  // Requested chroma is 1 in these units; the most that fits is `lo`.
  const knee = GAMUT_KNEE * lo;
  let k = 1;
  if (k > knee) {
    const width = lo - knee;
    const excess = k - knee;
    k = width > 0 ? knee + excess / (1 + excess / width) : lo;
  }
  return oklabToLinear([L, na * k, nb * k]).map((x) => Math.min(Math.max(x, 0), 1));
}

/**
 * The tone curve, on encoded luminance. Black, white and mid-grey placement is
 * what separates the four tone dials; see the table at the top of the file.
 */
export function toneCurve(y, p) {
  // Each step is skipped outright at its neutral value rather than evaluated
  // there: `pow(t, 1.0)` is exp2(log2(t)) on a GPU and is not exactly t, and an
  // identity that is only nearly an identity is not the rule this file keeps.
  let t = y;
  // Lift: black moves, white is pinned.
  if (p.lift !== 0) t = Math.min(Math.max(t + p.lift * (1 - t), 0), 1);
  // Gamma: the midtones move, both ends are pinned.
  if (p.gamma !== 1) t = Math.pow(t, 1 / p.gamma);
  // Contrast: an S about 0.5 that pins 0, 0.5 and 1. Defined on [0, 1] only —
  // exposure can push luminance past white, and the far half of the S raises a
  // negative number to a fractional power there.
  if (p.contrast !== 1) {
    t = Math.min(Math.max(t, 0), 1);
    t = t < 0.5 ? 0.5 * Math.pow(2 * t, p.contrast) : 1 - 0.5 * Math.pow(2 - 2 * t, p.contrast);
  }
  return t;
}

/**
 * The most a tone dial may scale a pixel's colour by. Past this, the extra
 * luminance arrives as neutral grey instead.
 *
 * A tone curve applied as a ratio keeps chromaticity exactly, which is what
 * lets the four tone dials own nothing but tone. Near black that ratio runs
 * away: lifting a pixel at 0.1% luminance to 5% is a 50× scale, which turns the
 * faint colour noise every dark region carries into vivid blotches. Capping it
 * and topping the rest up with grey gives the right luminance, keeps the hue,
 * and gives up only the chroma that was never really there. And pure black has
 * no colour to scale at all, which is the case that makes `brightness` able to
 * lift it.
 */
export const TONE_RATIO_CAP = 8;

/**
 * Bring a linear colour back inside [0, 1] by pulling it toward grey.
 *
 * Exposure and the tone curve can push a channel past either end. Clipping
 * that channel would change the colour's hue and luminance together; scaling the
 * chroma vector down instead keeps both, and gives up only the chroma the
 * display cannot show. Untouched when the colour is already in range, so it
 * cannot disturb the identity.
 */
export function gamutFit(c) {
  const Y = dot(c, LUMA);
  if (Y >= 1) return [1, 1, 1];
  if (Y <= 0) return [0, 0, 0];
  let k = 1;
  for (const x of c) {
    if (x > 1) k = Math.min(k, (1 - Y) / (x - Y));
    else if (x < 0) k = Math.min(k, Y / (Y - x));
  }
  if (k >= 1) return c;
  return c.map((x) => Y + (x - Y) * k);
}

/**
 * Grade one encoded (sRGB) colour. Returns encoded colour.
 *
 * The result is formed as `input + (out − in)` in encoded space, with both
 * encodes taken from the same expression. With every dial neutral the linear
 * values are untouched, the difference is exactly zero, and the original is
 * returned bit for bit — no pow round trip is ever allowed to leak into the
 * identity.
 */
export function gradePixel(srgb, p) {
  const lin = srgb.map(toLinear);

  // Exposure: a gain on every channel.
  let c = lin.map((x) => x * p.gain);

  // Tone: the curve runs on encoded luminance and is applied as a ratio, so the
  // colour's chromaticity is untouched — up to TONE_RATIO_CAP, past which the
  // remaining luminance arrives as grey.
  const y = dot(c, LUMA);
  const ye = toSRGB(y);
  const yt = toneCurve(ye, p);
  if (yt !== ye) {
    const Yt = toLinear(yt);
    const Yl = toLinear(ye);
    const r = Yl > 1e-9 ? Math.min(Yt / Yl, TONE_RATIO_CAP) : 0;
    const grey = Math.max(Yt - Yl * r, 0);
    c = c.map((x) => x * r + grey);
  }

  // Exposure and tone can overflow; bring the colour back before measuring its
  // chroma, so the chroma dials start from something displayable.
  c = gamutFit(c);

  // Saturation and hue, in OKLab. Skipped at neutral: the OKLab round trip is
  // not exact, and the identity has to be.
  if (p.sat !== 1 || p.hueCos !== 1 || p.hueSin !== 0) c = chromaAdjust(c, p);

  return srgb.map((x, i) => Math.min(Math.max(x + (toSRGB(c[i]) - toSRGB(lin[i])), 0), 1));
}

/** Mix a graded colour back toward the original by the master intensity. */
export function applyIntensity(srgb, graded, intensity) {
  return srgb.map((x, i) => x + (graded[i] - x) * intensity);
}
