/**
 * PF2e HUD — whose rail it is, and whether there is one at all.
 *
 * Pure: the host passes the viewer, what they control and what they own.
 *
 * Never on the stream login. That client holds GM rights and is watched by
 * the players: a rail there would be the GM's rail on the recording, and a
 * player's rail is the player's own screen, which the stream shows already.
 * And never beside reonZ's pf2e-hud, which draws its own bottom HUD over the
 * same canvas edge and replaces the same hotbar.
 */

/** Does this client get a rail? */
export function shouldMount({ system, stream = false, pf2eHud = false }) {
  return system === "pf2e" && !stream && !pf2eHud;
}

const RAIL_TYPES = new Set(["character", "familiar", "npc"]);

/**
 * The subject, Daggerheart's order: what the viewer controls, then their
 * assigned character, then the first character token on the scene they own.
 *
 *   player: a character → the full rail; a familiar or an NPC they own (an
 *           animal companion, say) → the slim rail.
 *   GM:     a character they control → that character's player rail; an NPC
 *           or a hazard → the creature or hazard panel; nothing → the panel
 *           with no creature and the hand.
 *
 * @returns {{ role: "player"|"gm", actor: object|null, token: object|null } | null}
 */
export function subjectOf({ isGM, controlled = [], character = null, owned = () => true, sceneTokens = [] }) {
  const first = controlled.find((tk) => tk?.actor);
  if (isGM) {
    if (first?.actor?.type === "character") return { role: "player", actor: first.actor, token: first.document ?? first };
    if (first && ["npc", "hazard"].includes(first.actor.type)) return { role: "gm", actor: first.actor, token: first.document ?? first };
    return { role: "gm", actor: null, token: null };
  }
  const mine = controlled.find((tk) => tk?.actor && RAIL_TYPES.has(tk.actor.type) && owned(tk.actor));
  if (mine) return { role: "player", actor: mine.actor, token: mine.document ?? mine };
  if (character && RAIL_TYPES.has(character.type)) {
    const tk = sceneTokens.find((x) => x?.actor?.id === character.id);
    return { role: "player", actor: tk?.actor ?? character, token: tk?.document ?? tk ?? null };
  }
  const tk = sceneTokens.find((x) => x?.actor?.type === "character" && owned(x.actor));
  return tk ? { role: "player", actor: tk.actor, token: tk.document ?? tk } : null;
}

/** Is it this actor's turn in this combat? A token's actor is compared by
 *  the token where there is one, so two goblins of one kind are two turns. */
export function isTurnOf(combatant, actor, token) {
  if (!combatant || !actor) return false;
  if (token?.id && combatant.tokenId) return combatant.tokenId === token.id;
  return combatant.actorId === actor.id || combatant.actor === actor;
}

/** The combat this actor is fighting in on this scene, once it has started. */
export function combatOf(combats, actor, token, sceneId) {
  for (const c of combats ?? []) {
    if (!c?.started) continue;
    if (c.scene && sceneId && (c.scene.id ?? c.scene) !== sceneId) continue;
    const list = Array.from(c.combatants ?? []);
    if (list.some((cb) => (token?.id && cb.tokenId ? cb.tokenId === token.id : cb.actorId === actor?.id))) return c;
  }
  return null;
}
