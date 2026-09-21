/**
 * Hexcrawl — constants shared by every half of the feature.
 *
 * Pure: no `game`, no `foundry`, no `canvas`, no PIXI. The check tool and the
 * preview page import this under plain Node / a bare browser page.
 *
 * Terrain colours here are DATA, not theme (see docs/DESIGN_SYSTEM.md, "domain
 * colours"): a forest is green whatever the campaign accent is, and a GM who
 * rethemes the suite has not asked for their map to change colour.
 */

export const FEATURE_ID = "hexcrawl";
export const PREFIX = "hex.";
export const I18N = "GLHEX";

/** World / client settings (all under SUITE_ID, all prefixed). */
export const SETTINGS = Object.freeze({
  sounds: "hex.sounds",          // world  Boolean — module option to switch sounds off
  volume: "hex.volume",          // client Number 0..1
  tooltipDelay: "hex.tooltipDelay", // client Number ms
});

/** Document flag keys (scope SUITE_ID). Dotted keys nest: flags[SUITE_ID].hex.map */
export const FLAGS = Object.freeze({
  enabled: "hex.enabled",        // Scene   Boolean — this scene is a hexcrawl
  map: "hex.map",                // Scene   MapData (model.mjs)
  moves: "hex.moves",            // Scene   MoveRecord[] (newest last, capped)
  party: "hex.party",            // Token   { on: true, sight: number|null }
});

export const MOVE_HISTORY_CAP = 20;

/* ── Visibility ─────────────────────────────────────────────────────────── */

/** Ordered: auto-reveal only ever raises a hex along this order. */
export const STATES = Object.freeze(["hidden", "masked", "revealed"]);
export const STATE_RANK = Object.freeze({ hidden: 0, masked: 1, revealed: 2 });

/** The fields a mask can show or withhold, each independently. i18n: GLHEX.field.<key>
 *  region    — the region's SHAPE: its border is drawn, nothing else about it
 *  terrain   — the terrain type (tile colour + glyph)
 *  rating    — the terrain rating (difficulty pips)
 *  name      — the region / hex name
 *  landmarks — landmarks set to "with its hex"
 *  rumor     — the region's rumour, when the party knows it */
export const MASK_FIELDS = Object.freeze(["region", "terrain", "rating", "name", "landmarks", "rumor"]);

/** Named mask presets. i18n: GLHEX.mask.<key> */
export const MASK_PRESETS = Object.freeze({
  // The shape of the region, and nothing about it.
  silhouette: Object.freeze({ region: true, terrain: false, rating: false, name: false, landmarks: false, rumor: false }),
  glimpsed: Object.freeze({ region: true, terrain: true, rating: true, name: false, landmarks: true, rumor: false }),
  rumoured: Object.freeze({ region: true, terrain: false, rating: false, name: true, landmarks: false, rumor: true }),
});
export const DEFAULT_MASK_PRESET = "glimpsed";

/** Landmark visibility. i18n: GLHEX.landmarkVis.<key>
 *  follow  — shown when its hex shows landmarks (revealed, or masked with the landmarks field)
 *  visible — always shown, even over a hidden hex (the tower on the horizon)
 *  hidden  — GM only until changed (the book's "hidden point of interest") */
export const LANDMARK_VIS = Object.freeze(["follow", "visible", "hidden"]);
export const MAX_LANDMARKS_PER_HEX = 3;

/* ── Terrain ────────────────────────────────────────────────────────────── */

/** Glyph ids the renderer can draw (glyphs.mjs). i18n: GLHEX.glyph.<key> */
export const GLYPH_IDS = Object.freeze([
  "grass", "tree", "palm", "marsh", "wave", "deep", "dune", "hills", "mount",
  "frozen", "mesa", "cave", "road", "ruins", "crystal", "fungus", "lava", "star", "none",
]);

/** Built-in terrains: the Journey to Horizon habitats plus Ocean.
 *  i18n: GLHEX.terrain.<id>. Shadowblighted is NOT a terrain — it is the
 *  `blight` overlay on whatever habitat is underneath (the book rerolls the
 *  underlying habitat, so the habitat survives the corruption). */
export const BUILTIN_TERRAINS = Object.freeze({
  grassland:   Object.freeze({ color: "#9cc46a", glyph: "grass" }),
  forest:      Object.freeze({ color: "#3f8a5f", glyph: "tree" }),
  tropical:    Object.freeze({ color: "#2fa57a", glyph: "palm" }),
  wetland:     Object.freeze({ color: "#4f9a8e", glyph: "marsh" }),
  aquatic:     Object.freeze({ color: "#3a8fb7", glyph: "wave" }),
  ocean:       Object.freeze({ color: "#2a5f96", glyph: "deep" }),
  drylands:    Object.freeze({ color: "#d0a65a", glyph: "dune" }),
  rolling:     Object.freeze({ color: "#a9b86a", glyph: "hills" }),
  mountain:    Object.freeze({ color: "#8d93a8", glyph: "mount" }),
  frozen:      Object.freeze({ color: "#cfe1ec", glyph: "frozen" }),
  badlands:    Object.freeze({ color: "#b0613f", glyph: "mesa" }),
  underground: Object.freeze({ color: "#6d5a86", glyph: "cave" }),
});
export const BUILTIN_TERRAIN_IDS = Object.freeze(Object.keys(BUILTIN_TERRAINS));

/** A hex with no terrain and no region draws as blank survey ground. */
export const BLANK_TERRAIN = Object.freeze({ color: "#5b6478", glyph: "none" });

/** The blight overlay hue: the suite's fixed "secret / uncanny" violet. Mirrors
 *  PALETTE.violet in core/theme.mjs — kept here only so this module stays pure;
 *  the renderer should prefer the theme mirror. */
export const BLIGHT_HUE_KEY = "violet";

/* ── Rating & travel ────────────────────────────────────────────────────── */

export const RATING_MIN = 1;
export const RATING_MAX = 4;
/** i18n: GLHEX.rating.<n> — Optimal / Fair / Rough / Extreme (book p.171). */
export const RATING_NAMES = Object.freeze({ 1: "optimal", 2: "fair", 3: "rough", 4: "extreme" });

/** Travel cost units. i18n: GLHEX.unit.<key> */
export const COST_UNITS = Object.freeze({
  minutes: 60,
  hours: 3600,
  watches: null, // resolved through config.cost.watchHours
  days: 86400,
});

export const DIE_SIZES = Object.freeze([4, 6, 8, 10, 12, 20]);

/** Render modes over the scene background. i18n: GLHEX.render.<key> */
export const RENDER_MODES = Object.freeze(["tiles", "tint", "outlines"]);

/** Brush tools. i18n: GLHEX.tool.<key> */
export const BRUSH_TOOLS = Object.freeze([
  "select", "terrain", "region", "rating", "state", "blight", "visited", "erase",
]);

/** Rumour truth notes. i18n: GLHEX.truth.<key> */
export const RUMOR_TRUTH = Object.freeze(["true", "partial", "false"]);

/** Scene defaults. The book's own procedure: sight 1 (current + adjacent),
 *  rating-many d6, a 1 triggers, 1/2/3/4 days. */
export const DEFAULT_CONFIG = Object.freeze({
  sight: 1,
  autoPreset: DEFAULT_MASK_PRESET,
  render: "tiles",
  alwaysPips: false,
  trail: true,
  playersMove: true,
  dice: Object.freeze({ die: 6, perRating: Object.freeze([1, 2, 3, 4]), trigger: 1 }),
  cost: Object.freeze({ unit: "days", table: Object.freeze([1, 2, 3, 4]), watchHours: 4 }),
  advanceTime: false,
  arrivalCard: false,
});

/** Zoom (canvas.stage.scale.x) above which per-hex pips always draw. */
export const PIP_ZOOM_THRESHOLD = 0.9;

/** Motion budget (ms, before the motion scale). Named so the check tool can
 *  pin them and nothing in the renderer writes a literal duration. */
export const TIMING = Object.freeze({
  revealOutline: 520,   // the survey outline draws itself
  revealInk: 560,       // then the terrain inks in
  revealStagger: 70,    // per hex, sweeping from the party
  maskFade: 420,
  hideFade: 380,
  tokenGlide: 480,
  trailFade: 600,
  blightPeriod: 3200,   // one pulse of the veins
  stagedPulse: 1600,
  sightDashPeriod: 6000,
  tooltipDelay: 350,
});
