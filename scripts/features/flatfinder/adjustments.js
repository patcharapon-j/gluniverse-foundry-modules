/**
 * Flatfinder Elite / Weak handling.
 *
 * IMPORTANT — interaction with pf2e-flatten:
 *   pf2e-flatten implements Proficiency-without-Level by adding a modifier equal to
 *   minus the creature's level to every check/DC, and it re-flattens automatically
 *   whenever the level changes. That means we must NOT mutate an NPC's derived level
 *   to represent Elite/Weak: doing so makes pf2e-flatten subtract a different amount
 *   and cancels (or doubles) the template's intended +/-2.
 *
 * Therefore the *stat* side of Elite/Weak is left to either:
 *   - the bundled "FF Elite/Weak" effects (recommended with pf2e-flatten): they add a
 *     clean +/-2 to all checks/DCs and leave level untouched, or
 *   - PF2e's native Elite/Weak button (see README caveat: under pf2e-flatten the
 *     native button's stat change is partly undone by re-flattening).
 *
 * This module only needs the *effective Flatfinder level* (base +/-2) for its own
 * encounter-XP and incapacitation math, which we compute here without ever changing
 * the actor, so pf2e-flatten is never disturbed.
 */

import { getSetting } from "./settings.js";

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

/**
 * Effective Flatfinder level for an actor, accounting for an Elite/Weak template as
 * a +/-2 level shift, without mutating the actor.
 *
 *  - Native button: the system already shifted the derived level by +/-1, so we add
 *    one more step to reach the Flatfinder +/-2.
 *  - Bundled FF effect: the level is unchanged, so we apply the full +/-2.
 */
export function flatfinderEffectiveLevel(actor) {
  const base = actor?.level ?? actor?.system?.details?.level?.value;
  if (typeof base !== "number") return null;
  if (!getSetting("eliteWeakLevel")) return base;

  const native = actor?.system?.attributes?.adjustment;
  if (native === "elite") return base + 1;
  if (native === "weak") return base - 1;

  const ff = getEffectAdjustment(actor);
  if (ff === "elite") return base + 2;
  if (ff === "weak") return base - 2;

  return base;
}
