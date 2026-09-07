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
