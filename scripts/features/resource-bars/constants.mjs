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
  segmentMode: PREFIX + "segmentMode",     // "count" | "perHp"
  segments: PREFIX + "segments",           // divisions across the fill, 0 = continuous
  segmentSize: PREFIX + "segmentSize",     // HP per division, when mode is perHp
  lowThreshold: PREFIX + "lowThreshold",   // percent at which the low state engages
  floatingDeltas: PREFIX + "floatingDeltas",
  pf2eLayers: PREFIX + "pf2eLayers",       // temp-HP shield plate + shield rail
  bloom: PREFIX + "bloom",                 // the post-process pass
  offsetX: PREFIX + "offsetX",             // world default nudge, in grid squares
  offsetY: PREFIX + "offsetY",

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

/**
 * Per-token flag keys, on the TokenDocument, under this package's flag scope.
 *
 * They share the `rb.` prefix with the settings for the same reason the
 * settings do: one package id owns every flag every feature writes, and the
 * prefix is the only thing keeping two features apart. A dot in a flag key
 * nests it — `getFlag(SUITE_ID, "rb.offsetX")` resolves through the object —
 * which is what lets the Token Config form name the field directly.
 */
export const FLAGS = Object.freeze({
  offsetX: PREFIX + "offsetX",
  offsetY: PREFIX + "offsetY",
});

/**
 * How far a nudge may go, in grid squares.
 *
 * Grid squares rather than pixels because everything else about the bar is
 * sized off the grid: an offset in pixels that reads correctly on a 100px-grid
 * scene puts the bar somewhere else entirely on a 70px one, and the GM would
 * have to re-nudge every token per scene.
 */
export const OFFSET = Object.freeze({ min: -3, max: 3, step: 0.05 });

/**
 * Division limits.
 *
 * `max` is a ceiling on the *computed* count, which only the per-HP mode can
 * reach: a 900 HP creature at one block per 5 HP asks for 180 divisions across
 * a bar that is forty pixels wide. The shader already fades a division out once
 * its gap falls under a device pixel, so nothing breaks without the cap — but
 * the count is also what sets the gap width, and past this many the bar is more
 * gap than plate long before the fade takes over.
 */
export const SEGMENTS = Object.freeze({ max: 60, sizeMin: 1, sizeMax: 100 });
