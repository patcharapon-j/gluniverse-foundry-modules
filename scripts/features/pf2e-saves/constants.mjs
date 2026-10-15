/** Save Resolution — ids, keys and closed vocabularies. Pure: imported under Node. */

export const FEATURE_ID = "pf2e-saves";
export const PREFIX = "sv.";

/** The session rides a flag on its own chat card, so it is scoped to that cast. */
export const FLAG = "sv.session";
/** The GM's effects-by-degree answer, remembered on the spell so the next cast is one click. */
export const SPELL_FLAG = "sv.config";

export const SETTINGS = Object.freeze({
  /** Client: open the panel by itself when a session starts that this user may run. */
  autoOpen: "sv.autoOpen",
  /** World: draw the "Resolve saves" button on spell cards with a save. */
  cardButton: "sv.cardButton",
});

/** PF2e's degree keys, worst first — index = PF2e's DegreeOfSuccess value. */
export const DEGREES = Object.freeze(["criticalFailure", "failure", "success", "criticalSuccess"]);

/** A basic save: ×2 / ×1 / ×½ / ×0 by degree. */
export const BASIC_MULT = Object.freeze({ criticalFailure: 2, failure: 1, success: 0.5, criticalSuccess: 0 });
/** A non-basic save: full damage on a failure, nothing on a success, until the GM says otherwise. */
export const PLAIN_MULT = Object.freeze({ criticalFailure: 1, failure: 1, success: 0, criticalSuccess: 0 });
/** Every multiplier the panel offers. */
export const MULTS = Object.freeze([0, 0.5, 1, 2]);

export const SAVES = Object.freeze(["fortitude", "reflex", "will"]);

/** Socket message types. Every payload is tagged with FEATURE_ID by core/socket.mjs. */
export const MSG = Object.freeze({
  /** client → GM: open a session for a cast { castId, targets: tokenId[] }. */
  open: "open",
});

/** The identifier our own rolls carry, so a save is matched to its row without guessing. */
export const IDENT = "gluniverse-saves";

/** How long Revert stays live outside an encounter. */
export const UNDO_MS = 10 * 60 * 1000;

/** The most rows one session will hold (a vast area is still one panel). */
export const MAX_ROWS = 60;

/** How far back the conductor looks for open sessions when a roll lands. */
export const SCAN_MESSAGES = 200;
