/**
 * GLUniverse — Loot Generator : feature entry (ported into the GLUniverse Suite).
 *
 * Per the suite contract this module does NOTHING at import time except define
 * functions/objects. All Foundry hook wiring, settings/keybinding registration,
 * adapter registration and review-card binding is deferred to the lifecycle
 * functions exported below, which the feature's adapter (index.mjs) delegates
 * into:
 *   - onRegisterSettings()  → always at init (so the toggle/menus exist)
 *   - onInit()              → at init, only when the feature is enabled & available
 *   - onReady()             → at ready, only when the feature is enabled & available
 */

import { MODULE_ID, HOOKS, CONTEXT } from "./const.js";
import { registerSettings, applyMotionTier } from "./settings.js";
// System adapters: imported for their factory objects only. They no longer
// self-register on import — onInit() registers them so a disabled feature is inert.
import { pf2eAdapter } from "./systems/pf2e/adapter.js";
import { dnd5eAdapter } from "./systems/dnd5e/adapter.js";
import { registerAdapter, getAdapter, systemSupported } from "./systems/registry.js";
import { AuditorDashboard } from "./apps/auditor.js";
import { WealthLedger } from "./auditor/ledger.js";
import { buildReport } from "./auditor/health-check.js";
import {
  buildRequest, combatRequest, explorationRequest, dungeonRequest, questRequest, shopRequest
} from "./loot/adapters.js";
import { proposeLoot } from "./loot/cascade.js";
import { proposeShop } from "./loot/shop.js";
import { materialize } from "./loot/materializer.js";
import { decorateProposal, flavorEnabled } from "./loot/decorator.js";
import { clearItemIndex } from "./loot/item-selector.js";
import { postReviewCard, bindReviewCardActions } from "./apps/review-card.js";
import { openGenerateDialog } from "./apps/generate-dialog.js";
import { openWorkshopDialog } from "./apps/workshop-dialog.js";
import { runWorkshop, workshopEnabled } from "./loot/workshop.js";

/**
 * The feature's public API object. Built once at import (pure references, no side
 * effects). Other feature files may import this directly; it is also surfaced via
 * the adapter `api` field (index.mjs) so the suite's
 * `game.modules.get("gluniverse-foundry-modules").api.features["loot-gen"]` resolves here —
 * replacing the old `game.modules.get("gluniverse-loot-gen").api`.
 */
export const LootGenAPI = {
  AuditorDashboard, WealthLedger, buildReport, HOOKS,
  // Loot model (build #2) — request builders.
  loot: { buildRequest, combatRequest, explorationRequest, dungeonRequest, questRequest, shopRequest },
  // Generation pipeline (build #3+) — cascade → decorate → review card → materialize.
  generate: { openGenerateDialog, proposeLoot, decorateProposal, flavorEnabled, postReviewCard, materialize, clearItemIndex },
  // Loot Workshop (/grill-me) — LLM-authored custom loot.
  workshop: { openWorkshopDialog, runWorkshop, workshopEnabled },
  // Shop generator (DESIGN §18) — budget-neutral buyable Merchant actors.
  shop: { proposeShop, openShopDialog: () => openGenerateDialog(CONTEXT.SHOP) }
};

/* ------------------------------- init phase ------------------------------- */

/** Register the feature's settings/menus. Always runs (so the toggle exists). */
export function onRegisterSettings() {
  registerSettings();
}

/** Everything that used to live in the old `init` hook. Enabled-only. */
export function onInit() {
  // Adapters register here (deferred from import) so a disabled feature is inert.
  registerAdapter(pf2eAdapter);
  registerAdapter(dnd5eAdapter);

  registerKeybindings();

  // The /grill-me chat command opens the Loot Workshop (GM-only). Returning false
  // stops the slash text from posting to chat. Anything else is left for Foundry.
  Hooks.on("chatMessage", (_chatLog, message, _chatData) => {
    const m = /^\/grill-?me\b\s*([\s\S]*)$/i.exec(String(message ?? "").trim());
    if (!m) return true;
    if (!game.user?.isGM) {
      ui.notifications?.warn("GLLG: only the GM can open the Loot Workshop.");
      return false;
    }
    openWorkshopDialog(m[1]?.trim() || "");
    return false;
  });

  // The auditor reads live sheets, so any gear/level/coin change should repaint it.
  // Refresh is debounced inside the app, so bursts (e.g. dropping a full kit) coalesce.
  for (const hook of ["updateActor", "createItem", "updateItem", "deleteItem"]) {
    Hooks.on(hook, doc => {
      // Only bother for character actors (the item hooks carry the parent actor).
      const actor = doc?.actor ?? doc;
      if (actor?.type && actor.type !== "character") return;
      AuditorDashboard.refresh();
    });
  }

  // v13+ scene controls (keyed objects; handlers use onChange).
  Hooks.on("getSceneControlButtons", controls => {
    if (!game.user?.isGM) return;
    const group = controls.tokens ?? controls.notes ?? Object.values(controls)[0];
    if (!group?.tools) return;
    group.tools["gllg-auditor"] = {
      name: "gllg-auditor",
      title: "GLLG.controls.openAuditor",
      icon: "fa-solid fa-gem",
      button: true,
      onChange: () => AuditorDashboard.toggle()
    };
    group.tools["gllg-generate"] = {
      name: "gllg-generate",
      title: "GLLG.controls.generateLoot",
      icon: "fa-solid fa-wand-sparkles",
      button: true,
      onChange: () => openGenerateDialog()
    };
    group.tools["gllg-workshop"] = {
      name: "gllg-workshop",
      title: "GLLG.controls.workshop",
      icon: "fa-solid fa-hammer",
      button: true,
      onChange: () => openWorkshopDialog()
    };
    group.tools["gllg-shop"] = {
      name: "gllg-shop",
      title: "GLLG.controls.shop",
      icon: "fa-solid fa-shop",
      button: true,
      onChange: () => openGenerateDialog(CONTEXT.SHOP)
    };
  });
}

/* ------------------------------- ready phase ------------------------------ */

/** Everything that used to live in the old `ready` hook. Enabled-only. */
export function onReady() {
  applyMotionTier();   // reflect the motion-tier preference onto <body>
  const adapter = getAdapter();
  if (!systemSupported()) {
    console.warn(`${MODULE_ID} | no loot adapter for the "${game.system?.id}" system — the feature is idle.`);
  } else {
    console.log(`${MODULE_ID} | active loot adapter: ${adapter.label} (${adapter.id})`);
  }
  bindReviewCardActions();
}

/* Keybindings live under the suite scope; keys are `lg.`-prefixed to avoid
   colliding with other features' keybindings on the same package id. */
function registerKeybindings() {
  game.keybindings.register(MODULE_ID, "lg.toggleAuditor", {
    name: "GLLG.keybindings.toggleAuditor",
    editable: [{ key: "KeyL", modifiers: ["Alt"] }],
    onDown: () => { AuditorDashboard.toggle(); return true; },
    restricted: false
  });
  game.keybindings.register(MODULE_ID, "lg.generateLoot", {
    name: "GLLG.keybindings.generateLoot",
    editable: [{ key: "KeyG", modifiers: ["Alt"] }],
    onDown: () => { if (game.user?.isGM) openGenerateDialog(); return true; },
    restricted: true
  });
  game.keybindings.register(MODULE_ID, "lg.workshop", {
    name: "GLLG.keybindings.workshop",
    editable: [{ key: "KeyW", modifiers: ["Alt"] }],
    onDown: () => { if (game.user?.isGM) openWorkshopDialog(); return true; },
    restricted: true
  });
  game.keybindings.register(MODULE_ID, "lg.shop", {
    name: "GLLG.keybindings.shop",
    editable: [{ key: "KeyS", modifiers: ["Alt"] }],
    onDown: () => { if (game.user?.isGM) openGenerateDialog(CONTEXT.SHOP); return true; },
    restricted: true
  });
}
