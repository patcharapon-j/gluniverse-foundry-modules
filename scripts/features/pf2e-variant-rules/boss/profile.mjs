/**
 * Boss Creatures — the profile on an actor, and the readers other features use.
 *
 * This module is the seam two *other* features reach through:
 *
 *   • `features/initiative` asks `bossBadge(actor)` what to draw on the card and
 *     how many turns the actor takes.
 *   • `features/flatfinder` asks `bossXpFactor(actor)` and
 *     `bossIncapacitationLevel(actor)` for its encounter budget and its
 *     incapacitation maths.
 *
 * Everything exported here is therefore a *read* that answers neutrally when the
 * rule is off, the system is not PF2e, or the actor was never marked — a null or
 * a 1, never a throw — so a world running the initiative rail with the variant
 * rules disabled behaves exactly as it did before this file existed. There are
 * no side effects at import time, which is what makes the cross-feature import
 * legal under the adapter contract.
 *
 * The writes live below the reads and are GM-only by construction: they are only
 * ever called from the NPC sheet panel, which does not render for anyone else.
 */

import { SUITE_ID } from "../../../core/const.mjs";
import { SETTINGS } from "../constants.mjs";
import { get } from "../settings.mjs";
import { BOSS_FLAGS, BOSS_TIER } from "./constants.mjs";
import { bossLevel, bossTurns, bossXpFactor as tierXpFactor, tierOf } from "./rules.mjs";

/** Is the Boss rule switched on right now? Re-read per call, never captured. */
export const bossOn = () => !!get(SETTINGS.bossEnabled, false);

/**
 * The raw profile stored on an actor, without consulting the enable flag.
 *
 * Used by the sheet, which must still show a boss's panel while the rule is
 * being switched on and off, and by `clearProfile`, which has to be able to
 * remove a profile the rule no longer honours.
 */
export function storedProfile(actor) {
  const raw = actor?.getFlag?.(SUITE_ID, BOSS_FLAGS.profile);
  if (!raw || typeof raw !== "object") return null;
  if (!tierOf(raw.tier)) return null;
  return {
    tier: raw.tier,
    baseLevel: Math.trunc(Number(raw.baseLevel) || 0),
    baseHp: Math.max(0, Math.trunc(Number(raw.baseHp) || 0)),
    abilities: Array.isArray(raw.abilities) ? raw.abilities.filter((id) => typeof id === "string") : [],
    downfalls: Array.isArray(raw.downfalls) ? raw.downfalls.filter((d) => d && typeof d === "object") : [],
    /** Free-text choices the GM locked in for an ability ("Once these choices have been made, they cannot be changed."). */
    choices: raw.choices && typeof raw.choices === "object" ? { ...raw.choices } : {},
  };
}

/**
 * The profile as the *rules* see it: null unless the rule is enabled.
 *
 * Everything outside the sheet reads through this one. Switching the rule off
 * must make a marked NPC behave like an ordinary creature again without anyone
 * having to unmark it first, or a GM trying the rule out for one session leaves
 * doubled Hit Points and tripled XP behind in every later fight.
 */
export function bossProfile(actor) {
  if (!bossOn()) return null;
  return storedProfile(actor);
}

/** Is this actor a boss right now? */
export const isBoss = (actor) => bossProfile(actor) !== null;

/* ── The cross-feature readers ───────────────────────────────────────────── */

/**
 * What the initiative rail should draw, or null for an ordinary combatant.
 *
 * Returns the tier so the card can carry its own accent, and the turn count so
 * the rail does not have to know the tier table.
 */
export function bossBadge(actor) {
  const profile = bossProfile(actor);
  if (!profile) return null;
  return { tier: profile.tier, turns: bossTurns(profile.tier) };
}

/**
 * The XP multiplier this actor contributes to an encounter budget.
 *
 * Deliberately *separate* from the level bump. The book gives a boss both a
 * higher creature level and a multiplied XP value, and they are not two views of
 * one number: Flatfinder's budget already derives XP from the level difference,
 * so folding the +2/+4 into the level it reads there would multiply the boss's
 * XP a second time on top of this factor. The level bump is for incapacitation;
 * this factor is for XP; neither may borrow the other.
 */
export function bossXpFactor(actor) {
  if (!get(SETTINGS.bossXp, true)) return 1;
  const profile = bossProfile(actor);
  return profile ? tierXpFactor(profile.tier) : 1;
}

/**
 * The creature level to use for incapacitation, or null when this is not a boss.
 *
 * `baseLevel` is what was on the actor when it was marked; the actor's live level
 * wins if it has since changed, so levelling a boss's base creature does not
 * leave the incapacitation maths reading a stale number.
 */
export function bossIncapacitationLevel(actor) {
  if (!get(SETTINGS.bossIncapacitation, true)) return null;
  const profile = bossProfile(actor);
  if (!profile) return null;
  const live = actor?.level ?? actor?.system?.details?.level?.value;
  const base = typeof live === "number" ? live : profile.baseLevel;
  return bossLevel(base, profile.tier);
}

/** How many turns per round this actor takes, 1 when it is not a boss. */
export function bossTurnCount(actor) {
  const profile = bossProfile(actor);
  return profile ? bossTurns(profile.tier) : 1;
}

/* ── Writes ──────────────────────────────────────────────────────────────── */

/** Write a whole profile back, replacing what was there. */
export async function setProfile(actor, profile) {
  if (!actor) return null;
  return actor.setFlag(SUITE_ID, BOSS_FLAGS.profile, profile);
}

/** Merge a partial change into the stored profile. */
export async function updateProfile(actor, patch) {
  const current = storedProfile(actor);
  if (!current) return null;
  return setProfile(actor, { ...current, ...patch });
}

/** Remove the profile entirely. Callers restore the base stats separately. */
export async function clearProfile(actor) {
  if (!actor) return null;
  return actor.unsetFlag(SUITE_ID, BOSS_FLAGS.profile);
}

/** The two tier ids, in the order the picker offers them. */
export const TIER_ORDER = Object.freeze([BOSS_TIER.greater, BOSS_TIER.supreme]);
