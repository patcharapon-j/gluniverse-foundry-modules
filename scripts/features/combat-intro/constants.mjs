/** Combat Intro — ids, keys and closed vocabularies. Pure: imported under Node. */

export const FEATURE_ID = "combat-intro";
export const PREFIX = "ci.";

/** The public state rides a flag on the Combat itself, so it is scoped to that encounter. */
export const FLAG = "ci.state";

export const SETTINGS = Object.freeze({
  /** Client: never compile the WebGL beats (CSS carries the whole sequence). */
  cssOnly: "ci.cssOnly",
  /** World: master volume for the cue set (0..1). */
  volume: "ci.volume",
});

/**
 * World: one file-picker setting per cue (`ci.sound.<cue>`). Blank plays the
 * skin's own file. One key each rather than an Object setting, because an
 * Object setting with no menu in front of it is reachable only from the console.
 */
export const SOUND_PREFIX = "ci.sound.";

/**
 * The skin is ONE world setting owned by the initiative feature (`init.skin`),
 * because the tracker carries it with or without this feature. Read it from
 * there; never register a second one.
 */
export const SKIN_SETTING = "init.skin";
export const SKINS = Object.freeze(["etched", "aegis"]);
export const DEFAULT_SKIN = "etched";

export const DSN_ID = "dice-so-nice";
export const DSN_MIN_MAJOR = 6;

/** Socket message types. Every payload is tagged with FEATURE_ID by core/socket.mjs. */
export const MSG = Object.freeze({
  intent: "intent",   // player → GM: { op, seqId, slotId, ... }
  throw: "throw",     // GM → entitled users: a result (full or sealed)
  sync: "sync",       // late client → GM: replay what I may see
});

/** Intent ops a client may send. Anything else is dropped by the GM. */
export const OPS = Object.freeze(["stat", "toggle", "throw"]);

/** Phases of one sequence, in order. `idle` is "no flag". */
export const PHASES = Object.freeze(["intro", "rolling", "sorting", "handoff"]);

/** Slot kinds. A hidden token never becomes a slot at all. */
export const KINDS = Object.freeze(["pc", "npc"]);

/**
 * Quick-pick statistics on a PC card, in display order. Everything else the
 * actor has (every skill, every lore) sits in the "more" drawer.
 */
export const QUICK_STATS = Object.freeze(["perception", "stealth", "deception", "diplomacy", "performance", "athletics", "survival"]);

/** Sound cues, one file per skin each. Missing keys are a designed no-op. */
export const CUES = Object.freeze(["introHit", "rosterTick", "titleSlam", "throw", "dieLand", "seal", "sortTick", "dockIn"]);

/** Intro header copy per skin. Keys resolve under GLCI.intro.<skin>.* (dynamic family). */
export const INTRO_LINES = Object.freeze({
  etched: ["eyebrow", "versus", "threat"],
  aegis: ["eyebrow", "versus", "threat", "motto"],
});

/** Threat severities Flatfinder reports; keys GLCI.threat.<severity> (dynamic family). */
export const SEVERITIES = Object.freeze(["trivial", "low", "moderate", "severe", "extreme"]);

/** Server-time lead for a throw cue, so every client starts the same frame. */
export const CUE_LEAD_MS = 320;

/** Identifier prefix for the Check.roll wrapper's PENDING map. */
export const IDENT = "gluniverse-combat-intro";

/** localStorage key for the GM's private half (results, held cards, toggles). */
export const PRIVATE_KEY = "gluniverse-foundry-modules.ci.private";

/*
 * The initiative rail never imports this feature. It reaches it through the
 * suite API — `game.modules.get(SUITE_ID).api.features["combat-intro"]` —
 * asking `canStart(combat)` to draw its Start button and `start(combat)` on a
 * click. Every feature's api object is exposed enabled or not, so `canStart`
 * answers false whenever this feature is off or stood down.
 */
/** Hook this feature raises right before startCombat(), carrying the cards' screen rects for the arrival. */
export const HANDOFF_HOOK = "gluniverse.combatIntro.handoff";
