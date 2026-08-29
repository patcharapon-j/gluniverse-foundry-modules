/**
 * GLUniverse Suite — resource bars: settings keys and layout constants.
 *
 * Every setting key carries the `rb.` prefix, which is also declared as the
 * adapter's `settingPrefix` so the Control Center can route them. Nothing in
 * the suite checks that two features have not claimed the same prefix, so a
 * collision here would silently have one feature overwrite the other's values.
 */

export const FEATURE_ID = "resource-bars";
export const PREFIX = "rb.";

export const SETTINGS = Object.freeze({
  /* World — these change what the table reads, so the GM owns them. */
  enabledBars: PREFIX + "enabledBars",     // "both" | "primary"
  segments: PREFIX + "segments",           // divisions across the fill, 0 = continuous
  lowThreshold: PREFIX + "lowThreshold",   // percent at which the low state engages
  floatingDeltas: PREFIX + "floatingDeltas",
  pf2eLayers: PREFIX + "pf2eLayers",       // temp-HP shield plate + shield rail
  bloom: PREFIX + "bloom",                 // the post-process pass

  /* Client — these are about the viewer's eyes, so the viewer owns them. */
  motionTier: PREFIX + "motionTier",       // default | reduced | none
  ramp: PREFIX + "ramp",                   // default | safe
  numbers: PREFIX + "numbers",             // hover | always | never
});

/**
 * Bar geometry, in multiples of the scene's grid size.
 *
 * The *quad* is larger than the bar it contains — the shader insets the body to
 * leave room for the bloom to spill into — so these are quad heights, and the
 * visible bar is roughly 64% of them for the hero and 58% for a rail.
 */
export const LAYOUT = Object.freeze({
  heroH: 0.30,        // quad height, × grid size
  railH: 0.17,
  gap: 0.015,         // between stacked bars
  minHeroPx: 16,      // floors, in world pixels — a bar smaller than this is
  minRailPx: 9,       // unreadable no matter how big the token is
  maxHeroPx: 44,      // and ceilings, so a gargantuan creature does not get a
  maxRailPx: 24,      // slab the size of a doorway
});

/** Roles, matching `uRole` in the shader. */
export const ROLE = Object.freeze({ hero: 0, rail: 1, shield: 2 });
