/**
 * What one chat card teaches the party — pure.
 *
 * The hard gate is "only what the players could actually see". The glue
 * (observe.mjs) answers `visible` (a public card: not blind, not whispered
 * away from every player) and `resultsShown` (PF2e's own metagame setting) and
 * this module does nothing without them. A blind GM roll teaches nothing; a
 * card whose degree PF2e hides teaches no degree.
 *
 * Three things can be learned:
 *
 *   1. A PC's check against a creature narrows that creature's DEFENCE, from
 *      the total and PF2e's unadjusted degree (the natural step is unwound in
 *      the engine's `boundsFromRoll`) — or pins it, when the card printed the
 *      DC itself (`dcShown`).
 *   2. A creature's roll reveals its MODIFIER exactly: a public card prints
 *      the formula, so the modifier is `total − natural`. A Strike is filed per
 *      attack, a save as its DC (10 + modifier), a spell attack as such.
 *   3. A PC's save against a creature's spell narrows that creature's SPELL DC.
 *
 * Every proof is shifted onto the BARE stat before it is filed: the situational
 * delta PF2e applied at the time (`dcDelta`, `modDelta`, measured by the glue)
 * is taken off, so an AC learned against an off-guard ogre is not two low
 * forever. MAP is part of a creature's modifier delta for the same reason.
 */

import { DEGREE_KEYS, boundsFromRoll, shift } from "../../core/pf2e-odds.mjs";
import { statForDcSlug, strikeStat } from "./constants.mjs";

const SAVES = new Set(["fortitude", "reflex", "will"]);

/** PF2e's Strike identifier is `${itemId}.${slug}.${melee|ranged}`. */
export function strikeSlugFromIdentifier(identifier) {
  const parts = String(identifier ?? "").split(".");
  return parts.length >= 3 ? parts[1] || null : null;
}

/**
 * @param {{
 *   context: object,             // flags.pf2e.context
 *   modifierName?: string,       // flags.pf2e.modifierName (the check's statistic slug)
 *   total: number, natural: number|null,
 *   visible: boolean, resultsShown: boolean, dcShown?: boolean,
 *   roller: {creature: boolean, kind?: string|null},
 *   defender: {creature: boolean, kind?: string|null}|null,
 *   origin?: {creature: boolean, kind?: string|null}|null,  // a save's caster
 *   dcDelta?: number,            // today's DC − bare DC, at roll time
 *   modDelta?: number,           // today's modifier − bare modifier (incl. MAP)
 * }} card
 * @returns {Array<{kind: string, stat: string, proof: {lo,hi}, src: string}>}
 */
export function observationsFrom(card) {
  const out = [];
  if (!card?.visible || !card.context) return out;
  const ctx = card.context;
  const type = ctx.type ?? null;
  const degree = DEGREE_KEYS.indexOf(ctx.unadjustedOutcome ?? "");
  const dcValue = Number.isFinite(ctx.dc?.value) ? ctx.dc.value : null;

  const proofOf = () =>
    card.dcShown ? { lo: dcValue, hi: dcValue } : card.resultsShown && degree >= 0 ? boundsFromRoll({ total: card.total, natural: card.natural, degree }) : null;

  // 1. A PC rolls against a creature's defence.
  if (!card.roller?.creature && card.defender?.creature && card.defender.kind && dcValue != null) {
    const stat = statForDcSlug(ctx.dc?.slug);
    const proof = proofOf();
    if (stat && proof) out.push({ kind: card.defender.kind, stat, proof: shift(proof, -(card.dcDelta ?? 0)), src: type ?? "check" });
  }

  // 2. A creature's modifier, read off a public card.
  if (card.roller?.creature && card.roller.kind && Number.isInteger(card.natural) && Number.isFinite(card.total)) {
    const bare = card.total - card.natural - (card.modDelta ?? 0);
    let stat = null;
    let value = bare;
    if (type === "attack-roll") {
      const slug = strikeSlugFromIdentifier(ctx.identifier);
      if (slug) stat = strikeStat(slug);
    } else if (type === "spell-attack-roll") {
      stat = "spell-attack";
    } else if (type === "saving-throw" && SAVES.has(card.modifierName)) {
      stat = card.modifierName;
      value = bare + 10;
    }
    if (stat) out.push({ kind: card.roller.kind, stat, proof: { lo: value, hi: value }, src: type });
  }

  // 3. A PC saves against a creature's spell.
  if (type === "saving-throw" && !card.roller?.creature && card.origin?.creature && card.origin.kind && dcValue != null) {
    const proof = proofOf();
    if (proof) out.push({ kind: card.origin.kind, stat: "spell-dc", proof, src: "saving-throw" });
  }

  return out;
}
