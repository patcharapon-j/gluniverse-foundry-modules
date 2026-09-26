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
import { normalizeGrade, linearToHex, toLinear } from "./grade-model.mjs";

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
  return mix(rgb.map((c) => c / peak), [1, 1, 1], 0.35).map(clamp01);
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
  // The wash is the room's colour, lightly pulled toward white so a saturated
  // room tints the cast rather than repainting it.
  g.wash.color = toHex(mix(ambient, [1, 1, 1], 0.15));
  // The light's colour is the background's where the light appears to be.
  const key = columnAt(sample, sample.centroid?.[0] ?? 0.5);
  g.gradient.color = toHex(toKeyLight(key));
  // The rim is the same lamp seen at a grazing angle: its colour, but hotter.
  g.rim.color = toHex(mix(toKeyLight(key), [1, 1, 1], 0.5));
  if (!sample.degraded && sample.centroid) {
    g.light.angle = lightAngleFrom(sample.centroid, sample.aspect);
  }
  g.seeded = true;
  return normalizeGrade(g);
}
