/**
 * PF2e degree of success — the one copy in the suite.
 *
 * Pure and dependency-free, so check tools load it under plain Node. Index ===
 * degree value: 0 critical failure … 3 critical success.
 *
 * This is the PRINTED rule only: ±10 bands, then one step for a natural 20 or
 * natural 1. PF2e's own DegreeOfSuccess also applies the actor's degree
 * adjustments (Juggernaut, incapacitation…) after that, and it is not exposed
 * on game.pf2e. So whenever PF2e itself rolled the check, read its outcome
 * (`roll.options.degreeOfSuccess`, `flags.pf2e.context.outcome`) rather than
 * recomputing here; this is for the rolls PF2e did not make (a free formula)
 * and for previews.
 */
export const DEGREE_KEYS = Object.freeze(["criticalFailure", "failure", "success", "criticalSuccess"]);

/** Beat the DC by 10+ → 3, meet it → 2, miss by 10+ → 0, otherwise 1. */
export function baseDegree(total, dc) {
  const delta = total - dc;
  if (delta >= 10) return 3;
  if (delta >= 0) return 2;
  if (delta <= -10) return 0;
  return 1;
}

/** A natural 20 shifts one step up, a natural 1 one step down. */
export function adjustDegreeForNatural(degree, natural) {
  if (natural === 20) return Math.min(3, degree + 1);
  if (natural === 1) return Math.max(0, degree - 1);
  return degree;
}

/**
 * The degree of a total against a DC. `natural` is the d20's face when the
 * roll is a single d20 (the only case the natural step applies to), else null.
 * No DC → null.
 */
export function degreeOf(total, dc, natural = null) {
  if (dc == null || !Number.isFinite(dc) || !Number.isFinite(total)) return null;
  return adjustDegreeForNatural(baseDegree(total, dc), natural);
}
