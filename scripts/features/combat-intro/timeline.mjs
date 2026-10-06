/**
 * Combat Intro — the ONLY statement of when anything happens.
 *
 * Both skins draw the same sequence: the DOM overlay, the WebGL beats and the
 * sound cues all read their times from here, so a skin changes how a beat looks
 * and never when it lands. tools/combat-intro-check.mjs proves the beats are
 * ordered, contiguous and identical for every skin, and the preview imports
 * this file rather than restating it.
 *
 * Every phase is a function of `serverNow - state.at`, so a client that joins
 * late, or a tab that was in the background, lands on the same frame as
 * everyone else. Pure: no `game`, no DOM.
 */

/** Intro beats, in order. Each starts where the previous one ends. */
export const INTRO = Object.freeze([
  ["boot", 700],      // the screen wakes: field, scan line, HUD frame
  ["roster", 1700],   // party and hostiles slide in, portrait by portrait
  ["title", 1300],    // the encounter title strikes
  ["threat", 900],    // the threat readout locks (blank beat when there is none)
  ["out", 600],       // the stage clears to the roll table
]);

/** The roll phase: the deal, then each slot's own throw clock. */
export const ROLL = Object.freeze({
  deal: 900,          // cards unfold onto the table
  tumble: 1250,       // the die leaves its idle pose and lands on its face
  reveal: 520,        // the total counts up beside the die
  settle: 650,        // grace after the LAST slot lands, before the sort
});

/** The sort, then the handoff into the rail. */
export const SORT = Object.freeze([
  ["hold", 450],      // the totals read, all at once (NPC seals break here)
  ["move", 1150],     // cards travel to their initiative slots
  ["settle", 400],
]);

export const HANDOFF = Object.freeze([
  ["collapse", 650],  // cards shrink toward the rail's slots
  ["dock", 750],      // they land as rail cards; the overlay drops away
]);

const total = (beats) => beats.reduce((a, [, ms]) => a + ms, 0);

export const INTRO_MS = total(INTRO);
export const SORT_MS = total(SORT);
export const HANDOFF_MS = total(HANDOFF);
/** From a throw stamp to that slot's total being fully on screen. */
export const THROW_MS = ROLL.tumble + ROLL.reveal;

/**
 * Where a beat list stands `ms` into it.
 * @returns {{ beat: string, t: number, k: number, ms: number }}  t = 0..1 within the beat, k = beat index
 */
export function beatAt(beats, ms) {
  let start = 0;
  for (let k = 0; k < beats.length; k++) {
    const [beat, len] = beats[k];
    if (ms < start + len || k === beats.length - 1) {
      return { beat, k, ms, t: Math.max(0, Math.min(1, (ms - start) / len)) };
    }
    start += len;
  }
  return { beat: beats[0][0], k: 0, ms, t: 0 };
}

/** The start offset of a named beat. */
export function beatStart(beats, name) {
  let start = 0;
  for (const [beat, len] of beats) {
    if (beat === name) return start;
    start += len;
  }
  return -1;
}

/** How long a timed phase lasts, or null for the roll phase (it waits for people). */
export function phaseLength(phase) {
  if (phase === "intro") return INTRO_MS;
  if (phase === "sorting") return SORT_MS;
  if (phase === "handoff") return HANDOFF_MS;
  return null;
}

/**
 * The clock of a sequence on this client.
 * @param {{phase: string, at: number}} state
 * @param {number} serverNow  game.time.serverTime on this client
 * @returns {{ phase: string, ms: number, done: boolean }}
 */
export function phaseClock(state, serverNow) {
  const ms = Math.max(0, serverNow - (Number(state?.at) || 0));
  const len = phaseLength(state?.phase);
  return { phase: state?.phase ?? "idle", ms, done: len != null && ms >= len };
}

/**
 * When the sort may begin: every slot has a throw stamp, and the last one has
 * had time to land and read. Null while any slot is still waiting.
 * @param {Array<{throw: null|{at:number}}>} slots
 */
export function sortReadyAt(slots) {
  if (!slots?.length) return null;
  let last = -Infinity;
  for (const s of slots) {
    if (!s.throw) return null;
    last = Math.max(last, Number(s.throw.at) || 0);
  }
  return last + THROW_MS + ROLL.settle;
}

/** A late-added combatant's mini sequence: deal, throw, then slide into the rail. */
export const LATE = Object.freeze([
  ["in", 500],
  ["wait", 0],        // open-ended: waits for the throw
  ["land", THROW_MS],
  ["slide", 900],
]);
