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

/**
 * The 3D dice: the glass, and the mark burning inside it.
 *
 * ONE STATEMENT, IN ONE PLACE, BECAUSE THESE TWO ARE ONLY MEANINGFUL AGAINST
 * EACH OTHER. The body is the colour of the casting; the glyph is the answer
 * the die exists to give. They are written in two entirely different files —
 * the body reaches Dice So Nice as a colorset field, the glyph is baked into an
 * emissive PNG by `tools/gen-surge-textures.mjs` — and the first version of
 * this had both landing on the suite's teal. A teal mark inside a teal die is
 * a die that answers nothing, and both halves looked perfectly correct in their
 * own file.
 *
 * So they are keys here, the check tool measures the angle between them, and
 * neither file states a colour of its own.
 *
 * `apex` is the suite's deep arcane violet: dark enough that a lit mark reads
 * against it, saturated enough to be a glass and not a smoke, and — unlike the
 * near-blacks — bright enough to be a body at all on a transmissive material.
 * The glyph stays in the COOL arcane family rather than going hot, because the
 * severity tiers own amber and red (`TIER_KEYS`) and a surge glyph in warn
 * would announce a Major before the severity has been rolled.
 */
export const DIE_KEYS = Object.freeze({
  body: "apex",
  edge: "violetHot",
  glyph: "cyan",
});

/** The surge glyph's emission, as a float triple. */
export function glyphFloats() {
  return hexToRgbFloat(PALETTE[DIE_KEYS.glyph]);
}
