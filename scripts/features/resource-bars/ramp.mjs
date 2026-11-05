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

import { PALETTE, mix } from "../../core/theme.mjs";

/**
 * The two ramps, low health first (index 0 = empty, last = full).
 *
 * `default` is Ink and Signal's four verdict hues in order of danger: green →
 * amber → ember → red. Health is the one quantity on a bar that is a verdict,
 * which is the Signal Rule's whole condition for a hue.
 *
 * `safe` is the protan/deutan alternative offered as a client setting. It
 * abandons the red/green axis entirely for blue → cyan → amber → ember, which
 * separates on the axis those viewers still have, and separates on lightness
 * besides. Its cyan bridge is the one Etched Glass hue left on the bar, kept on
 * purpose: Ink and Signal has no hue between amber and info, and the straight
 * OKLab line between two opposite hues runs through grey, which is "muddy"
 * read as "neutral" in exactly the ramp that exists to stay legible.
 */
export const RAMPS = Object.freeze({
  default: Object.freeze([PALETTE.isRed, PALETTE.isEmber, PALETTE.isAmber, PALETTE.isGreen]),
  safe: Object.freeze([PALETTE.isEmber, PALETTE.isAmber, PALETTE.cyan, PALETTE.isInfo]),
});

/**
 * Three colours that sit off the ramp on purpose.
 *
 * The health ramp encodes *how hurt something is*. `bar2` is whatever the GM
 * bound it to — spell slots, ammo, morale — and painting a half-full ammo
 * counter the same orange as a half-dead creature says something false about
 * it. So the secondary rail carries no hue at all (`--gl-is-dim`, the Signal
 * Rule), and health semantics stay with the resource that has them.
 *
 * Temp HP and the shield rail share info blue on purpose — they are the same
 * idea (a buffer in front of your hit points, a fact with no verdict) and
 * should read as related. Temp is the lighter tint because it is drawn as a
 * pane over the liquid and has to read on top of it.
 */
export const TEMP_COLOR = mix(PALETTE.isInfo, PALETTE.isText, 0.45);
export const SHIELD_COLOR = PALETTE.isInfo;
export const RAIL_COLOR = PALETTE.isDim;

/**
 * The two golds the guard-break fracture is drawn in.
 *
 * They are the initiative tracker's fracture colours, reached through the
 * PALETTE names they are: `warn` is the #ffb12d that feature calls "breakAmber"
 * and `signalHot` the #ffe070 it calls "breakHot". Naming them here rather than
 * copying two float triples out of `features/initiative/constants.mjs` keeps the
 * suite's one rule about colour in JS — route it through the palette mirror,
 * never hardcode it — and `tools/resource-bar-check.mjs` pins the two features
 * against each other, because a crack that is gold on the token and a slightly
 * different gold on the bar is drift nobody would file a bug about.
 *
 * They are deliberately *not* ramp stops. The break is a state of the creature's
 * guard, not of its health, so it must not be reachable by the fill.
 */
export const BREAK_AMBER = PALETTE.warn;
export const BREAK_HOT = PALETTE.signalHot;

/**
 * The dying gauge's two orchids: `--gl-orchid`, which gl-tokens.css reserves for
 * "dying / unstable", and its hot twin. They are the initiative tracker's vein
 * colours (`veinBase` / `veinHot`), reached through the palette names they are,
 * and `tools/resource-bar-check.mjs` pins the two features against each other
 * for the break golds' reason: one dying creature, one orchid.
 *
 * Not ramp stops either. Dying is not a quantity of hit points.
 */
export const DYING_COLOR = PALETTE.orchid;
export const DYING_HOT = PALETTE.orchidHot;

/**
 * DEAD's steel: `--gl-is-steel`, Ink and Signal's quiet tone. The flatline's
 * line, DEAD's letters and the frame of a dead bar are drawn in it, and nothing
 * else on a dead bar has a hue — the one state on the map that is not a colour
 * is the one that is over.
 */
export const DEAD_STEEL = PALETTE.isSteel;

/**
 * The readout's inks. At rest it is paper text on an ink outline; an impact
 * drags it toward the signal for what happened (red for a hit, green for a
 * heal), and a floating delta is drawn in that signal outright. The signals are
 * tinted toward paper because a numeral is a few pixels of stroke over a moving
 * map, and the raw red and green are plate colours, not text colours at that
 * size.
 */
export const READOUT_INK = Object.freeze({
  rest: PALETTE.isText,
  hit: mix(PALETTE.isRed, PALETTE.isText, 0.3),
  heal: mix(PALETTE.isGreen, PALETTE.isText, 0.45),
  edge: PALETTE.isInk0,
});

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
