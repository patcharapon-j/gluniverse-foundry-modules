/**
 * Flatfinder — the rules, as pure functions.
 *
 * Every number the feature prints or adds to a roll comes from here, and
 * nothing here reads the world: no `game`, no `CONFIG`, no actor. The world
 * readers (snapshot.mjs, competence.js, incapacitation.js) turn documents into
 * plain values and hand them over, which is what lets tools/flatfinder-check.mjs
 * drive the real rules against the PF2e tables under plain Node.
 */

import {
  BASE_PARTY,
  COMPETENCE_BANDS,
  ELITE_WEAK_SHIFT,
  ENCOUNTER_BUDGET,
  INCAP_BONUS_MAX,
  INCAP_BONUS_PER_LEVEL,
  PWL_DIFF_MAX,
  PWL_DIFF_MIN,
  PWL_XP_BY_DIFF,
  SIMPLE_HAZARD_FACTOR,
  SPELL_LEVEL_PER_RANK,
  THREAT_ORDER,
} from "./constants.js";

const isNum = (n) => typeof n === "number" && Number.isFinite(n);

/* ── Encounter XP ───────────────────────────────────────────────────────── */

/** The PWoL creature XP for a level difference; the table stops at ±7 and clamps there. */
export function xpForDiff(diff) {
  if (!isNum(diff)) return 0;
  const clamped = Math.max(PWL_DIFF_MIN, Math.min(PWL_DIFF_MAX, Math.trunc(diff)));
  return PWL_XP_BY_DIFF[String(clamped)] ?? 0;
}

/**
 * XP one creature or hazard is worth against a party level.
 * `hazard` is null for a creature, "complex" (counts as a creature) or "simple".
 */
export function creatureXp(level, partyLevel, { hazard = null } = {}) {
  if (!isNum(level) || !isNum(partyLevel)) return 0;
  const xp = xpForDiff(level - partyLevel);
  return hazard === "simple" ? Math.round(xp * SIMPLE_HAZARD_FACTOR) : xp;
}

/** The five budgets for a party of `size`. */
export function encounterBudgets(size) {
  const n = Math.max(1, Math.trunc(isNum(size) ? size : BASE_PARTY));
  const out = {};
  for (const key of THREAT_ORDER) {
    const { base, perPc } = ENCOUNTER_BUDGET[key];
    out[key] = Math.max(0, base + (n - BASE_PARTY) * perPc);
  }
  return out;
}

/**
 * The rating of an encounter: the mildest threat whose budget still holds it.
 *
 * A budget is a ceiling, so 70 XP against a party of four (low 60, moderate 80)
 * is a Moderate fight, not a Low one. This is PF2e's own reading
 * (`calculateEncounterRating`), and the tracker must agree with it: the
 * standalone module rounded down, which called every fight that overspent a
 * budget by less than a full step the milder rating.
 */
export function threatRating(xp, budgets) {
  const total = isNum(xp) ? xp : 0;
  for (const key of THREAT_ORDER.slice(0, -1)) if (total <= budgets[key]) return key;
  return "extreme";
}

/**
 * How far the encounter sits from the next rating up: `{ key, gap }` where
 * adding `gap` more XP tips it into `key`. An Extreme fight has no next
 * rating, so it reports `under` (XP left inside the Extreme budget) or `over`
 * (XP past it); both are 0 exactly at the budget.
 */
export function headroom(xp, budgets) {
  const rating = threatRating(xp, budgets);
  if (rating === "extreme") {
    const d = xp - budgets.extreme;
    return { key: null, gap: 0, over: Math.max(0, d), under: Math.max(0, -d) };
  }
  return { key: THREAT_ORDER[THREAT_ORDER.indexOf(rating) + 1], gap: budgets[rating] - xp + 1, over: 0, under: 0 };
}

/** The XP each PC earns, scaled to the four-character table as PF2e does. */
export function awardPerPc(xp, size) {
  if (!isNum(xp) || !isNum(size) || size < 1) return 0;
  return Math.floor((xp / size) * BASE_PARTY);
}

/** Party level from the PCs' levels: their mean, rounded. */
export function partyLevelOf(levels) {
  const list = (levels ?? []).filter(isNum);
  if (!list.length) return null;
  return Math.round(list.reduce((a, b) => a + b, 0) / list.length);
}

/* ── Elite / Weak ───────────────────────────────────────────────────────── */

/**
 * Flatfinder's level for a creature: its base level ±2 when Elite or Weak.
 *
 * `base` is the level the creature was built at (PF2e's `details.level.base`),
 * never the live level: PF2e's native button already moves the live level by 1,
 * or by 2 at the edges (an Elite creature of level 0 or below, a Weak one of
 * level 1), so "live + 1" lands on +3 there. Off, it is PF2e's own level.
 */
export function eliteWeakLevel({ level, base, adjustment, shift = true }) {
  if (!shift || (adjustment !== "elite" && adjustment !== "weak")) return isNum(level) ? level : null;
  const from = isNum(base) ? base : level;
  if (!isNum(from)) return null;
  return adjustment === "elite" ? from + ELITE_WEAK_SHIFT : from - ELITE_WEAK_SHIFT;
}

/**
 * The level PF2e itself gives an adjusted creature (NPCPF2e#prepareBaseData):
 * Elite +1, or +2 from level 0 and below; Weak −1, or −2 from level 1. The
 * planner uses it when the Elite/Weak setting is off, so a planned Elite reads
 * exactly what the tracker will read once that creature is on the board.
 */
export function pf2eAdjustedLevel(base, adjustment) {
  if (!isNum(base)) return null;
  const b = Math.max(-1, base);
  if (adjustment === "elite") return b < 1 ? b + 2 : b + 1;
  if (adjustment === "weak") return b === 1 ? b - 2 : b - 1;
  return b;
}

/** A planned creature's level under the current Elite/Weak setting. */
export function plannedLevel(base, adjustment, shift = true) {
  return shift ? eliteWeakLevel({ level: base, base, adjustment }) : pf2eAdjustedLevel(base, adjustment);
}

/* ── Competence ─────────────────────────────────────────────────────────── */

/** The highest band whose minimum the total reaches. Negative totals land on the first. */
export function bandIndexFromTotal(total) {
  let index = 0;
  if (!isNum(total)) return index;
  for (let i = 0; i < COMPETENCE_BANDS.length; i++) if (total >= COMPETENCE_BANDS[i].min) index = i;
  return index;
}

/**
 * A check's competence band.
 *
 * Lore checks go up one band; a natural 20 up one and a natural 1 down one.
 * The shifts are reported in the order they were applied, so the card can say
 * why a 19 reads Impressive.
 */
export function competence({ total, natural = null, lore = false }) {
  if (!isNum(total)) return null;
  const from = bandIndexFromTotal(total);
  let index = from;
  const shifts = [];
  if (lore) {
    index += 1;
    shifts.push("lore");
  }
  if (natural === 20) {
    index += 1;
    shifts.push("nat20");
  } else if (natural === 1) {
    index -= 1;
    shifts.push("nat1");
  }
  index = Math.max(0, Math.min(COMPETENCE_BANDS.length - 1, index));
  return { index, from, band: COMPETENCE_BANDS[index], total, natural, lore, shifts };
}

/* ── Incapacitation ─────────────────────────────────────────────────────── */

/** A spell's level for incapacitation: twice its rank. */
export function spellLevel(rank) {
  return isNum(rank) ? rank * SPELL_LEVEL_PER_RANK : null;
}

/** Flatfinder's save bonus: twice the level difference when the target outlevels the source, capped. */
export function incapacitationBonus(targetLevel, sourceLevel) {
  if (!isNum(targetLevel) || !isNum(sourceLevel)) return 0;
  const diff = targetLevel - sourceLevel;
  if (diff <= 0) return 0;
  return Math.min(diff * INCAP_BONUS_PER_LEVEL, INCAP_BONUS_MAX);
}
