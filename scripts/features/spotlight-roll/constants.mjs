/**
 * Spotlight Roll — ids, keys and the closed vocabularies. Pure.
 */
export const FEATURE_ID = "spotlight-roll";
export const PREFIX = "dr.";

export const SETTINGS = Object.freeze({
  /** World: the open request (GM-written). Carries nothing a player may not see. */
  active: "dr.active",
  /** World: let players dismiss the spotlight on their own screen. */
  allowDismiss: "dr.allowDismiss",
  /** Client: motion tier for this screen. */
  motion: "dr.motion",
  /** Client: skip the WebGL backdrop on this screen (CSS only). */
  cssOnly: "dr.cssOnly",
  /** World: hold before the spotlight leaves on its own, seconds (0 = until closed). */
  autoClose: "dr.autoClose",
});

/** The Dice So Nice generation the die host is written against. */
export const DSN_ID = "dice-so-nice";
export const DSN_MIN_MAJOR = 6;

/** Socket message types, all on the suite's one channel. */
export const MSG = Object.freeze({
  intent: "intent",         // player → GM: toggles / throw / reroll / dismiss request
  throw: "throw",           // GM → recipients: a slot's result (or its sealed stand-in)
  sync: "sync",             // client → GM: send me what I may see of the open request
  close: "close",           // GM → all: the spotlight is over
});

/** What a request can ask for. */
export const CHECK_KINDS = Object.freeze(["skill", "lore", "save", "perception", "flat", "formula"]);
export const LAYOUTS = Object.freeze(["single", "group", "opposed"]);
/** Who sees the result. */
export const AUDIENCES = Object.freeze(["all", "roller", "gm"]);
/** How the DC is shown to players: always, hidden until the reveal beat, never. */
export const DC_MODES = Object.freeze(["shown", "hidden", "never"]);
export const FORTUNE = Object.freeze(["none", "fortune", "misfortune"]);
export const SAVES = Object.freeze(["fortitude", "reflex", "will"]);

export const MAX_ROLLERS = 6;
export const MAX_FORMULA_DICE = 6;
/** Dice faces a free formula may throw. d100 is a d10 pair. */
export const FORMULA_FACES = Object.freeze([4, 6, 8, 10, 12, 20, 100]);

/** Lead between the GM resolving a throw and every screen starting it. */
export const CUE_LEAD_MS = 320;

/** The roll identifier prefix the Check.roll wrapper recognises. */
export const IDENT = "gluniverse-spotlight";
