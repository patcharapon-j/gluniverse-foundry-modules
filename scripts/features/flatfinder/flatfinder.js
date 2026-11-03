/**
 * PF2e Flatfinder — feature entry module (ported into the GLUniverse Suite).
 *
 * Wires up the automation for:
 *  - Competence-check result badges on skill (and optionally perception) chat cards.
 *  - The Flatfinder Incapacitation save adjustment.
 *  - Flattening of static item/inline DCs (subtracting the source item's level).
 *  - The Flatfinder Elite/Weak (+/-2 level) reading for XP and incapacitation.
 *  - The threat strip in the combat tracker, and the encounter planner window.
 *
 * The suite registry owns the Foundry lifecycle: this module registers NOTHING
 * at import time. `registerSettings` runs unconditionally at init; `onInit` and
 * `onReady` run only when the feature is enabled and the pf2e system is present.
 */

import { MODULE_ID } from "./constants.js";
import { getSetting, registerSettings as registerFlatfinderSettings } from "./settings.js";
import { renderCompetenceBadge } from "./competence.js";
import { registerIncapacitation } from "./incapacitation.js";
import { registerFlattenDc } from "./flatten.js";
import { renderEncounterBudget } from "./encounter.js";
import { openPlanner, refreshPlanner } from "./planner.mjs";
import { registerQuickProvider } from "../../core/quick-palette.mjs";
import { matchesQuery } from "../../core/util.mjs";

/** Set once the registry runs this feature's onInit (enabled, PF2e present). */
let live = false;

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

/** Combat-tracker handler (the threat strip). */
function onRenderCombatTracker(app, html) {
  try {
    renderEncounterBudget(app, html, { onPlan: openPlanner });
  } catch (err) {
    console.error(`${MODULE_ID} | Encounter budget error`, err);
  }
}

/**
 * The tracker re-renders on combat and combatant changes, but not when a
 * creature already in the fight changes underneath it: an Elite/Weak toggle,
 * a boss being marked, a level edit, an FF effect added, a token switched to
 * Friendly. Each of those changes the rating, so it redraws the strip (and an
 * open planner), batched so a burst of updates is one redraw.
 */
let redrawTimer = null;
function redrawSoon() {
  if (!game.user?.isGM || !getSetting("encounterBudget")) return;
  if (redrawTimer) return;
  redrawTimer = setTimeout(() => {
    redrawTimer = null;
    try {
      ui.combat?.render?.();
      refreshPlanner();
    } catch (err) {
      console.error(`${MODULE_ID} | Encounter redraw error`, err);
    }
  }, 0);
}

const inViewedCombat = (actor) => {
  const combat = game.combats?.viewed;
  if (!actor || !combat) return false;
  return combat.combatants.some((c) => c.actor === actor || (c.actorId && c.actorId === actor.id));
};

function wireEncounterRedraws() {
  Hooks.on("updateActor", (actor) => {
    if (inViewedCombat(actor)) redrawSoon();
  });
  for (const hook of ["createItem", "deleteItem"]) {
    Hooks.on(hook, (item) => {
      if (item?.type === "effect" && inViewedCombat(item.parent)) redrawSoon();
    });
  }
  Hooks.on("updateToken", (token, changes) => {
    if ("disposition" in (changes ?? {}) && inViewedCombat(token?.actor)) redrawSoon();
  });
}

/** The quick palette (Ctrl+K) offers the planner. */
const quickProvider = {
  id: "flatfinder",
  order: 70,
  label: "PF2E-FLATFINDER.Planner.Title",
  icon: "fa-solid fa-chess-rook",
  available: () => !!game.user?.isGM,
  search(query) {
    const title = game.i18n.localize("PF2E-FLATFINDER.Planner.Title");
    const words = `${title} ${game.i18n.localize("PF2E-FLATFINDER.Planner.Keywords")}`;
    if (!matchesQuery(words, query)) return [];
    return [
      {
        key: "flatfinder-planner",
        title,
        sub: game.i18n.localize("PF2E-FLATFINDER.Planner.Sub"),
        icon: "fa-solid fa-chess-rook",
        actions: [{ id: "open", label: game.i18n.localize("PF2E-FLATFINDER.Planner.Open"), icon: "fa-solid fa-up-right-from-square", mod: "" }],
        run: async () => {
          openPlanner();
        },
      },
    ];
  },
};

/** Everything from the old `init` hook (chat/tracker render wiring). */
export function onInit() {
  live = true;
  // Foundry v13+ renders chat messages via renderChatMessageHTML (HTMLElement).
  Hooks.on("renderChatMessageHTML", onRenderChatMessage);
  Hooks.on("renderCombatTracker", onRenderCombatTracker);
  wireEncounterRedraws();
  registerQuickProvider(quickProvider);
}

/** Everything from the old `ready` hook (pf2e-dependent automation). */
export function onReady() {
  if (game.system?.id !== "pf2e") {
    console.warn(`${MODULE_ID} | The Pathfinder 2e system is required; flatfinder automation disabled.`);
    return;
  }
  registerIncapacitation();
  registerFlattenDc();
  console.log(`${MODULE_ID} | Flatfinder automation ready.`);
}

/** The feature's public surface (`api.features.flatfinder`); inert while the feature is off. */
export const api = Object.freeze({
  openPlanner: () => (live ? openPlanner() : null),
});
