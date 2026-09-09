/**
 * Boss Creatures — the rules themselves, as pure functions.
 *
 * Source: *Adventures+* pp. 48–55.
 *
 * Nothing here touches a Foundry global, so `tools/pf2e-variant-rules-check.mjs`
 * asserts on it directly. Every number a boss shows on a sheet, prints in an
 * ability description or hands to another feature comes from this file, so the
 * readout and the thing it describes cannot drift apart.
 */

import { BOSS_TIER } from "./constants.mjs";

/* ══════════════════════════════════════════════════════════════════════════
   TIERS
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * The two boss grades, and everything that follows from picking one.
 *
 * "A Supreme creature has Hit Points equal to 2 x the base creature's Hit Points
 * and a Greater creature has Hit Points equal to 1.5 x the base creature's Hit
 * Points." / "the boss's level is equal to the base creature level + 4 if it is
 * a Supreme creature, or equal to the base creature level + 2 if it is a Greater
 * creature." / "A Greater creature is worth XP equal to twice the base creature,
 * and a Supreme creature is worth XP equal to thrice the base creature."
 *
 * `turns` is the count from BOSS TURNS: Greater 2, Supreme 3.
 */
export const TIERS = Object.freeze({
  [BOSS_TIER.greater]: Object.freeze({
    id: BOSS_TIER.greater,
    hpFactor: 1.5,
    levelBump: 2,
    xpFactor: 2,
    turns: 2,
  }),
  [BOSS_TIER.supreme]: Object.freeze({
    id: BOSS_TIER.supreme,
    hpFactor: 2,
    levelBump: 4,
    xpFactor: 3,
    turns: 3,
  }),
});

/** The tier record for a stored value, or null when the value names no tier. */
export function tierOf(tier) {
  return TIERS[tier] ?? null;
}

/* ══════════════════════════════════════════════════════════════════════════
   LEVEL, HIT POINTS, EXPERIENCE
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * The boss's creature level: base + 2 (Greater) or + 4 (Supreme).
 *
 * This is a level *for rules that ask what level the creature is* — the book
 * names incapacitation — and emphatically not a stat boost: "Boss's typically
 * have the same defenses as the base creature." It must therefore never be
 * written back to `system.details.level.value`. pf2e-flatten implements
 * Proficiency-without-Level by adding a custom modifier equal to minus the
 * actor's level and refreshing it whenever the level changes, so raising the
 * stored level would silently subtract another 2 or 4 from every check and DC
 * the boss makes — the same trap Flatfinder's own Elite/Weak handling documents
 * and avoids.
 */
export function bossLevel(baseLevel, tier) {
  const record = tierOf(tier);
  const base = Math.trunc(Number(baseLevel) || 0);
  return record ? base + record.levelBump : base;
}

/**
 * The boss's maximum Hit Points.
 *
 * Rounded down. PF2e compares against thresholds derived from max HP, and a
 * fraction of a Hit Point is not a thing the system can spend; flooring keeps
 * the printed figure and the stored figure the same number.
 */
export function bossHp(baseHp, tier) {
  const record = tierOf(tier);
  const base = Math.max(0, Math.trunc(Number(baseHp) || 0));
  return record ? Math.floor(base * record.hpFactor) : base;
}

/** The XP multiplier a boss applies to the base creature's own XP value. */
export function bossXpFactor(tier) {
  return tierOf(tier)?.xpFactor ?? 1;
}

/** How many turns per round this boss takes. */
export function bossTurns(tier) {
  return tierOf(tier)?.turns ?? 1;
}

/* ══════════════════════════════════════════════════════════════════════════
   BOSS DC AND BOSS MODIFIER
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * PF2e's level-based DC table, levels −1 through 25.
 *
 * Carried here rather than read from the system because this module must stay
 * importable without a Foundry global — the check tool asserts on `bossDc`
 * directly. It is a verbatim copy of the system's own map, and the check tool
 * re-reads that map out of `pf2e.mjs` and compares the two entry by entry, so a
 * system errata cannot leave this table quietly wrong.
 *
 * The top of the table is where a hand-written copy goes wrong: the steps widen
 * to +2 from level 21 on (42, 44, 46, 48, 50), not the +1/+2 alternation that
 * runs through the middle of the table.
 */
export const LEVEL_DC = Object.freeze([
  /* -1 */ 13, /* 0 */ 14, /* 1 */ 15, /* 2 */ 16, /* 3 */ 18, /* 4 */ 19,
  /* 5 */ 20, /* 6 */ 22, /* 7 */ 23, /* 8 */ 24, /* 9 */ 26, /* 10 */ 27,
  /* 11 */ 28, /* 12 */ 30, /* 13 */ 31, /* 14 */ 32, /* 15 */ 34, /* 16 */ 35,
  /* 17 */ 36, /* 18 */ 38, /* 19 */ 39, /* 20 */ 40, /* 21 */ 42, /* 22 */ 44,
  /* 23 */ 46, /* 24 */ 48, /* 25 */ 50,
]);

/** The "very hard" adjustment from PF2e's DC adjustment table. */
export const VERY_HARD = 5;

/** The level-based DC for a level, clamped to the ends of the published table. */
export function levelDc(level) {
  const index = Math.trunc(Number(level) || 0) + 1;
  return LEVEL_DC[Math.max(0, Math.min(LEVEL_DC.length - 1, index))];
}

/**
 * The Boss DC: "usually a very hard DC of the base creature's level".
 *
 * Note *base* creature's level, not the boss's inflated one — a Supreme boss
 * built on a level 8 creature rolls against the level 8 very-hard DC, not the
 * level 12 one. Getting this wrong is invisible in play (the number is merely
 * larger) and makes every save against the boss harder than the book intends.
 *
 * `flatten` is the non-positive Proficiency-without-Level offset the actor
 * carries, if any. A Boss DC is a static number we compute from a table, so
 * nothing in pf2e-flatten can reach it — in a PWoL world the PCs' saves are
 * flattened by their own level while this DC would not be, and every save
 * against the boss would be off by roughly a level. Folding the actor's own
 * flattening value in here is what keeps the two sides on the same scale.
 */
export function bossDc(baseLevel, { flatten = 0 } = {}) {
  const raw = levelDc(baseLevel) + VERY_HARD;
  const offset = Math.min(0, Math.trunc(Number(flatten) || 0));
  return Math.max(1, raw + offset);
}

/** "the boss modifier is equal to its Boss DC – 10". */
export function bossModifier(baseLevel, options = {}) {
  return bossDc(baseLevel, options) - 10;
}

/* ══════════════════════════════════════════════════════════════════════════
   DOWNFALLS
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * The defence penalty a boss carries, given how many *separate* Downfalls have
 * been triggered since the beginning of its initial turn.
 *
 * "When a Downfall is triggered, the boss takes a –1 penalty to all its defenses
 * … Each time a separate Downfall is triggered, increase the penalty to the
 * boss's defenses by 1 to a maximum of –3."
 *
 * Returned negative, so a caller never has to remember which way the sign goes;
 * a positive value here would silently *harden* the boss at the moment the
 * party finally got through to it.
 */
export function downfallPenalty(triggeredCount) {
  const n = Math.max(0, Math.trunc(Number(triggeredCount) || 0));
  return -Math.min(3, n);
}

/** The most Downfalls that can stack before the penalty stops growing. */
export const DOWNFALL_PENALTY_CAP = 3;

/**
 * A boss should carry as many Downfalls as it has Boss Abilities.
 *
 * "a boss should have an equal number of Downfalls as it has Boss Abilities".
 * Returned as a report rather than enforced: a half-built boss is a normal state
 * to be in while building one, and refusing to save it would be worse than
 * saying so.
 */
export function downfallBalance({ abilities = 0, downfalls = 0 } = {}) {
  const a = Math.max(0, Math.trunc(Number(abilities) || 0));
  const d = Math.max(0, Math.trunc(Number(downfalls) || 0));
  return { abilities: a, downfalls: d, balanced: a === d, delta: d - a };
}

/** "A Boss can have up to 3 Boss Abilities." */
export const MAX_ABILITIES = 3;

/**
 * Can this Downfall be triggered right now?
 *
 * Two separate locks, and they are not the same lock:
 *   • a boss triggers *any* Downfall at most once per boss turn, and
 *   • once a Downfall has fired from a specific trigger it is immune to that
 *     trigger until the beginning of the boss's *initial* turn.
 *
 * The second outlasts the first — a Supreme boss has three turns between initial
 * turns — so collapsing them into one would let the same critical hit disrupt
 * the same boss twice in a round.
 *
 * @param {object} state
 * @param {number} state.turnSerial       monotonic count of boss turns taken
 * @param {number} state.roundSerial      monotonic count of the boss's initial turns
 * @param {number|null} state.lastTurn    turnSerial of the last Downfall of any kind
 * @param {number|null} state.lastRound   roundSerial when *this* trigger last fired
 */
export function downfallAvailable({
  turnSerial = 0,
  roundSerial = 0,
  lastTurn = null,
  lastRound = null,
} = {}) {
  if (lastTurn !== null && lastTurn === turnSerial) return false;
  if (lastRound !== null && lastRound === roundSerial) return false;
  return true;
}

/* ══════════════════════════════════════════════════════════════════════════
   ABILITY SCALING
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * "N per X levels of the base creature (minimum N)" — the book's one scaling
 * idiom, used by nearly every ability that deals damage.
 *
 * Floors, and never returns less than one step. A level-1 boss would otherwise
 * telegraph an ability that deals nothing at all.
 */
export function perLevels(level, per, step = 1) {
  const l = Math.max(0, Math.trunc(Number(level) || 0));
  const divisor = Math.max(1, Math.trunc(Number(per) || 1));
  const size = Math.max(1, Math.trunc(Number(step) || 1));
  return Math.max(size, Math.floor(l / divisor) * size);
}

/** The same idiom expressed as a dice pool: `Nd6` and friends. */
export function diceFor(level, per, faces) {
  const count = Math.max(1, Math.floor(Math.max(0, Math.trunc(Number(level) || 0)) / Math.max(1, per)));
  return { count, faces, formula: `${count}d${faces}` };
}

/**
 * Extra weapon dice on Targeted Assault: one, two from 10th level, three from
 * 18th. Keyed on the boss's own level, which is the level the ability names.
 */
export function targetedAssaultDice(level) {
  const l = Math.trunc(Number(level) || 0);
  if (l >= 18) return 3;
  if (l >= 10) return 2;
  return 1;
}

/** Grasping Appendages: 2, "+1 for every 5 levels of the base creature". */
export function appendageCount(baseLevel) {
  return 2 + Math.floor(Math.max(0, Math.trunc(Number(baseLevel) || 0)) / 5);
}

/** Reinforcements!: 4 underlings, "+1 for every 3 levels of the base creature". */
export function reinforcementCount(baseLevel) {
  return 4 + Math.floor(Math.max(0, Math.trunc(Number(baseLevel) || 0)) / 3);
}

/** Impenetrable: "resistance is 6 per 4 levels of the base creature (minimum 6)". */
export function impenetrableResistance(baseLevel) {
  return perLevels(baseLevel, 4, 6);
}

/** Infused: "a weakness … equal to twice the base creature's level". */
export function infusedWeakness(baseLevel) {
  return Math.max(1, Math.trunc(Number(baseLevel) || 0) * 2);
}

/** Unleash: "temporary Hit Points equal to 5 x its level" — the *boss's* level. */
export function unleashTempHp(level) {
  return Math.max(0, Math.trunc(Number(level) || 0) * 5);
}

/** Consume Underling: "15 per 2 levels of the base creature (minimum 15)". */
export function consumeUnderlingHealing(baseLevel) {
  return perLevels(baseLevel, 2, 15);
}

/* ══════════════════════════════════════════════════════════════════════════
   BOSS TURN ROTATION
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Where a boss's extra turns fall in the round, as a count of PC turns that pass
 * between them.
 *
 * "Greater The boss has 2 turns. The boss's second turn typically occurs after 2
 * members of the party have acted since its first turn." / "Supreme The boss has
 * 3 turns. The boss's second turn typically occurs after 1 member of the party
 * has acted since its first turn, and then its third turn typically occurs after
 * 3 party members have acted since its first turn."
 *
 * Both quoted rotations assume a party of four, so they are expressed here as
 * *fractions of the party* and re-derived for the real party size. A four-PC
 * table gets exactly the book's numbers back; a five- or six-PC table gets the
 * same shape rather than a boss that acts twice in a row at one end of the round.
 *
 * @returns {number[]} gaps, in PC turns after the initial turn, one per extra turn
 */
export function turnOffsets(tier, partySize = 4) {
  const record = tierOf(tier);
  if (!record || record.turns < 2) return [];

  const size = Math.max(1, Math.trunc(Number(partySize) || 4));
  // The book's own rotations, as they read for four PCs.
  const canonical = record.turns === 3 ? [1, 3] : [2];
  const offsets = canonical.map((gap) => Math.round((gap * size) / 4));

  // Two turns must never land on the same gap, and none may land on 0 — "A boss
  // should never be able to take multiple turns in succession".
  //
  // Deliberately *not* clamped to the party size. At a very small table a
  // Supreme boss's three turns cannot all fit between distinct PC turns, and
  // clamping here would collapse two of them onto the same gap — which is the
  // succession the rule forbids, reintroduced by the code meant to prevent it.
  // Running past the end of the order is `planTurns`'s problem, and it solves it
  // by placing the overflow at the bottom of the round instead.
  const seen = new Set([0]);
  return offsets.map((gap) => {
    let value = Math.max(1, gap);
    while (seen.has(value)) value += 1;
    seen.add(value);
    return value;
  });
}

/* ══════════════════════════════════════════════════════════════════════════
   SCALE RESOLUTION
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Every value an ability's rule text can interpolate, computed for one boss.
 *
 * `data.mjs` declares which of these keys each ability needs and the lang file
 * spends them as `{placeholders}`. The check tool walks all three and refuses a
 * text that spends a key its entry does not declare, a declared key this
 * resolver cannot produce, and a declared key the text never spends — so an
 * ability can never print `{dmg}` at the table, and a rewritten description can
 * never quietly stop showing a number the GM needs.
 *
 * @param {{baseLevel: number, tier: string, flatten?: number}} boss
 */
export function resolveScale({ baseLevel = 0, tier = null, flatten = 0 } = {}) {
  const base = Math.trunc(Number(baseLevel) || 0);
  const level = bossLevel(base, tier);
  const dc = bossDc(base, { flatten });

  return {
    baseLevel: base,
    level,
    dc,
    modifier: bossModifier(base, { flatten }),
    // The book's three dice ladders, all "per 2 levels of the base creature".
    d6: diceFor(base, 2, 6).formula,
    d8: diceFor(base, 2, 8).formula,
    d10: diceFor(base, 2, 10).formula,
    // Flat "1 per 2 levels" hazard-terrain damage.
    hazardDamage: perLevels(base, 2, 1),
    // "1 per 6 levels (minimum 1)" — Billowing Cloud's condition value.
    conditionValue: perLevels(base, 6, 1),
    consumeHealing: consumeUnderlingHealing(base),
    appendages: appendageCount(base),
    reinforcements: reinforcementCount(base),
    resistance: impenetrableResistance(base),
    weakness: infusedWeakness(base),
    assaultDice: targetedAssaultDice(level),
    tempHp: unleashTempHp(level),
  };
}

/** The scale keys `resolveScale` can produce — the check tool's other half. */
export const SCALE_KEYS = Object.freeze(Object.keys(resolveScale({ baseLevel: 1, tier: "greater" })));
