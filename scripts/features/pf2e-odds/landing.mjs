/**
 * What a resolved check card lets THIS viewer see land — the one gate both
 * landing beats share: the badge's face pulse and stamp (line-badges.mjs) and
 * the ring on the Dice So Nice die (dice-highlight.mjs).
 *
 * Anything short of the truth asks what the PLAYERS could read on the card —
 * the stream login holds GM rights and is watched by the players:
 *
 *   • the card must have reached a player (not blind, not a GM-only whisper);
 *   • the degree only under PF2e's own "show results" metagame setting;
 *   • the natural only when PF2e shows the roll's breakdown (NPC dice are
 *     hidden from players otherwise).
 */

import { DEGREE_KEYS } from "../../core/pf2e-odds.mjs";
import { breakdownShown, metagame, reachedPlayers } from "./observe.mjs";
import { seesTruth } from "./view.mjs";

const ATTACKS = new Set(["attack-roll", "spell-attack-roll"]);

/** The kept d20's natural, or null when the roll has no single kept d20. */
export function naturalOf(roll) {
  const die = roll?.dice?.find?.((d) => d.faces === 20);
  const kept = die?.results?.filter?.((r) => r.active !== false && !r.discarded) ?? [];
  return kept.length === 1 ? kept[0].result : null;
}

/**
 * @returns {{face: number|null, degree: number|null, stamps: "attack"|"check",
 *            sourceId: string|null, targetId: string|null}|null}
 */
export function landingOf(message, user = game.user) {
  if (!message?.isContentVisible || message.blind) return null;
  const truth = seesTruth(user);
  if (!truth && !reachedPlayers(message)) return null;
  const ctx = message.flags?.pf2e?.context;
  const roll = message.rolls?.[0];
  if (!ctx || !roll) return null;
  const d = DEGREE_KEYS.indexOf(ctx.outcome ?? "");
  const degree = d >= 0 && (truth || metagame("results")) ? d : null;
  const face = truth || breakdownShown(roll) ? naturalOf(roll) : null;
  if (face == null && degree == null) return null;
  return {
    face,
    degree,
    stamps: ATTACKS.has(ctx.type) ? "attack" : "check",
    sourceId: message.speaker?.token ?? null,
    targetId: String(ctx.target?.token ?? "").split(".").pop() || null,
  };
}
