/**
 * GLUniverse Suite — Mythic GME feature: the oracle engine.
 *
 * Pure-ish roll logic for the Mythic Game Master Emulator 2nd Edition tables,
 * plus the persisted Chaos Factor. No UI here — the panel calls these and renders
 * the returned result objects. Rolls are silent internal d100s (no chat / no 3D
 * dice) per the feature contract; the panel offers an explicit "send to chat".
 *
 * Fate Chart model: every cell is a triple [excYes, yes, excNo] taken from one
 * master sequence, indexed by (chaosFactor + oddsOffset) clamped to [1..13]. This
 * reproduces the printed chart exactly (verified against the rulebook rows) while
 * staying compact. See docs / the feature grill notes for the derivation.
 */

import { SUITE_ID } from "../../core/const.mjs";
import { clamp, toInt } from "../../core/util.mjs";
import { MEANING, ELEMENTS } from "./data/tables.mjs";

export const FEATURE_ID = "mythic-gme";
export const CHAOS_KEY = "mythic.chaos";
export const LOG_KEY = "mythic.log";
export const POS_KEY = "mythic.panelPos";
export const AUTOEVENT_KEY = "mythic.autoEvent";

export const CHAOS_MIN = 1;
export const CHAOS_MAX = 9;
export const CHAOS_DEFAULT = 5;
export const LOG_MAX = 50;

/** d(n): silent internal die, 1..n. */
const d = (n) => 1 + Math.floor(Math.random() * n);
const roll100 = () => d(100);

/* ── Fate Chart ─────────────────────────────────────────────────────────── */

/** Master sequence of [exceptionalYes, yes, exceptionalNo] thresholds (1-indexed). */
const FATE_MASTER = [
  [0, 1, 81],   // 1  (excNo≥81; excYes "X" = 0 → never)
  [1, 5, 82],   // 2
  [2, 10, 83],  // 3
  [3, 15, 84],  // 4
  [5, 25, 86],  // 5
  [7, 35, 88],  // 6
  [10, 50, 91], // 7  (the 50/50-at-CF5 centre)
  [13, 65, 94], // 8
  [15, 75, 96], // 9
  [17, 85, 98], // 10
  [18, 90, 99], // 11
  [19, 95, 100],// 12
  [20, 99, 101],// 13 (excNo "x" = 101 → never)
];

/** Odds rows (low→high) and their offset into the master sequence. */
export const ODDS = [
  { id: "impossible", offset: -2 },
  { id: "nearly-impossible", offset: -1 },
  { id: "very-unlikely", offset: 0 },
  { id: "unlikely", offset: 1 },
  { id: "fifty-fifty", offset: 2 },
  { id: "likely", offset: 3 },
  { id: "very-likely", offset: 4 },
  { id: "nearly-certain", offset: 5 },
  { id: "certain", offset: 6 },
];

const oddsById = (id) => ODDS.find((o) => o.id === id) ?? ODDS[4];

/** The [excYes, yes, excNo] cell for an odds id at a chaos factor. */
function fateCell(oddsId, cf) {
  const idx = clamp(cf + oddsById(oddsId).offset, 1, FATE_MASTER.length);
  return FATE_MASTER[idx - 1];
}

/* ── Event Focus ────────────────────────────────────────────────────────── */

const EVENT_FOCUS = [
  [5, "Remote Event"],
  [10, "Ambiguous Event"],
  [20, "New NPC"],
  [40, "NPC Action"],
  [45, "NPC Negative"],
  [50, "NPC Positive"],
  [55, "Move Toward A Thread"],
  [65, "Move Away From A Thread"],
  [70, "Close A Thread"],
  [80, "PC Negative"],
  [85, "PC Positive"],
  [100, "Current Context"],
];

function focusFor(r) {
  for (const [max, label] of EVENT_FOCUS) if (r <= max) return label;
  return EVENT_FOCUS[EVENT_FOCUS.length - 1][1];
}

/* ── Chaos Factor state (world setting) ─────────────────────────────────── */

export const getChaos = () =>
  clamp(toInt(game.settings.get(SUITE_ID, CHAOS_KEY), CHAOS_DEFAULT), CHAOS_MIN, CHAOS_MAX);

export async function setChaos(v) {
  const next = clamp(toInt(v, CHAOS_DEFAULT), CHAOS_MIN, CHAOS_MAX);
  await game.settings.set(SUITE_ID, CHAOS_KEY, next);
  return next;
}

export const adjustChaos = (delta) => setChaos(getChaos() + toInt(delta, 0));

/* ── Rolls ──────────────────────────────────────────────────────────────── */

/**
 * Ask the Fate Chart. Returns the yes/no verdict plus whether a Random Event was
 * triggered (doubles with the tens digit ≤ chaos factor).
 */
export function rollFate(oddsId, cf = getChaos()) {
  const [excYes, yes, excNo] = fateCell(oddsId, cf);
  const r = roll100();

  let verdict, key;
  if (r <= excYes) { verdict = "Exceptional Yes"; key = "exceptional-yes"; }
  else if (r <= yes) { verdict = "Yes"; key = "yes"; }
  else if (r >= excNo) { verdict = "Exceptional No"; key = "exceptional-no"; }
  else { verdict = "No"; key = "no"; }

  const tens = Math.floor(r / 10);
  const ones = r % 10;
  const isDouble = r < 100 && tens === ones && r >= 11;
  const eventTriggered = isDouble && tens <= cf;

  return { oddsId, cf, roll: r, verdict, key, yes, threshold: [excYes, yes, excNo], eventTriggered };
}

/** Roll the Event Focus table. */
export function rollEventFocus() {
  const r = roll100();
  return { roll: r, focus: focusFor(r) };
}

/** Roll the two-column Actions meaning table (verb + subject-ish). */
export function rollActions() {
  const i1 = d(100), i2 = d(100);
  return { rolls: [i1, i2], words: [MEANING.action1[i1 - 1], MEANING.action2[i2 - 1]] };
}

/** Roll the two-column Descriptions meaning table. */
export function rollDescriptions() {
  const i1 = d(100), i2 = d(100);
  return { rolls: [i1, i2], words: [MEANING.descriptor1[i1 - 1], MEANING.descriptor2[i2 - 1]] };
}

/** A full Random Event: Event Focus + an Actions meaning pair. */
export function rollRandomEvent() {
  const focus = rollEventFocus();
  const meaning = rollActions();
  return { focus, meaning };
}

/** Roll a single Elements meaning table by id. */
export function rollElement(id) {
  const table = ELEMENTS.find((e) => e.id === id);
  if (!table) return null;
  const i = d(100);
  return { id, name: table.name, roll: i, word: table.entries[i - 1] };
}

/** Elements grouped by category, in declaration order — for the panel picker. */
export function elementGroups() {
  const groups = [];
  const byCat = new Map();
  for (const e of ELEMENTS) {
    if (!byCat.has(e.category)) { byCat.set(e.category, []); groups.push({ category: e.category, tables: byCat.get(e.category) }); }
    byCat.get(e.category).push({ id: e.id, name: e.name });
  }
  return groups;
}
