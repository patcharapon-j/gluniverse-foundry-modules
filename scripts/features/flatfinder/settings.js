/**
 * Settings registration and small shared helpers.
 */

import { MODULE_ID, ffKey } from "./constants.js";

/**
 * Read one of this feature's settings, swallowing errors before registration.
 * Keys are passed unprefixed by callers; we apply the suite key prefix here.
 */
export function getSetting(key) {
  try {
    return game.settings.get(MODULE_ID, ffKey(key));
  } catch (err) {
    return undefined;
  }
}

/** Normalize a render-hook payload to a plain HTMLElement (jQuery or element). */
export function asElement(html) {
  if (html instanceof HTMLElement) return html;
  if (html?.[0] instanceof HTMLElement) return html[0];
  return html ?? null;
}

export function registerSettings() {
  game.settings.register(MODULE_ID, ffKey("competenceBadge"), {
    name: "PF2E-FLATFINDER.Settings.CompetenceBadge.Name",
    hint: "PF2E-FLATFINDER.Settings.CompetenceBadge.Hint",
    scope: "world",
    config: true,
    type: String,
    choices: {
      off: "PF2E-FLATFINDER.Settings.CompetenceBadge.Off",
      skills: "PF2E-FLATFINDER.Settings.CompetenceBadge.Skills",
      all: "PF2E-FLATFINDER.Settings.CompetenceBadge.All",
    },
    default: "skills",
    requiresReload: false,
  });

  game.settings.register(MODULE_ID, ffKey("incapacitation"), {
    name: "PF2E-FLATFINDER.Settings.Incapacitation.Name",
    hint: "PF2E-FLATFINDER.Settings.Incapacitation.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    requiresReload: false,
  });

  game.settings.register(MODULE_ID, ffKey("flattenDc"), {
    name: "PF2E-FLATFINDER.Settings.FlattenDc.Name",
    hint: "PF2E-FLATFINDER.Settings.FlattenDc.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    requiresReload: false,
  });

  game.settings.register(MODULE_ID, ffKey("eliteWeakLevel"), {
    name: "PF2E-FLATFINDER.Settings.EliteWeakLevel.Name",
    hint: "PF2E-FLATFINDER.Settings.EliteWeakLevel.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    requiresReload: false,
  });

  game.settings.register(MODULE_ID, ffKey("apexTurns"), {
    name: "PF2E-FLATFINDER.Settings.ApexTurns.Name",
    hint: "PF2E-FLATFINDER.Settings.ApexTurns.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    requiresReload: false,
  });

  game.settings.register(MODULE_ID, ffKey("apexPerTurnGuard"), {
    name: "PF2E-FLATFINDER.Settings.ApexPerTurnGuard.Name",
    hint: "PF2E-FLATFINDER.Settings.ApexPerTurnGuard.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    requiresReload: false,
  });

  game.settings.register(MODULE_ID, ffKey("apexPhases"), {
    name: "PF2E-FLATFINDER.Settings.ApexPhases.Name",
    hint: "PF2E-FLATFINDER.Settings.ApexPhases.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    requiresReload: false,
  });

  game.settings.register(MODULE_ID, ffKey("encounterBudget"), {
    name: "PF2E-FLATFINDER.Settings.EncounterBudget.Name",
    hint: "PF2E-FLATFINDER.Settings.EncounterBudget.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    requiresReload: false,
  });
}
