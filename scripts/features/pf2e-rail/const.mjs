/**
 * PF2e HUD (`pf2e-rail`) — identifiers and the one statement of every timing
 * the rail's JavaScript waits on. CSS durations come from the suite's
 * `--gl-d-*` ladder; these are the waits a host or a gesture counts itself,
 * and they are multiplied by nothing, because they are dwell times (how long a
 * pointer must rest before a peek opens), not animation lengths.
 *
 * Pure: imported by the view, the preview page and the check tool alike.
 */
export const FEATURE_ID = "pf2e-rail";
export const PREFIX = "ph.";
export const NS = "GLRAIL";

/** PF2e's standard exploration activities (Player Core, "Exploration
 *  Activities"), as the system's own Actions compendium files them. A
 *  character carries an activity only once it is an item on the sheet, and
 *  `system.exploration` holds those item ids, so the bar offers these to a
 *  character who lacks them and copies one from the compendium on its first
 *  pick (`ph.coreExploration`). Ids are pinned against PF2e 8.7's pack. */
export const EXPLORE_PACK = "pf2e.actionspf2e";
export const STANDARD_EXPLORATION = Object.freeze([
  { slug: "avoid-notice", id: "IE2nThCmoyhQA0Jn", name: "Avoid Notice" },
  { slug: "defend", id: "cYtYKa1gDEl7y2N0", name: "Defend" },
  { slug: "detect-magic", id: "Yb0C1uLzeHrVLl7a", name: "Detect Magic" },
  { slug: "follow-the-expert", id: "tfa4Sh7wcxCEqL29", name: "Follow the Expert" },
  { slug: "hustle", id: "JuqmIAnkL9hVGai8", name: "Hustle" },
  { slug: "investigate", id: "EwgTZBWsc8qKaViP", name: "Investigate" },
  { slug: "repeat-a-spell", id: "OQaFzDtVEOMWizJJ", name: "Repeat a Spell" },
  { slug: "scout", id: "kV3XM0YJeS2KCSOb", name: "Scout" },
  { slug: "search", id: "TiNDYUGlMmxzxBYU", name: "Search" },
].map(Object.freeze));
/** The id a standard activity the character does not carry yet goes by. */
export const STD_EXPLORE = "std:";

export const TIMING = Object.freeze({
  /** A pointer has to rest this long on a card, row or strike before it peeks. */
  peekOpen: 140,
  /** …and may leave for this long (crossing the gap to the peek) before it closes. */
  peekClose: 250,
  /** A change of whose rail it is fades the old one out for this long first. */
  swap: 150,
  /** The wheel is still while framing for this long before the zoom is saved. */
  frameSettle: 300,
  /** The wheel over the spell dial steps one rank per gesture, and a gesture
   *  ends after this long with no wheel event: a trackpad's stream of small
   *  deltas is one gesture, not twenty ranks. */
  wheelStep: 140,
  /** A refresh waits for the next frame, or this long where frames are
   *  starved (a background tab). */
  refreshFallback: 120,
  /** A thrown card waits this long for the redraw that replaces it, then
   *  comes back: a cast that changed nothing left nothing to redraw. */
  cardReturn: 600,
  /** A Hero Point spent this long after a roll echoed still answers that
   *  roll: its light streaks to the press, and the reroll echoes there. */
  rerollWindow: 60000,
});

/** What the shared frame budget may take away, first to last. The light
 *  (light.mjs) is the rail's only animation that is not feedback, so it goes
 *  first; the CSS ignition under it still plays. */
export const SHED_ORDER = Object.freeze(["light"]);

/** How much of the PF2e Hit Point track reads as low. The resource bars use
 *  the same line (`LOW_HEALTH_AT`), so a bar and the rail turn together. */
export const LOW_HEALTH_AT = 0.25;

/** The order a creature's three saves are always drawn in. */
export const SAVES = Object.freeze(["fortitude", "reflex", "will"]);

/** Strike rows the plate holds before the last becomes "N more". */
export const STRIKE_ROWS = 4;
/** Action rows the plate holds (one fewer when there are toggles to draw). */
export const ACTION_ROWS = 4;
/** Chips the GM panel holds before the last becomes "N more". */
export const GM_MOVES = 4;

/** The drawers, in the order their tiles are drawn. `sheet` opens the sheet. */
export const DRAWERS = Object.freeze(["skills", "actions", "inventory", "effects", "rest", "macros", "sheet"]);
