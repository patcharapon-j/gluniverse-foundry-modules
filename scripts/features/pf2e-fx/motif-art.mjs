/**
 * Spellsprite — motifs: the object an effect depicts (constants.mjs
 * MOTIF_VOCAB), from the name's nouns. Pure.
 *
 * `MOTIFS[motif]` may carry any of these hooks; a delivery calls the ones that
 * exist and draws its own default otherwise. A missing motif is never an error.
 *
 *   carrier(s, M, p)                          decorate or replace the travelling particle p
 *   impact(s, M, { x, y, z, pow, rad, at })   the object landing
 *   conjure(s, M, { x, y, z, h, at, life })   the object appearing (forms, summons)
 *   residue(s, M, { x, y, at })               what stays behind
 */

export const MOTIFS = {};
