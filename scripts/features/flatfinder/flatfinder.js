/**
 * PF2e Flatfinder — feature entry module (ported into the GLUniverse Suite).
 *
 * Wires up the automation for:
 *  - Competence-check result badges on skill (and optionally perception) chat cards.
 *  - The Flatfinder Incapacitation save adjustment annotation.
 *  - Flattening of static item/inline DCs (subtracting the source item's level).
 *  - The Flatfinder Elite/Weak (+/-2 level) template correction.
 *  - The Flatfinder Apex (solo boss) extra-turn template.
 *  - The Flatfinder encounter XP/difficulty badge in the combat tracker.
 *
 * The suite registry owns the Foundry lifecycle: this module registers NOTHING
 * at import time. `registerSettings` runs unconditionally at init; `onInit` and
 * `onReady` run only when the feature is enabled and the pf2e system is present.
 */

import { MODULE_ID } from "./constants.js";
import { registerSettings as registerFlatfinderSettings } from "./settings.js";
import { renderCompetenceBadge } from "./competence.js";
import { registerIncapacitation } from "./incapacitation.js";
import { registerFlattenDc } from "./flatten.js";
import { renderEncounterBudget } from "./encounter.js";
import { registerApex, decorateApexTracker } from "./apex.js";

/** Always-run settings registration (delegated from the adapter). */
export function registerSettings() {
  registerFlatfinderSettings();
}

/** Chat-card handler (badge is idempotent and refreshes on re-render). */
function onRenderChatMessage(message, html) {
  try {
    renderCompetenceBadge(message, html);
  } catch (err) {
    console.error(`${MODULE_ID} | Competence badge error`, err);
  }
}

/** Combat-tracker handler (encounter budget + Apex decoration). */
function onRenderCombatTracker(app, html) {
  try {
    renderEncounterBudget(app, html);
  } catch (err) {
    console.error(`${MODULE_ID} | Encounter budget error`, err);
  }
  try {
    decorateApexTracker(app, html);
  } catch (err) {
    console.error(`${MODULE_ID} | Apex tracker decoration error`, err);
  }
}

/** Everything from the old `init` hook (chat/tracker render wiring). */
export function onInit() {
  // Foundry v13+ renders chat messages via renderChatMessageHTML (HTMLElement).
  Hooks.on("renderChatMessageHTML", onRenderChatMessage);
  Hooks.on("renderCombatTracker", onRenderCombatTracker);
}

/** Everything from the old `ready` hook (pf2e-dependent automation). */
export function onReady() {
  if (game.system?.id !== "pf2e") {
    console.warn(`${MODULE_ID} | The Pathfinder 2e system is required; flatfinder automation disabled.`);
    return;
  }
  registerIncapacitation();
  registerFlattenDc();
  registerApex();
  console.log(`${MODULE_ID} | Flatfinder automation ready.`);
}
