/**
 * Live PF2e condition/effect item -> the plain snapshot `readStatusChange` reads.
 *
 * The seam exists for the same reason `snapshot.js`' does: the reader has the rules in it and is tested
 * under plain Node, so everything that needs `game`, `canvas` or a document lives here.
 */

import { MODULE_ID } from "../../stream/constants.js";
import { CARD_FLAGS } from "../settings.js";
import { artFor } from "./read-message.js";
import { isFocus } from "../framing/focus-math.js";

/**
 * @param {Item} item                         the condition or effect that changed
 * @param {"gained"|"raised"|"lowered"|"lost"} direction
 * @param {number|null} value                 the condition's value after the change, where it has one
 */
export function snapshotStatusChange(item, direction, value) {
  const actor = item?.parent;
  if (!actor) return null;
  return {
    actor: actorOf(actor),
    change: {
      id: item.id ?? null,
      slug: item.slug ?? item.system?.slug ?? null,
      name: item.name ?? "",
      kind: item.type === "condition" ? "condition" : "effect",
      img: item.img ?? null,
      value,
      direction
    }
  };
}

/**
 * The creature the change is on.
 *
 * `key` is the *actor's* id, not the item's: every change to one creature folds into one card, and an
 * unlinked token actor has its own id already, so two goblins never share a row.
 */
function actorOf(actor) {
  const token = tokenOf(actor);
  const isNpc = !isCharacter(actor) && !actor.hasPlayerOwner;
  const tokenImg = token?.texture?.src ?? null;
  const img = artFor(actor.img, tokenImg, isNpc);
  return {
    key: actor.id ?? actor.uuid ?? "",
    name: token?.name ?? actor.name ?? "",
    isCharacter: isCharacter(actor),
    hasPlayerOwner: !!actor.hasPlayerOwner,
    hiddenName: isNpc && nameHidden(token),
    observable: observable(actor, token),
    img,
    imgKind: (img ? img === tokenImg : isNpc) ? "token" : "portrait",
    focus: focusFor(actor, img)
  };
}

function isCharacter(actor) {
  return actor?.type === "character" || actor?.type === "familiar";
}

/** The token this change should be judged by: the actor's own, else one on the active scene. */
function tokenOf(actor) {
  if (actor.token) return actor.token;
  const tokens = activeTokens(actor);
  return tokens.find((t) => !t.hidden) ?? tokens[0] ?? null;
}

/**
 * Could a player have seen this creature?
 *
 * A player-owned actor is always the party's business. Anything else has to be standing somewhere a
 * player can look: a token on the current scene that the GM has not hidden. No token, no card — a
 * condition applied to a compendium-side or off-scene actor is bookkeeping, not a moment.
 *
 * Deliberately *not* a sight test. Vision is per-player and per-token and would make the stream's
 * answer depend on which login happens to be connected; "the GM has not hidden it and it is on the
 * scene" is the same question Foundry's own token HUD answers.
 */
function observable(actor, token) {
  if (actor.hasPlayerOwner) return true;
  const tokens = activeTokens(actor);
  if (tokens.length) return tokens.some((t) => !t.hidden);
  // An unlinked token actor is its own token, which may not be in the placeables list yet.
  return !!token?.id && token.hidden === false;
}

/** Token documents for this actor on the scene in view, or [] when there is no canvas. */
function activeTokens(actor) {
  try {
    const tokens = actor.getActiveTokens?.(false, true);
    return Array.isArray(tokens) ? tokens.filter(Boolean) : [];
  } catch {
    return [];
  }
}

/** PF2e's own "players cannot see this creature's name" answer, honoured exactly as roll cards do. */
function nameHidden(token) {
  if (!game.pf2e?.settings?.tokens?.nameVisibility) return false;
  return token?.playersCanSeeName === false;
}

/** A GM's hand-set framing for this exact picture, the same flag the roll card reads. */
function focusFor(actor, img) {
  if (!img) return null;
  const overrides = actor.getFlag?.(MODULE_ID, CARD_FLAGS.portraitFocus) ?? [];
  if (!Array.isArray(overrides)) return null;
  const match = overrides.find((o) => o?.src === img && isFocus(o));
  return match ? { x: match.x, y: match.y, w: match.w } : null;
}
