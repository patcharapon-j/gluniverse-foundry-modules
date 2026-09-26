/**
 * Stage character grade — the data model.
 *
 * Pure: no `game`, no `canvas`, no DOM. The check tool imports this under plain
 * Node, and the shader in gl.mjs is a transcription of `shadePixel` below, so
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
 * Some settings are not effects and have no neutral: the light's angle, a
 * layer's colour, how soft a ramp is. They only shape an effect whose own
 * amount dial decides whether it is there at all.
 *
 * Where each value lives:
 *   scene flag  `stage.grade`          the full stack for that room
 *   world       `stage.gradeDefaults`  the stack a scene starts from
 *   actor       `ppTrim` (library)     a small per-art correction
 */

import { clamp, hex6 } from "../../../core/util.mjs";

/** Schema version of a stored grade. */
export const GRADE_VERSION = 1;

/** Scene flag key; read and written through the suite id. */
export const GRADE_FLAG = "stage.grade";

/**
 * @typedef {object} DialSpec
 * @property {number} min
 * @property {number} max
 * @property {number} step
 * @property {number} default   What a fresh world starts from.
 * @property {number} [neutral] The value at which the dial is an exact no-op;
 *                              absent for settings that only shape an effect.
 */

const dial = (min, max, step, dflt, neutral) =>
  Object.freeze(neutral === undefined ? { min, max, step, default: dflt } : { min, max, step, default: dflt, neutral });

// ─── The layer stack ───
//
// Layers, in the order the shader applies them:
//
//   basic      basic correction — six dials, each owning one property:
//                exposure    gain in linear light — moves white, black stays put
//                brightness  lift — moves black, white stays put
//                gamma       midtones — black and white both stay put
//                contrast    slope about mid-grey — black, white, mid-grey stay put
//                saturation  chroma — lightness and hue stay put
//                hue         hue angle — lightness and chroma stay put
//              The four tone dials act on luminance as a ratio, so none of them
//              can shift chromaticity; the two colour dials act on the OKLab
//              chroma vector, so neither can shift lightness.
//   gradient   a ramp of the light's colour across the figure, lit side to dark
//              side, soft-light blended
//   wash       the room's colour over the whole figure, as a luminance-neutral
//              cast; and how far the figure darkens with Foundry's scene darkness
//   rim        light catching the edge that faces the lamp: the silhouette,
//              shifted toward the light and blurred, cut out of itself — the
//              inner-shadow model — screened on in the rim's colour
//   backShadow the side turned away from the lamp, darkened
//   looks      up to MAX_LOOKS colour looks (3D LUTs, lut.mjs), applied in
//              order, each at its own opacity
//   glow       the art's own highlights, bloomed and screened on over the
//              result — and spilling past the outline, which is the one place
//              the pass draws outside the art's coverage
//
// `light` is not a layer: it is the one light the scene has, shared by every
// layer that has a direction, so every character is lit from the same side.
// `skin` is not a layer either: it is how hard skin holds back the chromatic
// half of the colour layers (never their level — a face in a dark room darkens).

export const SECTIONS = Object.freeze({
  basic: Object.freeze({
    exposure: dial(-3, 3, 0.05, 0, 0),
    brightness: dial(-100, 100, 1, 0, 0),
    gamma: dial(0.25, 4, 0.01, 1, 1),
    contrast: dial(-100, 100, 1, 0, 0),
    saturation: dial(-100, 100, 1, 0, 0),
    hue: dial(-180, 180, 1, 0, 0),
  }),
  light: Object.freeze({
    /** Direction from the character toward the light, degrees: 0 right, 90 up,
     *  180 left, -90 down. */
    angle: dial(-180, 180, 1, 90),
    /** How much of the figure the light's falloff spans: 0 is a hard
     *  terminator across the middle, 100 a ramp from edge to edge. Shared by the
     *  gradient and the back shadow, which are the two sides of one falloff. */
    softness: dial(0, 100, 1, 70),
  }),
  gradient: Object.freeze({
    amount: dial(0, 100, 1, 55, 0),
  }),
  wash: Object.freeze({
    amount: dial(0, 100, 1, 60, 0),
    /** How far the figure dims at full scene darkness. */
    darkness: dial(0, 100, 1, 75, 0),
  }),
  rim: Object.freeze({
    amount: dial(0, 100, 1, 75, 0),
    /** How far in from the edge the rim reaches ("light depth"). */
    width: dial(0, 100, 1, 30),
    /** How soft the rim's inner edge is. */
    softness: dial(0, 100, 1, 40),
  }),
  backShadow: Object.freeze({
    amount: dial(0, 100, 1, 50, 0),
  }),
  glow: Object.freeze({
    amount: dial(0, 100, 1, 30, 0),
    /** How far the bloom spreads: 0 keeps it tight to the highlight, 100 lets
     *  the widest level of the bloom pyramid dominate. */
    radius: dial(0, 100, 1, 40),
    /** How bright a part of the art must be to glow at all. */
    threshold: dial(0, 100, 1, 65),
  }),
  skin: Object.freeze({
    guard: dial(0, 100, 1, 50),
  }),
});

/** Colour settings, per section, as `#rrggbb`. */
export const COLORS = Object.freeze({
  gradient: Object.freeze({ color: "#ffe6c4" }),
  wash: Object.freeze({ color: "#808080" }),
  rim: Object.freeze({ color: "#fff4e6" }),
});

/** Rim reach at `width` 100, as a fraction of the art's height. */
export const RIM_MAX_WIDTH = 0.06;

/** How far the back shadow darkens the far side at `amount` 100, in linear
 *  light. Never to black: a figure's shadow side still has the room in it. */
export const BACK_SHADOW_MAX = 0.7;

/** Width of the glow's threshold knee, in encoded luma. */
export const GLOW_KNEE = 0.15;

/** Glow strength at `amount` 100. */
export const GLOW_GAIN = 1.2;

/**
 * Levels in the bloom pyramid. Each halves the resolution of the one before,
 * starting at half the render size, so five reach about 1/64 of it — wide
 * enough for a soft glow that fills the air around a character.
 */
export const GLOW_LEVELS = 5;

/** Taps on the ring the rim's blur samples, plus one at the centre. */
export const RIM_TAPS = 8;

/** How quickly the rim reaches full strength across its edge. The directional
 *  difference it is built from rarely reaches 1 inside a soft rim. */
export const RIM_GAIN = 1.5;

// Kept as named exports because the actor trim and the check tool speak in
// basic-correction terms.
export const BASIC_DIALS = SECTIONS.basic;
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

/** How many looks one grade can stack. Each is a texture unit in the shader. */
export const MAX_LOOKS = 4;

/** A look's opacity, 0..100. Neutral at 0. */
export const LOOK_OPACITY = dial(0, 100, 1, 100, 0);

/** A look id: "builtin:<slug>" or "custom:<slug>". Stored data, never renamed. */
export const LOOK_ID_RE = /^(builtin|custom):[a-z0-9][a-z0-9-]{0,63}$/;

function buildGrade(pick) {
  const out = { v: GRADE_VERSION };
  for (const [section, dials] of Object.entries(SECTIONS)) {
    out[section] = {};
    for (const [key, spec] of Object.entries(dials)) out[section][key] = pick(spec);
    for (const [key, value] of Object.entries(COLORS[section] ?? {})) out[section][key] = value;
  }
  out.looks = [];
  out.seeded = false;
  return out;
}

/** Coerce a stored look stack: valid ids only, opacities in range, at most
 *  MAX_LOOKS, order kept. */
export function normalizeLooks(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const entry of raw) {
    if (out.length >= MAX_LOOKS) break;
    const id = typeof entry?.id === "string" ? entry.id : "";
    if (!LOOK_ID_RE.test(id)) continue;
    out.push({ id, opacity: readDial(LOOK_OPACITY, entry.opacity, LOOK_OPACITY.default) });
  }
  return out;
}

const deepFreeze = (o) => {
  for (const v of Object.values(o)) if (v && typeof v === "object") deepFreeze(v);
  return Object.freeze(o);
};

/** What a fresh world's default grade is. Not neutral: a scene nobody has
 *  graded should still look like it belongs to the room. */
export const DEFAULT_GRADE = deepFreeze(buildGrade((spec) => spec.default));

/** Every effect at its no-op. Returns the art untouched. */
export const NEUTRAL_GRADE = deepFreeze(buildGrade((spec) => spec.neutral ?? spec.default));

/** The trim an actor with nothing stored gets. */
export const DEFAULT_TRIM = Object.freeze(
  Object.fromEntries(TRIM_KEYS.map((key) => [key, BASIC_DIALS[key].neutral]))
);

function readDial(spec, raw, fallback) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback ?? spec.neutral ?? spec.default;
  return clamp(n, spec.min, spec.max);
}

/**
 * Coerce anything stored into a complete, in-range grade.
 *
 * Missing sections, dials and colours come from `fallback` — the world default
 * when reading a scene — so a grade stored by an older build reads back as
 * exactly what it said, plus the table's own defaults for what it did not know
 * about. Always returns every key of the schema: grade-store writes by merge
 * and relies on that to replace every stored value.
 */
export function normalizeGrade(raw, fallback = DEFAULT_GRADE) {
  const src = raw && typeof raw === "object" ? raw : {};
  const base = fallback && typeof fallback === "object" ? fallback : DEFAULT_GRADE;
  const out = { v: GRADE_VERSION };
  for (const [section, dials] of Object.entries(SECTIONS)) {
    const s = src[section] && typeof src[section] === "object" ? src[section] : {};
    const b = base[section] && typeof base[section] === "object" ? base[section] : DEFAULT_GRADE[section];
    out[section] = {};
    for (const [key, spec] of Object.entries(dials)) {
      const fb = readDial(spec, b[key], spec.default);
      out[section][key] = key in s ? readDial(spec, s[key], fb) : fb;
    }
    for (const [key, dflt] of Object.entries(COLORS[section] ?? {})) {
      const fb = hex6(String(b[key] ?? ""), dflt).toLowerCase();
      out[section][key] = hex6(String(s[key] ?? ""), fb).toLowerCase();
    }
  }
  out.looks = normalizeLooks(Array.isArray(src.looks) ? src.looks : base.looks);
  out.seeded = "seeded" in src ? src.seeded === true : base.seeded === true;
  return out;
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

/** Interpolate two normalized grades — the scene-change tween. Dials ease;
 *  colours ease in linear light; the light angle takes the short way round. */
export function lerpGrade(a, b, t) {
  const out = { v: GRADE_VERSION, seeded: b.seeded, looks: lerpLooks(a.looks ?? [], b.looks ?? [], t) };
  for (const [section, dials] of Object.entries(SECTIONS)) {
    out[section] = {};
    for (const key of Object.keys(dials)) {
      const from = a[section][key];
      let to = b[section][key];
      if (section === "light" && key === "angle") {
        let d = to - from;
        d -= 360 * Math.round(d / 360);
        out[section][key] = from + d * t;
        continue;
      }
      out[section][key] = from + (to - from) * t;
    }
    for (const key of Object.keys(COLORS[section] ?? {})) {
      const ca = hexToLinear(a[section][key]);
      const cb = hexToLinear(b[section][key]);
      out[section][key] = linearToHex(ca.map((x, i) => x + (cb[i] - x) * t));
    }
  }
  return out;
}

/**
 * The look stack mid-tween. The same looks in the same order ease their
 * opacities; a different stack cannot be crossfaded in MAX_LOOKS slots, so the
 * new one fades in from nothing instead.
 */
function lerpLooks(a, b, t) {
  const same = a.length === b.length && a.every((l, i) => l.id === b[i].id);
  if (t >= 1) return b.map((l) => ({ ...l }));
  if (same) return b.map((l, i) => ({ id: l.id, opacity: a[i].opacity + (l.opacity - a[i].opacity) * t }));
  return b.map((l) => ({ id: l.id, opacity: l.opacity * t }));
}

// ─── Resolution to shader parameters ───

/** `#rrggbb` → encoded 0..1 triplet. */
export function hexToRgb(hex) {
  const h = hex6(String(hex ?? ""), "#808080");
  return [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
}

export function hexToLinear(hex) {
  return hexToRgb(hex).map(toLinear);
}

export function linearToHex(lin) {
  const ch = (x) => Math.round(Math.min(Math.max(toSRGB(x), 0), 1) * 255).toString(16).padStart(2, "0");
  return `#${ch(lin[0])}${ch(lin[1])}${ch(lin[2])}`;
}

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
  const b = normalizeGrade({ basic }, NEUTRAL_GRADE).basic;
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

/** Largest channel gain a wash cast may apply. A saturated room colour
 *  normalised to unit luminance can otherwise ask for 10× on one channel. */
export const WASH_CAST_MAX = 4;

/**
 * Everything the shader takes, for one character in one room.
 *
 * @param {object} grade   A normalized grade.
 * @param {object} trim    The actor's trim.
 * @param {object} ctx
 * @param {number} ctx.aspect    Art width / height.
 * @param {number} ctx.darkness  Foundry's scene darkness, 0..1.
 */
export function stackParams(grade, trim = DEFAULT_TRIM, { aspect = 0.5, darkness = 0 } = {}) {
  const g = normalizeGrade(grade, NEUTRAL_GRADE);
  const rad = (g.light.angle * Math.PI) / 180;

  // The wash cast: the room's colour at unit luminance, so it moves hue and
  // leaves level alone. A saturated room would ask for a huge gain on one
  // channel; the cast is pulled toward white until no channel exceeds
  // WASH_CAST_MAX, which keeps its luminance at exactly 1 (moving along the
  // line to (1,1,1) cannot change a LUMA-weighted sum that is 1 at both ends).
  const washLin = hexToLinear(g.wash.color);
  const washY = Math.max(washLin[0] * LUMA[0] + washLin[1] * LUMA[1] + washLin[2] * LUMA[2], 1e-4);
  let cast = washLin.map((x) => x / washY);
  const castPeak = Math.max(...cast);
  if (castPeak > WASH_CAST_MAX) {
    const k = (WASH_CAST_MAX - 1) / (castPeak - 1);
    cast = cast.map((x) => 1 + (x - 1) * k);
  }

  const asp = Math.max(Number(aspect) || 0.5, 0.05);
  // Image space: +Y is down, so "up" is a negative Y.
  const dir = [Math.cos(rad), -Math.sin(rad)];

  // The rim, in the art's uv. Lengths are measured in units of the art's
  // height and divided by the aspect on x, so the rim is as wide on the side of
  // a tall portrait as it is on top of it. A rim with no reach is no rim.
  const reach = (g.rim.width / 100) * RIM_MAX_WIDTH;
  const blur = reach * (0.25 + g.rim.softness / 100);

  return {
    ...basicParams(g.basic, trim),
    aspect: asp,
    lightDir: dir,
    lightSoft: 0.08 + 0.92 * (g.light.softness / 100),
    gradAmount: g.gradient.amount / 100,
    gradColor: hexToRgb(g.gradient.color),
    washAmount: g.wash.amount / 100,
    washCast: cast,
    darkGain: 1 - Math.min(Math.max(Number(darkness) || 0, 0), 1) * (g.wash.darkness / 100),
    rimAmount: reach > 0 ? g.rim.amount / 100 : 0,
    rimOffset: [(dir[0] * reach) / asp, dir[1] * reach],
    rimRadius: [blur / asp, blur],
    rimColor: hexToRgb(g.rim.color),
    backAmount: (g.backShadow.amount / 100) * BACK_SHADOW_MAX,
    glowAmount: g.glow.amount / 100,
    glowSpread: g.glow.radius / 100,
    glowThreshold: g.glow.threshold / 100,
    // Slot i of the shader's look stack. The renderer resolves each id to a
    // LUT; an id it cannot resolve is drawn at opacity 0.
    lookIds: g.looks.map((l) => l.id),
    lookAmounts: Array.from({ length: MAX_LOOKS }, (_, i) => (g.looks[i] ? g.looks[i].opacity / 100 : 0)),
    skin: g.skin.guard / 100,
  };
}


// ─── The reference implementation ───
//
// `shadePixel` is the shader, written out in JavaScript. gl.mjs transcribes it
// into GLSL line for line; the check tool asserts the rules above against this,
// and the browser harness asserts that the GLSL agrees with it. Change one and
// you must change the other.

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


// ── Skin ──
// A blue night scene applied honestly turns every face in the cast blue, and
// nobody reads that as moonlight; they read it as broken, because the eye's
// tolerance for a shifted skin tone is far narrower than for any other colour.
// So skin holds back the *chromatic* half of the colour layers and takes their
// level in full: a face in a dark room darkens without changing hue.
//
// Detection is a soft ellipse in chroma (Cb/Cr), where every human complexion
// clusters while luma varies widely. Measured on the *original* art's encoded
// colour — the space the cluster was measured in, and before any layer has had
// a chance to move a face out of it.
export const SKIN_CENTRE = Object.freeze([0.395, 0.598]);
export const SKIN_RADIUS = Object.freeze([0.105, 0.078]);

const smoothstep = (e0, e1, x) => {
  const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1);
  return t * t * (3 - 2 * t);
};

export function skinMask(srgb) {
  const [r, g, b] = srgb;
  const cb = -0.169 * r - 0.331 * g + 0.5 * b + 0.5;
  const cr = 0.5 * r - 0.419 * g - 0.081 * b + 0.5;
  const d = Math.hypot((cb - SKIN_CENTRE[0]) / SKIN_RADIUS[0], (cr - SKIN_CENTRE[1]) / SKIN_RADIUS[1]);
  const inside = 1 - smoothstep(0.7, 1.3, d);
  // Chroma means nothing near black (quantisation) or white (a blown highlight).
  const l = dot(srgb, LUMA);
  return inside * smoothstep(0.06, 0.18, l) * (1 - smoothstep(0.86, 0.98, l));
}

/**
 * Keep a layer's change of level, and hold back its change of colour by `k`.
 *
 * The held-back colour is `before` rescaled to `after`'s luminance — the same
 * chromaticity at the new level.
 */
export function guardSkin(before, after, k) {
  if (k <= 0) return after;
  const Yb = dot(before, LUMA);
  if (Yb <= 1e-9) return after;
  const r = dot(after, LUMA) / Yb;
  return after.map((x, i) => x + (before[i] * r - x) * k);
}

// ── Directional light ──

/**
 * How lit a point of the art is by the scene light: 1 on the lit side, 0 on the
 * far side, a ramp between. `uv` is the art's own 0..1 coordinates (+Y down);
 * the art is made isotropic first so a 45° light is 45° on a tall portrait too.
 */
export function litWeight(uv, p) {
  const px = (uv[0] - 0.5) * p.aspect;
  const py = uv[1] - 0.5;
  const dx = p.lightDir[0];
  const dy = p.lightDir[1];
  const half = 0.5 * (Math.abs(dx) * p.aspect + Math.abs(dy));
  const t = (px * dx + py * dy) / Math.max(half, 1e-6);
  return smoothstep(-p.lightSoft, p.lightSoft, t);
}

/** The blurred silhouette around a point: the centre and a ring of taps. */
export function ringAlpha(cx, cy, p, alphaAt) {
  let sum = alphaAt(cx, cy);
  for (let i = 0; i < RIM_TAPS; i++) {
    const a = (i * 2 * Math.PI) / RIM_TAPS;
    sum += alphaAt(cx + Math.cos(a) * p.rimRadius[0], cy + Math.sin(a) * p.rimRadius[1]);
  }
  return sum / (RIM_TAPS + 1);
}

/**
 * How much rim light lands on a point: the inner-shadow model, made
 * directional.
 *
 * The blurred silhouette here, minus the blurred silhouette shifted toward the
 * light, is high exactly where moving toward the lamp leaves the figure — the
 * edge that faces it. Using the shifted silhouette alone (the plain inner
 * shadow) also lights every edge the blur reaches, including ones that run
 * parallel to the light, which reads as an outline rather than a rim. Where the
 * art is cut off by its own frame, coverage clamps at the border, so a cropped
 * bust gets no false rim along the crop. `alphaAt(u, v)` samples the art's
 * coverage — the shader's texture, or the harness's copy of it.
 */
export function rimMask(uv, alpha, p, alphaAt) {
  const here = ringAlpha(uv[0], uv[1], p, alphaAt);
  const shifted = ringAlpha(uv[0] + p.rimOffset[0], uv[1] + p.rimOffset[1], p, alphaAt);
  return alpha * Math.min(Math.max((here - shifted) * RIM_GAIN, 0), 1);
}

/** Screen, per channel, on encoded values. */
export function screen(b, s) {
  return 1 - (1 - b) * (1 - s);
}

/** W3C soft-light, per channel, on encoded values. */
export function softLight(b, s) {
  if (s <= 0.5) return b - (1 - 2 * s) * b * (1 - b);
  const d = b <= 0.25 ? ((16 * b - 12) * b + 4) * b : Math.sqrt(b);
  return b + (2 * s - 1) * (d - b);
}

/** Basic correction on a linear colour. */
export function basicCorrect(lin, p) {
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
  return c;
}

/**
 * The whole stack for one pixel. `srgb` is the original art's encoded colour,
 * `uv` its position in the art, `alpha` its coverage, and `alphaAt(u, v)`
 * samples coverage anywhere in the art (the rim needs its neighbourhood).
 * Returns encoded colour, before master intensity.
 *
 * The result is formed as `input + (out − in)` in encoded space, with both
 * encodes taken from the same expression. With every layer neutral the linear
 * values are untouched, the difference is exactly zero, and the original is
 * returned bit for bit — no pow round trip is ever allowed to leak into the
 * identity. Every layer is skipped outright at its neutral value for the same
 * reason.
 */
export function shadePixel(srgb, uv, p, alphaAt = null, alpha = 1, looks = null) {
  const lin = srgb.map(toLinear);
  const guard = p.skin * skinMask(srgb);

  let c = basicCorrect(lin, p);

  // Gradient: the light's colour, soft-light blended, ramping from the lit side.
  if (p.gradAmount > 0) {
    const w = p.gradAmount * litWeight(uv, p);
    if (w > 0) {
      const e = c.map(toSRGB);
      const lit = e.map((x, i) => {
        const b = Math.min(Math.max(x, 0), 1);
        return x + (softLight(b, p.gradColor[i]) - x) * w;
      });
      c = guardSkin(c, lit.map(toLinear), guard);
    }
  }

  // Wash: the room's colour, as a cast that moves hue and not level.
  if (p.washAmount > 0) {
    const cast = c.map((x, i) => x * (1 + (p.washCast[i] - 1) * p.washAmount));
    c = guardSkin(c, cast, guard);
  }
  // …and the room's darkness, which is level only — skin takes it in full.
  if (p.darkGain !== 1) c = c.map((x) => x * p.darkGain);

  // Rim: the edge facing the lamp, screened on in the rim's colour. It is
  // light, not pigment, so skin takes it as it is.
  if (p.rimAmount > 0 && alphaAt) {
    const w = p.rimAmount * rimMask(uv, alpha, p, alphaAt);
    if (w > 0) {
      const e = c.map(toSRGB);
      c = e.map((x, i) => toLinear(x + (screen(Math.min(Math.max(x, 0), 1), p.rimColor[i]) - x) * w));
    }
  }

  // Back shadow: the side turned away from the lamp, darker. Level only.
  if (p.backAmount > 0) {
    const k = 1 - p.backAmount * (1 - litWeight(uv, p));
    if (k !== 1) c = c.map((x) => x * k);
  }

  c = gamutFit(c);

  // Looks: each LUT applied in order at its own opacity, on encoded colour.
  // `looks[i]` is the strip for slot i (lut.mjs `sampleStrip`), or null.
  if (looks) {
    for (let i = 0; i < MAX_LOOKS; i++) {
      const w = p.lookAmounts[i];
      if (!(w > 0) || !looks[i]) continue;
      const e = c.map((x) => Math.min(Math.max(toSRGB(x), 0), 1));
      const graded = looks[i].sample(e);
      c = guardSkin(c, e.map((x, k) => toLinear(x + (graded[k] - x) * w)), guard);
    }
  }
  return srgb.map((x, i) => Math.min(Math.max(x + (toSRGB(c[i]) - toSRGB(lin[i])), 0), 1));
}

// ── Bloom ──
//
// The glow is a bloom: the art's bright parts, blurred over a pyramid of
// progressively smaller images and blended back up. A single pass of taps over
// a wide radius leaves visible copies of every sharp highlight; a pyramid does
// not, at any radius, because each level only ever blurs by a pixel or two of
// its own resolution.
//
//   down 0   the bright pass, at half resolution: four bilinear taps, each
//            thresholded, so every output texel averages a 4×4 block
//   down k   the same four-tap box, from the level above
//   up k     the level's own down result, mixed with a tent-filtered copy of
//            the level below by a per-level weight (`bloomWeights`)
//
// The weights make the result the *normalised sum* of every level, each one
// `spread` times the weight of the level above it: at spread 0 only the finest
// level counts, at spread 1 every level counts equally. A plain mix toward the
// coarser level would let the coarsest replace the rest and wash the core out;
// a plain sum would overflow an 8-bit render target. The weighted mix is that
// normalised sum, one level at a time, and never leaves 0..1.
//
// The images hold premultiplied bright colour. This reference runs the same
// passes on the CPU, sampling exactly as the GPU does (bilinear between texel
// centres, clamped at the edges), so the browser harness can compare them.

/** A float RGBA image: `{ width, height, data }`, premultiplied. */
function makeImage(width, height) {
  return { width, height, data: new Float32Array(width * height * 4) };
}

/** Bilinear sample of an image at uv, clamped at the edges, like a texture. */
export function sampleImage(img, u, v) {
  const { width: W, height: H, data } = img;
  const tx = Math.min(Math.max(u * W - 0.5, 0), W - 1);
  const ty = Math.min(Math.max(v * H - 0.5, 0), H - 1);
  const x0 = Math.floor(tx);
  const y0 = Math.floor(ty);
  const x1 = Math.min(x0 + 1, W - 1);
  const y1 = Math.min(y0 + 1, H - 1);
  const fx = tx - x0;
  const fy = ty - y0;
  const out = [0, 0, 0, 0];
  for (let k = 0; k < 4; k++) {
    const a = data[(y0 * W + x0) * 4 + k];
    const b = data[(y0 * W + x1) * 4 + k];
    const c = data[(y1 * W + x0) * 4 + k];
    const d = data[(y1 * W + x1) * 4 + k];
    out[k] = (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
  }
  return out;
}

/** The bright pass on one premultiplied texel: its colour, kept by how far its
 *  luma clears the threshold. Premultiplied out. */
export function brightPass(t, threshold) {
  const a = Math.max(t[3], 0.0039);
  const c = [t[0] / a, t[1] / a, t[2] / a];
  const k = smoothstep(threshold, threshold + GLOW_KNEE, dot(c, LUMA)) * t[3];
  return [c[0] * k, c[1] * k, c[2] * k, k];
}

/** Sizes of the pyramid for a render of `width` × `height`. */
export function bloomSizes(width, height) {
  const sizes = [];
  let w = width;
  let h = height;
  for (let i = 0; i < GLOW_LEVELS; i++) {
    w = Math.max(1, Math.round(w / 2));
    h = Math.max(1, Math.round(h / 2));
    sizes.push([w, h]);
    if (w === 1 && h === 1) break;
  }
  return sizes;
}

/** Offsets of the four-tap box, in source texels. */
export const DOWN_TAPS = Object.freeze([[-1, -1], [1, -1], [-1, 1], [1, 1]]);

/** The four-tap box downsample; `bright` applies the bright pass per tap. */
function downsample(src, w, h, threshold, bright) {
  const out = makeImage(w, h);
  const ox = 1 / src.width;
  const oy = 1 / src.height;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const u = (x + 0.5) / w;
      const v = (y + 0.5) / h;
      const acc = [0, 0, 0, 0];
      for (const [dx, dy] of DOWN_TAPS) {
        let t = sampleImage(src, u + dx * ox, v + dy * oy);
        if (bright) t = brightPass(t, threshold);
        for (let k = 0; k < 4; k++) acc[k] += t[k] * 0.25;
      }
      out.data.set(acc, (y * w + x) * 4);
    }
  }
  return out;
}

/**
 * The mix weight of each up step, finest first. With N the normaliser of the
 * accumulated level below (N = 1 at the coarsest), the step is
 * (fine + s·N·tent) / (1 + s·N), which is a mix toward the tent by s·N/(1+s·N).
 */
export function bloomWeights(levels, spread) {
  const weights = new Array(Math.max(levels - 1, 0));
  let n = 1;
  for (let i = levels - 2; i >= 0; i--) {
    weights[i] = (spread * n) / (1 + spread * n);
    n = 1 + spread * n;
  }
  return weights;
}

/** The up step: this level's own result, mixed toward a 3×3 tent of the
 *  coarser level by `weight`. */
function upsample(fine, coarse, weight) {
  const out = makeImage(fine.width, fine.height);
  const ox = 1 / coarse.width;
  const oy = 1 / coarse.height;
  for (let y = 0; y < fine.height; y++) {
    for (let x = 0; x < fine.width; x++) {
      const u = (x + 0.5) / fine.width;
      const v = (y + 0.5) / fine.height;
      const tent = [0, 0, 0, 0];
      for (let j = -1; j <= 1; j++) {
        for (let i = -1; i <= 1; i++) {
          const w = ((i === 0 ? 2 : 1) * (j === 0 ? 2 : 1)) / 16;
          const t = sampleImage(coarse, u + i * ox, v + j * oy);
          for (let k = 0; k < 4; k++) tent[k] += t[k] * w;
        }
      }
      const f = sampleImage(fine, u, v);
      out.data.set(f.map((x2, k) => x2 + (tent[k] - x2) * weight), (y * fine.width + x) * 4);
    }
  }
  return out;
}

/**
 * The whole pyramid, on the CPU. `art` is the premultiplied art image. Returns
 * the finished bloom at half resolution — what the shader samples as `u_bloom`.
 */
export function bloomPyramid(art, p) {
  const sizes = bloomSizes(art.width, art.height);
  const down = [];
  let src = art;
  sizes.forEach(([w, h], i) => {
    src = downsample(src, w, h, p.glowThreshold, i === 0);
    down.push(src);
  });
  const weights = bloomWeights(down.length, p.glowSpread);
  let up = down[down.length - 1];
  for (let i = down.length - 2; i >= 0; i--) up = upsample(down[i], up, weights[i]);
  return up;
}

/** The glow's emission from a bloom sample, encoded. Scaled by the scene's
 *  darkness, so a dark room's highlights glow less. */
export function glowFrom(bloom, p) {
  const k = p.glowAmount * GLOW_GAIN * p.darkGain;
  return [0, 1, 2].map((i) => Math.min(Math.max(bloom[i] * k, 0), 1));
}

/**
 * The shader's whole output for one fragment: premultiplied [r, g, b, a], after
 * master intensity. `texel` is the premultiplied texture value at `uv`,
 * `sample` samples the art anywhere, and `bloomAt` samples the finished bloom
 * — exactly what the shader reads.
 */
export function shadeFragment(texel, uv, p, sample, intensity = 1, bloomAt = null, looks = null) {
  const a = texel[3];
  const G = p.glowAmount > 0 && bloomAt ? glowFrom(bloomAt(uv[0], uv[1]), p) : null;
  if (a <= 0) {
    if (!G) return [0, 0, 0, 0];
    const ga = Math.max(G[0], G[1], G[2]);
    return [G[0] * intensity, G[1] * intensity, G[2] * intensity, ga * intensity];
  }
  const div = Math.max(a, 0.0039);
  const srgb = [texel[0] / div, texel[1] / div, texel[2] / div];
  let graded = shadePixel(srgb, uv, p, (u, v) => sample(u, v)[3], a, looks);
  if (G) graded = graded.map((x, i) => screen(Math.min(Math.max(x, 0), 1), G[i]));
  const out = srgb.map((x, i) => x + (graded[i] - x) * intensity);
  if (G && a < 1) {
    const ga = Math.max(G[0], G[1], G[2]) * intensity;
    return [...out.map((x, i) => x * a + G[i] * intensity * (1 - a)), a + ga * (1 - a)];
  }
  return [out[0] * a, out[1] * a, out[2] * a, a];
}

/** Basic correction alone, on an encoded colour — the first layer in
 *  isolation, which is how the check tool pins its six dials. */
export function gradePixel(srgb, p) {
  const lin = srgb.map(toLinear);
  const c = basicCorrect(lin, p);
  return srgb.map((x, i) => Math.min(Math.max(x + (toSRGB(c[i]) - toSRGB(lin[i])), 0), 1));
}

/** Mix a graded colour back toward the original by the master intensity. */
export function applyIntensity(srgb, graded, intensity) {
  return srgb.map((x, i) => x + (graded[i] - x) * intensity);
}

/** The identity parameters. Declared last: it runs the model at import. */
export const NEUTRAL_PARAMS = Object.freeze(stackParams(NEUTRAL_GRADE));
