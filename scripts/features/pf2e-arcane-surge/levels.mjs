/**
 * GLUniverse Suite — Arcane Surge stability resolution.
 *
 * Pure logic: no Foundry, no DOM, no settings reads. Everything here takes a
 * config object and returns a value, so `tools/arcane-surge-check.mjs` can drive
 * the real functions rather than a reimplementation of them.
 *
 * The chain a casting walks:
 *
 *   area level ──(steadied? one step down)──► effective level
 *                                              │
 *                     ┌────────────────────────┴───────────────────┐
 *                     │                                            │
 *              ordinary casting                             invited casting
 *              roll 1d20 ≤ threshold                        surges outright,
 *              → surge                                      row escalates one
 *                     │                                            │
 *                     └────────────────────────┬───────────────────┘
 *                                              ▼
 *                                     severity row → 1d100 → tier
 */

import { clamp, toInt } from "../../core/util.mjs";
import {
  DEFAULT_LEVEL_CONFIG,
  LEVELS,
  MAX_THRESHOLD,
  ROW_INVITED_UNRAVELING,
  ROWS,
  TIERS,
} from "./constants.mjs";

/** True when `id` names one of the four stability levels. */
export const isLevel = (id) => LEVELS.includes(id);

/** Index of a level in the weakest→worst order, or 0 for anything unknown. */
export const levelIndex = (id) => {
  const i = LEVELS.indexOf(id);
  return i < 0 ? 0 : i;
};

/**
 * Merge stored config over the defaults.
 *
 * Stored config is a world setting a GM edits, so every field is treated as
 * hostile: a threshold outside 0..20 would make the die disagree with the odds,
 * and non-monotonic bands would make a tier unreachable in a way nothing else
 * would report. Both are repaired here rather than at each call site.
 */
export function resolveConfig(stored = {}) {
  const out = {};
  for (const row of [...LEVELS, ROW_INVITED_UNRAVELING]) {
    const base = DEFAULT_LEVEL_CONFIG[row];
    const over = stored?.[row] ?? {};
    out[row] = {
      threshold: clamp(toInt(over.threshold ?? base.threshold, base.threshold), 0, MAX_THRESHOLD),
      bands: normalizeBands(over.bands ?? base.bands),
    };
  }
  // Stable never surges, whatever a stored value claims.
  out.stable.threshold = 0;
  out.stable.bands = null;
  return out;
}

/**
 * Coerce a band table into monotonic cumulative upper bounds ending at 100.
 *
 * Bounds must be non-decreasing: each tier's window is the gap above the
 * previous bound, so a bound that dips below its predecessor would silently
 * produce a negative-width window (an unreachable tier) instead of an error.
 * The last tier is pinned to 100 so no d100 result can fall off the end.
 */
export function normalizeBands(bands) {
  if (!bands) return null;
  const out = {};
  let floor = 0;
  for (const tier of TIERS) {
    const raw = toInt(bands[tier] ?? floor, floor);
    floor = clamp(raw, floor, 100);
    out[tier] = floor;
  }
  out[TIERS[TIERS.length - 1]] = 100;
  return out;
}

/**
 * Apply Steady the Spell: one step toward Stable, floored there.
 * Fraying becomes Stable, which means the casting is not checked at all.
 */
export function steadiedLevel(level) {
  return LEVELS[Math.max(0, levelIndex(level) - 1)];
}

/**
 * The severity row an invited casting reads against: Fraying uses Unbound,
 * Unbound uses Unraveling, Unraveling uses its own invited row.
 */
export function invitedRow(level) {
  if (level === "unraveling") return ROW_INVITED_UNRAVELING;
  const next = LEVELS[Math.min(LEVELS.length - 1, levelIndex(level) + 1)];
  return next === "stable" ? "fraying" : next;
}

/**
 * Resolve one casting's exposure.
 *
 * `mode` is the player's armed choice: "none" | "steadied" | "invited".
 * Returns the effective level, the severity row, the d20 threshold, and whether
 * a d20 is rolled at all. An invited casting is a guaranteed surge, so it rolls
 * NO d20 — throwing a die whose result is predetermined would misrepresent the
 * odds the die exists to show.
 */
export function resolveExposure(areaLevel, mode = "none", config = resolveConfig()) {
  const level = isLevel(areaLevel) ? areaLevel : "stable";
  const steadied = mode === "steadied";
  const invited = mode === "invited";

  // Steadying and inviting are mutually exclusive; the arm control enforces it,
  // and an invited casting ignores a stale steadied flag rather than stacking.
  const effective = steadied && !invited ? steadiedLevel(level) : level;

  // Inviting requires actual instability — there is nothing to invite in Stable.
  const canInvite = invited && effective !== "stable";
  const row = canInvite ? invitedRow(effective) : effective;
  const threshold = config[effective]?.threshold ?? 0;

  return {
    areaLevel: level,
    effective,
    row,
    threshold,
    steadied: steadied && !invited,
    invited: canInvite,
    // Stable never checks; an invited casting surges without a die.
    rollsDie: !canInvite && threshold > 0,
    autoSurge: canInvite,
  };
}

/** True when a d20 result surges at this threshold. */
export const isSurge = (dieResult, threshold) =>
  Number.isInteger(dieResult) && threshold > 0 && dieResult <= threshold;

/**
 * Read a d100 (1..100) against a row's bands.
 *
 * Returns the first tier whose cumulative bound the roll reaches. Zero-width
 * tiers are skipped, which is how Fraying never produces a Catastrophic.
 */
export function severityTier(roll, bands) {
  if (!bands) return null;
  const value = clamp(toInt(roll, 1), 1, 100);
  let floor = 0;
  for (const tier of TIERS) {
    const bound = bands[tier];
    if (bound > floor && value <= bound) return tier;
    floor = bound;
  }
  return TIERS[TIERS.length - 1];
}

/** The inclusive [low, high] window a tier occupies, or null when unreachable. */
export function tierWindow(tier, bands) {
  if (!bands) return null;
  const i = TIERS.indexOf(tier);
  if (i < 0) return null;
  const low = (i === 0 ? 0 : bands[TIERS[i - 1]]) + 1;
  const high = bands[tier];
  return high < low ? null : [low, high];
}

/** Every row id the config UI edits, in display order. */
export const configurableRows = () => ROWS.slice();

/**
 * How many glyph faces a level's die carries. This IS the threshold — the die
 * is not decorative, it is the odds made physical. `gen-surge-textures.mjs` and
 * `dsn.mjs` both read it from here so the two cannot drift.
 */
export const glyphFaces = (level, config = resolveConfig()) => config[level]?.threshold ?? 0;

/** The levels that actually roll a die, i.e. every level above Stable. */
export const rollingLevels = (config = resolveConfig()) =>
  LEVELS.filter((level) => (config[level]?.threshold ?? 0) > 0);

/**
 * Ambient chaos 0..1 for a level, used by the overlay shader and to scale the
 * burst. Stable is exactly 0 so the overlay renders nothing at all rather than
 * a very faint something.
 */
export function chaosFor(level) {
  const i = levelIndex(level);
  return i === 0 ? 0 : i / (LEVELS.length - 1);
}
