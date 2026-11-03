/**
 * Spellsprite — constants. Pure: the check tool, the preview and the coverage
 * tool import this under plain Node.
 */

export const FEATURE_ID = "pf2e-fx";
export const PREFIX = "fx.";

export const SETTINGS = Object.freeze({
  spells: "fx.spells",
  strikes: "fx.strikes",
  actions: "fx.actions",
  conditions: "fx.conditions",
  artPerSquare: "fx.artPerSquare",
  impactFrames: "fx.impactFrames",
  shake: "fx.shake",
  maxConcurrent: "fx.maxConcurrent",
  floor: "fx.floor",
  rules: "fx.rules",
  rulesMenu: "fx.rulesMenu",
  standDown: "fx.standDown",
});

/** The flag a look lives in, on an Item or an Actor (`flags[SUITE_ID][LOOK_FLAG]`). */
export const LOOK_FLAG = "fx.look";
/** The scene flag that overrides the floor brightness guess. */
export const FLOOR_FLAG = "fx.floor";

/** Sprite timing, seconds. Every duration the hosts and the reader use lives here. */
export const TIMING = Object.freeze({
  step: 1 / 120,
  /** Messages of one cast (card, saves, damage) are joined inside this window. */
  joinWindow: 8,
  /** A save that has not arrived by then plays the neutral impact. */
  saveWait: 2.5,
  /** The longest a host waits for Dice So Nice before playing anyway. */
  diceWait: 6,
  /** Effects older than this when they would start are dropped (a late join). */
  stale: 12,
  /** The longest frame step a host feeds the sim; a stalled tab does not fast-forward. */
  maxDt: 0.05,
});

/** Shed order: cheapest to lose first. Never pixel size. */
export const SHED_ORDER = Object.freeze(["minor", "tokenLight", "lightBands", "debris", "shake", "concurrency"]);

export const ART_PER_SQUARE = 26;
export const DELIVERIES = Object.freeze(["attack", "save", "area", "strike", "auto", "self", "condition", "tick"]);
export const OUTCOMES = Object.freeze(["crit", "hit", "miss", "neutral"]);
export const FLOURISHES = Object.freeze(["sparkles", "petals", "runes", "none"]);
export const WEAPON_STYLES = Object.freeze(["slash", "pierce", "bludgeon", "ranged", "thrown", "claw", "bite", "unarmed"]);
export const TRADITIONS = Object.freeze(["arcane", "divine", "occult", "primal"]);

/** The 26 Spellglass materials, in its order (pf2e-aoe/schema.mjs). */
export const MATERIALS = Object.freeze([
  "fire", "cold", "electricity", "acid", "poison", "sonic", "force",
  "kinetic", "vitality", "void", "spirit", "holy", "unholy", "light",
  "shadow", "mental", "illusion", "air", "earth", "water", "wood",
  "metal", "plant", "fungal", "arcane", "neutral",
]);

/** The effect families, and which materials share each. */
export const FAMILIES = Object.freeze({
  flame: ["fire"],
  frost: ["cold"],
  arc: ["electricity"],
  corrode: ["acid", "poison"],
  shock: ["sonic", "force", "air"],
  radiance: ["vitality", "holy", "light"],
  umbra: ["void", "unholy", "shadow"],
  psyche: ["mental", "illusion", "spirit"],
  earthwork: ["earth", "metal"],
  tide: ["water"],
  growth: ["wood", "plant", "fungal"],
  physical: ["kinetic", "neutral", "arcane"],
});

export const FAMILY_OF = Object.freeze(Object.fromEntries(
  Object.entries(FAMILIES).flatMap(([family, mats]) => mats.map((m) => [m, family])),
));

/**
 * Spellglass functions (pf2e-aoe/schema.mjs), plus three Spellsprite adds that
 * Spellglass has no use for: `teleport`, `movement` and `transform`. Everything
 * that is not `harm` (or `hazard`) plays a form (forms.mjs).
 */
export const FUNCTIONS = Object.freeze([
  "harm", "restore", "support", "protect", "hinder", "control",
  "conceal", "terrain", "detect", "summon", "hazard", "neutral",
  "teleport", "movement", "transform",
]);
