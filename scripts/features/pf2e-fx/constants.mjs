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
  /** A follow-up Grab / Knockdown / Push (or its check) this long after the Strike that set it up
   *  draws with that Strike's body part (handoff.mjs), arrival to arrival: the Strike's dice take up
   *  to diceWait, which leaves the GM at least as long again to press the follow-up. Later than this it
   *  is more likely a fresh Grapple than the follow-through of that bite. */
  handoff: 12,
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

/*
 * The look model's closed vocabularies (docs/SPELLSPRITE_LOOK.md). depict.mjs
 * emits only these; growing a set means a lexicon entry and a renderer too.
 */

/** How it gets there: the timeline. */
export const DELIVERY_VOCAB = Object.freeze([
  // melee weapons, by group
  "swing", "chop", "smash", "thrust", "sweep", "stab", "peck", "flail", "lash", "fist", "bash",
  // natural attacks, by name
  "rake", "jaws", "gore", "sting", "stomp", "buffet", "slam", "pincer", "grasp", "squeeze",
  // ranged weapons, by group then name
  "arrow", "bolt", "bullet", "pellets", "slug", "stone", "dart", "thrown", "rock", "bomb", "grenade",
  "laser", "plasma", "zap", "sonicwave", "jet", "mindbeam", "spit", "net", "missile",
  // spells and abilities with harm or hazard
  "ray", "orb", "darts", "lob", "fall", "burst", "cone", "line", "emanation", "wall", "touch", "gaze", "voice", "breath", "aura", "bloom",
  // everything else
  "form", "condition", "tick",
]);

/**
 * Which renderer table owns each delivery (compile.mjs routes by it, fx-check
 * requires an entry for every one): `strikes.mjs` STRIKES for melee and
 * natural, `ranged.mjs` RANGED, `deliveries.mjs` HARM.
 */
export const DELIVERY_GROUPS = Object.freeze({
  melee: Object.freeze(["swing", "chop", "smash", "thrust", "sweep", "stab", "peck", "flail", "lash", "fist", "bash"]),
  natural: Object.freeze(["rake", "jaws", "gore", "sting", "stomp", "buffet", "slam", "pincer", "grasp", "squeeze"]),
  ranged: Object.freeze(["arrow", "bolt", "bullet", "pellets", "slug", "stone", "dart", "thrown", "rock", "bomb", "grenade", "laser", "plasma", "zap", "sonicwave", "jet", "mindbeam", "spit", "net", "missile"]),
  harm: Object.freeze(["ray", "orb", "darts", "lob", "fall", "burst", "cone", "line", "emanation", "wall", "touch", "gaze", "voice", "breath", "aura", "bloom"]),
  other: Object.freeze(["form", "condition", "tick"]),
});

/** What object it depicts. */
export const MOTIF_VOCAB = Object.freeze([
  "blade", "weapon", "spear", "arrow", "hammer", "chain", "whip", "needle",
  "hand", "fist", "claw", "jaws", "eye", "heart", "skull", "bones", "blood", "wing", "feather",
  "storm", "cloud", "rain", "wind", "tornado", "lightning", "sun", "moon", "star", "comet",
  "stone", "crystal", "spike", "wave", "bubble", "mist", "smoke",
  "vine", "thorn", "root", "flower", "leaf", "tree", "spore",
  "ghost", "rune", "glyph", "word", "note", "bell", "mirror", "door", "mask", "crown", "coin", "card",
  "serpent", "dragon", "beast", "swarm", "web",
  "flame", "orb", "ray", "shield", "wall",
]);

/** How hard and how big. */
export const PROP_VOCAB = Object.freeze([
  "deadly", "fatal", "scatter", "automatic", "concussive", "kickback", "splash", "heavy", "power", "reach", "sweep",
  "agile", "forceful", "backstabber", "volley", "unwieldy", "tech", "boost", "area",
  "precious", "magical", "persistent",
  "incapacitation", "fortune", "misfortune", "auditory", "visual", "linguistic", "emotion", "fear", "curse", "polymorph",
  "teleportation", "summon", "healing", "nonlethal", "holy", "unholy", "death", "light", "darkness", "poison", "disease",
  "minor", "major",
]);

/** Who is doing it: the caster's wind-up. */
export const FLAVOR_VOCAB = Object.freeze([
  "arcane", "divine", "occult", "primal",
  "rage", "flurry", "impulse", "gun", "finisher", "spellstrike", "overdrive", "composition", "stance", "hunt", "sneak",
  "judgment", "esoterica", "psyche", "apparition", "necromancy", "rune", "command", "guard", "exemplar", "eidolon",
]);

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
