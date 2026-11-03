/**
 * Mythic GME: the rules, as pure functions.
 *
 * Every roll takes an `rng` (a function returning [0, 1)), so the check tool
 * can drive each rule with fixed dice and the preview can draw a stable page.
 * Nothing here reads the world, the DOM or a setting.
 *
 * What is pinned, and where it comes from (Mythic Game Master Emulator 2e):
 *
 *  - The Fate Chart. Every cell is three numbers: roll at or under the first
 *    for an Exceptional Yes, at or under the second for a Yes, at or over the
 *    third for an Exceptional No. The printed chart is one diagonal sequence:
 *    raising the odds one step reads the same cell as raising the Chaos Factor
 *    one step, so a cell is `FATE_MASTER[cf + offset]`, clamped at both ends.
 *    50/50 at Chaos 5 is the centre (10 / 50 / 91).
 *  - Random Events. A Fate roll of doubles (11, 22 ... 99) whose digit is at or
 *    under the Chaos Factor triggers one, whatever the answer was.
 *  - The Chaos Factor runs 1 to 9. A scene the characters controlled lowers it
 *    by one; one they did not raises it by one.
 *  - Testing the expected scene: d10. At or under the Chaos Factor the scene is
 *    not what was expected: an odd roll alters it, an even roll interrupts it
 *    (a Random Event). Over the Chaos Factor, it plays as expected.
 *  - Event Focus: d100 on twelve bands.
 */

import { CHAOS_DEFAULT, CHAOS_MAX, CHAOS_MIN, WEIGHT_MAX } from "./constants.mjs";

/** d(n) from an rng: 1..n. */
export const die = (n, rng = Math.random) => 1 + Math.floor(rng() * n);

/** Any value as a legal Chaos Factor. */
export function clampChaos(v) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return CHAOS_DEFAULT;
  return Math.min(CHAOS_MAX, Math.max(CHAOS_MIN, n));
}

/* ── Fate Chart ──────────────────────────────────────────────────────────── */

/**
 * The chart's diagonal, low to high: [exceptionalYes, yes, exceptionalNo].
 * An Exceptional Yes of 0 can never be rolled (the book's "X"); an Exceptional
 * No of 101 can never be rolled either.
 */
export const FATE_MASTER = Object.freeze([
  [0, 1, 81],
  [1, 5, 82],
  [2, 10, 83],
  [3, 15, 84],
  [5, 25, 86],
  [7, 35, 88],
  [10, 50, 91],
  [13, 65, 94],
  [15, 75, 96],
  [17, 85, 98],
  [18, 90, 99],
  [19, 95, 100],
  [20, 99, 101],
].map((row) => Object.freeze(row)));

/** The nine odds, low to high, and where each reads the diagonal from. */
export const ODDS = Object.freeze([
  { id: "impossible", offset: -2 },
  { id: "nearly-impossible", offset: -1 },
  { id: "very-unlikely", offset: 0 },
  { id: "unlikely", offset: 1 },
  { id: "fifty-fifty", offset: 2 },
  { id: "likely", offset: 3 },
  { id: "very-likely", offset: 4 },
  { id: "nearly-certain", offset: 5 },
  { id: "certain", offset: 6 },
].map((o) => Object.freeze(o)));

export const DEFAULT_ODDS = "fifty-fifty";
export const oddsById = (id) => ODDS.find((o) => o.id === id) ?? null;

/** The verdicts, from best to worst. */
export const VERDICTS = Object.freeze(["exceptional-yes", "yes", "no", "exceptional-no"]);

/** The cell for an odds id at a Chaos Factor. */
export function fateCell(oddsId, cf) {
  const odds = oddsById(oddsId) ?? oddsById(DEFAULT_ODDS);
  const i = Math.min(FATE_MASTER.length, Math.max(1, clampChaos(cf) + odds.offset)) - 1;
  const [excYes, yes, excNo] = FATE_MASTER[i];
  return { excYes, yes, excNo };
}

/** The verdict a d100 reads on a cell. */
export function verdictOf(roll, cell) {
  if (roll <= cell.excYes) return "exceptional-yes";
  if (roll <= cell.yes) return "yes";
  if (roll >= cell.excNo) return "exceptional-no";
  return "no";
}

/** Doubles at or under the Chaos Factor: 11, 22 ... 99. A roll of 100 is not doubles. */
export function triggersEvent(roll, cf) {
  if (!Number.isInteger(roll) || roll < 11 || roll > 99) return false;
  const tens = Math.floor(roll / 10);
  return tens === roll % 10 && tens <= clampChaos(cf);
}

/**
 * Ask the Fate Chart. The returned shape keeps every field the pre-remake api
 * returned (`oddsId, cf, roll, key, yes, threshold, eventTriggered`), so a macro
 * written against `api.rollFate` still reads it.
 */
export function rollFate(oddsId, cf, rng = Math.random) {
  const id = oddsById(oddsId) ? oddsId : DEFAULT_ODDS;
  const chaos = clampChaos(cf);
  const cell = fateCell(id, chaos);
  const roll = die(100, rng);
  const key = verdictOf(roll, cell);
  return {
    oddsId: id,
    cf: chaos,
    roll,
    key,
    yes: cell.yes,
    threshold: [cell.excYes, cell.yes, cell.excNo],
    eventTriggered: triggersEvent(roll, chaos),
  };
}

/* ── Event Focus ─────────────────────────────────────────────────────────── */

/**
 * d100 bands. `list` names the Mythic list a focus points at, so a Random
 * Event can pick the thread or character it is about.
 */
export const EVENT_FOCUS = Object.freeze([
  { max: 5, key: "remote" },
  { max: 10, key: "ambiguous" },
  { max: 20, key: "new-npc" },
  { max: 40, key: "npc-action", list: "characters" },
  { max: 45, key: "npc-negative", list: "characters" },
  { max: 50, key: "npc-positive", list: "characters" },
  { max: 55, key: "toward-thread", list: "threads" },
  { max: 65, key: "away-thread", list: "threads" },
  { max: 70, key: "close-thread", list: "threads" },
  { max: 80, key: "pc-negative" },
  { max: 85, key: "pc-positive" },
  { max: 100, key: "current-context" },
].map((f) => Object.freeze(f)));

export function focusFor(roll) {
  return EVENT_FOCUS.find((f) => roll <= f.max) ?? EVENT_FOCUS[EVENT_FOCUS.length - 1];
}

export function rollEventFocus(rng = Math.random) {
  const roll = die(100, rng);
  const f = focusFor(roll);
  return { roll, key: f.key, list: f.list ?? null };
}

/* ── Scenes ──────────────────────────────────────────────────────────────── */

/** Test the expected scene: d10 against the Chaos Factor. */
export function sceneCheck(cf, rng = Math.random) {
  const chaos = clampChaos(cf);
  const roll = die(10, rng);
  let result = "expected";
  if (roll <= chaos) result = roll % 2 ? "altered" : "interrupted";
  return { roll, cf: chaos, result };
}

/** The Chaos Factor after a scene: down one if the characters were in control, up one if not. */
export function chaosAfterScene(cf, inControl) {
  return clampChaos(clampChaos(cf) + (inControl ? -1 : 1));
}

/** Scene Adjustment, d10. Seven and up means two adjustments. */
export const SCENE_ADJUSTMENTS = Object.freeze([
  { max: 1, key: "remove-character" },
  { max: 2, key: "add-character" },
  { max: 3, key: "reduce-activity" },
  { max: 4, key: "increase-activity" },
  { max: 5, key: "remove-object" },
  { max: 6, key: "add-object" },
  { max: 10, key: "two-adjustments" },
].map((a) => Object.freeze(a)));

export const adjustmentFor = (roll) => SCENE_ADJUSTMENTS.find((a) => roll <= a.max) ?? SCENE_ADJUSTMENTS.at(-1);

/**
 * Roll a Scene Adjustment. "Make 2 Adjustments" rolls twice more, rerolling
 * anything of 7 or more, so the result is always one or two concrete changes.
 */
export function rollSceneAdjustment(rng = Math.random) {
  const first = die(10, rng);
  const rolls = [first];
  if (first <= 6) return { rolls, adjustments: [adjustmentFor(first).key] };
  const adjustments = [];
  let guard = 0;
  while (adjustments.length < 2 && guard++ < 64) {
    const r = die(10, rng);
    rolls.push(r);
    if (r <= 6) adjustments.push(adjustmentFor(r).key);
  }
  // A broken rng that never lands under 7 still answers with something.
  while (adjustments.length < 2) adjustments.push(SCENE_ADJUSTMENTS[adjustments.length].key);
  return { rolls, adjustments, double: true };
}

/* ── Lists ───────────────────────────────────────────────────────────────── */

export const clampWeight = (w) => Math.min(WEIGHT_MAX, Math.max(1, Math.round(Number(w)) || 1));

/**
 * Pick from a Thread or Character list. An entry written in more than once is
 * weighted that many times (up to three), as the book's list does by writing a
 * line again. Returns null for an empty list.
 */
export function pickFromList(entries, rng = Math.random) {
  const rows = (entries ?? []).filter((e) => e && String(e.name ?? "").trim());
  if (!rows.length) return null;
  const total = rows.reduce((n, e) => n + clampWeight(e.weight), 0);
  const roll = die(total, rng);
  let acc = 0;
  for (const e of rows) {
    acc += clampWeight(e.weight);
    if (roll <= acc) return { id: e.id, name: String(e.name), roll, of: total };
  }
  return null;
}
