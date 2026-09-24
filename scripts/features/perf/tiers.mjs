/**
 * Performance — the tier table and how a client's tier is resolved.
 *
 * Pure and dependency-free: `tools/perf-check.mjs` walks every row.
 *
 * A tier is a set of values, not a set of switches, and every row states every
 * field. A row that left one out would inherit whatever the code defaulted to,
 * which is a quality decision nobody made. The check tool refuses a gap.
 *
 * The four tiers are ordered best → cheapest. "The GM's floor" is the BEST tier
 * a client may run: a client can always choose something cheaper, never
 * something better. Balanced is the default and is defined as "no visible
 * change" — everything it does is either invisible (a still canvas redrawn less
 * often, a context released while nobody can see it) or a cost removed from a
 * path that looks the same. Every visual trade starts at Performance.
 */

export const TIERS = Object.freeze(["quality", "balanced", "performance", "potato"]);
export const AUTO = "auto";
export const DEFAULT_TIER = "balanced";

/**
 * Field reference (every row has all of them):
 *
 *   perfMode        Foundry canvas performance mode ceiling (CONST value) or
 *                   null for "the user's own". NOT live: applied at the next
 *                   scene draw.
 *   resolution      "native" | "reduced" (0.75 × DPR, never below 1) | "base"
 *                   (1.0, no retina). NOT live.
 *   idleFps         Canvas ticker rate while nothing moves; 0 = no idle drop.
 *   vision          How a moving token's sight is recomputed: "full" (every
 *                   frame, Foundry's own), a number N (every Nth frame), or
 *                   "snap" (once, when the move lands).
 *   shedFloor       Steps every suite ladder starts shed by (Infinity = all).
 *   supersampleFloor  Rung every supersample ladder starts at (0 = 2×).
 *   glass           "full" | "light" | "none" — the `data-gl-perf` glass level.
 *   ambient         "always" | "still" (pause while panning / hidden) | "off".
 *   zoomBlur        false = drop soft-shadow blur while a zoom is in progress.
 *   glRelease       Seconds a suite WebGL context may sit unused before it is
 *                   released (it is rebuilt on demand).
 */
export const TIER_TABLE = Object.freeze({
  quality: Object.freeze({
    perfMode: null, resolution: "native", idleFps: 0, vision: "full", shedFloor: 0,
    supersampleFloor: 0, glass: "full", ambient: "always", zoomBlur: true, glRelease: 60,
  }),
  balanced: Object.freeze({
    perfMode: null, resolution: "native", idleFps: 20, vision: 3, shedFloor: 0,
    supersampleFloor: 0, glass: "full", ambient: "still", zoomBlur: true, glRelease: 60,
  }),
  performance: Object.freeze({
    perfMode: null, resolution: "reduced", idleFps: 15, vision: "snap", shedFloor: 1,
    supersampleFloor: 1, glass: "light", ambient: "still", zoomBlur: false, glRelease: 30,
  }),
  potato: Object.freeze({
    perfMode: 0, resolution: "base", idleFps: 10, vision: "snap", shedFloor: Infinity,
    supersampleFloor: 2, glass: "none", ambient: "off", zoomBlur: false, glRelease: 10,
  }),
});

/** Every field a row must state. */
export const TIER_FIELDS = Object.freeze([
  "perfMode", "resolution", "idleFps", "vision", "shedFloor",
  "supersampleFloor", "glass", "ambient", "zoomBlur", "glRelease",
]);

/**
 * Fields that are cheap to change mid-scene. Auto only ever moves these: a knob
 * that forces a canvas redraw or re-initialises perception is a hitch of its
 * own, and a governor that caused hitches to cure hitches would oscillate.
 */
export const LIVE_FIELDS = Object.freeze([
  "idleFps", "vision", "shedFloor", "supersampleFloor", "glass", "ambient", "zoomBlur", "glRelease",
]);

/** The tiers Auto moves between, best first. */
export const AUTO_RANGE = Object.freeze(["balanced", "performance", "potato"]);

export const tierIndex = (id) => {
  const i = TIERS.indexOf(id);
  return i < 0 ? TIERS.indexOf(DEFAULT_TIER) : i;
};

/**
 * The best tier a user may run, from the GM's floor object.
 * A per-user row replaces the world maximum outright (in either direction), so
 * a capture login can be held to Balanced in a world whose floor is Quality.
 *
 * @param {{ max?: string, users?: Record<string, { max?: string|null }> }} floor
 * @param {string} userId
 * @returns {string} a TIERS id
 */
export function floorFor(floor, userId) {
  const row = floor?.users?.[userId];
  if (row?.max && TIERS.includes(row.max)) return row.max;
  if (floor?.max && TIERS.includes(floor.max)) return floor.max;
  return TIERS[0];
}

/** Whether the GM marked this user as a capture client. */
export function isCapture(floor, userId) {
  return !!floor?.users?.[userId]?.capture;
}

/**
 * Resolve what a client actually runs.
 *
 * @param {object} p
 * @param {string} p.choice      The client's own setting: a TIERS id or "auto".
 * @param {string} p.floor       The best tier allowed (floorFor()).
 * @param {string} [p.autoTier]  Where the governor currently sits (AUTO only).
 * @returns {{ tier: string, auto: boolean, values: object, baseline: string }}
 *   `tier` names the row whose LIVE fields are in force; `baseline` the row
 *   whose non-live fields are. They differ only under Auto, where the non-live
 *   half stays at the floor-clamped Balanced so the governor can never force a
 *   redraw or a resolution change mid-scene.
 */
export function resolveTier({ choice, floor, autoTier = AUTO_RANGE[0] }) {
  const fi = tierIndex(floor);
  const clamp = (id) => TIERS[Math.max(fi, tierIndex(id))];
  if (choice === AUTO) {
    const baseline = clamp(AUTO_RANGE[0]);
    const tier = clamp(AUTO_RANGE.includes(autoTier) ? autoTier : AUTO_RANGE[0]);
    const values = { ...TIER_TABLE[baseline] };
    for (const f of LIVE_FIELDS) values[f] = TIER_TABLE[tier][f];
    return { tier, auto: true, values: Object.freeze(values), baseline };
  }
  const tier = clamp(TIERS.includes(choice) ? choice : DEFAULT_TIER);
  return { tier, auto: false, values: TIER_TABLE[tier], baseline: tier };
}

/**
 * The canvas resolution a tier asks for, never above what the user's own
 * Foundry setting produced and never below 1 (sub-1 is blur, not savings).
 * @param {string} mode  TIER_TABLE[...].resolution
 * @param {number} own   the resolution Foundry was about to use
 */
export function resolutionFor(mode, own) {
  const base = Number.isFinite(own) && own > 0 ? own : 1;
  if (mode === "base") return Math.min(base, 1);
  if (mode === "reduced") return Math.min(base, Math.max(1, base * 0.75));
  return base;
}
