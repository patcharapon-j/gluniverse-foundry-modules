/**
 * Spellsprite — how a harmful spell or ability travels, one timeline per harm
 * delivery (constants.mjs DELIVERY_GROUPS.harm). Pure.
 *
 * `HARM[delivery](s, M, ctx)`; ctx is compile.mjs's `harmCtx`: the bodies, the
 * outcome reader, the caster's hand and every shared helper (release, linger,
 * fire, spray, areaFX, areaMetric, areaCentroid, equivRadius, spotIn, lobSize,
 * charge, projectile, POW, SAVE_POW, windUp, motif). Set `s.period`.
 * compile.mjs falls back to its own harm timeline for a delivery missing here.
 */

export const HARM = {};
