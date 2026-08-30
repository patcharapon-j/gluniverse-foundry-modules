/**
 * GLUniverse Suite — token conditions: who may see what.
 *
 * This is the file whose failure is quietest. Everything it governs renders
 * perfectly when it is wrong, raises nothing, and is discovered only when a
 * player says something they should not have known — "why is the duke
 * *frightened*?" about a token the GM had hidden, or the name of an effect the
 * GM had marked unidentified precisely so nobody could read it.
 *
 * Two rules, and they are absolute:
 *
 *   1. **Never draw on a token this client cannot see.** Foundry has already
 *      computed that into `token.visible`, so that is the authority rather than
 *      a rule of our own that can drift from core as the vision system changes.
 *   2. **Never resolve an unidentified effect for a non-GM.** The redaction
 *      happens in `data.mjs`, at the point of *reading* — the name, the artwork
 *      and the counter are never put into the plate's state at all, rather than
 *      being put there and then not drawn. A field that is never populated
 *      cannot leak through a later refactor that draws one more thing.
 *
 * Foundry's own effect icons are suppressed with `renderable = false`, never
 * `visible`. `visible` is a permission answer that other code reads; clearing it
 * would make the token's state invisible to everything that asks, this feature
 * included.
 */

/**
 * Whether this client may see any plate on this token at all.
 *
 * A GM sees a hidden token's plates, because a hidden token is one the GM is
 * running and its state is the thing they most need. Everybody else gets the
 * same answer Foundry gives for the token itself.
 */
export function canViewPlates(token) {
  const doc = token?.document;
  if (!doc) return false;
  /* A secret token is one nobody but a GM may know exists. Its conditions are a
     stronger tell than the token, because a floating rail with nothing under it
     says "something is standing here" as loudly as the token would. */
  if (doc.isSecret && !game.user?.isGM) return false;
  if (game.user?.isGM && doc.hidden) return true;
  return !!token.visible || !!token.controlled;
}

/**
 * Whether a plate's *name* may be drawn on this client right now.
 *
 * Strictly narrower than `canViewPlates`, and narrower again than the sigil: a
 * name is a more precise disclosure than a coloured plate with a symbol on it,
 * so it can be turned down but never up. The mode is consulted only after
 * `canViewPlates` has already allowed the plate, which is why a client that
 * chose "always" still reads nothing off a token it cannot see.
 */
export function canViewLabels(token, mode) {
  if (mode === "never") return false;
  if (!canViewPlates(token)) return false;
  if (mode === "always") return true;
  return !!token.hover || !!token.controlled || (canvas?.tokens?.highlightObjects ?? false);
}
