/**
 * PF2e Odds — settings. Every key begins `od.`, the adapter's settingPrefix.
 */

import { SUITE_ID } from "../../core/const.mjs";
import { SETTINGS } from "./constants.mjs";
import { ObservationsMenu } from "./observations-app.mjs";

const label = (key) => ({
  name: `GLOD.settings.${key.slice("od.".length)}.name`,
  hint: `GLOD.settings.${key.slice("od.".length)}.hint`,
});

const bool = (key, dflt, scope = "client") => ({ ...label(key), scope, config: true, type: Boolean, default: dflt });

export function registerSettings() {
  // The ledger. A world setting rather than flags for the dex's own reason:
  // knowledge is a relation between the party and a KIND of creature, and a
  // flag can only live on one document.
  game.settings.register(SUITE_ID, SETTINGS.ledger, { scope: "world", config: false, type: Object, default: {} });

  // Only read while Creaturedex is off; with the dex on, its Party Knowledge
  // setting decides, so a table never has two answers to one question.
  game.settings.register(SUITE_ID, SETTINGS.partyKnowledge, bool(SETTINGS.partyKnowledge, true, "world"));

  game.settings.register(SUITE_ID, SETTINGS.lineBadge, bool(SETTINGS.lineBadge, true));
  game.settings.register(SUITE_ID, SETTINGS.sheet, bool(SETTINGS.sheet, true));
  game.settings.register(SUITE_ID, SETTINGS.dialog, bool(SETTINGS.dialog, true));
  game.settings.register(SUITE_ID, SETTINGS.savePrompt, bool(SETTINGS.savePrompt, true));
  game.settings.register(SUITE_ID, SETTINGS.dice, bool(SETTINGS.dice, true));

  game.settings.registerMenu(SUITE_ID, SETTINGS.observationsMenu, {
    ...label(SETTINGS.observationsMenu),
    label: "GLOD.observations.open",
    icon: "fa-solid fa-binoculars",
    type: ObservationsMenu(),
    restricted: true,
  });
}

export function get(key, fallback = undefined) {
  try {
    return game.settings.get(SUITE_ID, key);
  } catch {
    return fallback;
  }
}
