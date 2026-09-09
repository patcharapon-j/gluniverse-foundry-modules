/**
 * Creaturedexing — the rules, as arithmetic.
 *
 * Pure and Foundry-free so `tools/creaturedex-check.mjs` can exercise every one
 * of them under plain Node. Nothing here reads a setting, a flag or a document;
 * callers pass the world in and get a decision back.
 */

import { OUTCOME } from "./constants.mjs";

/**
 * How many sections a Recall Knowledge result buys.
 *
 *   "Critical Success … the GM also reveals two sections of the stat block for
 *    the creature or hazard of your choice.
 *    Success … reveals one section of the stat block … of your choice."
 *
 * Failure buys nothing and critical failure buys a lie, which is a different
 * kind of answer and is reported separately by `outcomeEffect`.
 */
export function revealCount(outcome) {
  if (outcome === OUTCOME.critSuccess) return 2;
  if (outcome === OUTCOME.success) return 1;
  return 0;
}

/**
 * What a result actually does, once the table's own options are applied.
 *
 * The "It's Not a Secret" sidebar is the one option that changes an outcome
 * rather than the presentation of it:
 *
 *   "In the event your table does not play with secret checks on Recall
 *    Knowledge, it is encouraged that the critical failure effect for the
 *    Recall Knowledge is removed entirely."
 *
 * Removed entirely means removed — a critical failure becomes an ordinary
 * failure, not a quieter lie. A table that can see the die cannot be told a
 * falsehood by it.
 */
export function outcomeEffect(outcome, { noSecret = false } = {}) {
  if (outcome === OUTCOME.critFailure) {
    return noSecret ? { kind: "none", count: 0 } : { kind: "false", count: 1 };
  }
  const count = revealCount(outcome);
  return { kind: count > 0 ? "reveal" : "none", count };
}

/**
 * Is this subject's creaturedex complete?
 *
 *   "If a subject does not have three sections in its stat block, such as a
 *    simple hazard, you need only reveal the number of sections it has
 *    available."
 *
 * So completion is measured against the sections this subject actually has, not
 * against the number three. A simple hazard with one section completes on one
 * reveal, and a subject with no sections at all is not completable — returning
 * true there would hand out Discerning Aid for knowing nothing.
 */
export function isComplete(known, available) {
  const have = new Set(known ?? []);
  const need = (available ?? []).filter(Boolean);
  if (!need.length) return false;
  return need.every((key) => have.has(key));
}

/** Sections still unknown, in the subject's own printed order. */
export const missingSections = (known, available) => {
  const have = new Set(known ?? []);
  return (available ?? []).filter((key) => !have.has(key));
};

/**
 * The circumstance bonus Discerning Aid hands the ally.
 *
 *   "Your result provides a circumstance bonus of the same value as the Aid
 *    reaction, including imposing a penalty on a critical failure and
 *    increasing the circumstance bonus if you are a master or legendary in the
 *    skill you used to Recall Knowledge."
 *
 * So this is Aid's own table, keyed on the proficiency rank of the skill the
 * *Recall Knowledge* was made with — not the skill the ally is rolling.
 */
export function aidBonus(outcome, rank = "trained") {
  if (outcome === OUTCOME.critSuccess) {
    if (rank === "legendary") return 4;
    if (rank === "master") return 3;
    return 2;
  }
  if (outcome === OUTCOME.success) return 1;
  if (outcome === OUTCOME.critFailure) return -1;
  return 0;
}

/**
 * The optional 1d4 pick.
 *
 *   "it can be appropriate to simply roll 1d4 randomly to determine which
 *    section is revealed, allowing the player to choose on a 4."
 *
 * Returns the section key the die chose, or `null` for "the player chooses".
 * The die is always 1d4 even when the subject has fewer than three sections —
 * a roll past the end is the same freedom a 4 grants, which keeps a simple
 * hazard from being harder to learn than a creature.
 */
export function rollSection(roll, available) {
  const keys = (available ?? []).filter(Boolean);
  const n = Math.trunc(Number(roll) || 0);
  if (n < 1 || n > 3) return null;
  return keys[n - 1] ?? null;
}

/**
 * May this character attempt Recall Knowledge on this subject again?
 *
 *   "characters should be able to use Recall Knowledge on the same creature or
 *    hazard again, regardless of their results on previous checks, after they
 *    have seen the creature or hazard take its turn during an encounter in
 *    which they could be observed by the creature that used Recall Knowledge."
 *
 * The first attempt is always free; every attempt after that has to be paid for
 * by a turn the party has watched the subject take. Counting turns rather than
 * asking "has it acted at all" is what stops one observed turn from unlocking
 * an unlimited run of retries in the same round.
 *
 * This is advisory. Nothing in this feature blocks a roll the GM allows — the
 * card says whether the attempt is a repeat and leaves the ruling where it
 * belongs.
 */
export function canAttempt(attempts, observedTurns) {
  const made = Math.max(0, Math.trunc(Number(attempts) || 0));
  const seen = Math.max(0, Math.trunc(Number(observedTurns) || 0));
  return made === 0 || seen >= made;
}
