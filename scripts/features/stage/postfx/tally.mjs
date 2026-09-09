/**
 * Stage post-processing — measurement, and the match it feeds.
 *
 * The grade this feature applied for its first several versions was open-loop:
 * it measured the *room* and multiplied the art by a tint. Nothing ever looked
 * at the art. That is enough to make a character warmer or cooler, and it is not
 * enough to make one belong to a scene, because belonging is a statement about
 * two things at once — a portrait painted in flat daylight and one painted with
 * crushed blacks need opposite corrections to land in the same room, and a tint
 * cannot tell them apart.
 *
 * So both sides get measured, into the same shape:
 *
 *   black / mid / white   per channel, from a histogram — the tonal range
 *   mean                  per channel — the colour cast
 *   luma                  overall level
 *   sat                   overall chroma
 *
 * and {@link matchGrade} turns a pair of those into the correction. The four
 * components of that correction are **separable on purpose** — see below.
 *
 * Everything here is pure: no DOM, no GL, no settings. `tools/postfx-check.mjs`
 * pins it, which is the only reason any of it can be trusted, since a grade that
 * is subtly wrong looks exactly like art that was subtly wrong to begin with.
 */

import { clamp, clamp01 } from "../../../core/util.mjs";

const LUMA = [0.2126, 0.7152, 0.0722];

/** Histogram resolution. 64 bins puts the black point within 1.6% of its true
 *  value, which is finer than the difference between two JPEG encodes of the
 *  same painting — and a coarser histogram is a *steadier* one across the art
 *  a table actually owns. */
const BINS = 64;

/** Percentiles the tonal range is read at. Not 0 and 100: a single stray pixel
 *  — one specular ping, one anti-aliased corner of a signature — would then set
 *  the white point for the whole figure and the match would swing with it. */
const P_BLACK = 0.02;
const P_MID = 0.5;
const P_WHITE = 0.98;

/** Alpha (0..255) above which a pixel counts as part of the subject. Matches
 *  `FIGURE_ALPHA` in the prepass: measuring the antialiased fringe would fold
 *  the background the art was cut from into the subject's own black point. */
export const TALLY_ALPHA = 24;

/** Rec. 709 luma of a 0..1 triplet. */
export function luma(rgb) {
  return LUMA[0] * rgb[0] + LUMA[1] * rgb[1] + LUMA[2] * rgb[2];
}

/** Neutral stats — the identity of {@link matchGrade}. Anything that fails to
 *  measure returns this rather than a partial answer, so a decode failure makes
 *  the grade inert instead of making it wrong. */
export const NEUTRAL_STATS = Object.freeze({
  ok: false,
  black: Object.freeze([0, 0, 0]),
  mid: Object.freeze([0.5, 0.5, 0.5]),
  white: Object.freeze([1, 1, 1]),
  mean: Object.freeze([0.5, 0.5, 0.5]),
  luma: 0.5,
  sat: 0.25,
});

/** Read a percentile out of one channel's histogram. */
function percentile(hist, offset, total, p) {
  const target = total * p;
  let seen = 0;
  for (let b = 0; b < BINS; b++) {
    seen += hist[offset + b];
    if (seen >= target) return b / (BINS - 1);
  }
  return 1;
}

/**
 * Measure an RGBA byte buffer.
 *
 * Both call sites already hold one of these for their own reasons — the normal
 * prepass has the art at 256px, the scene sampler has the background at 32px —
 * so this costs one extra walk over a buffer that was being walked anyway, and
 * no decode of its own.
 *
 * @param {Uint8ClampedArray|Uint8Array} data  RGBA, 4 bytes per pixel.
 * @param {number} alphaMin  Alpha (0..255) below which a pixel is ignored.
 * @returns {object} stats, or {@link NEUTRAL_STATS} when nothing was covered.
 */
export function tallyPixels(data, alphaMin = TALLY_ALPHA) {
  if (!data || data.length < 4) return NEUTRAL_STATS;

  const hist = new Int32Array(BINS * 3);
  const sum = [0, 0, 0];
  let satSum = 0;
  let satWeight = 0;
  let count = 0;

  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < alphaMin) continue;
    const r = data[i] / 255;
    const g = data[i + 1] / 255;
    const b = data[i + 2] / 255;

    hist[((r * (BINS - 1)) | 0)]++;
    hist[BINS + ((g * (BINS - 1)) | 0)]++;
    hist[BINS * 2 + ((b * (BINS - 1)) | 0)]++;

    sum[0] += r;
    sum[1] += g;
    sum[2] += b;

    // HSV saturation, weighted by the pixel's own luma. Hue is undefined near
    // black and the quantisation there is savage — an unweighted mean over a
    // dark painting measures its noise floor rather than its colour.
    const hi = Math.max(r, g, b);
    const lo = Math.min(r, g, b);
    const l = luma([r, g, b]);
    satSum += (hi > 1e-4 ? (hi - lo) / hi : 0) * l;
    satWeight += l;
    count++;
  }

  if (count === 0) return NEUTRAL_STATS;

  const mean = [sum[0] / count, sum[1] / count, sum[2] / count];
  const at = (p) => [
    percentile(hist, 0, count, p),
    percentile(hist, BINS, count, p),
    percentile(hist, BINS * 2, count, p),
  ];

  return {
    ok: true,
    black: at(P_BLACK),
    mid: at(P_MID),
    white: at(P_WHITE),
    mean,
    luma: luma(mean),
    sat: satWeight > 1e-4 ? satSum / satWeight : 0,
  };
}

// ── Bounds ──
// Every component of the match is clamped, and the clamps are the difference
// between a grade and a disaster. The measurement can legitimately return an
// enormous ratio — a near-black portrait against a snowfield asks for 6× — and
// obeying it does not put the character in the room, it destroys the character.
// Past these the honest answer is that the art does not belong in that scene and
// no correction will fix it.

/** Brightness ratio. Asymmetric: lifting a dark figure into a bright room reads
 *  as washed out far sooner than dropping a bright one into a dark room reads as
 *  crushed, because the second is what a real dark room does to a real person. */
const BRIGHT_MIN = 0.45;
const BRIGHT_MAX = 1.7;

/** Contrast ratio about the subject's own mean. */
const GAIN_MIN = 0.65;
const GAIN_MAX = 1.6;

/** Per-channel cast. Tight, because this one is applied to skin. */
const CAST_MIN = 0.72;
const CAST_MAX = 1.4;

/** Saturation ratio. */
const SAT_MIN = 0.5;
const SAT_MAX = 1.55;

/** Blend a ratio toward its identity of 1 by weight `w`. */
function weigh(ratio, w) {
  return 1 + (ratio - 1) * clamp01(w);
}

/**
 * Work out how to move the subject's colour onto the scene's.
 *
 * The whole design of this function is that its four components are **separable
 * and individually inert**. Each returns its own identity when its weight is 0,
 * and each moves one property of the picture and no other:
 *
 * | component | moves | leaves alone |
 * | --- | --- | --- |
 * | `bright` | the mean level | contrast, hue, chroma |
 * | `gain` | contrast about `pivot` | the mean level, hue, chroma |
 * | `cast` | hue | the mean level (it is luma-normalised) |
 * | `sat` | chroma | the mean level, hue |
 *
 * That is not tidiness. A GM who does not like the result has to be able to find
 * out *which part* they do not like, and they can only do that if moving one
 * slider changes one thing. Fold brightness into the tonal match — the obvious
 * simplification, since a single per-channel affine does both at once and is one
 * multiply — and the two dials become two ways of asking the same question, so
 * neither of them answers it.
 *
 * The mean-preserving pivot is what buys that for the contrast term: a raw
 * black-to-white affine moves the average as a side effect, and then a stage
 * that only wanted more contrast quietly gets darker as well.
 *
 * @param {object} subject  Stats from {@link tallyPixels} over the character.
 * @param {object} scene    Stats from {@link tallyPixels} over the background.
 * @param {object} weights  { cast, sat, bright, tone } each 0..1.
 * @returns {{cast:number[], gain:number, pivot:number, bright:number, sat:number}}
 */
export function matchGrade(subject, scene, weights = {}) {
  const identity = { cast: [1, 1, 1], gain: 1, pivot: 0.5, bright: 1, sat: 1 };
  if (!subject?.ok || !scene?.ok) return identity;

  const wCast = clamp01(weights.cast ?? 0);
  const wSat = clamp01(weights.sat ?? 0);
  const wBright = clamp01(weights.bright ?? 0);
  const wTone = clamp01(weights.tone ?? 0);

  // ── Brightness ──
  const sLuma = Math.max(subject.luma, 1e-3);
  const bright = weigh(clamp(scene.luma / sLuma, BRIGHT_MIN, BRIGHT_MAX), wBright);

  // ── Contrast, about the subject's own mean ──
  // Read off the black-to-white span on each side. A subject with almost no
  // span — a silhouette, a logo — would ask for an enormous gain, so the
  // denominator is floored well above zero rather than merely above epsilon.
  const sSpan = Math.max(luma(subject.white) - luma(subject.black), 0.08);
  const rSpan = Math.max(luma(scene.white) - luma(scene.black), 0.08);
  const gain = weigh(clamp(rSpan / sSpan, GAIN_MIN, GAIN_MAX), wTone);

  // ── Cast ──
  // The ratio of the two mean colours, with the overall level divided back out
  // so this carries hue and nothing else. Means rather than white points: a
  // white point is one end of the histogram and on character art that end is
  // very often a specular highlight, which is the lamp's colour and not the
  // subject's, so matching on it partly cancels the thing being measured.
  const cast = [0, 1, 2].map((c) =>
    clamp(scene.mean[c] / Math.max(subject.mean[c], 1e-3), CAST_MIN, CAST_MAX)
  );
  const castLuma = Math.max(luma(cast), 1e-3);
  const castNorm = cast.map((v) => weigh(v / castLuma, wCast));

  // ── Saturation ──
  const sat = weigh(clamp(scene.sat / Math.max(subject.sat, 1e-3), SAT_MIN, SAT_MAX), wSat);

  return { cast: castNorm, gain, pivot: clamp01(sLuma), bright, sat };
}
