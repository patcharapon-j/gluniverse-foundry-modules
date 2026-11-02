/**
 * Diorama — PF2e falling, pure. Shown, never applied.
 *
 * Player Core p. 420, "Falling":
 *   "If you fall more than 5 feet, when you land you take bludgeoning damage
 *    equal to half the distance you fell. If you take any damage from a fall,
 *    you land prone."
 *   Into water, snow or another relatively soft substance, "you can treat the
 *    fall as though it were 20 feet shorter, or 30 feet shorter if you
 *    intentionally dove in. The effective reduction can't be greater than the
 *    depth (so when falling into 10-foot-deep water, you treat the fall as 10
 *    feet shorter)."
 *   "Treat falls longer than 1,500 feet as though they were 1,500 feet (750
 *    damage)."
 *
 * The terrain model knows a cell is water but not how deep it is, so the view
 * passes `depth` only when it knows one; unknown depth reads as deep enough,
 * and the readout says the reduction is conditional.
 */

export const PF2E_FALL = Object.freeze({
  /** A fall of this many feet or less does no damage. */
  safe: 5,
  /** Into water (or snow, or another soft surface): this much shorter. */
  soft: 20,
  /** And this much shorter when the creature dove in on purpose. */
  dive: 30,
  /** Longer falls count as this long. */
  max: 1500,
});

/**
 * @param {number} drop  feet fallen
 * @param {{soft?:boolean, depth?:number, dove?:boolean}} [o]
 * @returns {{drop:number, effective:number, damage:number, prone:boolean, reduction:number}}
 *   effective: the fall the damage is counted from; reduction: feet taken off for the soft landing
 */
export function pf2eFall(drop, { soft = false, depth = Infinity, dove = false } = {}) {
  const d = Math.max(0, Number(drop) || 0);
  const deep = Number.isFinite(Number(depth)) ? Math.max(0, Number(depth)) : Infinity;
  const reduction = soft ? Math.min(dove ? PF2E_FALL.dive : PF2E_FALL.soft, deep, d) : 0;
  const effective = Math.min(PF2E_FALL.max, d - reduction);
  const damage = effective > PF2E_FALL.safe ? Math.floor(effective / 2) : 0;
  return { drop: d, effective, damage, prone: damage > 0, reduction };
}
