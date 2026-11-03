/**
 * Spellsprite — ranged-weapon Strikes, one timeline per ranged delivery
 * (constants.mjs DELIVERY_GROUPS.ranged). Pure.
 *
 * Same contract as strikes.mjs: `RANGED[delivery](s, M, ctx)` with ctx
 * `{ caster, targets, outcome, release, linger, fire, handOf, POW, windUp, motif }`.
 * compile.mjs falls back to the old `ranged` style for a delivery missing here.
 */

export const RANGED = {};
