/**
 * Flatfinder Elite / Weak handling.
 *
 * IMPORTANT — interaction with pf2e-flatten:
 *   pf2e-flatten implements Proficiency-without-Level by adding a modifier equal to
 *   minus the creature's level to every check/DC, and it re-flattens automatically
 *   whenever the level changes. That means we must NOT write an NPC's level to
 *   represent Elite/Weak: doing so makes pf2e-flatten subtract a different amount
 *   and cancels (or doubles) the template's intended +/-2.
 *
 * Therefore the *stat* side of Elite/Weak is left to either:
 *   - the bundled "FF Elite/Weak" effects (recommended with pf2e-flatten): they add a
 *     clean +/-2 to all checks/DCs and leave level untouched, or
 *   - PF2e's native Elite/Weak button (under pf2e-flatten the native button's stat
 *     change is partly undone by re-flattening).
 *
 * This module only needs Flatfinder's *level* for a creature (base +/-2) for the
 * encounter XP and incapacitation maths, which it computes without ever changing
 * the actor, so pf2e-flatten is never disturbed.
 */

import { getSetting } from "./settings.js";
import { eliteWeakLevel } from "./rules.mjs";

/** Read an effect's slug regardless of where the system stores it. */
function effectSlug(effect) {
  return effect?.slug ?? effect?.system?.slug ?? "";
}

/**
 * Detect a Flatfinder Elite/Weak adjustment applied via the bundled "FF Elite/Weak"
 * effects (which do not change level). Returns "elite", "weak" or null.
 */
export function getEffectAdjustment(actor) {
  const effects = actor?.itemTypes?.effect ?? [];
  for (const effect of effects) {
    const slug = effectSlug(effect);
    if (slug.includes("ff-elite")) return "elite";
    if (slug.includes("ff-weak")) return "weak";
  }
  return null;
}

/** PF2e's native adjustment ("elite" / "weak") or the bundled effect's, or null. */
export function adjustmentOf(actor) {
  const native = actor?.system?.attributes?.adjustment;
  if (native === "elite" || native === "weak") return native;
  return getEffectAdjustment(actor);
}

/**
 * The level a creature was built at: PF2e's prepared `details.level.base` (the
 * source level, clamped at −1), else the stored source value.
 */
export function baseLevelOf(actor) {
  const prepared = actor?.system?.details?.level?.base;
  if (typeof prepared === "number") return prepared;
  const source = actor?._source?.system?.details?.level?.value;
  return typeof source === "number" ? source : null;
}

/** PF2e's live level for an actor (with its own Elite/Weak step), or null. */
export function liveLevelOf(actor) {
  const lvl = actor?.level ?? actor?.system?.details?.level?.value;
  return typeof lvl === "number" ? lvl : null;
}

/**
 * Effective Flatfinder level for an actor, accounting for an Elite/Weak template as
 * a +/-2 level shift from the level it was built at, without mutating the actor.
 *
 * The standalone module added one more step to PF2e's native level, which is +3
 * for an Elite creature of level 0 or below and −3 for a Weak level-1 one,
 * because PF2e itself moves those by 2. Counting from the base level is exact.
 */
export function flatfinderEffectiveLevel(actor) {
  return eliteWeakLevel({
    level: liveLevelOf(actor),
    base: baseLevelOf(actor),
    adjustment: adjustmentOf(actor),
    shift: getSetting("eliteWeakLevel") !== false,
  });
}
