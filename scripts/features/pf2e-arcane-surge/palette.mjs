/**
 * GLUniverse Suite — Arcane Surge colour, derived from the suite palette.
 *
 * WebGL cannot read a CSS custom property, so shader colours have to come from
 * the JS palette mirror in `core/theme.mjs` — never from hexes written out
 * again here. This module is the one place that conversion happens, so a
 * retheme reaches both the veil and the burst.
 *
 * `anim.mjs` carries a literal copy of these floats because it must stay
 * dependency-free (the preview page inlines it as source, with no module
 * resolution available). That copy is the drift risk this file exists to
 * contain, and `tools/arcane-surge-check.mjs` asserts the two agree.
 */

import { PALETTE, hexToRgbFloat } from "../../core/theme.mjs";

/**
 * The teal→cyan arcane ramp, as GLSL float triples.
 *
 * `deep` is the near-black the veil sits over, `mid` the stabilised teal the
 * suite already uses to mean "held", `hot` the cyan it tears toward.
 */
export function rampFloats() {
  return {
    deep: hexToRgbFloat(PALETTE.ink2),
    mid: hexToRgbFloat(PALETTE.teal),
    hot: hexToRgbFloat(PALETTE.cyan),
  };
}

/** The palette keys the ramp is built from, so the check tool can verify the
 *  literal copy in `anim.mjs` against the same source this uses. */
export const RAMP_KEYS = Object.freeze({ deep: "ink2", mid: "teal", hot: "cyan" });

/**
 * Each severity tier's hue, as palette keys.
 *
 * These MUST match the `.glas-tier-*` accent remaps in
 * `styles/pf2e-arcane-surge.css` — the card and the full-screen verdict fire
 * together, and two different reds would read as two different results. The
 * check tool asserts the two lists agree.
 */
export const TIER_KEYS = Object.freeze({
  minor: "cyan",
  major: "warn",
  catastrophic: "warnDeep",
  breach: "hazard",
});

/** One tier's verdict colour as a GLSL float triple. */
export function tierFloats(tier) {
  const key = TIER_KEYS[tier] ?? TIER_KEYS.minor;
  return hexToRgbFloat(PALETTE[key]);
}

/**
 * Each stability level's hue, as palette keys.
 *
 * These MUST match the `.glas-level-*` accent remaps in
 * `styles/pf2e-arcane-surge.css`: the chip's marker is coloured by the CSS and
 * the cracks growing out of it by the shader, and the two sit two pixels apart.
 * The check tool asserts the two lists agree.
 *
 * `unbound` deliberately does NOT use `--gl-holo-b`, which the token file
 * aliases to `--gl-violet` — the ladder's two most dangerous rungs were
 * rendering in exactly the same colour, which is the one place on it where
 * telling them apart matters.
 */
export const LEVEL_KEYS = Object.freeze({
  stable: "teal",
  fraying: "cyan",
  unbound: "violet",
  unraveling: "orchid",
});

/**
 * One level's crack colour as a GLSL ramp.
 *
 * `deep` stays the near-black bed every arcane surface sits over; `mid` is the
 * level's own hue and `hot` its pale variant, which is what the energy running
 * along a crack tears toward.
 */
export function levelFloats(level) {
  const key = LEVEL_KEYS[level] ?? LEVEL_KEYS.stable;
  return {
    deep: hexToRgbFloat(PALETTE.ink2),
    mid: hexToRgbFloat(PALETTE[key]),
    hot: hexToRgbFloat(PALETTE[`${key}Hot`] ?? PALETTE[key]),
  };
}
