/**
 * GLUniverse Suite — feature adapter for "loot-gen" (the Loot Generator).
 *
 * Registers the feature with the suite registry and delegates its lifecycle into
 * the ported entry module (./module.js). Nothing runs at import time beyond the
 * registry record; settings register at init, and gated init/ready wiring runs
 * only when the feature is enabled & available (pf2e or dnd5e).
 */

import { Suite } from "../../core/registry.mjs";
import { onRegisterSettings, onInit, onReady, LootGenAPI } from "./module.js";

Suite.register({
  id: "loot-gen",
  title: "GLS.feature.loot-gen.title",
  hint: "GLS.feature.loot-gen.hint",
  icon: "fa-solid fa-gem",
  system: ["pf2e", "dnd5e"],
  requires: [],
  core: false,
  defaultEnabled: false,

  registerSettings() {
    onRegisterSettings();
  },

  onInit() {
    onInit();
  },

  onReady() {
    onReady();
  },

  // Migration from the standalone `gluniverse-loot-gen` module: every old setting
  // key gains the `lg.` feature prefix under the suite namespace. (Flag scopes also
  // moved to the suite, but loot-gen's flags are transient chat/proposal/working
  // state — no persistent document data needs relocating, so no `migrate` hook.)
  legacy: {
    id: "gluniverse-loot-gen",
    settings: {
      ledger: "lg.ledger",
      partyActorId: "lg.partyActorId",
      shoppingAccess: "lg.shoppingAccess",
      variantABP: "lg.variantABP",
      proficiencyWithoutLevel: "lg.proficiencyWithoutLevel",
      driftTolerancePct: "lg.driftTolerancePct",
      heirloomMode: "lg.heirloomMode",
      heirloomArmor: "lg.heirloomArmor",
      etchRunes: "lg.etchRunes",
      dnd5eSourceMode: "lg.dnd5eSourceMode",
      dnd5eSourcePack: "lg.dnd5eSourcePack",
      dnd5eSourceBooks: "lg.dnd5eSourceBooks",
      dnd5eAutoImport: "lg.dnd5eAutoImport",
      llmFlavor: "lg.llmFlavor",
      sidecarUrl: "lg.sidecarUrl",
      sidecarSecret: "lg.sidecarSecret",
      llmModel: "lg.llmModel",
      campaignContext: "lg.campaignContext",
      llmLog: "lg.llmLog",
      auditorPosition: "lg.auditorPosition",
      auditorHidden: "lg.auditorHidden",
      motionTier: "lg.motionTier",
    },
  },

  // Exposed as game.modules.get("gluniverse-suite").api.features["loot-gen"].
  api: LootGenAPI,
});
