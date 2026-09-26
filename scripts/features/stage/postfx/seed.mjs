/**
 * Starting values for a scene's grade, proposed from its background.
 *
 * Pure: turns a background sample (scene-sample.mjs) into a grade. The result
 * is stored on the scene like any hand-set grade and is never recomputed on its
 * own — a GM who re-samples asks for it, and a GM who edits a value keeps it.
 *
 * Only colours and the light's direction are proposed. How *much* of each layer
 * a scene gets comes from the world default the seed starts from, because that
 * is a decision about the table's taste, and a background says nothing about it.
 */

import { clamp01 } from "../../../core/util.mjs";
import { columnAt } from "./scene-sample.mjs";
import { normalizeGrade, linearToHex, toLinear, toSRGB, linearToOklab, oklabToLinear, gamutFit } from "./grade-model.mjs";

/** Where a standing character's middle sits in the background, 0..1 (+Y down).
 *  Stage art is composited over the lower part of the frame. */
export const FIGURE_ANCHOR = Object.freeze([0.5, 0.68]);

const mix = (a, b, t) => a.map((x, i) => x + (b[i] - x) * t);

/**
 * Turn a sampled background colour into something that reads as a *light*.
 * Raw background colour is too dark and too desaturated to light with, so the
 * hue is kept, the brightest channel is normalised up, and the result is pulled
 * part-way to white — real key light is less saturated than what it lands on.
 * Encoded 0..1 in, encoded 0..1 out.
 */
export function toKeyLight(rgb) {
  const peak = Math.max(rgb[0], rgb[1], rgb[2], 0.001);
  return mix(rgb.map((c) => c / peak), [1, 1, 1], KEY_WHITEN).map(clamp01);
}

/** How far a key light is pulled toward white. Enough to read as light rather
 *  than paint; more and a blue room lights its cast in near-white. */
export const KEY_WHITEN = 0.2;

/** How far the rim is pulled further toward white than the key. */
export const RIM_WHITEN = 0.35;

/** How much the room's average colour is saturated before it becomes the wash.
 *  An average over a whole background is far greyer than the light the room
 *  reads as — a night street averages to a slate that is barely blue. */
export const WASH_CHROMA_BOOST = 2.2;

/** The least OKLab chroma a seeded wash carries once the room has a clear hue. */
export const WASH_CHROMA_MIN = 0.1;

/** Below this OKLab chroma a room is grey, and its hue is noise: it is only
 *  boosted, never lifted to WASH_CHROMA_MIN. */
const GREY_CHROMA = [0.01, 0.04];

const smoothstep = (a, b, x) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/**
 * The room's colour as a wash: its hue, at a chroma that reads as coloured
 * light. Lightness is fixed, since the cast is normalised to unit luminance
 * anyway, and set where the gamut leaves the most room for chroma.
 * Encoded 0..1 in, encoded 0..1 out.
 */
export function roomCast(rgb) {
  const lab = linearToOklab(rgb.map(toLinear));
  const C = Math.hypot(lab[1], lab[2]);
  if (C < 1e-4) return [...rgb];
  const boosted = C * WASH_CHROMA_BOOST;
  const target = boosted + Math.max(WASH_CHROMA_MIN - boosted, 0) * smoothstep(GREY_CHROMA[0], GREY_CHROMA[1], C);
  const k = target / C;
  const lin = gamutFit(oklabToLinear([0.72, lab[1] * k, lab[2] * k]));
  return lin.map((x) => clamp01(toSRGB(clamp01(x))));
}

/**
 * The light's angle, in degrees (0 right, 90 up), from a character standing at
 * FIGURE_ANCHOR toward the background's brightest region. Made isotropic with
 * the background's aspect first: across a 16:9 frame a step of 0.1 is nearly
 * twice the distance of the same step down it.
 */
export function lightAngleFrom(centroid, aspect = 16 / 9) {
  const dx = (centroid[0] - FIGURE_ANCHOR[0]) * aspect;
  const dy = FIGURE_ANCHOR[1] - centroid[1];
  if (Math.hypot(dx, dy) < 1e-6) return 90;
  return Math.round((Math.atan2(dy, dx) * 180) / Math.PI);
}

const toHex = (encoded) => linearToHex(encoded.map(toLinear));

/**
 * The seeded grade: `base` (normally the world default) with the colours and
 * the light direction read off the background. A degraded sample — no image,
 * only the scene's flat colour — proposes colours but keeps the base's light,
 * since a flat colour says nothing about where the light is.
 */
export function seedFromSample(sample, base) {
  const g = normalizeGrade(base);
  if (!sample?.ok) return { ...g, seeded: true };

  const ambient = sample.ambient ?? [0.5, 0.5, 0.5];
  // The wash is the room's hue, saturated: the background's average is much
  // greyer than the light it reads as (roomCast).
  g.wash.color = toHex(roomCast(ambient));
  // The light's colour is the background's where the light appears to be.
  const key = columnAt(sample, sample.centroid?.[0] ?? 0.5);
  g.gradient.color = toHex(toKeyLight(key));
  // The rim is the same lamp seen at a grazing angle: its colour, but hotter.
  g.rim.color = toHex(mix(toKeyLight(key), [1, 1, 1], RIM_WHITEN));
  if (!sample.degraded && sample.centroid) {
    g.light.angle = lightAngleFrom(sample.centroid, sample.aspect);
  }
  g.seeded = true;
  return normalizeGrade(g);
}
