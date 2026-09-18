/**
 * GLUniverse Suite — Arcane Surge colour, derived from the suite palette.
 *
 * WebGL cannot read a CSS custom property, so shader colours have to come from
 * the JS palette mirror in `core/theme.mjs` — never from hexes written out
 * again here. This module is the one place that conversion happens, so a
 * retheme reaches the beats and the dice. The standing weave is not on that
 * list any more: it is DOM, it reads the tokens directly, and it needs nothing
 * from here.
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
 * `deep` is the near-black the beats sit over, `mid` the stabilised teal the
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

/* THE STABILITY LEVELS' HUES ARE NOT HERE, and that is the point of this note.
 *
 * They used to be — a `LEVEL_KEYS` table feeding `levelFloats()`, because the
 * weave was a shader and a shader cannot read a CSS custom property. So each
 * rung's colour was stated twice, once here and once as a `.glas-level-*`
 * accent remap, and the check tool existed to hold the two together. They drifted
 * anyway: `unbound` sat on `--gl-holo-b`, which `gl-tokens.css` aliases to
 * `--gl-violet`, so the ladder's two most dangerous rungs rendered in exactly
 * the same colour and every file involved looked correct.
 *
 * The weave is DOM now and takes `--gl-accent` straight from the chip it grows
 * out of, so the four remaps in `styles/pf2e-arcane-surge.css` are the only
 * statement of that colour and there is nothing left to drift. The check tool
 * still reads them — four distinct tokens, each with a `-hot` sibling for the
 * energy running along a thread — it just reads them in one place now.
 */

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
 * THE BODY IS BLACK GLASS. A transmissive material carries its tint through the
 * whole casting instead of painting it on, so `ink1` does not render as a black
 * SURFACE — it renders as smoked glass: the frost still catches light, the
 * bevels still take the edge colour, and what passes through the die is dimmed
 * rather than coloured. An earlier pass here used `apex`, a lit violet, on the
 * reasoning that a near-black body would come out as a void. That reasoning was
 * sound only while the die had nothing else in it; with the glyph emitting and
 * the frost lit, black is the material the die wanted all along.
 *
 * It costs the hue axis, though, and that is the thing to hold on to: at this
 * value a hue is not a colour anybody can see, so the mark can no longer read
 * against the body by BEING a different hue. It reads by VALUE instead — 0.77
 * of relative luminance between them, and blowing to white at the eye. That is
 * why the check measures either axis and insists on one of them.
 *
 * `edge` is doing real work now rather than trimming. It is the only thing that
 * gives a black die a silhouette: DSN paints the bevels between the faces with
 * it, and without a lit edge the die is a hole in the table that happens to have
 * numbers on it. `violet` rather than `violetHot` because on black the pale one
 * was the loudest thing on the die.
 *
 * The glyph stays in the COOL arcane family rather than going hot, because the
 * severity tiers own amber and red (`TIER_KEYS`) and a surge glyph in warn
 * would announce a Major before the severity has been rolled.
 */
export const DIE_KEYS = Object.freeze({
  body: "ink1",
  edge: "violet",
  glyph: "cyan",
});

/** The surge glyph's emission, as a float triple. */
export function glyphFloats() {
  return hexToRgbFloat(PALETTE[DIE_KEYS.glyph]);
}
