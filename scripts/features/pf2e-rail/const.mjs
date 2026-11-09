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

export const TIMING = Object.freeze({
  /** A pointer has to rest this long on a card, row or strike before it peeks. */
  peekOpen: 140,
  /** …and may leave for this long (crossing the gap to the peek) before it closes. */
  peekClose: 250,
  /** A change of whose rail it is fades the old one out for this long first. */
  swap: 150,
  /** The wheel is still while framing for this long before the zoom is saved. */
  frameSettle: 300,
});

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
