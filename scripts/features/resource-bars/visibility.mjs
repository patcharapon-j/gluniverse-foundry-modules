/**
 * GLUniverse Suite — resource bars: who may see what.
 *
 * This is the single most consequential file in the feature and the one whose
 * failure is quietest. Foundry lets a GM set a token's `displayBars` so that
 * players cannot see a hostile's hit points; a replacement bar that draws
 * anyway leaks that information *and looks completely correct while doing it*.
 * No error, no warning, and nobody notices until a player says a number they
 * should not have known.
 *
 * So the rule is absolute: this feature never shows more than `displayBars`
 * already permits. It may show less.
 */

/**
 * Reimplementation of Foundry's own display-mode test.
 *
 * We prefer Foundry's answer when it has one (below); this exists for the
 * window before `token.bars` is built, and as a guard against a future version
 * moving that property.
 */
function canViewMode(token, mode) {
  const M = CONST.TOKEN_DISPLAY_MODES;
  const highlight = canvas?.tokens?.highlightObjects ?? false;
  switch (mode) {
    case M.NONE: return false;
    case M.ALWAYS: return true;
    case M.CONTROL: return !!token.controlled;
    case M.HOVER: return !!token.hover || highlight;
    case M.OWNER_HOVER: return !!token.isOwner && (!!token.hover || highlight);
    case M.OWNER: return !!token.isOwner;
    default: return false;
  }
}

/**
 * Whether this client may see this token's bars at all.
 *
 * Foundry has already computed exactly this into `token.bars.visible` by the
 * time it refreshes a token, so that is the authority when it exists — reading
 * its answer rather than recomputing one means we cannot drift away from it as
 * the core rules change.
 */
export function canViewBars(token) {
  if (!token?.document || token.document.isSecret) return false;
  if (game.user.isGM && token.document.hidden) return true;
  if (!token.visible && !token.controlled) return false;
  if (token.bars && typeof token.bars.visible === "boolean") return token.bars.visible;
  return canViewMode(token, token.document.displayBars);
}

/**
 * Whether the numeric readout may be drawn.
 *
 * Strictly narrower than `canViewBars` — a number is a more precise disclosure
 * than a length, so it can be turned further down but never up.
 */
export function canViewNumbers(token, mode) {
  if (mode === "never") return false;
  if (!canViewBars(token)) return false;
  if (mode === "always") return true;
  return !!token.hover || !!token.controlled || (canvas?.tokens?.highlightObjects ?? false);
}
