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
  liquid: PREFIX + "liquid",               // ink | mercury | lava — the primary bar's material
  segmentMode: PREFIX + "segmentMode",     // "count" | "perHp"
  segments: PREFIX + "segments",           // divisions across the fill, 0 = continuous
  segmentSize: PREFIX + "segmentSize",     // HP per division, when mode is perHp
  dividers: PREFIX + "dividers",           // draw the divisions at all
  dividerWidth: PREFIX + "dividerWidth",   // gap between plates, in device pixels
  numbersForce: PREFIX + "numbersForce",   // player | hover | always | never
  lowThreshold: PREFIX + "lowThreshold",   // percent at which the low state engages
  floatingDeltas: PREFIX + "floatingDeltas",
  pf2eLayers: PREFIX + "pf2eLayers",       // temp-HP shield plate + shield rail
  breakFx: PREFIX + "breakFx",             // the initiative tracker's guard-break fracture
  bloom: PREFIX + "bloom",                 // the post-process pass
  offsetX: PREFIX + "offsetX",             // world default nudge, in grid squares
  offsetY: PREFIX + "offsetY",

  /* Client — these are about the viewer's eyes, so the viewer owns them. */
  motionTier: PREFIX + "motionTier",       // default | reduced | none
  ramp: PREFIX + "ramp",                   // default | safe
  numbers: PREFIX + "numbers",             // hover | always | never
  numberScale: PREFIX + "numberScale",     // readout size, × the bar-derived default

  /* ── Names ── The label on the bar (see name.mjs / mystify.mjs). Whether the
     table's names move onto the bars is the GM's; how big one person needs them
     is theirs. The size shares READOUT's range. */
  names: PREFIX + "names",                 // world: our label replaces Foundry's nameplate
  nameScale: PREFIX + "nameScale",         // client: label size, × the bar-derived default
});

/**
 * Bar geometry, in multiples of the scene's grid size.
 *
 * The *quad* is larger than the bar it contains — the shader insets the body to
 * leave room for the bloom to spill into — so these are quad heights, and the
 * visible bar is roughly 64% of them for the hero and 58% for a rail.
 */
export const LAYOUT = Object.freeze({
  tokenGap: 0.035,   // space below the token before the bar stack
  heroH: 0.24,        // quad height, × grid size
  railH: 0.10,
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

/**
 * How wide the gap between two plates is, in **pixels at 100% zoom**.
 *
 * World-sized, so the gap scales with the canvas. It used to be held at a fixed
 * number of device pixels, which was correct about the one thing it set out to
 * fix — a gap in geometry units is ~2px on a HiDPI display and sub-pixel on an
 * ordinary one — and wrong about zoom: six pixels at every zoom level is a
 * hairline on a zoomed-in bar and most of the plate on a zoomed-out one.
 *
 * The host divides this by the bar's world height before it reaches the shader
 * (`uSegW` is in bar heights), and the shader floors the result at a pixel and a
 * half. That floor is what keeps the old fix: a zoomed-out bar keeps its
 * divisions — the colour-blind position channel — rather than losing them.
 */
export const DIVIDER = Object.freeze({ min: 3, max: 14, step: 1, default: 6 });

/**
 * Readout size limits, as a multiplier on the size the bar's own height gives.
 *
 * A multiplier and not a pixel size: every other dimension in this feature is
 * derived from the scene's grid, so an absolute size that reads correctly on a
 * 100px-grid scene is either a smudge or a banner on a 70px one, and the whole
 * stack would need re-tuning per scene. Scaling the derived size keeps the
 * readout in proportion to the bar it belongs to at every zoom and grid size.
 */
export const READOUT = Object.freeze({ min: 0.6, max: 2, step: 0.05 });
