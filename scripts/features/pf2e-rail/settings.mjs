/**
 * PF2e HUD — settings and stored keys. Every key is `ph.`.
 *
 * What is stored, and where:
 *   - the portrait's frame: the ACTOR flag `ph.frame` (`{ x, y, scale }`),
 *     the owner's, so every screen that draws the plinth draws it framed;
 *   - the skill finder's pins: the USER flag `ph.pins`, `{ [actorId]: slug[] }`,
 *     so a player's pins follow them to another computer and a GM's pins
 *     for one creature never crowd another's;
 *   - whether the rail is folded, and the two preferences below: client
 *     settings, because they are about this screen.
 * The action economy is stored nowhere (turn.mjs).
 */
import { SUITE_ID } from "../../core/const.mjs";

export const SETTINGS = Object.freeze({
  hideHotbar: "ph.hideHotbar",
  gmRail: "ph.gmRail",
  folded: "ph.folded",
});

export const FLAGS = Object.freeze({
  frame: "ph.frame",
  pins: "ph.pins",
});

export function registerSettings() {
  game.settings.register(SUITE_ID, SETTINGS.hideHotbar, {
    name: "GLRAIL.settings.hideHotbar.name",
    hint: "GLRAIL.settings.hideHotbar.hint",
    scope: "client", config: true, type: Boolean, default: true,
  });
  game.settings.register(SUITE_ID, SETTINGS.gmRail, {
    name: "GLRAIL.settings.gmRail.name",
    hint: "GLRAIL.settings.gmRail.hint",
    scope: "client", config: true, type: Boolean, default: true,
  });
  game.settings.register(SUITE_ID, SETTINGS.folded, { scope: "client", config: false, type: Boolean, default: false });
}

export const setting = (key, fallback) => {
  try { return game.settings.get(SUITE_ID, key); } catch { return fallback; }
};
