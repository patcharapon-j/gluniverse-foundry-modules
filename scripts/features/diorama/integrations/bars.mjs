/**
 * Diorama — the display-mode rules the 3D view still asks itself.
 *
 * The bars themselves are not drawn here: view/bar-layer.mjs puts the 2D
 * canvas's own bars (Resource Bars', or Foundry's `token.bars`) on the
 * standees, and who sees one is Foundry's `token.bars.visible`, with the view's
 * hover handed to the 2D token. Two questions are left that Foundry cannot
 * answer: whether a name shows (the snapshot's), and what a *player* would see
 * while the GM looks through "view as players".
 */

/** CONST.TOKEN_DISPLAY_MODES, with the v14 numbers as the fallback. */
export const DISPLAY = Object.freeze({ NONE: 0, CONTROL: 10, OWNER_HOVER: 20, HOVER: 30, OWNER: 40, ALWAYS: 50 });

const modes = () => globalThis.CONST?.TOKEN_DISPLAY_MODES ?? DISPLAY;

/**
 * Foundry's `Token#_canViewMode`, against the 3D view's hover.
 * @param {number} mode
 * @param {{controlled?:boolean, hovered?:boolean, isOwner?:boolean}} s
 */
export function canViewMode(mode, { controlled = false, hovered = false, isOwner = false } = {}) {
  const M = modes();
  switch (Number(mode)) {
    case M.NONE: return false;
    case M.ALWAYS: return true;
    case M.CONTROL: return !!controlled;
    case M.HOVER: return !!hovered;
    case M.OWNER_HOVER: return !!isOwner && !!hovered;
    case M.OWNER: return !!isOwner;
    default: return false;
  }
}

/**
 * Whether some player could see a token's bars at all, for the GM's "view as
 * players": shown to everyone (always, or on hover), or to its owners when a
 * player owns it. Never more than a player would get.
 * @param {number} mode  the token's displayBars
 * @param {boolean} playerOwned
 */
export function playersSeeBars(mode, playerOwned) {
  const M = modes();
  switch (Number(mode)) {
    case M.ALWAYS: case M.HOVER: return true;
    case M.OWNER: case M.OWNER_HOVER: case M.CONTROL: return !!playerOwned;
    default: return false;
  }
}
