/**
 * GLUniverse Suite — token conditions: settings keys and layout constants.
 *
 * Every setting key carries the `tc.` prefix, which is also declared as the
 * adapter's `settingPrefix` so the Control Center can route them. Nothing in
 * the suite checks that two features have not claimed the same prefix, so a
 * collision here would silently have one feature overwrite the other's values.
 */

export const FEATURE_ID = "token-conditions";
export const PREFIX = "tc.";

export const SETTINGS = Object.freeze({
  /* World — these change what the table reads, so the GM owns them. */
  showEffects: PREFIX + "showEffects",     // draw effects as well as conditions
  suppressCore: PREFIX + "suppressCore",   // hide Foundry's own icon grid
  maxPlates: PREFIX + "maxPlates",         // before the tail collapses to +N
  side: PREFIX + "side",                   // "left" | "right" flank
  bloom: PREFIX + "bloom",                 // the post-process pass
  offsetX: PREFIX + "offsetX",             // world default nudge, in grid squares
  offsetY: PREFIX + "offsetY",
  expiryWarn: PREFIX + "expiryWarn",       // rounds left at which a plate breathes

  /* Client — these are about the viewer's eyes, so the viewer owns them. */
  motionTier: PREFIX + "motionTier",       // default | reduced | none
  labels: PREFIX + "labels",               // hover | always | never
  scale: PREFIX + "scale",                 // plate size, × the grid-derived default
});

/**
 * Per-token flag keys, on the TokenDocument, under this package's flag scope.
 *
 * They share the `tc.` prefix with the settings for the same reason the settings
 * do: one package id owns every flag every feature writes, and the prefix is the
 * only thing keeping two features apart. A dot in a flag key nests it —
 * `getFlag(SUITE_ID, "tc.offsetX")` resolves through the object — which is what
 * lets a Token Config form name the field directly.
 */
export const FLAGS = Object.freeze({
  offsetX: PREFIX + "offsetX",
  offsetY: PREFIX + "offsetY",
});

/**
 * Rail geometry, in multiples of the scene's grid size.
 *
 * `plate` is the visible plate's edge. The *quad* drawn for it is larger — the
 * shader insets the body by `INSET` on every side to leave room for the bloom
 * to spill into — so the mesh is about 1.23× this on each axis and neighbouring
 * quads overlap slightly. That overlap is bleed, not collision.
 *
 * Everything is derived from the grid rather than from pixels for the reason the
 * resource bar's offsets are: an absolute size that reads correctly on a
 * 100px-grid scene is a smudge or a banner on a 70px one, and the whole stack
 * would need re-tuning per scene.
 *
 * ## Why the collapsed rail is packed, and packed *inside* the token
 *
 * A single column hanging off the token's flank is legible at three plates and
 * a liability at eight: a creature in the sixth round of a real fight carries
 * more conditions than a column can hold, and the column answers by growing
 * down through the two squares below it — over whatever is standing there. A
 * status readout that obscures the board it is describing has stopped being a
 * readout.
 *
 * So the collapsed rail is a *block*: as many rows as the token's own square
 * has room for, wrapping into a second and third column, entirely within the
 * token's footprint. Density costs area rather than trespass, and it grows in
 * the one direction that is unambiguously this creature's business — its own
 * square. The expanded form is under no such constraint; see `selScale`.
 */
export const LAYOUT = Object.freeze({
  plate: 0.185,       // plate edge, × grid size
  gap: 0.022,         // between plates in the packed block
  groupGap: 0.105,    // between the condition group and the effect group
  margin: 0.035,      // inset from the token's edge to the block
  /* Room left unused at the token's foot. Foundry draws its own resource bars
     and nameplate across the bottom of a token, and the suite's bar feature
     straddles the same edge; a plate in the bottom corner sits on top of one of
     them on most worlds. Reserved unconditionally rather than by asking another
     feature whether it is enabled — this file must not know that one exists. */
  foot: 0.13,
  /* Floors, in world pixels. Foundry's own effect icons on a 1×1 token are a
     fifth of the grid, so 14 is the size the eye is already used to reading a
     status glyph at, not a size invented here; above 46 a plate is a signpost. */
  minPx: 14,
  maxPx: 46,
  /* Ceilings on the packed block, so a token that somehow reads twenty effects
     cannot tile its own art. Past these the tail absorbs the remainder.

     `rowsMax` is what keeps the block a block on a large creature: a Huge token
     has room for eleven rows, and eleven plates down one edge of it is a stripe
     rather than a readout — it also puts the last plate a full two squares below
     the first, which is exactly the reading distance this layout exists to
     remove. Six rows fills a Large token and sits in the top corner of a Huge
     one, which is where the eye already goes. */
  rowsMax: 6,
  colsMax: 3,
  /* The expanded plate's edge, as a multiple of its packed edge. The packed
     block trades size for density; the name it shows on hover has to be read,
     so expanding restores the size the density spent. */
  selScale: 1.68,
  /* The expanded plate, as a multiple of its *expanded* edge. Capped so a long
     name on a large token cannot reach across the map. */
  wideMax: 5.2,
  /* Room an expanded plate must leave to the right of its name, as a multiple
     of the plate's edge: the counter tab occupies the bottom-right corner, and
     a name laid out against the body's full width runs underneath it. The tab
     is drawn on top and opaque, so the failure is not a collision warning — it
     is a name with its last two letters missing. */
  tabRoom: 1.18,
  /* How far the unfold must have travelled before names are drawn. A label laid
     out against the expanded width while the plate is still nearly square hangs
     off the end of it; below this the plate is opening and carries its sigil
     alone. */
  nameAt: 0.45,
});

/** How far a nudge may go, in grid squares. */
export const OFFSET = Object.freeze({ min: -3, max: 3, step: 0.05 });

/** Plate count limits, and the readout size range. */
export const LIMITS = Object.freeze({
  platesMin: 3,
  platesMax: 12,
  scaleMin: 0.6,
  scaleMax: 2,
  scaleStep: 0.05,
  /** Rounds remaining at which an effect starts to breathe. */
  expiryWarnMax: 3,
});

/** Forms, matching `uForm` in the shader. */
export const FORM = Object.freeze({ plate: 0, tail: 1 });

/**
 * The plate's interior proportions, in the shader's own `p` space — where one
 * unit is the quad's height and x is scaled by the aspect.
 *
 * These are the numbers the GLSL, the label layout and the preview all have to
 * agree on. A sigil placed by the shader and a counter placed by the host, each
 * from its own copy of the same geometry, is how a badge ends up half off its
 * own tab — and that does not read as a two-pixel error, it reads as two people
 * having drawn the same plate. `tools/token-conditions-check.mjs` compares the
 * tab's three numbers against the literals in the GLSL on every run.
 */
export const PLATE = Object.freeze({
  iconHalf: 0.295,     // largest half-extent a sigil may take
  iconOfBody: 0.78,    // …as a fraction of the body's half-height
  iconPad: 0.10,       // air between the body's edge and the sigil
  tabHalfX: 0.24,      // the counter tab's half-width, capped
  tabOfBody: 0.38,     // …as a fraction of the body's half-width
  tabHalfY: 0.235,     // and its half-height
  nameOfPlate: 0.30,   // label cap height, × the plate's edge
  tabOfPlate: 0.30,    // counter cap height, × the plate's edge
});
