/**
 * GLUniverse Suite — resource bars: the health ramp.
 *
 * The fill's hue is a function of the health fraction (a resource bar's job is
 * legibility at 40px across a table, so meaning beats theme purity here — see
 * docs/RESOURCE_BARS.md). Every stop is an existing suite hue from
 * `core/theme.mjs`'s PALETTE; nothing new is introduced, and
 * `tools/resource-bar-check.mjs` pins that those values still equal the ones in
 * `styles/gl-tokens.css`.
 *
 * Interpolation happens in **OKLab**, not sRGB. A naive lerp from #5fdb92 to
 * #ffd24a passes through a desaturated olive that reads as "muddy green" rather
 * than "getting worse"; OKLab holds the chroma up across the whole ramp. The
 * conversion is done here, once, at settings-change time — the shader receives
 * OKLab triples and only pays for the inverse transform.
 */

import { PALETTE } from "../../core/theme.mjs";

/**
 * The two ramps, low health first (index 0 = empty, last = full).
 *
 * `default` runs green → yellow → orange → red. `signal` is skipped in favour
 * of `warnDeep`: #ffd24a and #ffb12d are close enough that spending a stop on
 * both turns the yellow→red half into one long orange.
 *
 * `safe` is the protan/deutan alternative offered as a client setting. It
 * abandons the red/green axis entirely for blue → cyan → yellow → orange, which
 * separates on the axis those viewers still have, and separates on lightness
 * besides.
 */
export const RAMPS = Object.freeze({
  default: Object.freeze([PALETTE.hazard, PALETTE.warnDeep, PALETTE.signal, PALETTE.good]),
  safe: Object.freeze([PALETTE.warnDeep, PALETTE.signal, PALETTE.cyan, PALETTE.info]),
});

/**
 * Three colours that sit off the ramp on purpose.
 *
 * The health ramp encodes *how hurt something is*. `bar2` is whatever the GM
 * bound it to — spell slots, ammo, morale — and painting a half-full ammo
 * counter the same orange as a half-dead creature says something false about
 * it. So the secondary rail routes through the suite accent instead, which is
 * exactly what the design system reserves `--gl-accent` for, and health
 * semantics stay with the resource that has them.
 *
 * Temp HP and the shield rail share the cyan family on purpose — they are the
 * same idea (a buffer in front of your hit points) and should read as related.
 * The secondary rail is the one that must not join them, which is why it takes
 * the accent and they do not.
 */
export const TEMP_COLOR = PALETTE.cyanHot;
export const SHIELD_COLOR = PALETTE.cyan;
export const RAIL_COLOR = PALETTE.accent;

/* ── sRGB ⇄ OKLab ────────────────────────────────────────────────────────
   Björn Ottosson's transform. Kept here rather than in core/theme.mjs because
   theme.mjs's colour maths is deliberately the small set every feature needs;
   this is the one feature that interpolates perceptually. */

const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));

/** "#rrggbb" → OKLab [L, a, b]. */
export function hexToOklab(hex) {
  const n = parseInt(String(hex).replace(/^#/, ""), 16);
  const r = toLinear(((n >> 16) & 255) / 255);
  const g = toLinear(((n >> 8) & 255) / 255);
  const b = toLinear((n & 255) / 255);

  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);

  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/**
 * The four OKLab stops for a ramp, flattened to a 12-float array — the layout
 * the `uRamp` uniform expects (`vec3 uRamp[4]`).
 */
export function rampUniform(mode = "default") {
  const stops = RAMPS[mode] ?? RAMPS.default;
  return Float32Array.from(stops.flatMap(hexToOklab));
}

/** "#rrggbb" → [r, g, b] in 0..1, for the off-ramp colours. */
export function hexToFloat3(hex) {
  const n = parseInt(String(hex).replace(/^#/, ""), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/**
 * Where the low-health state engages, and where the permanent "half gone" tick
 * sits. The tick is deliberately a mark rather than a colour event: dnd5e calls
 * 50% bloodied and PF2e does not, so it reads as information in one system and
 * as decoration in the other, which is the right failure mode.
 */
export const LOW_HEALTH_AT = 0.25;
export const HALF_TICK_AT = 0.5;
