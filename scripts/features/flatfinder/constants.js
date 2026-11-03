/**
 * Shared constants for the PF2e Flatfinder module.
 */

/**
 * Ported into the GLUniverse Suite. The settings namespace / flag scope is the
 * single installed package id; per-feature isolation is achieved by prefixing
 * every settings key and flag key with this feature's short prefix.
 */
export const MODULE_ID = "gluniverse-foundry-modules";

/** This feature's id (folder name) and short key prefix. */
export const FEATURE_ID = "flatfinder";
export const PREFIX = "ff.";

/** Prefix a settings/flag key with this feature's prefix. */
export const ffKey = (key) => `${PREFIX}${key}`;

/**
 * Competence-check thresholds (Flatfinder v3, §3 "Competence Checks").
 * Bands are ordered from worst (index 0) to best (index 7). A roll's band is the
 * highest band whose `min` is <= the check total. Totals below 0 fall into index 0.
 */
export const COMPETENCE_BANDS = [
  { key: "disastrous", min: -Infinity, label: "PF2E-FLATFINDER.Competence.Band.Disastrous" },
  { key: "inept", min: 0, label: "PF2E-FLATFINDER.Competence.Band.Inept" },
  { key: "poor", min: 5, label: "PF2E-FLATFINDER.Competence.Band.Poor" },
  { key: "passable", min: 10, label: "PF2E-FLATFINDER.Competence.Band.Passable" },
  { key: "solid", min: 15, label: "PF2E-FLATFINDER.Competence.Band.Solid" },
  { key: "impressive", min: 20, label: "PF2E-FLATFINDER.Competence.Band.Impressive" },
  { key: "remarkable", min: 25, label: "PF2E-FLATFINDER.Competence.Band.Remarkable" },
  { key: "phenomenal", min: 30, label: "PF2E-FLATFINDER.Competence.Band.Phenomenal" },
];

/**
 * The Proficiency-without-Level creature XP table referenced by Flatfinder's
 * Encounter Building chapter, keyed by (creature level - party level).
 */
export const PWL_XP_BY_DIFF = {
  "-7": 9,
  "-6": 12,
  "-5": 14,
  "-4": 18,
  "-3": 21,
  "-2": 26,
  "-1": 32,
  "0": 40,
  "1": 48,
  "2": 60,
  "3": 72,
  "4": 90,
  "5": 108,
  "6": 135,
  "7": 160,
};

export const PWL_DIFF_MIN = -7;
export const PWL_DIFF_MAX = 7;

/**
 * Standard PF2e encounter budget, expressed for a party of 4 with the
 * per-extra-character adjustment that scales the budget for other party sizes.
 * PF2e's own `generateEncounterBudgets` states the same table as a fraction of
 * 20 XP per character (x0.5, x0.75, x1, x1.5, x2); tools/flatfinder-check.mjs
 * holds the two equal for every party size.
 */
export const ENCOUNTER_BUDGET = {
  trivial: { base: 40, perPc: 10 },
  low: { base: 60, perPc: 15 },
  moderate: { base: 80, perPc: 20 },
  severe: { base: 120, perPc: 30 },
  extreme: { base: 160, perPc: 40 },
};

/** The five threat ratings, mildest first. Keys are i18n (`Encounter.Severity.*`) and data. */
export const THREAT_ORDER = Object.freeze(["trivial", "low", "moderate", "severe", "extreme"]);

/** The party size the budget table is written for. */
export const BASE_PARTY = 4;

/**
 * A simple hazard is worth a fifth of a creature of its level. That is the exact
 * ratio between PF2e's simple-hazard and creature XP tables, applied here to the
 * Proficiency-without-Level creature table; complex hazards count as creatures.
 */
export const SIMPLE_HAZARD_FACTOR = 0.2;

/** Flatfinder counts an Elite creature as 2 levels higher and a Weak one 2 lower. */
export const ELITE_WEAK_SHIFT = 2;

/**
 * Flatfinder's incapacitation rule: a target that outlevels the source gains an
 * untyped bonus of twice the difference, capped, and a spell counts as twice
 * its rank.
 */
export const INCAP_BONUS_PER_LEVEL = 2;
export const INCAP_BONUS_MAX = 10;
export const SPELL_LEVEL_PER_RANK = 2;

/**
 * How recent a chat card must be for its badge to play its entrance. Older
 * cards (the log on load, a re-render) draw settled. Not an animation length:
 * the entrance itself runs on the suite's duration tokens.
 */
export const FRESH_CARD_MS = 6000;

/** Every setting this feature registers, unprefixed (the key is `ff.<name>`). */
export const SETTING_KEYS = Object.freeze([
  "competenceBadge",
  "incapacitation",
  "flattenDc",
  "eliteWeakLevel",
  "encounterBudget",
  "planner",
]);

