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
 */
export const ENCOUNTER_BUDGET = {
  trivial: { base: 40, perPc: 10 },
  low: { base: 60, perPc: 15 },
  moderate: { base: 80, perPc: 20 },
  severe: { base: 120, perPc: 30 },
  extreme: { base: 160, perPc: 40 },
};

/**
 * Apex (solo boss) template — Flatfinder v3 §8 "The Apex (Solo Boss) template".
 * A creature flagged as Apex takes extra full turns each round: its Prime turn at
 * its rolled initiative, then an additional turn at (result − 10), a third at
 * (result − 20), and so on. `turns` is the total number of turns per round.
 */
export const APEX_FLAG = "ff.apex";
export const APEX_PRIME_FLAG = "ff.apexPrime";
export const APEX_EXTRA_FLAG = "ff.apexExtra";
export const APEX_PHASES_FLAG = "ff.apexPhasesFired";
export const APEX_DEFAULTS = Object.freeze({ enabled: false, turns: 2 });
export const APEX_TURNS_LIMITS = Object.freeze({ min: 2, max: 4 });
/** Initiative gap between consecutive Apex turns (Flatfinder: −10 per extra turn). */
export const APEX_INITIATIVE_STEP = 10;
/** HP fractions that trigger an Apex phase beat (Flatfinder §8: 66% and 33%). */
export const APEX_PHASE_THRESHOLDS = Object.freeze([0.66, 0.33]);

/** The sibling suite feature whose Card initiative mode owns multi-turn bosses. */
export const GLUNI_MODULE_ID = "gluniverse-foundry-modules";
/** Initiative's (prefixed) setting key within the suite namespace. */
export const GLUNI_INIT_MODE_KEY = "init.initiativeMode";

export const DEGREE_LABELS = [
  "PF2E-FLATFINDER.Degree.CriticalFailure",
  "PF2E-FLATFINDER.Degree.Failure",
  "PF2E-FLATFINDER.Degree.Success",
  "PF2E-FLATFINDER.Degree.CriticalSuccess",
];
